-- Allow a daily-rental reservation to receive money before check-in.
-- Payment remains independent from confirmation/check-in, so front desk can
-- register an advance while preserving the reservation workflow state.

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
  if v_booking.status not in ('pending_review', 'confirmed', 'checked_in', 'checked_out') then
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
      'request_id', p_request_id,
      'booking_status_at_payment', v_booking.status
    )
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

revoke all on function public.daily_record_payment_rpc(uuid, numeric, date, text, uuid, jsonb) from public, anon;
grant execute on function public.daily_record_payment_rpc(uuid, numeric, date, text, uuid, jsonb) to authenticated, service_role;
