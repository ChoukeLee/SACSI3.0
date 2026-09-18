-- Correct an erroneous check-in, not a real guest departure. Preserve all history.
create or replace function public.daily_void_erroneous_checkin_rpc(p_booking_id uuid, p_reason text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_next public.unit_status;
begin
  if auth.uid() is null or not public.has_app_role('admin') then
    raise exception 'dailyCancelPermissionDenied' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'correctionReasonRequired'; end if;
  select * into v_booking from public.daily_bookings where id=p_booking_id for update;
  if not found then raise exception 'bookingNotFound'; end if;
  if v_booking.status='cancelled' and exists (
    select 1 from public.audit_logs where entity_id=p_booking_id and action='void_erroneous_checkin'
  ) then return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id); end if;
  if v_booking.status <> 'checked_in' or v_booking.actual_check_out is not null then
    raise exception 'bookingNotErroneousCheckin';
  end if;
  if coalesce(v_booking.prepaid_amount_xof,0) <> 0 or exists (
    select 1 from public.payments where source_type='daily_booking' and source_id=p_booking_id
  ) or exists (
    select 1 from public.receivables where source_type='daily_booking' and source_id=p_booking_id and paid_amount_xof<>0
  ) then raise exception 'bookingHasPayments'; end if;
  if exists (select 1 from public.cleaning_tasks where daily_booking_id=p_booking_id) then
    raise exception 'bookingHasCleaningHistory';
  end if;
  perform 1 from public.units where id=v_booking.unit_id for update;
  update public.daily_bookings set status='cancelled',
    notes=concat_ws(E'\n',nullif(notes,''),'误入住撤销：' || trim(p_reason)),updated_at=now() where id=p_booking_id;
  update public.receivables set status='cancelled',updated_at=now()
    where source_type='daily_booking' and source_id=p_booking_id;
  v_next:=public.daily_resolve_unit_status(v_booking.unit_id,p_booking_id);
  update public.units set status=v_next,updated_at=now() where id=v_booking.unit_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
  values(auth.uid(),'void_erroneous_checkin','daily_booking',p_booking_id,to_jsonb(v_booking),
    (select to_jsonb(b) from public.daily_bookings b where id=p_booking_id),
    jsonb_build_object('reason',trim(p_reason),'next_status',v_next,'channel','authenticated_admin_ui'));
  return public.daily_booking_operation_snapshot(p_booking_id,v_booking.unit_id);
end;
$$;
revoke all on function public.daily_void_erroneous_checkin_rpc(uuid,text) from public,anon,service_role;
grant execute on function public.daily_void_erroneous_checkin_rpc(uuid,text) to authenticated;
