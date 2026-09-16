begin;

-- Unapplied local migration. Keep the public signature for existing web callers.
-- A missing/NULL identity must never turn a permission guard into SQL NULL.
create or replace function private.current_operator_action_allowed(p_action_name text, p_risk_level text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from private.operator_action_catalog c
    where c.action_name = p_action_name and c.risk_level = p_risk_level
      and (public.current_user_role() = any(c.default_roles) or exists (
        select 1 from private.operator_action_grants g
        where g.user_id = (select auth.uid()) and g.action_name = c.action_name and g.revoked_at is null
      ))
  );
$$;

create or replace function private.operator_record_daily_payment(
  p_booking_id uuid, p_amount numeric, p_payment_date date default current_date,
  p_receipt_no text default null, p_request_id uuid default null, p_actor jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_unit public.units%rowtype;
  v_existing public.payments%rowtype;
  v_payment_id uuid;
  v_actor_id uuid := (select auth.uid());
  v_date date := coalesce(p_payment_date, current_date);
  v_receipt text := nullif(btrim(p_receipt_no), '');
  v_paid numeric;
  v_final numeric;
  v_nights integer;
  v_count integer;
  v_before jsonb;
  v_after jsonb;
begin
  if not coalesce(
    (select auth.jwt()->>'role') = 'service_role'
    or private.current_operator_action_allowed('record_daily_payment', 'L2'), false
  ) then raise exception 'dailyWritePermissionDenied' using errcode = '42501'; end if;
  if p_booking_id is null then raise exception 'bookingNotFound'; end if;
  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_amount <= 0 or trunc(p_amount) <> p_amount or p_amount > 999999999999 then
    raise exception 'invalidPaymentAmount';
  end if;
  if not isfinite(v_date) then raise exception 'invalidPaymentDate'; end if;
  if length(v_receipt) > 120 then raise exception 'invalidReceiptNo'; end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_existing from public.payments where request_id = p_request_id;
  if found then
    -- Compare persisted business fields under the request lock. Transport text
    -- and connector version may change on a retry; the original audit is retained.
    if v_existing.source_type is distinct from 'daily_booking'
      or v_existing.source_id is distinct from p_booking_id
      or v_existing.request_kind is distinct from 'daily_payment'
      or v_existing.amount is distinct from p_amount
      or v_existing.payment_date is distinct from v_date
      or v_existing.receipt_no is distinct from v_receipt
      or v_existing.currency::text is distinct from 'XOF'
      or v_existing.exchange_rate_to_xof is distinct from 1 then
      raise exception 'requestIdConflict';
    end if;
    select count(*) into v_count from public.audit_logs a
    where a.entity_type = 'daily_booking' and a.entity_id = p_booking_id
      and a.action = 'supplementary_payment' and a.actor_id is not distinct from v_actor_id
      and a.metadata->>'request_id' = p_request_id::text
      and a.metadata->>'payment_id' = v_existing.id::text;
    if v_count <> 1 then raise exception 'requestIdConflict'; end if;
    if exists (select 1 from public.payments where reversal_of_payment_id = v_existing.id) then
      raise exception 'paymentAlreadyReversed';
    end if;
    return public.daily_booking_operation_snapshot(p_booking_id, null);
  end if;

  select * into v_booking from public.daily_bookings where id = p_booking_id for update;
  if not found then raise exception 'bookingNotFound'; end if;
  if v_booking.status not in ('pending_review', 'confirmed', 'checked_in', 'checked_out') then
    raise exception 'bookingNotPayable';
  end if;
  select * into v_unit from public.units where id = v_booking.unit_id;
  if not found then raise exception 'bookingFinanceInconsistent'; end if;
  -- Do not silently create or repair missing/misassigned receivables during entry.
  perform 1 from public.receivables r
  where r.source_type = 'daily_booking' and r.source_id = p_booking_id and r.status <> 'cancelled'
  for update;
  select count(*) into v_count from public.receivables r
  where r.source_type = 'daily_booking' and r.source_id = p_booking_id and r.status <> 'cancelled';
  if v_count <> 1 or exists (
    select 1 from public.receivables r
    where r.source_type = 'daily_booking' and r.source_id = p_booking_id and r.status <> 'cancelled'
      and (r.customer_id is distinct from v_booking.customer_id
        or r.unit_id is distinct from v_booking.unit_id or r.building_id is distinct from v_unit.building_id
        or r.currency::text is distinct from 'XOF' or r.category is distinct from 'daily_rental')
  ) then raise exception 'bookingFinanceInconsistent'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments
  where source_type = 'daily_booking' and source_id = p_booking_id;
  if v_paid < 0 or v_booking.prepaid_amount_xof is distinct from greatest(0, v_paid) then
    raise exception 'bookingFinanceInconsistent';
  end if;
  v_before := jsonb_build_object(
    'prepaid_amount_xof', v_booking.prepaid_amount_xof, 'total_amount_xof', v_booking.total_amount_xof,
    'final_amount_xof', v_booking.final_amount_xof, 'billing_status', v_booking.billing_status
  );
  if v_booking.checkout_mode = 'open' and v_booking.status = 'checked_in' and v_booking.actual_check_out is null then
    v_nights := greatest(1, current_date - v_booking.check_in);
    update public.daily_bookings
    set total_amount_xof = v_nights * nightly_price_xof,
      final_amount_xof = greatest(0, v_nights * nightly_price_xof - coalesce(manual_discount_amount_xof, 0)), updated_at = now()
    where id = p_booking_id returning * into v_booking;
  end if;
  v_final := greatest(0, coalesce(v_booking.final_amount_xof, v_booking.total_amount_xof, 0));
  if v_paid + p_amount > v_final then raise exception 'paymentExceedsOutstanding'; end if;
  insert into public.payments(
    customer_id, unit_id, source_type, source_id, payment_date, amount, currency,
    exchange_rate_to_xof, receipt_no, request_id, request_kind
  ) values (v_booking.customer_id, v_booking.unit_id, 'daily_booking', p_booking_id,
    v_date, p_amount, 'XOF', 1, v_receipt, p_request_id, 'daily_payment') returning id into v_payment_id;
  insert into public.ledger_entries(
    building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
  ) values (v_unit.building_id, v_booking.unit_id, v_payment_id, v_date, 'income', 'daily_rental', p_amount,
    '日租收款 房间' || v_unit.unit_no);
  perform public.daily_sync_booking_finance_tx(p_booking_id);
  select to_jsonb(b) into v_after from public.daily_bookings b where b.id = p_booking_id;
  insert into public.audit_logs(
    actor_id, actor_email, actor_role, action, entity_type, entity_id, entity_label, before_data, after_data, metadata
  ) values (v_actor_id, left(coalesce((select auth.jwt()->>'email'), ''), 320), public.current_user_role(),
    'supplementary_payment', 'daily_booking', p_booking_id, v_unit.code, v_before,
    jsonb_build_object('prepaid_amount_xof', v_after->'prepaid_amount_xof', 'total_amount_xof', v_after->'total_amount_xof',
      'final_amount_xof', v_after->'final_amount_xof', 'billing_status', v_after->'billing_status'),
    jsonb_build_object('payment_id', v_payment_id, 'amount', p_amount, 'payment_date', v_date, 'receipt_no', v_receipt,
      'request_id', p_request_id, 'booking_agent_id', v_booking.booking_agent_id,
      'booking_status_at_payment', v_booking.status,
      'channel', left(coalesce(p_actor->>'channel', 'sacsi_web'), 40),
      'connector_version', left(coalesce(p_actor->>'connector_version', ''), 80),
      'protocol_version', left(coalesce(p_actor->>'protocol_version', ''), 40),
      'input_source', left(coalesce(p_actor->>'input_source', 'manual_form'), 40),
      'original_instruction', left(coalesce(p_actor->>'original_instruction', ''), 4000))
  );
  if not coalesce((private.operator_daily_payment_integrity(p_booking_id, p_request_id, v_actor_id)->>'verified')::boolean, false) then
    raise exception 'paymentIntegrityCheckFailed';
  end if;
  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_record_payment_rpc(
  p_booking_id uuid, p_amount numeric, p_payment_date date default current_date,
  p_receipt_no text default null, p_request_id uuid default null, p_actor jsonb default '{}'::jsonb
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.operator_record_daily_payment($1, $2, $3, $4, $5, $6);
$$;

-- Owner-only evaluator shared by transaction-time enforcement and user-bound
-- read verification. Its actor argument is never accepted from an API caller.
create or replace function private.operator_daily_payment_integrity(p_booking_id uuid, p_request_id uuid, p_actor_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_payment public.payments%rowtype;
  v_booking public.daily_bookings%rowtype;
  v_unit public.units%rowtype;
  v_audit public.audit_logs%rowtype;
  v_paid numeric;
  v_final numeric;
  v_count integer;
  v_payment_ok boolean := false;
  v_finance_ok boolean := false;
  v_receivables_ok boolean := false;
  v_ledger_ok boolean := false;
  v_audit_ok boolean := false;
begin
  select * into v_payment from public.payments
  where request_id = p_request_id and request_kind = 'daily_payment'
    and source_type = 'daily_booking' and source_id = p_booking_id;
  select * into v_booking from public.daily_bookings where id = p_booking_id;
  select * into v_unit from public.units where id = v_booking.unit_id;
  select * into v_audit from public.audit_logs
  where actor_id is not distinct from p_actor_id and entity_type = 'daily_booking' and entity_id = p_booking_id
    and action = 'supplementary_payment' and metadata->>'request_id' = p_request_id::text
  order by created_at desc, id desc limit 1;
  select greatest(0, coalesce(sum(amount), 0)) into v_paid from public.payments
  where source_type = 'daily_booking' and source_id = p_booking_id;
  v_final := greatest(0, coalesce(v_booking.final_amount_xof, v_booking.total_amount_xof, 0));
  v_payment_ok := v_payment.id is not null and v_booking.id is not null
    and v_payment.customer_id = v_booking.customer_id and v_payment.unit_id = v_booking.unit_id
    and v_payment.currency::text = 'XOF' and v_payment.exchange_rate_to_xof = 1 and v_payment.amount > 0
    and not exists (select 1 from public.payments where reversal_of_payment_id = v_payment.id);
  v_finance_ok := v_booking.id is not null and v_booking.prepaid_amount_xof = v_paid
    and v_booking.billing_status = case when v_paid >= v_final and v_booking.status = 'checked_out' then 'settled'
      when v_paid >= v_final then 'prepaid' when v_paid > 0 then 'partially_paid' else 'need_top_up' end;
  select count(*) into v_count from public.receivables r
  where r.source_type = 'daily_booking' and r.source_id = p_booking_id and r.status <> 'cancelled';
  v_receivables_ok := v_count = 1 and exists (
    select 1 from public.receivables r
    where r.source_type = 'daily_booking' and r.source_id = p_booking_id
      and r.customer_id = v_booking.customer_id and r.unit_id = v_booking.unit_id
      and r.building_id = v_unit.building_id and r.currency::text = 'XOF' and r.category = 'daily_rental'
      and r.amount_xof = v_final and r.paid_amount_xof = least(v_final, v_paid)
      and (case when v_paid >= v_final then r.status = 'paid' when v_paid > 0 then r.status = 'partial'
        else r.status in ('pending', 'overdue') end)
  );
  select count(*) into v_count from public.ledger_entries where payment_id = v_payment.id;
  v_ledger_ok := v_count = 1 and exists (
    select 1 from public.ledger_entries l where l.payment_id = v_payment.id
      and l.unit_id = v_payment.unit_id and l.building_id = v_unit.building_id
      and l.entry_date = v_payment.payment_date and l.direction = 'income'
      and l.category = 'daily_rental' and l.amount_xof = v_payment.amount
  );
  select count(*) into v_count from public.audit_logs a
  where a.entity_type = 'daily_booking' and a.entity_id = p_booking_id
    and a.action = 'supplementary_payment' and a.metadata->>'request_id' = p_request_id::text;
  v_audit_ok := v_count = 1 and v_audit.id is not null
    and v_audit.metadata->>'payment_id' = v_payment.id::text
    and v_audit.metadata->'amount' = to_jsonb(v_payment.amount)
    and v_audit.metadata->>'payment_date' = v_payment.payment_date::text
    and v_audit.before_data->>'prepaid_amount_xof' is not null
    and v_audit.after_data->>'prepaid_amount_xof' is not null;
  -- Check the historical before/after increment, not today's balance after later payments.
  if v_audit_ok then
    begin
      v_audit_ok := (v_audit.after_data->>'prepaid_amount_xof')::numeric
        - (v_audit.before_data->>'prepaid_amount_xof')::numeric = v_payment.amount;
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_audit_ok := false;
    end;
  end if;
  return jsonb_build_object(
    'evidenceVersion', 2,
    'verified', coalesce(v_payment_ok and v_finance_ok and v_receivables_ok and v_ledger_ok and v_audit_ok, false),
    'checks', jsonb_build_object('payment', coalesce(v_payment_ok,false), 'bookingFinance', coalesce(v_finance_ok,false),
      'receivables', coalesce(v_receivables_ok,false), 'ledger', coalesce(v_ledger_ok,false), 'audit', coalesce(v_audit_ok,false)),
    'payment', case when v_payment.id is null then null else to_jsonb(v_payment) end,
    'booking', case when v_booking.id is null then null else jsonb_build_object(
      'id', v_booking.id, 'prepaidAmountXof', v_booking.prepaid_amount_xof, 'totalAmountXof', v_booking.total_amount_xof,
      'finalAmountXof', v_booking.final_amount_xof, 'billingStatus', v_booking.billing_status, 'status', v_booking.status) end,
    'receivables', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'amountXof',r.amount_xof,
      'paidAmountXof',r.paid_amount_xof,'status',r.status) order by r.created_at desc)
      from public.receivables r where r.source_type='daily_booking' and r.source_id=p_booking_id and r.status<>'cancelled'), '[]'::jsonb),
    'audit', case when v_audit.id is null then null else jsonb_build_object(
      'id',v_audit.id,'actorId',v_audit.actor_id,'action',v_audit.action,'createdAt',v_audit.created_at) end
  );
