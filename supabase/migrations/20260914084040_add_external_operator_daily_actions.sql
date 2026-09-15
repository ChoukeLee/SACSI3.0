begin;

-- The existing page RPCs remain the only writers. This migration makes the
-- first external-operator slice use the same atomic payment path while
-- authorizing against the versioned operator-action catalog.

create or replace function public.daily_booking_operation_snapshot(
  p_booking_id uuid,
  p_unit_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_unit_id uuid;
  v_unit jsonb;
begin
  if not (
    (select auth.jwt()->>'role') = 'service_role'
    or
    private.current_operator_action_allowed('query_daily_booking', 'L0')
    or private.current_operator_action_allowed('record_daily_payment', 'L2')
  ) then
    raise exception 'dailyReadPermissionDenied' using errcode = '42501';
  end if;

  select * into v_booking from public.daily_bookings where id = p_booking_id;
  v_unit_id := coalesce(v_booking.unit_id, p_unit_id);

  if v_unit_id is not null then
    select to_jsonb(u) into v_unit from public.units u where u.id = v_unit_id;
  end if;

  return jsonb_build_object(
    'booking', case when v_booking.id is null then null else to_jsonb(v_booking) end,
    'unit', coalesce(v_unit, 'null'::jsonb),
    'receivables', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.due_date desc, r.created_at desc)
      from public.receivables r
      where r.source_type = 'daily_booking' and r.source_id = p_booking_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.payment_date desc, p.created_at desc)
      from public.payments p
      where p.source_type = 'daily_booking' and p.source_id = p_booking_id
    ), '[]'::jsonb),
    'cleaningTasks', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from public.cleaning_tasks c
      where c.unit_id = v_unit_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.operator_query_daily_booking(
  p_booking_id uuid default null,
  p_building_code text default null,
  p_unit_no text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.units%rowtype;
  v_building public.buildings%rowtype;
  v_booking_id uuid;
  v_active_count integer;
  v_snapshot jsonb;
begin
  if not private.current_operator_action_allowed('query_daily_booking', 'L0') then
    raise exception 'dailyReadPermissionDenied' using errcode = '42501';
  end if;

  if p_booking_id is null and (nullif(btrim(p_building_code), '') is null or nullif(btrim(p_unit_no), '') is null) then
    raise exception 'bookingSelectorRequired';
  end if;
  if p_booking_id is not null and (p_building_code is not null or p_unit_no is not null) then
    raise exception 'bookingSelectorConflict';
  end if;

  if p_booking_id is not null then
    select b.id into v_booking_id from public.daily_bookings b where b.id = p_booking_id;
    if v_booking_id is null then
      return jsonb_build_object('status', 'not_found', 'selector', jsonb_build_object('bookingId', p_booking_id));
    end if;
  else
    select u.* into v_unit
    from public.units u
    join public.buildings b on b.id = u.building_id
    where lower(b.code) = lower(btrim(p_building_code))
      and lower(u.unit_no) = lower(btrim(p_unit_no));

    if v_unit.id is null then
      return jsonb_build_object(
        'status', 'not_found',
        'selector', jsonb_build_object('buildingCode', btrim(p_building_code), 'unitNo', btrim(p_unit_no))
      );
    end if;

    select b.* into v_building from public.buildings b where b.id = v_unit.building_id;

    select count(*) into v_active_count
    from public.daily_bookings d
    where d.unit_id = v_unit.id
      and d.status in ('pending_review', 'confirmed', 'checked_in');

    select d.id into v_booking_id
    from public.daily_bookings d
    where d.unit_id = v_unit.id
      and d.status in ('pending_review', 'confirmed', 'checked_in')
    order by d.check_in desc, d.created_at desc
    limit 1;

    if v_active_count <> 1 then
      return jsonb_build_object(
        'status', case when v_active_count > 1 then 'ambiguous' else 'selection_required' end,
        'unit', to_jsonb(v_unit) || jsonb_build_object(
          'building_code', v_building.code,
          'building_name', v_building.display_name
        ),
        'candidates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'bookingId', d.id,
            'status', d.status,
            'checkIn', d.check_in,
            'checkOut', d.check_out,
            'checkoutMode', d.checkout_mode,
            'guestName', d.guest_name,
            'updatedAt', d.updated_at
          ) order by d.check_in desc, d.created_at desc)
          from (
            select * from public.daily_bookings
            where unit_id = v_unit.id
            order by check_in desc, created_at desc
            limit 10
          ) d
        ), '[]'::jsonb)
      );
    end if;
  end if;

  v_snapshot := public.daily_booking_operation_snapshot(v_booking_id, null);
  return jsonb_build_object(
    'status', 'found',
    'snapshot', v_snapshot,
    'context', (
      select jsonb_build_object(
        'buildingCode', building.code,
        'buildingName', building.display_name,
        'bookingAgent', case when agent.id is null then null else jsonb_build_object('id', agent.id, 'name', agent.name) end,
        'guest', case when guest.id is null then null else jsonb_build_object('id', guest.id, 'name', guest.name) end
      )
      from public.daily_bookings booking
      join public.units unit_record on unit_record.id = booking.unit_id
      join public.buildings building on building.id = unit_record.building_id
      left join public.customers agent on agent.id = coalesce(booking.booking_agent_id, booking.customer_id)
      left join public.customers guest on guest.id = booking.guest_customer_id
      where booking.id = v_booking_id
    )
  );
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
set search_path = ''
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_unit public.units%rowtype;
  v_paid numeric;
  v_final numeric;
  v_payment_id uuid;
  v_existing_booking_id uuid;
  v_existing_kind text;
  v_nights integer;
  v_before jsonb;
  v_after jsonb;
  v_audit_metadata jsonb;
