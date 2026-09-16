begin;

-- Keep each superseded proposal intact. Only the pending proposal's identifier
-- rotates; the payment request ID never changes, preserving payment idempotency.
create table private.operator_confirmation_history (
  id uuid primary key,
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  successor_id uuid not null,
  previous_record jsonb not null,
  replaced_at timestamptz not null default clock_timestamp()
);
alter table private.operator_confirmation_history enable row level security;
revoke all on private.operator_confirmation_history from public,anon,authenticated,service_role;
create index operator_confirmation_history_request_idx on private.operator_confirmation_history(request_id);

create or replace function private.get_operator_payment_confirmation(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row private.operator_payment_confirmations%rowtype; v_successor uuid;
begin
  if (select auth.uid()) is null or not coalesce(private.current_operator_action_allowed('record_daily_payment','L2'),false) then
    raise exception 'confirmationForbidden' using errcode='42501'; end if;
  select * into v_row from private.operator_payment_confirmations where id=p_id and actor_id=(select auth.uid());
  if found then
    return jsonb_build_object('id',v_row.id,'actorId',v_row.actor_id,'request',v_row.request_data,
      'snapshot',v_row.expected_snapshot,'status',v_row.status,'expiresAt',v_row.expires_at,'confirmedAt',v_row.confirmed_at);
  end if;
  select successor_id into v_successor from private.operator_confirmation_history where id=p_id and actor_id=(select auth.uid());
  if not found then raise exception 'confirmationNotFound'; end if;
  return jsonb_build_object('id',p_id,'status','superseded','replacementId',v_successor);
end; $$;

create function private.reprepare_operator_payment_confirmation(p_previous_id uuid,p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_request uuid;
  v_row private.operator_payment_confirmations%rowtype;
  v_history private.operator_confirmation_history%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_current jsonb;
begin
  if v_actor is null or not coalesce(private.current_operator_action_allowed('record_daily_payment','L2'),false) then
    raise exception 'confirmationForbidden' using errcode='42501'; end if;
  v_request := (p_request->>'requestId')::uuid;
  if v_request is null or p_previous_id is null then raise exception 'invalidConfirmationRequest'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request::text,0));
  select * into v_row from private.operator_payment_confirmations where request_id=v_request and actor_id=v_actor for update;
  if not found then raise exception 'confirmationNotFound'; end if;
  if v_row.id <> p_previous_id then
    -- Exact retries return the immediate successor only, never silently follow
    -- several revisions or replace a later proposal.
    select * into v_history from private.operator_confirmation_history
      where id=p_previous_id and actor_id=v_actor and request_id=v_request;
    if not found or v_history.successor_id <> v_row.id
      or v_row.request_data is distinct from p_request or v_row.expected_snapshot is distinct from p_snapshot then
      raise exception 'confirmationRequestConflict'; end if;
    return jsonb_build_object('id',v_row.id,'status',v_row.status,'expiresAt',v_row.expires_at);
  end if;
  perform 1 from public.daily_bookings where id=v_row.booking_id for update;
  if not found then raise exception 'bookingNotFound'; end if;
  if v_row.status <> 'pending' or exists(select 1 from public.payments where request_id=v_request) then
    raise exception 'confirmationAlreadyExecuted'; end if;
  if p_request->'input'->>'bookingId' is distinct from v_row.booking_id::text
    or p_request->>'actionName' is distinct from 'record_daily_payment'
    or p_request->>'inputSource' is distinct from 'excel_screenshot'
    or p_request->>'scope' is distinct from 'business_data'
    or p_request->'exceptionalBusinessCase' is distinct from 'false'::jsonb
    or p_request->>'protocolVersion' is distinct from '1.0'
    or jsonb_typeof(p_request->'input'->'amountXof') is distinct from 'number'
    or length(coalesce(p_request->>'originalInstruction','')) not between 1 and 4000
    or length(coalesce(p_request->>'connectorVersion','')) not between 1 and 80
    or octet_length(p_request::text)>65536 or octet_length(p_snapshot::text)>1048576 then
    raise exception 'invalidConfirmationRequest'; end if;
  if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp()
    or p_expires_at>clock_timestamp()+interval '10 minutes' then raise exception 'confirmationExpired'; end if;
  v_current := public.daily_booking_operation_snapshot(v_row.booking_id,null);
  if v_current is distinct from p_snapshot then raise exception 'confirmationSnapshotChanged'; end if;
  if coalesce(v_current->'booking'->>'status','') not in ('confirmed','checked_in')
    or v_current->'booking'->>'check_out' is null or v_current->'booking'->>'checkout_mode'='open' then
    raise exception 'confirmationScopeUnsupported'; end if;
  insert into private.operator_confirmation_history(id,actor_id,request_id,successor_id,previous_record)
    values(v_row.id,v_actor,v_request,v_new_id,to_jsonb(v_row));
  update private.operator_payment_confirmations set id=v_new_id,request_data=p_request,expected_snapshot=p_snapshot,
    expires_at=p_expires_at,created_at=clock_timestamp() where id=v_row.id;
  insert into public.audit_logs(actor_id,actor_email,actor_role,action,entity_type,entity_id,metadata)
    values(v_actor,(select auth.jwt()->>'email'),public.current_user_role(),'reprepare_operator_payment','daily_booking',v_row.booking_id,
      jsonb_build_object('request_id',v_request,'previous_confirmation_id',v_row.id,'confirmation_id',v_new_id,
        'channel','external_codex','input_source','excel_screenshot','previous_amount',v_row.request_data->'input'->'amountXof',
        'amount',p_request->'input'->'amountXof'));
  return jsonb_build_object('id',v_new_id,'status','pending','expiresAt',p_expires_at);
end; $$;

create function public.reprepare_operator_payment_confirmation(p_previous_id uuid,p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.reprepare_operator_payment_confirmation($1,$2,$3,$4);
$$;
revoke all on function private.reprepare_operator_payment_confirmation(uuid,jsonb,jsonb,timestamptz),
  public.reprepare_operator_payment_confirmation(uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.reprepare_operator_payment_confirmation(uuid,jsonb,jsonb,timestamptz),
  public.reprepare_operator_payment_confirmation(uuid,jsonb,jsonb,timestamptz) to authenticated;
commit;
