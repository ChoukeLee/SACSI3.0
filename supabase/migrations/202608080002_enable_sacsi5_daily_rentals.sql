-- Enable daily rentals for any unit explicitly configured for the business.
-- This replaces the former SACSI11-only guard while keeping the same atomic workflow.

-- Create daily-rental bookings atomically.
-- Conflict checks, booking creation, unit status, receivable, and audit log
-- either all commit or all roll back.

alter table public.daily_bookings
  add column if not exists creation_request_id uuid;

create unique index if not exists daily_bookings_creation_request_id_key
  on public.daily_bookings (creation_request_id)
  where creation_request_id is not null;

create or replace function public.daily_create_booking_rpc(
  p_unit_id uuid,
  p_customer_id uuid,
  p_check_in date,
  p_check_out date default null,
  p_checkout_mode text default 'fixed',
  p_nightly_price_xof numeric default 40000,
  p_notes text default null,
  p_ota_source text default null,
  p_request_id uuid default null,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit units%rowtype;
  v_booking daily_bookings%rowtype;
  v_existing_booking_id uuid;
  v_daily_rental_enabled boolean;
  v_customer_blacklisted boolean;
  v_effective_check_out date;
  v_conflicting_booking daily_bookings%rowtype;
  v_nights integer;
  v_total numeric;
  v_next_status public.unit_status;
begin
  if p_request_id is null then
    raise exception 'requestIdRequired';
  end if;
  if p_check_in is null then
    raise exception 'checkInRequired';
  end if;
  if p_check_in < current_date then
    raise exception 'pastDateNotAllowed';
  end if;
  if p_checkout_mode not in ('fixed', 'open') then
    raise exception 'invalidCheckoutMode';
  end if;
  if p_checkout_mode = 'fixed' and (p_check_out is null or p_check_out <= p_check_in) then
    raise exception 'invalidDateRange';
  end if;
  if p_nightly_price_xof is null or p_nightly_price_xof <= 0 then
    raise exception 'invalidPrice';
  end if;

  -- Serialize retries that carry the same request id, including retries that
  -- accidentally target a different room because the client state changed.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  -- Serialize all creates for the same room. This closes the race between
  -- checking availability and inserting the booking.
  select *
    into v_unit
  from public.units
  where id = p_unit_id
  for update;

  if v_unit.id is null then
    raise exception 'unitNotFound';
  end if;

  -- A retry with the same request id returns the already committed booking.
  select id
    into v_existing_booking_id
  from public.daily_bookings
  where creation_request_id = p_request_id;

  if v_existing_booking_id is not null then
    return public.daily_booking_operation_snapshot(v_existing_booking_id, p_unit_id);
  end if;

  select exists (
    select 1
    from public.unit_business_flags f
    where f.unit_id = p_unit_id
      and f.business_type = 'daily_rental'
      and f.is_enabled = true
  ) into v_daily_rental_enabled;

  if not v_daily_rental_enabled then
    raise exception 'dailyRentalNotEnabledForUnit';
  end if;

  if v_unit.status = 'maintenance' then raise exception 'unitMaintenance'; end if;
  if v_unit.status = 'locked' then raise exception 'unitLocked'; end if;
  if v_unit.status = 'sold' then raise exception 'saleConflict'; end if;
  if v_unit.status = 'leased' then raise exception 'longLeaseConflict'; end if;

  select is_blacklisted
    into v_customer_blacklisted
  from public.customers
  where id = p_customer_id;

  if not found then
    raise exception 'customerNotFound';
  end if;
  if v_customer_blacklisted then
    raise exception 'customerBlacklisted';
  end if;

  v_effective_check_out := case
    when p_checkout_mode = 'open' then date '9999-12-31'
    else p_check_out
  end;

  select *
    into v_conflicting_booking
  from public.daily_bookings b
  where b.unit_id = p_unit_id
    and b.status in ('pending_review', 'confirmed', 'checked_in')
    and b.check_in < v_effective_check_out
    and p_check_in < case
      when b.checkout_mode = 'open' then date '9999-12-31'
      else coalesce(b.check_out, b.check_in)
    end
  order by b.check_in
  limit 1;

  if v_conflicting_booking.id is not null then
    raise exception 'doubleBooked: % -> %',
      v_conflicting_booking.check_in,
      case
        when v_conflicting_booking.checkout_mode = 'open' then '?'
        else coalesce(v_conflicting_booking.check_out::text, '?')
      end;
  end if;

  if exists (
    select 1
    from public.lease_contracts l
    where l.unit_id = p_unit_id
      and l.status = 'active'
      and l.start_date < v_effective_check_out
      and l.expected_end_date > p_check_in
  ) then
    raise exception 'longLeaseConflict';
  end if;

  if exists (
    select 1
    from public.sale_contracts s
    where s.unit_id = p_unit_id
      and s.status = 'active'
  ) then
    raise exception 'saleConflict';
  end if;

  v_nights := case
    when p_checkout_mode = 'fixed' then greatest(1, p_check_out - p_check_in)
    else 1
  end;
  v_total := round(p_nightly_price_xof * v_nights);

  insert into public.daily_bookings(
    unit_id,
    customer_id,
    check_in,
    check_out,
    checkout_mode,
    nightly_price_xof,
    total_amount_xof,
    final_amount_xof,
    prepaid_amount_xof,
    billing_status,
    status,
    ota_source,
    notes,
    creation_request_id
  )
  values (
    p_unit_id,
    p_customer_id,
    p_check_in,
    case when p_checkout_mode = 'fixed' then p_check_out else null end,
    p_checkout_mode,
    p_nightly_price_xof,
    v_total,
    v_total,
    0,
    'need_top_up',
    'pending_review',
    p_ota_source,
    p_notes,
    p_request_id
  )
  returning * into v_booking;

  insert into public.receivables(
    building_id,
    unit_id,
    customer_id,
    source_type,
    source_id,
    category,
    title,
    due_date,
    amount_xof,
    paid_amount_xof,
    status,
    currency
  )
  values (
    v_unit.building_id,
    p_unit_id,
    p_customer_id,
    'daily_booking',
    v_booking.id,
    'daily_rental',
    '日租 ' || p_check_in,
    p_check_in,
    v_total,
    0,
    'pending',
    'XOF'
  );

  v_next_status := public.daily_resolve_unit_status(p_unit_id);
  update public.units
  set status = v_next_status,
      updated_at = now()
  where id = p_unit_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    (p_actor->>'actor_id')::uuid,
    'create',
    'daily_booking',
    v_booking.id,
    p_actor || jsonb_build_object(
      'unit_id', p_unit_id,
      'customer_id', p_customer_id,
      'check_in', p_check_in,
      'check_out', p_check_out,
      'checkout_mode', p_checkout_mode,
      'request_id', p_request_id
    )
  );

  return public.daily_booking_operation_snapshot(v_booking.id, p_unit_id);
end;
$$;

grant execute on function public.daily_create_booking_rpc(
  uuid, uuid, date, date, text, numeric, text, text, uuid, jsonb
) to authenticated, service_role;



create or replace function public.enforce_daily_booking_sacsi11_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.unit_business_flags f
    where f.unit_id = new.unit_id
      and f.business_type = 'daily_rental'
      and f.is_enabled = true
  ) then
    raise exception 'dailyRentalNotEnabledForUnit'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_daily_booking_sacsi11_unit() is
  'Guards daily bookings by enabled daily_rental business flag; legacy function name retained for trigger compatibility.';

