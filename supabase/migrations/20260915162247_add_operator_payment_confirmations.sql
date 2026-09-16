begin;

create table private.operator_payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  request_id uuid not null unique,
  booking_id uuid not null references public.daily_bookings(id),
  request_data jsonb not null,
  expected_snapshot jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  status text not null default 'pending' check (status in ('pending','completed')),
  check ((status = 'completed') = (confirmed_at is not null))
);
alter table private.operator_payment_confirmations enable row level security;
revoke all on private.operator_payment_confirmations from public, anon, authenticated, service_role;
create index operator_payment_confirmations_actor_idx on private.operator_payment_confirmations(actor_id, created_at desc);

create function private.create_operator_payment_confirmation(p_request jsonb, p_snapshot jsonb, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_request uuid;
  v_booking uuid;
  v_row private.operator_payment_confirmations%rowtype;
  v_current jsonb;
begin
  if v_actor is null or not coalesce(private.current_operator_action_allowed('record_daily_payment','L2'),false) then
    raise exception 'confirmationForbidden' using errcode = '42501'; end if;
  if p_request->>'actionName' is distinct from 'record_daily_payment'
    or p_request->>'inputSource' is distinct from 'excel_screenshot'
    or p_request->>'scope' is distinct from 'business_data'
    or p_request->'exceptionalBusinessCase' is distinct from 'false'::jsonb
    or p_request->>'protocolVersion' is distinct from '1.0'
    or jsonb_typeof(p_request->'input'->'amountXof') is distinct from 'number'
    or length(coalesce(p_request->>'originalInstruction','')) not between 1 and 4000
    or length(coalesce(p_request->>'connectorVersion','')) not between 1 and 80
    or octet_length(p_request::text) > 65536 or octet_length(p_snapshot::text) > 1048576 then
    raise exception 'invalidConfirmationRequest'; end if;
  v_request := (p_request->>'requestId')::uuid;
  v_booking := (p_request->'input'->>'bookingId')::uuid;
  if v_request is null or v_booking is null or p_snapshot is null then raise exception 'invalidConfirmationRequest'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request::text,0));
  select * into v_row from private.operator_payment_confirmations where request_id=v_request for update;
  if found then
    if v_row.actor_id is distinct from v_actor or v_row.request_data is distinct from p_request
      or v_row.expected_snapshot is distinct from p_snapshot then raise exception 'confirmationRequestConflict'; end if;
    return jsonb_build_object('id',v_row.id,'status',v_row.status,'expiresAt',v_row.expires_at);
  end if;
  perform 1 from public.daily_bookings where id=v_booking for update;
  if not found then raise exception 'bookingNotFound'; end if;
  if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp()+interval '10 minutes' then raise exception 'confirmationExpired'; end if;
  v_current := public.daily_booking_operation_snapshot(v_booking,null);
  if v_current is distinct from p_snapshot then raise exception 'confirmationSnapshotChanged'; end if;
  if coalesce(v_current->'booking'->>'status','') not in ('confirmed','checked_in')
    or v_current->'booking'->>'check_out' is null
    or v_current->'booking'->>'checkout_mode' = 'open' then raise exception 'confirmationScopeUnsupported'; end if;
  if exists(select 1 from public.payments where request_id=v_request) then raise exception 'confirmationRequestConflict'; end if;
  insert into private.operator_payment_confirmations(actor_id,request_id,booking_id,request_data,expected_snapshot,expires_at)
  values(v_actor,v_request,v_booking,p_request,p_snapshot,p_expires_at) returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'expiresAt',v_row.expires_at);
end; $$;