begin
  if not (
    (select auth.jwt()->>'role') = 'service_role'
    or private.current_operator_action_allowed('record_daily_payment', 'L2')
  ) then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or trunc(p_amount) <> p_amount then
    raise exception 'invalidPaymentAmount';
  end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select source_id, request_kind into v_existing_booking_id, v_existing_kind
  from public.payments where request_id = p_request_id;
  if v_existing_booking_id is not null then
    if v_existing_booking_id <> p_booking_id or v_existing_kind is distinct from 'daily_payment' then
      raise exception 'requestIdConflict';
    end if;
    return public.daily_booking_operation_snapshot(p_booking_id, null);
  end if;

  select * into v_booking from public.daily_bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status not in ('pending_review', 'confirmed', 'checked_in', 'checked_out') then
    raise exception 'bookingNotPayable';
  end if;

  v_before := jsonb_build_object(
    'prepaid_amount_xof', v_booking.prepaid_amount_xof,
    'total_amount_xof', v_booking.total_amount_xof,
    'final_amount_xof', v_booking.final_amount_xof,
    'billing_status', v_booking.billing_status
  );

  -- Running open stays accrue through today before the overpayment check.
  if coalesce(v_booking.checkout_mode, 'fixed') = 'open'
    and v_booking.status = 'checked_in'
    and v_booking.actual_check_out is null then
    v_nights := greatest(1, current_date - v_booking.check_in);
    update public.daily_bookings
    set total_amount_xof = v_nights * nightly_price_xof,
        final_amount_xof = greatest(0, v_nights * nightly_price_xof - coalesce(manual_discount_amount_xof, 0)),
        updated_at = now()
    where id = p_booking_id
    returning * into v_booking;
  end if;

  select * into v_unit from public.units where id = v_booking.unit_id;
  select coalesce(sum(amount), 0) into v_paid
  from public.payments where source_type = 'daily_booking' and source_id = p_booking_id;
  v_final := greatest(0, coalesce(v_booking.final_amount_xof, v_booking.total_amount_xof, 0));
  if v_paid + p_amount > v_final then raise exception 'paymentExceedsOutstanding'; end if;

  insert into public.payments(
    customer_id, unit_id, source_type, source_id, payment_date,
    amount, currency, exchange_rate_to_xof, receipt_no, request_id, request_kind
  ) values (
    v_booking.customer_id, v_booking.unit_id, 'daily_booking', p_booking_id,
    coalesce(p_payment_date, current_date), p_amount, 'XOF', 1,
    nullif(btrim(p_receipt_no), ''), p_request_id, 'daily_payment'
  ) returning id into v_payment_id;

  insert into public.ledger_entries(
    building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
  ) values (
    v_unit.building_id, v_booking.unit_id, v_payment_id,
    coalesce(p_payment_date, current_date), 'income', 'daily_rental', p_amount,
    '日租收款 房间' || v_unit.unit_no
  );

  perform public.daily_sync_booking_finance_tx(p_booking_id);
  select to_jsonb(b) into v_after from public.daily_bookings b where b.id = p_booking_id;

  v_audit_metadata := jsonb_build_object(
    'payment_id', v_payment_id,
    'amount', p_amount,
    'payment_date', coalesce(p_payment_date, current_date),
    'request_id', p_request_id,
    'booking_status_at_payment', v_booking.status,
    'channel', left(coalesce(p_actor->>'channel', 'sacsi_web'), 40),
    'connector_version', left(coalesce(p_actor->>'connector_version', ''), 80),
    'protocol_version', left(coalesce(p_actor->>'protocol_version', ''), 40),
    'input_source', left(coalesce(p_actor->>'input_source', 'manual_form'), 40),
    'original_instruction', left(coalesce(p_actor->>'original_instruction', ''), 4000)
  );

  insert into public.audit_logs(
    actor_id, actor_email, actor_role, action, entity_type, entity_id,
    entity_label, before_data, after_data, metadata
  ) values (
    (select auth.uid()), left(coalesce((select auth.jwt()->>'email'), ''), 320), public.current_user_role(),
    'supplementary_payment', 'daily_booking', p_booking_id,
    v_unit.code, v_before,
    jsonb_build_object(
      'prepaid_amount_xof', v_after->'prepaid_amount_xof',
      'total_amount_xof', v_after->'total_amount_xof',
      'final_amount_xof', v_after->'final_amount_xof',
      'billing_status', v_after->'billing_status'
    ),
    v_audit_metadata
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function private.verify_operator_daily_payment(
  p_booking_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_booking public.daily_bookings%rowtype;
  v_audit public.audit_logs%rowtype;
begin
  if not private.current_operator_action_allowed('record_daily_payment', 'L2') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;

  select * into v_payment from public.payments
  where request_id = p_request_id and request_kind = 'daily_payment' and source_id = p_booking_id;
  select * into v_booking from public.daily_bookings where id = p_booking_id;
  select * into v_audit from public.audit_logs
  where actor_id = (select auth.uid())
    and entity_type = 'daily_booking'
    and entity_id = p_booking_id
    and action = 'supplementary_payment'
    and metadata->>'request_id' = p_request_id::text
  order by created_at desc limit 1;

  return jsonb_build_object(
    'verified', v_payment.id is not null and v_booking.id is not null and v_audit.id is not null,
    'payment', case when v_payment.id is null then null else to_jsonb(v_payment) end,
    'booking', case when v_booking.id is null then null else jsonb_build_object(
      'id', v_booking.id,
      'prepaidAmountXof', v_booking.prepaid_amount_xof,
      'totalAmountXof', v_booking.total_amount_xof,
      'finalAmountXof', v_booking.final_amount_xof,
      'billingStatus', v_booking.billing_status,
      'status', v_booking.status
    ) end,
    'receivables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'amountXof', r.amount_xof, 'paidAmountXof', r.paid_amount_xof, 'status', r.status
      ) order by r.created_at desc)
      from public.receivables r
      where r.source_type = 'daily_booking' and r.source_id = p_booking_id and r.status <> 'cancelled'
    ), '[]'::jsonb),
    'audit', case when v_audit.id is null then null else jsonb_build_object(
      'id', v_audit.id, 'actorId', v_audit.actor_id, 'action', v_audit.action, 'createdAt', v_audit.created_at
    ) end
  );
