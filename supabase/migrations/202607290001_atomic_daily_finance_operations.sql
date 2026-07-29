-- Make daily-rental money and status operations atomic and idempotent.
-- Historical rows are not rewritten by this migration.

begin;

alter table public.payments
  add column if not exists request_kind text,
  add column if not exists reversal_of_payment_id uuid references public.payments(id),
  add column if not exists reversal_reason text;

create unique index if not exists payments_one_reversal_per_payment_key
  on public.payments(reversal_of_payment_id)
  where reversal_of_payment_id is not null;

create table if not exists public.daily_operation_requests (
  request_id uuid primary key,
  operation_kind text not null,
  booking_id uuid not null references public.daily_bookings(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.daily_operation_requests enable row level security;
revoke all on table public.daily_operation_requests from public, anon, authenticated;
grant select, insert on table public.daily_operation_requests to service_role;

create or replace function public.daily_sync_booking_finance_tx(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_paid numeric;
  v_final numeric;
begin
  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then raise exception 'bookingNotFound'; end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where source_type = 'daily_booking'
    and source_id = p_booking_id;

  v_paid := greatest(0, v_paid);
  v_final := greatest(0, coalesce(v_booking.final_amount_xof, v_booking.total_amount_xof, 0));

  update public.receivables
  set amount_xof = v_final,
      paid_amount_xof = least(v_final, v_paid),
      status = case
        when status = 'cancelled' then status
        when v_paid >= v_final then 'paid'
        when v_paid > 0 then 'partial'
        when due_date < current_date then 'overdue'
        else 'pending'
      end,
      updated_at = now()
  where source_type = 'daily_booking'
    and source_id = p_booking_id;

  update public.daily_bookings
  set prepaid_amount_xof = v_paid,
      billing_status = case
        when v_paid >= v_final and status = 'checked_out' then 'settled'
        when v_paid >= v_final then 'prepaid'
        when v_paid > 0 then 'partially_paid'
        else 'need_top_up'
      end,
      updated_at = now()
  where id = p_booking_id;
end;
$$;

revoke all on function public.daily_sync_booking_finance_tx(uuid) from public, anon, authenticated;
grant execute on function public.daily_sync_booking_finance_tx(uuid) to service_role;

drop function if exists public.daily_check_in_booking_rpc(uuid, numeric, jsonb);

create function public.daily_check_in_booking_rpc(
  p_booking_id uuid,
  p_prepaid_amount numeric default 0,
  p_request_id uuid default null,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_unit public.units%rowtype;
  v_paid numeric;
  v_final numeric;
  v_payment_id uuid;
  v_existing_booking_id uuid;
  v_existing_kind text;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;
  if coalesce(p_prepaid_amount, 0) < 0 then raise exception 'invalidPaymentAmount'; end if;
  if coalesce(p_prepaid_amount, 0) > 0 and p_request_id is null then
    raise exception 'requestIdRequired';
  end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
    select source_id, request_kind
      into v_existing_booking_id, v_existing_kind
    from public.payments
    where request_id = p_request_id;
    if v_existing_booking_id is not null then
      if v_existing_booking_id <> p_booking_id or v_existing_kind is distinct from 'daily_check_in' then
        raise exception 'requestIdConflict';
      end if;
      return public.daily_booking_operation_snapshot(p_booking_id, null);
    end if;
  end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status <> 'confirmed' then raise exception 'bookingNotConfirmed'; end if;

  select * into v_unit
  from public.units
  where id = v_booking.unit_id
  for update;
  if v_unit.status in ('maintenance', 'locked', 'sold', 'leased') then
    raise exception 'unitUnavailable';
  end if;
  if exists (
    select 1 from public.cleaning_tasks
    where unit_id = v_booking.unit_id and is_completed = false
  ) then raise exception 'cleaningPending'; end if;
  if exists (
    select 1 from public.daily_bookings
    where unit_id = v_booking.unit_id and status = 'checked_in' and id <> p_booking_id
  ) then raise exception 'unitAlreadyOccupied'; end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where source_type = 'daily_booking' and source_id = p_booking_id;
  v_final := greatest(0, coalesce(v_booking.final_amount_xof, v_booking.total_amount_xof, 0));
  if v_paid + coalesce(p_prepaid_amount, 0) > v_final then
    raise exception 'paymentExceedsOutstanding';
  end if;

  update public.daily_bookings
  set status = 'checked_in', updated_at = now()
  where id = p_booking_id;

  update public.units
  set status = 'daily_occupied', updated_at = now()
  where id = v_booking.unit_id;

  if coalesce(p_prepaid_amount, 0) > 0 then
    insert into public.payments(
      customer_id, unit_id, source_type, source_id, payment_date,
      amount, currency, exchange_rate_to_xof, request_id, request_kind
    )
    values (
      v_booking.customer_id, v_booking.unit_id, 'daily_booking', p_booking_id, current_date,
      p_prepaid_amount, 'XOF', 1, p_request_id, 'daily_check_in'
    )
    returning id into v_payment_id;

    insert into public.ledger_entries(
      building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
    )
    values (
      v_unit.building_id, v_booking.unit_id, v_payment_id, current_date,
      'income', 'daily_rental', p_prepaid_amount, '日租预付 房间' || v_unit.unit_no
    );
  end if;

  perform public.daily_sync_booking_finance_tx(p_booking_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'check_in', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object(
      'prepaid_amount', coalesce(p_prepaid_amount, 0),
      'request_id', p_request_id
    )
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_record_payment_rpc(
  p_booking_id uuid,
  p_amount numeric,
  p_payment_date date default current_date,
  p_receipt_no text default null,
  p_request_id uuid default null,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_unit public.units%rowtype;
  v_paid numeric;
  v_final numeric;
  v_payment_id uuid;
  v_existing_booking_id uuid;
  v_existing_kind text;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalidPaymentAmount'; end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select source_id, request_kind
    into v_existing_booking_id, v_existing_kind
  from public.payments
  where request_id = p_request_id;
  if v_existing_booking_id is not null then
    if v_existing_booking_id <> p_booking_id or v_existing_kind is distinct from 'daily_payment' then
      raise exception 'requestIdConflict';
    end if;
    return public.daily_booking_operation_snapshot(p_booking_id, null);
  end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status not in ('checked_in', 'checked_out') then
    raise exception 'bookingNotPayable';
  end if;

  select * into v_unit
  from public.units
  where id = v_booking.unit_id;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where source_type = 'daily_booking' and source_id = p_booking_id;
  v_final := greatest(0, coalesce(v_booking.final_amount_xof, v_booking.total_amount_xof, 0));
  if v_paid + p_amount > v_final then raise exception 'paymentExceedsOutstanding'; end if;

  insert into public.payments(
    customer_id, unit_id, source_type, source_id, payment_date,
    amount, currency, exchange_rate_to_xof, receipt_no, request_id, request_kind
  )
  values (
    v_booking.customer_id, v_booking.unit_id, 'daily_booking', p_booking_id,
    coalesce(p_payment_date, current_date), p_amount, 'XOF', 1,
    nullif(btrim(p_receipt_no), ''), p_request_id, 'daily_payment'
  )
  returning id into v_payment_id;

  insert into public.ledger_entries(
    building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
  )
  values (
    v_unit.building_id, v_booking.unit_id, v_payment_id,
    coalesce(p_payment_date, current_date), 'income', 'daily_rental', p_amount,
    '日租收款 房间' || v_unit.unit_no
  );

  perform public.daily_sync_booking_finance_tx(p_booking_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'supplementary_payment', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object(
      'payment_id', v_payment_id,
      'amount', p_amount,
      'payment_date', coalesce(p_payment_date, current_date),
      'request_id', p_request_id
    )
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_reverse_payment_rpc(
  p_payment_id uuid,
  p_reason text,
  p_request_id uuid,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_booking public.daily_bookings%rowtype;
  v_unit public.units%rowtype;
  v_reversal_id uuid;
  v_existing_booking_id uuid;
  v_existing_kind text;
  v_existing_reversal_target uuid;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reversalReasonRequired'; end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select source_id, request_kind, reversal_of_payment_id
    into v_existing_booking_id, v_existing_kind, v_existing_reversal_target
  from public.payments
  where request_id = p_request_id;
  if v_existing_booking_id is not null then
    if v_existing_kind is distinct from 'daily_reversal'
      or v_existing_reversal_target is distinct from p_payment_id then
      raise exception 'requestIdConflict';
    end if;
    return public.daily_booking_operation_snapshot(v_existing_booking_id, null);
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;
  if v_payment.id is null then raise exception 'paymentNotFound'; end if;
  if v_payment.source_type <> 'daily_booking' or v_payment.source_id is null then
    raise exception 'paymentNotDailyRental';
  end if;
  if v_payment.amount <= 0 or v_payment.reversal_of_payment_id is not null then
    raise exception 'paymentCannotBeReversed';
  end if;
  if exists (
    select 1 from public.payments where reversal_of_payment_id = p_payment_id
  ) then raise exception 'paymentAlreadyReversed'; end if;

  select * into v_booking
  from public.daily_bookings
  where id = v_payment.source_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;

  select * into v_unit from public.units where id = v_booking.unit_id;

  insert into public.payments(
    customer_id, unit_id, source_type, source_id, payment_date,
    amount, currency, exchange_rate_to_xof, receipt_no, notes,
    request_id, request_kind, reversal_of_payment_id, reversal_reason
  )
  values (
    v_payment.customer_id, v_payment.unit_id, 'daily_booking', v_payment.source_id,
    current_date, -v_payment.amount, 'XOF', 1,
    'REV-' || left(v_payment.id::text, 8),
    '冲销原收款：' || btrim(p_reason),
    p_request_id, 'daily_reversal', p_payment_id, btrim(p_reason)
  )
  returning id into v_reversal_id;

  insert into public.ledger_entries(
    building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
  )
  values (
    v_unit.building_id, v_booking.unit_id, v_reversal_id, current_date,
    'expense', 'daily_rental', v_payment.amount,
    '冲销日租收款 房间' || v_unit.unit_no || '：' || btrim(p_reason)
  );

  perform public.daily_sync_booking_finance_tx(v_payment.source_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'payment_reversed', 'payment', p_payment_id,
    p_actor || jsonb_build_object(
      'booking_id', v_payment.source_id,
      'reversal_payment_id', v_reversal_id,
      'amount', v_payment.amount,
      'reason', btrim(p_reason),
      'request_id', p_request_id
    )
  );

  return public.daily_booking_operation_snapshot(v_payment.source_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_check_out_booking_rpc(
  p_booking_id uuid,
  p_actual_check_out date default current_date,
  p_final_amount numeric default null,
  p_discount_amount numeric default 0,
  p_discount_reason text default null,
  p_checkout_unit_status public.unit_status default 'cleaning_pending',
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_nights integer;
  v_gross numeric;
  v_discount numeric;
  v_final numeric;
  v_paid numeric;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status <> 'checked_in' then raise exception 'bookingNotCheckedIn'; end if;
  if p_actual_check_out < v_booking.check_in then raise exception 'actualCheckOutBeforeCheckIn'; end if;
  if p_checkout_unit_status <> 'cleaning_pending' then
    raise exception 'checkoutMustCreateCleaning';
  end if;

  v_nights := greatest(1, p_actual_check_out - v_booking.check_in);
  v_gross := round(v_nights * v_booking.nightly_price_xof);
  v_discount := greatest(0, coalesce(p_discount_amount, 0));
  if v_discount > 0 and nullif(btrim(p_discount_reason), '') is null then
    raise exception 'discountReasonRequired';
  end if;
  if v_discount > v_gross then raise exception 'discountExceedsGross'; end if;
  v_final := v_gross - v_discount;
  if p_final_amount is not null and p_final_amount <> v_final then
    raise exception 'finalAmountMustMatchCalculatedAmount';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where source_type = 'daily_booking' and source_id = p_booking_id;

  update public.daily_bookings
  set status = 'checked_out',
      check_out = case when checkout_mode = 'open' then p_actual_check_out else check_out end,
      actual_check_out = p_actual_check_out,
      total_amount_xof = v_gross,
      final_amount_xof = v_final,
      manual_discount_amount_xof = v_discount,
      manual_discount_reason = case when v_discount > 0 then btrim(p_discount_reason) else null end,
      updated_at = now()
  where id = p_booking_id;

  update public.units
  set status = 'cleaning_pending', updated_at = now()
  where id = v_booking.unit_id;

  if not exists (
    select 1 from public.cleaning_tasks
    where daily_booking_id = p_booking_id and is_completed = false
  ) then
    insert into public.cleaning_tasks(unit_id, daily_booking_id, is_completed)
    values (v_booking.unit_id, p_booking_id, false);
  end if;

  perform public.daily_sync_booking_finance_tx(p_booking_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'check_out', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object(
      'actual_check_out', p_actual_check_out,
      'nights', v_nights,
      'gross_amount', v_gross,
      'discount', v_discount,
      'final_amount', v_final,
      'paid_amount', v_paid,
      'outstanding_amount', greatest(0, v_final - v_paid)
    )
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_apply_discount_rpc(
  p_booking_id uuid,
  p_amount numeric,
  p_reason text,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_final numeric;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalidDiscountAmount'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'discountReasonRequired'; end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status <> 'checked_in' then raise exception 'bookingNotCheckedIn'; end if;
  if p_amount > v_booking.total_amount_xof then raise exception 'discountExceedsGross'; end if;

  v_final := v_booking.total_amount_xof - p_amount;
  update public.daily_bookings
  set manual_discount_amount_xof = p_amount,
      manual_discount_reason = btrim(p_reason),
      final_amount_xof = v_final,
      updated_at = now()
  where id = p_booking_id;

  perform public.daily_sync_booking_finance_tx(p_booking_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'apply_discount', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object('discount', p_amount, 'reason', btrim(p_reason))
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_set_fixed_checkout_rpc(
  p_booking_id uuid,
  p_new_check_out date,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_nights integer;
  v_total numeric;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status <> 'checked_in' then raise exception 'bookingNotCheckedIn'; end if;
  if v_booking.checkout_mode <> 'open' then raise exception 'bookingNotOpenEnded'; end if;
  if p_new_check_out <= v_booking.check_in then raise exception 'invalidDateRange'; end if;

  if exists (
    select 1 from public.daily_bookings b
    where b.unit_id = v_booking.unit_id
      and b.id <> p_booking_id
      and b.status in ('pending_review', 'confirmed', 'checked_in')
      and b.check_in < p_new_check_out
      and v_booking.check_in < case
        when b.checkout_mode = 'open' then date '9999-12-31'
        else coalesce(b.check_out, b.check_in)
      end
  ) then raise exception 'doubleBooked'; end if;

  v_nights := greatest(1, p_new_check_out - v_booking.check_in);
  v_total := round(v_nights * v_booking.nightly_price_xof);

  update public.daily_bookings
  set checkout_mode = 'fixed',
      check_out = p_new_check_out,
      actual_check_out = null,
      total_amount_xof = v_total,
      final_amount_xof = greatest(0, v_total - coalesce(manual_discount_amount_xof, 0)),
      updated_at = now()
  where id = p_booking_id;

  perform public.daily_sync_booking_finance_tx(p_booking_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'set_fixed_checkout', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object(
      'previous_mode', 'open',
      'new_check_out', p_new_check_out,
      'nights', v_nights,
      'new_total', v_total
    )
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

drop function if exists public.daily_extend_stay_rpc(uuid, date, integer, jsonb);

create function public.daily_extend_stay_rpc(
  p_booking_id uuid,
  p_new_check_out date default null,
  p_extra_nights integer default 0,
  p_request_id uuid default null,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_nights integer;
  v_total numeric;
  v_existing_request public.daily_operation_requests%rowtype;
  v_request_payload jsonb;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;

  v_request_payload := jsonb_build_object(
    'new_check_out', p_new_check_out,
    'extra_nights', p_extra_nights
  );
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_existing_request
  from public.daily_operation_requests
  where request_id = p_request_id;
  if v_existing_request.request_id is not null then
    if v_existing_request.operation_kind <> 'extend_stay'
      or v_existing_request.booking_id <> p_booking_id
      or v_existing_request.payload <> v_request_payload then
      raise exception 'requestIdConflict';
    end if;
    return public.daily_booking_operation_snapshot(p_booking_id, null);
  end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status <> 'checked_in' then raise exception 'bookingNotCheckedIn'; end if;

  insert into public.daily_operation_requests(request_id, operation_kind, booking_id, payload)
  values (p_request_id, 'extend_stay', p_booking_id, v_request_payload);

  if v_booking.checkout_mode = 'fixed' then
    if p_new_check_out is null or v_booking.check_out is null or p_new_check_out <= v_booking.check_out then
      raise exception 'newCheckOutMustBeLater';
    end if;
    if exists (
      select 1 from public.daily_bookings b
      where b.unit_id = v_booking.unit_id
        and b.id <> p_booking_id
        and b.status in ('pending_review', 'confirmed', 'checked_in')
        and b.check_in < p_new_check_out
        and v_booking.check_in < case
          when b.checkout_mode = 'open' then date '9999-12-31'
          else coalesce(b.check_out, b.check_in)
        end
    ) then raise exception 'doubleBooked'; end if;
    v_nights := greatest(1, p_new_check_out - v_booking.check_in);
    v_total := round(v_nights * v_booking.nightly_price_xof);
    update public.daily_bookings
    set check_out = p_new_check_out,
        total_amount_xof = v_total,
        final_amount_xof = greatest(0, v_total - coalesce(manual_discount_amount_xof, 0)),
        updated_at = now()
    where id = p_booking_id;
  else
    if coalesce(p_extra_nights, 0) <= 0 then raise exception 'invalidExtensionNights'; end if;
    v_nights := p_extra_nights;
    v_total := v_booking.total_amount_xof + round(p_extra_nights * v_booking.nightly_price_xof);
    update public.daily_bookings
    set total_amount_xof = v_total,
        final_amount_xof = greatest(0, v_total - coalesce(manual_discount_amount_xof, 0)),
        updated_at = now()
    where id = p_booking_id;
  end if;

  perform public.daily_sync_booking_finance_tx(p_booking_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'extend_stay', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object(
      'new_check_out', p_new_check_out,
      'extra_nights', v_nights,
      'new_total', v_total
    )
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_cancel_booking_rpc(
  p_booking_id uuid,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_next_status public.unit_status;
  v_paid numeric;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status not in ('pending_review', 'confirmed') then
    raise exception 'bookingCannotBeCancelled';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where source_type = 'daily_booking' and source_id = p_booking_id;
  if v_paid <> 0 then raise exception 'bookingHasPayments'; end if;

  update public.daily_bookings
  set status = 'cancelled',
      prepaid_amount_xof = 0,
      billing_status = 'need_top_up',
      updated_at = now()
  where id = p_booking_id;

  update public.receivables
  set status = 'cancelled', updated_at = now()
  where source_type = 'daily_booking' and source_id = p_booking_id;

  v_next_status := public.daily_resolve_unit_status(v_booking.unit_id, p_booking_id);
  update public.units
  set status = v_next_status, updated_at = now()
  where id = v_booking.unit_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'cancel', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object('next_status', v_next_status)
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

revoke all on function public.daily_check_in_booking_rpc(uuid, numeric, uuid, jsonb) from public, anon;
revoke all on function public.daily_record_payment_rpc(uuid, numeric, date, text, uuid, jsonb) from public, anon;
revoke all on function public.daily_reverse_payment_rpc(uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.daily_apply_discount_rpc(uuid, numeric, text, jsonb) from public, anon;
revoke all on function public.daily_set_fixed_checkout_rpc(uuid, date, jsonb) from public, anon;
revoke all on function public.daily_extend_stay_rpc(uuid, date, integer, uuid, jsonb) from public, anon;

grant execute on function public.daily_check_in_booking_rpc(uuid, numeric, uuid, jsonb) to authenticated, service_role;
grant execute on function public.daily_record_payment_rpc(uuid, numeric, date, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.daily_reverse_payment_rpc(uuid, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.daily_apply_discount_rpc(uuid, numeric, text, jsonb) to authenticated, service_role;
grant execute on function public.daily_set_fixed_checkout_rpc(uuid, date, jsonb) to authenticated, service_role;
grant execute on function public.daily_extend_stay_rpc(uuid, date, integer, uuid, jsonb) to authenticated, service_role;

commit;
