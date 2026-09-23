begin;
-- Additive workflow only; no historical business rows are rewritten.
create table private.operator_daily_workflows (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  actor_id uuid not null references auth.users(id), booking_id uuid not null references public.daily_bookings(id),
  request_data jsonb not null, expected_snapshot jsonb not null, deployment text not null,
  expires_at timestamptz not null, created_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','completed','superseded')),
  replaces_id uuid references private.operator_daily_workflows(id), result jsonb
);
create unique index operator_daily_workflow_current on private.operator_daily_workflows(request_id) where status<>'superseded';
create index operator_daily_workflow_actor on private.operator_daily_workflows(actor_id);
create index operator_daily_workflow_booking on private.operator_daily_workflows(booking_id);
create index operator_daily_workflow_replaces on private.operator_daily_workflows(replaces_id);
alter table private.operator_daily_workflows enable row level security;
revoke all on private.operator_daily_workflows from public,anon,authenticated,service_role;

create function private.daily_workflow_allowed(p_booking_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and coalesce(public.has_app_role('admin','front_desk','rental_sales'),false)
 and private.current_operator_action_allowed('record_daily_payment','L2')
 and private.current_operator_action_allowed('query_daily_booking','L0')
 and exists(select 1 from public.daily_bookings b where b.id=p_booking_id and public.can_access_unit(b.unit_id));
$$;

create function private.preview_daily_workflow(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.daily_bookings%rowtype; u public.units%rowtype; r public.receivables%rowtype;
 d date; pd date; amt numeric; total numeric; paid numeric; s jsonb; n integer;
begin
 if jsonb_typeof(p_request) is distinct from 'object' then raise exception 'workflowInvalidRequest'; end if;
 if exists(select 1 from jsonb_object_keys(p_request) k where k not in ('requestId','bookingId','operation','originalInstruction','effectiveCheckOut','amountXof','paymentDate','paymentMethod'))
 or not p_request ?& array['requestId','bookingId','operation','originalInstruction','effectiveCheckOut','amountXof','paymentDate','paymentMethod']
 or exists(select 1 from jsonb_each(p_request) e where e.value='null'::jsonb)
 or coalesce(p_request->>'operation','') not in ('extend_and_collect','checkout_and_collect')
 or coalesce(p_request->>'paymentMethod','') not in ('cash','check','bank_transfer','offset','other')
 or length(btrim(p_request->>'originalInstruction')) not between 1 and 4000
 or jsonb_typeof(p_request->'amountXof')<>'number'
 or coalesce(p_request->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 then raise exception 'workflowInvalidRequest'; end if;
 if not private.daily_workflow_allowed((p_request->>'bookingId')::uuid) then raise exception 'workflowForbidden' using errcode='42501'; end if;
 d:=(p_request->>'effectiveCheckOut')::date; pd:=(p_request->>'paymentDate')::date; amt:=(p_request->>'amountXof')::numeric;
 if not isfinite(d) or not isfinite(pd) or d::text<>p_request->>'effectiveCheckOut' or pd::text<>p_request->>'paymentDate'
 or pd>current_date or amt<=0 or amt>999999999999 or trunc(amt)<>amt then raise exception 'workflowInvalidRequest'; end if;
 select * into b from public.daily_bookings where id=(p_request->>'bookingId')::uuid;
 select * into u from public.units where id=b.unit_id;
 if b.status<>'checked_in' or b.checkout_mode<>'fixed' or b.check_out is null or b.check_out<=b.check_in or b.check_in>current_date
 or coalesce(b.manual_discount_amount_xof,0)<>0 or b.nightly_price_xof<=0
 or b.final_amount_xof is distinct from greatest(1,b.check_out-b.check_in)*b.nightly_price_xof
 then raise exception 'workflowSpecialPricingOrState'; end if;
 if (p_request->>'operation'='extend_and_collect' and (d<=b.check_out or d<=current_date))
 or (p_request->>'operation'='checkout_and_collect' and (d<b.check_in or d>current_date)) then raise exception 'workflowInvalidDate'; end if;
 if u.status in ('maintenance','locked','leased','sold') or exists(select 1 from public.lease_contracts where unit_id=u.id and status='active')
 or exists(select 1 from public.daily_bookings other where other.unit_id=u.id and other.id<>b.id
 and other.status in ('pending_review','confirmed','checked_in') and other.check_in<d
 and b.check_in<case when other.checkout_mode='open' then date '9999-12-31' else coalesce(other.check_out,other.check_in+1) end)
 then raise exception 'workflowRoomConflict'; end if;
 select count(*) into n from public.receivables where source_type='daily_booking' and source_id=b.id and status<>'cancelled';
 select * into r from public.receivables where source_type='daily_booking' and source_id=b.id and status<>'cancelled' limit 1;
 select coalesce(sum(amount),0) into paid from public.payments where source_type='daily_booking' and source_id=b.id;
 if n<>1 or r.unit_id is distinct from u.id or r.building_id is distinct from u.building_id or r.customer_id is distinct from b.customer_id
 or r.category<>'daily_rental' or r.currency::text<>'XOF' or r.management_status in ('historical_pending','excluded')
 or r.amount_xof is distinct from b.final_amount_xof or r.paid_amount_xof is distinct from paid or b.prepaid_amount_xof is distinct from paid
 or paid<0 or paid>b.final_amount_xof or exists(select 1 from public.payments where source_type='daily_booking' and source_id=b.id and (currency::text<>'XOF' or exchange_rate_to_xof<>1))
 then raise exception 'workflowFinanceMismatch'; end if;
 total:=greatest(1,d-b.check_in)*b.nightly_price_xof;
 if total>999999999999 or paid+amt>total then raise exception 'workflowOverpayment'; end if;
 s:=jsonb_build_object('booking',to_jsonb(b),'unit',to_jsonb(u),'receivable',to_jsonb(r),
 'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where source_type='daily_booking' and source_id=b.id),'[]'::jsonb),
 'businessDate',current_date);
 return jsonb_build_object('snapshot',s,'plan',jsonb_build_object('bookingId',b.id,'unitCode',u.code,'guestName',coalesce(nullif(btrim(b.guest_name),''),(select c.name from public.customers c where c.id=b.customer_id)),
 'operation',p_request->>'operation','checkIn',b.check_in,'scheduledCheckOutBefore',b.check_out,
 'scheduledCheckOutAfter',case when p_request->>'operation'='extend_and_collect' then d else b.check_out end,
 'actualCheckOutAfter',case when p_request->>'operation'='checkout_and_collect' then d else null end,
 'totalBefore',b.final_amount_xof,'totalAfter',total,'paidBefore',paid,'paidAfter',paid+amt,'outstandingAfter',total-paid-amt,
 'paymentDate',pd,'paymentMethod',p_request->>'paymentMethod','amountXof',amt,'cleaningRequired',p_request->>'operation'='checkout_and_collect'));
end; $$;

create function private.get_daily_workflow(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.operator_daily_workflows%rowtype;
begin
 select * into w from private.operator_daily_workflows where id=p_id and actor_id=(select auth.uid());
 if not found or not private.daily_workflow_allowed(w.booking_id) then raise exception 'workflowForbidden' using errcode='42501'; end if;
 return to_jsonb(w);
end; $$;

create function private.create_daily_workflow(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text,p_replaces_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.operator_daily_workflows%rowtype; fresh jsonb; rid uuid:=(p_request->>'requestId')::uuid;
begin
 if not private.daily_workflow_allowed((p_request->>'bookingId')::uuid) then raise exception 'workflowForbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
 select * into w from private.operator_daily_workflows where request_id=rid and status<>'superseded' for update;
 if found then
   if w.actor_id<>(select auth.uid()) then raise exception 'workflowForbidden' using errcode='42501'; end if;
   if w.request_data=p_request and w.expected_snapshot=p_snapshot and w.deployment=p_deployment and w.expires_at>now() and p_replaces_id is null then return to_jsonb(w); end if;
   if w.status='completed' or p_replaces_id is distinct from w.id then raise exception 'workflowRequestConflict'; end if;
 elsif p_replaces_id is not null then raise exception 'workflowRequestConflict'; end if;
 if exists(select 1 from public.payments where request_id=rid) or exists(select 1 from public.daily_operation_requests where request_id=rid) then raise exception 'workflowRequestConflict'; end if;
 if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '15 minutes' or length(coalesce(p_deployment,'')) not between 1 and 200 then raise exception 'workflowExpired'; end if;
 fresh:=private.preview_daily_workflow(p_request);
 if fresh is distinct from p_snapshot then raise exception 'workflowChanged'; end if;
 if w.id is not null then update private.operator_daily_workflows set status='superseded' where id=w.id; end if;
 insert into private.operator_daily_workflows(request_id,actor_id,booking_id,request_data,expected_snapshot,deployment,expires_at,replaces_id)
 values(rid,(select auth.uid()),(p_request->>'bookingId')::uuid,p_request,p_snapshot,p_deployment,p_expires_at,p_replaces_id) returning * into w;
 return to_jsonb(w);
end; $$;

create function private.confirm_daily_workflow(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.operator_daily_workflows%rowtype; b public.daily_bookings%rowtype; q jsonb; e jsonb; actor jsonb; rid uuid; d date;
begin
 select request_id into rid from private.operator_daily_workflows where id=p_id and actor_id=(select auth.uid());
 if rid is null then raise exception 'workflowForbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
 select * into w from private.operator_daily_workflows where id=p_id for update;
 if not private.daily_workflow_allowed(w.booking_id) then raise exception 'workflowForbidden' using errcode='42501'; end if;
 if w.status='completed' then
   e:=private.operator_daily_payment_integrity(w.booking_id,rid,w.actor_id);
   if e->>'verified' is distinct from 'true'
   or not exists(select 1 from public.payments p where p.request_id=rid and p.source_id=w.booking_id
     and p.amount=(w.request_data->>'amountXof')::numeric and p.payment_date=(w.request_data->>'paymentDate')::date
     and p.payment_method=w.request_data->>'paymentMethod')
   or not exists(select 1 from public.audit_logs a where a.entity_id=w.booking_id and a.actor_id=w.actor_id
     and a.action='operator_daily_workflow' and a.metadata->>'workflow_confirmation_id'=w.id::text
     and a.metadata->>'request_id'=rid::text and a.metadata->>'operation'=w.request_data->>'operation')
   then raise exception 'workflowResultChanged'; end if;
   return w.result;
 end if;
 if w.status<>'pending' or w.expires_at<=now() or (w.expected_snapshot->'snapshot'->>'businessDate')::date<>current_date then raise exception 'workflowExpired'; end if;
 -- Legacy daily writers also acquire the booking before updating the unit.
 select * into b from public.daily_bookings where id=w.booking_id for update;
 perform 1 from public.units where id=b.unit_id for update;
 perform 1 from public.receivables where source_type='daily_booking' and source_id=b.id order by id for update;
 if private.preview_daily_workflow(w.request_data) is distinct from w.expected_snapshot then raise exception 'workflowChanged'; end if;
 if exists(select 1 from public.payments where request_id=rid) or exists(select 1 from public.daily_operation_requests where request_id=rid) then raise exception 'workflowRequestConflict'; end if;
 q:=w.request_data; d:=(q->>'effectiveCheckOut')::date;
 actor:=jsonb_build_object('channel','external_codex','workflow_confirmation_id',w.id,'original_instruction',q->>'originalInstruction','request_id',rid);
 if q->>'operation'='extend_and_collect' then
   perform public.daily_extend_stay_rpc(b.id,d,0,rid,actor);
 else
   perform public.daily_check_out_booking_rpc(b.id,d,(w.expected_snapshot->'plan'->>'totalAfter')::numeric,0,null,'cleaning_pending',actor);
 end if;
 perform private.operator_record_daily_payment(b.id,(q->>'amountXof')::numeric,(q->>'paymentDate')::date,null,rid,actor);
 update public.payments set payment_method=q->>'paymentMethod' where request_id=rid;
 e:=private.operator_daily_payment_integrity(b.id,rid,w.actor_id);
 if e->>'verified' is distinct from 'true' then raise exception 'workflowVerificationFailed'; end if;
 select * into b from public.daily_bookings where id=w.booking_id;
 if b.final_amount_xof is distinct from (w.expected_snapshot->'plan'->>'totalAfter')::numeric
 or b.prepaid_amount_xof is distinct from (w.expected_snapshot->'plan'->>'paidAfter')::numeric
 or (q->>'operation'='extend_and_collect' and (b.status<>'checked_in' or b.check_out<>d))
 or (q->>'operation'='checkout_and_collect' and (b.status<>'checked_out' or b.actual_check_out<>d
 or not exists(select 1 from public.cleaning_tasks where daily_booking_id=b.id and not is_completed)))
 then raise exception 'workflowVerificationFailed'; end if;
 insert into public.audit_logs(actor_id,actor_email,actor_role,action,entity_type,entity_id,metadata,before_data,after_data)
 values(w.actor_id,left(coalesce((select auth.jwt()->>'email'),''),320),public.current_user_role(),'operator_daily_workflow','daily_booking',b.id,actor||jsonb_build_object('operation',q->>'operation','payment_method',q->>'paymentMethod'),w.expected_snapshot->'snapshot'->'booking',to_jsonb(b));
 update private.operator_daily_workflows set status='completed',result=jsonb_build_object('status','completed','verified',true,'requestId',rid,'bookingId',b.id,'operation',q->>'operation','amountXof',(q->>'amountXof')::numeric) where id=w.id returning * into w;
 return w.result;
end; $$;

create function private.find_daily_workflow(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.operator_daily_workflows%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'workflowForbidden' using errcode='42501'; end if;
 select * into w from private.operator_daily_workflows where request_id=p_request_id and actor_id=(select auth.uid()) and status<>'superseded';
 if not found then return jsonb_build_object('status','not_found'); end if;
 if not private.daily_workflow_allowed(w.booking_id) then raise exception 'workflowForbidden' using errcode='42501'; end if;
 return jsonb_build_object('status',w.status,'id',w.id,'requestId',w.request_id,'verified',false,'notice','已完成状态是历史记录；不要换号重录。');
end; $$;

create function public.preview_daily_workflow(p_request jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.preview_daily_workflow($1); $$;
create function public.create_daily_workflow(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text,p_replaces_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.create_daily_workflow($1,$2,$3,$4,$5); $$;
create function public.get_daily_workflow(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.get_daily_workflow($1); $$;
create function public.confirm_daily_workflow(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.confirm_daily_workflow($1); $$;
create function public.find_daily_workflow(p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.find_daily_workflow($1); $$;
create function public.daily_workflow_protocol_version() returns integer language sql immutable security invoker set search_path='' as $$ select 1; $$;
revoke all on function private.daily_workflow_allowed(uuid) from public,anon,authenticated,service_role;
revoke all on function private.preview_daily_workflow(jsonb),private.create_daily_workflow(jsonb,jsonb,timestamptz,text,uuid),private.get_daily_workflow(uuid),private.confirm_daily_workflow(uuid),private.find_daily_workflow(uuid),
public.preview_daily_workflow(jsonb),public.create_daily_workflow(jsonb,jsonb,timestamptz,text,uuid),public.get_daily_workflow(uuid),public.confirm_daily_workflow(uuid),public.find_daily_workflow(uuid),public.daily_workflow_protocol_version() from public,anon,authenticated,service_role;
grant execute on function private.preview_daily_workflow(jsonb),private.create_daily_workflow(jsonb,jsonb,timestamptz,text,uuid),private.get_daily_workflow(uuid),private.confirm_daily_workflow(uuid),private.find_daily_workflow(uuid),
public.preview_daily_workflow(jsonb),public.create_daily_workflow(jsonb,jsonb,timestamptz,text,uuid),public.get_daily_workflow(uuid),public.confirm_daily_workflow(uuid),public.find_daily_workflow(uuid),public.daily_workflow_protocol_version() to authenticated;
notify pgrst,'reload schema';
commit;
