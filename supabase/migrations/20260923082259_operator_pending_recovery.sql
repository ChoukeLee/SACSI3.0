begin;
-- Read-only lookup for interrupted single-payment draft responses.
create function private.find_operator_payment_confirmation(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.operator_payment_confirmations%rowtype;
begin
  if (select auth.uid()) is null or not coalesce(private.current_operator_action_allowed('record_daily_payment','L2'),false) then
    raise exception 'confirmationForbidden' using errcode='42501';
  end if;
  select * into w from private.operator_payment_confirmations where request_id=p_request_id and actor_id=(select auth.uid());
  if not found then return jsonb_build_object('status','not_found'); end if;
  if not exists(select 1 from public.daily_bookings b where b.id=w.booking_id and public.can_access_unit(b.unit_id)) then
    raise exception 'confirmationForbidden' using errcode='42501';
  end if;
  return jsonb_build_object('id',w.id,'requestId',w.request_id,'status',w.status,'expiresAt',w.expires_at,'verified',false);
end; $$;
create function public.find_operator_payment_confirmation(p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.find_operator_payment_confirmation($1); $$;
revoke all on function private.find_operator_payment_confirmation(uuid),public.find_operator_payment_confirmation(uuid) from public,anon,authenticated,service_role;
grant execute on function private.find_operator_payment_confirmation(uuid),public.find_operator_payment_confirmation(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
