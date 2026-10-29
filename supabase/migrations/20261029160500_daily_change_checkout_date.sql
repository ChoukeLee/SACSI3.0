-- Allow authorized daily-rental staff to change the planned departure date
-- before checkout, with conflict checks, receivable synchronization and audit.
begin;

create or replace function public.daily_change_checkout_date_rpc(
  p_booking_id uuid,
  p_new_check_out date,
  p_request_id uuid,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_existing public.daily_operation_requests%rowtype;
  v_payload jsonb;
  v_unit_id uuid;
  v_unit public.units%rowtype;
  v_nights integer;
  v_total numeric;
  v_final numeric;
  v_paid numeric;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;
  if p_new_check_out is null then raise exception 'checkOutRequired'; end if;

  v_payload := jsonb_build_object('new_check_out', p_new_check_out);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_existing
  from public.daily_operation_requests
  where request_id = p_request_id;
  if v_existing.request_id is not null then
    if v_existing.operation_kind <> 'change_checkout_date'
      or v_existing.booking_id <> p_booking_id
      or v_existing.payload <> v_payload then
      raise exception 'requestIdConflict';
    end if;
    return public.daily_booking_operation_snapshot(p_booking_id, null);
  end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status not in ('confirmed', 'checked_in') then
    raise exception 'bookingCannotChangeCheckoutDate';
  end if;
  if v_booking.actual_check_out is not null then raise exception 'bookingAlreadyCheckedOut'; end if;
  if p_new_check_out <= v_booking.check_in then raise exception 'invalidDateRange'; end if;
  if p_new_check_out < current_date then raise exception 'checkoutDateMustBeTodayOrLater'; end if;
  if (to_jsonb(v_booking)->>'net_settlement') is not null
    or coalesce((to_jsonb(v_booking)->>'settlement_adjustment_amount_xof')::numeric, 0) <> 0 then
    raise exception 'operationAssistanceRequired';
  end if;
  if v_booking.checkout_mode = 'fixed' and v_booking.check_out = p_new_check_out then
    raise exception 'checkoutDateUnchanged';
  end if;

  v_unit_id := v_booking.unit_id;
  select * into v_unit from public.units where id = v_unit_id for update;
  if v_unit.id is null then raise exception 'unitNotFound'; end if;
  if exists (
    select 1
    from public.daily_bookings b
    where b.unit_id = v_booking.unit_id
      and b.id <> p_booking_id
      and b.status in ('pending_review', 'confirmed', 'checked_in')
      and b.check_in < p_new_check_out
      and v_booking.check_in < case
        when b.checkout_mode = 'open' then date '9999-12-31'
        else coalesce(b.check_out, b.check_in)
      end
  ) then raise exception 'doubleBooked'; end if;

  v_nights := p_new_check_out - v_booking.check_in;
  v_total := round(v_nights * v_booking.nightly_price_xof);
  v_final := greatest(0, v_total - coalesce(v_booking.manual_discount_amount_xof, 0));
  select greatest(0, coalesce(sum(amount), 0)) into v_paid
  from public.payments
  where source_type = 'daily_booking' and source_id = p_booking_id;
  if v_paid > v_final then raise exception 'checkoutDateCreatesOverpayment'; end if;

  insert into public.daily_operation_requests(request_id, operation_kind, booking_id, payload)
  values (p_request_id, 'change_checkout_date', p_booking_id, v_payload);

  update public.daily_bookings
  set checkout_mode = 'fixed',
      check_out = p_new_check_out,
      total_amount_xof = v_total,
      final_amount_xof = v_final,
      updated_at = now()
  where id = p_booking_id;

  perform public.daily_sync_booking_finance_tx(p_booking_id);

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'change_checkout_date', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object(
      'request_id', p_request_id,
      'previous_check_out', v_booking.check_out,
      'new_check_out', p_new_check_out,
      'previous_checkout_mode', v_booking.checkout_mode,
      'nights', v_nights,
      'new_total', v_total,
      'new_final', v_final,
      'paid_amount', v_paid
    )
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_unit_id);
end;
$$;

revoke all on function public.daily_change_checkout_date_rpc(uuid, date, uuid, jsonb) from public, anon;
grant execute on function public.daily_change_checkout_date_rpc(uuid, date, uuid, jsonb) to authenticated;

commit;