end;
$$;

create or replace function public.operator_query_daily_booking(
  p_booking_id uuid default null,
  p_building_code text default null,
  p_unit_no text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.operator_query_daily_booking($1, $2, $3);
$$;

create or replace function public.verify_operator_daily_payment(
  p_booking_id uuid,
  p_request_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.verify_operator_daily_payment($1, $2);
$$;

revoke all on function private.operator_query_daily_booking(uuid, text, text) from public, anon;
revoke all on function private.verify_operator_daily_payment(uuid, uuid) from public, anon;
grant execute on function private.operator_query_daily_booking(uuid, text, text) to authenticated;
grant execute on function private.verify_operator_daily_payment(uuid, uuid) to authenticated;
revoke all on function public.operator_query_daily_booking(uuid, text, text) from public, anon;
revoke all on function public.verify_operator_daily_payment(uuid, uuid) from public, anon;
revoke all on function public.daily_booking_operation_snapshot(uuid, uuid) from public, anon;
revoke all on function public.daily_record_payment_rpc(uuid, numeric, date, text, uuid, jsonb) from public, anon;
grant execute on function public.operator_query_daily_booking(uuid, text, text) to authenticated;
grant execute on function public.verify_operator_daily_payment(uuid, uuid) to authenticated;
grant execute on function public.daily_booking_operation_snapshot(uuid, uuid) to authenticated, service_role;
grant execute on function public.daily_record_payment_rpc(uuid, numeric, date, text, uuid, jsonb) to authenticated, service_role;

commit;