create function private.get_operator_payment_confirmation(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row private.operator_payment_confirmations%rowtype;
begin
  if (select auth.uid()) is null or not coalesce(private.current_operator_action_allowed('record_daily_payment','L2'),false) then
    raise exception 'confirmationForbidden' using errcode = '42501'; end if;
  select * into v_row from private.operator_payment_confirmations where id=p_id and actor_id=(select auth.uid());
  if not found then raise exception 'confirmationNotFound'; end if;
  return jsonb_build_object('id',v_row.id,'actorId',v_row.actor_id,'request',v_row.request_data,
    'snapshot',v_row.expected_snapshot,'status',v_row.status,'expiresAt',v_row.expires_at,'confirmedAt',v_row.confirmed_at);
end; $$;

create function private.confirm_operator_payment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row private.operator_payment_confirmations%rowtype;
  v_request uuid;
  v_snapshot jsonb;
  v_evidence jsonb;
  v_input jsonb;
begin
  if v_actor is null or not coalesce(private.current_operator_action_allowed('record_daily_payment','L2'),false) then
    raise exception 'confirmationForbidden' using errcode = '42501'; end if;
  select request_id into v_request from private.operator_payment_confirmations where id=p_id and actor_id=v_actor;
  if not found then raise exception 'confirmationNotFound'; end if;
  -- Match the existing payment writer: request lock before booking lock.
  perform pg_advisory_xact_lock(hashtextextended(v_request::text,0));
  select * into v_row from private.operator_payment_confirmations where id=p_id and actor_id=v_actor for update;
  perform 1 from public.daily_bookings where id=v_row.booking_id for update;
  if not found then raise exception 'bookingNotFound'; end if;
  if v_row.status = 'completed' then
    v_evidence := private.operator_daily_payment_integrity(v_row.booking_id,v_row.request_id,v_actor);
    if not coalesce((v_evidence->>'verified')::boolean,false) then raise exception 'confirmationResultInvalid'; end if;
    return jsonb_build_object('status','completed','requestId',v_row.request_id,'verification',v_evidence,
      'snapshot',public.daily_booking_operation_snapshot(v_row.booking_id,null));
  end if;
  if v_row.expires_at <= clock_timestamp()
    or (v_row.created_at at time zone 'Africa/Abidjan')::date <> (clock_timestamp() at time zone 'Africa/Abidjan')::date then
    raise exception 'confirmationExpired'; end if;
  -- Existing approved business writers serialize on the booking row. Direct
  -- privileged SQL outside that contract is not covered by this protocol.
  if public.daily_booking_operation_snapshot(v_row.booking_id,null) is distinct from v_row.expected_snapshot then
    raise exception 'confirmationSnapshotChanged'; end if;
  if exists(select 1 from public.payments where request_id=v_row.request_id) then raise exception 'confirmationRequestConflict'; end if;
  v_input := v_row.request_data->'input';
  v_snapshot := private.operator_record_daily_payment(v_row.booking_id,(v_input->>'amountXof')::numeric,
    (v_input->>'paymentDate')::date,v_input->>'receiptNo',v_row.request_id,
    jsonb_build_object('channel','external_codex','input_source','excel_screenshot',
      'connector_version',v_row.request_data->>'connectorVersion','protocol_version',v_row.request_data->>'protocolVersion',
      'original_instruction',v_row.request_data->>'originalInstruction'));
  update private.operator_payment_confirmations set status='completed',confirmed_at=clock_timestamp() where id=p_id;
  insert into public.audit_logs(actor_id,actor_email,actor_role,action,entity_type,entity_id,metadata)
  values(v_actor,(select auth.jwt()->>'email'),public.current_user_role(),'confirm_operator_payment','daily_booking',v_row.booking_id,
    jsonb_build_object('confirmation_id',p_id,'request_id',v_row.request_id,'channel','sacsi_web',
      'confirmation_method','authenticated_account_confirmation','input_source','excel_screenshot'));
  v_evidence := private.operator_daily_payment_integrity(v_row.booking_id,v_row.request_id,v_actor);
  if not coalesce((v_evidence->>'verified')::boolean,false) then raise exception 'confirmationResultInvalid'; end if;
  return jsonb_build_object('status','completed','requestId',v_row.request_id,'snapshot',v_snapshot,'verification',v_evidence);
end; $$;

create function public.create_operator_payment_confirmation(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz)
returns jsonb language sql security invoker set search_path = '' as $$ select private.create_operator_payment_confirmation($1,$2,$3); $$;
create function public.get_operator_payment_confirmation(p_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select private.get_operator_payment_confirmation($1); $$;
create function public.confirm_operator_payment(p_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select private.confirm_operator_payment($1); $$;

revoke all on function private.create_operator_payment_confirmation(jsonb,jsonb,timestamptz),
  private.get_operator_payment_confirmation(uuid),private.confirm_operator_payment(uuid),
  public.create_operator_payment_confirmation(jsonb,jsonb,timestamptz),public.get_operator_payment_confirmation(uuid),public.confirm_operator_payment(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.create_operator_payment_confirmation(jsonb,jsonb,timestamptz),
  private.get_operator_payment_confirmation(uuid),private.confirm_operator_payment(uuid),
  public.create_operator_payment_confirmation(jsonb,jsonb,timestamptz),public.get_operator_payment_confirmation(uuid),public.confirm_operator_payment(uuid)
  to authenticated;
commit;