end;
$$;

create or replace function private.verify_operator_daily_payment(p_booking_id uuid, p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.current_operator_action_allowed('record_daily_payment', 'L2'), false) then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;
  return private.operator_daily_payment_integrity(p_booking_id, p_request_id, (select auth.uid()));
end;
$$;

revoke all on function private.operator_daily_payment_integrity(uuid,uuid,uuid) from public, anon, authenticated, service_role;
-- Application rollout gate: refuse writes against the previous database release.
create or replace function public.operator_daily_payment_protocol_version()
returns integer language sql stable security invoker set search_path = '' as $$
  select case when (select auth.uid()) is not null then 2 else 0 end;
$$;
revoke all on function public.operator_daily_payment_protocol_version() from public, anon;
grant execute on function public.operator_daily_payment_protocol_version() to authenticated;
revoke all on function private.operator_record_daily_payment(uuid,numeric,date,text,uuid,jsonb) from public, anon;
grant execute on function private.operator_record_daily_payment(uuid,numeric,date,text,uuid,jsonb) to authenticated, service_role;
revoke all on function public.daily_record_payment_rpc(uuid,numeric,date,text,uuid,jsonb) from public, anon;
grant execute on function public.daily_record_payment_rpc(uuid,numeric,date,text,uuid,jsonb) to authenticated, service_role;
revoke all on function private.verify_operator_daily_payment(uuid,uuid) from public, anon;
grant execute on function private.verify_operator_daily_payment(uuid,uuid) to authenticated;

commit;
