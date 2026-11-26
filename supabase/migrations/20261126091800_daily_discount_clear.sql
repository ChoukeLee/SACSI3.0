-- A zero discount explicitly restores gross price on an existing checked-in order.
-- Use the existing atomic business operation, keep payments and occupancy unchanged.
begin;

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
  if p_amount is null or p_amount < 0 then raise exception 'invalidDiscountAmount'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'discountReasonRequired'; end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if not public.can_access_unit(v_booking.unit_id) then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;
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

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
  values (
    auth.uid(), 'apply_discount', 'daily_booking', p_booking_id,
    jsonb_build_object('manual_discount_amount_xof', v_booking.manual_discount_amount_xof,
      'manual_discount_reason', v_booking.manual_discount_reason, 'final_amount_xof', v_booking.final_amount_xof),
    jsonb_build_object('manual_discount_amount_xof', p_amount,
      'manual_discount_reason', btrim(p_reason), 'final_amount_xof', v_final),
    coalesce(p_actor, '{}'::jsonb) || jsonb_build_object('discount', p_amount, 'reason', btrim(p_reason))
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

commit;
