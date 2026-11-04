begin;

-- A separately switchable, authenticated workflow. This migration creates no
-- tenant bills or payments. All business effects require the tenant's own JWT.
create table private.missing_rent_collection_protocol (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 version integer not null check(version=1)
);
insert into private.missing_rent_collection_protocol values(true,true,1);
alter table private.missing_rent_collection_protocol enable row level security;
revoke all on private.missing_rent_collection_protocol from public,anon,authenticated,service_role;

create table private.missing_rent_collection_requests (
 request_id uuid primary key, actor_id uuid not null references auth.users(id),
 contract_id uuid not null references public.lease_contracts(id),
 input jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.missing_rent_collection_requests enable row level security;
revoke all on private.missing_rent_collection_requests from public,anon,authenticated,service_role;

create function private.missing_rent_collection_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated'
 and coalesce(public.has_app_role('admin'),false)
 and coalesce(public.can_execute_operator_action('record_combined_lease_payment','L3'),false)
 and coalesce(public.can_execute_operator_action('record_lease_rent','L2'),false)
 and exists(select 1 from private.missing_rent_collection_protocol where singleton and enabled and version=1);
$$;
revoke all on function private.missing_rent_collection_allowed() from public,anon,authenticated,service_role;

create function public.missing_rent_collection_review_rpc(p_contract_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare facts jsonb; c public.lease_contracts%rowtype;
begin
 if not private.missing_rent_collection_allowed() then
  raise exception 'missingRentPermissionDenied' using errcode='42501'; end if;
 select * into c from public.lease_contracts where id=p_contract_id;
 if not found or not coalesce(public.can_access_unit(c.unit_id),false) then
  raise exception 'missingRentPermissionDenied' using errcode='42501'; end if;
 facts:=public.lease_rent_period_review_rpc(c.id);
 return facts||jsonb_build_object('protocolVersion',1,'actorId',auth.uid(),
  'contract',to_jsonb(c),'automaticCoverage',false);
end; $$;

create function private.collect_missing_monthly_rent(p_contract_id uuid,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare
 actor uuid:=auth.uid(); c public.lease_contracts%rowtype; u public.units%rowtype;
 prior private.missing_rent_collection_requests%rowtype;
 start_day date; end_day date; payment_day date; v_amount numeric;
 r_id uuid; before_state jsonb; collection jsonb; result jsonb; source text;
begin
 if not private.missing_rent_collection_allowed() then
  raise exception 'missingRentPermissionDenied' using errcode='42501'; end if;
 if p_request_id is null or p_contract_id is null or p_input is null
  or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>12000
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in
   ('expectedToken','periodStart','periodEnd','amountXof','paymentDate','paymentMethod','reason','inputSource','externalReceiptNo'))
  or jsonb_typeof(p_input->'expectedToken') is distinct from 'string'
  or coalesce(p_input->>'expectedToken','') !~ '^[0-9a-f]{32}$'
  or jsonb_typeof(p_input->'periodStart') is distinct from 'string'
  or jsonb_typeof(p_input->'periodEnd') is distinct from 'string'
  or jsonb_typeof(p_input->'paymentDate') is distinct from 'string'
  or coalesce(p_input->>'periodStart','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p_input->>'periodEnd','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p_input->>'paymentDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(p_input->'amountXof') is distinct from 'number'
  or jsonb_typeof(p_input->'reason') is distinct from 'string'
  or length(btrim(coalesce(p_input->>'reason',''))) not between 10 and 1000
  or p_input->>'inputSource' is null or p_input->>'inputSource' not in ('natural_language','excel_screenshot')
  or p_input->>'paymentMethod' is null or p_input->>'paymentMethod' not in ('cash','check','bank_transfer','other')
  or (p_input ? 'externalReceiptNo' and (jsonb_typeof(p_input->'externalReceiptNo') is distinct from 'string'
     or length(p_input->>'externalReceiptNo') not between 1 and 200)) then
  raise exception 'invalidMissingRentCollection'; end if;
 begin
  start_day:=(p_input->>'periodStart')::date; end_day:=(p_input->>'periodEnd')::date;
  payment_day:=(p_input->>'paymentDate')::date; v_amount:=(p_input->>'amountXof')::numeric;
  if not isfinite(start_day) or not isfinite(end_day) or not isfinite(payment_day)
   or to_char(start_day,'YYYY-MM-DD')<>p_input->>'periodStart'
   or to_char(end_day,'YYYY-MM-DD')<>p_input->>'periodEnd'
   or to_char(payment_day,'YYYY-MM-DD')<>p_input->>'paymentDate'
   or start_day<>date_trunc('month',start_day)::date
   or end_day<>(start_day+interval '1 month - 1 day')::date
   or payment_day>(now() at time zone 'Africa/Abidjan')::date
   or start_day>(now() at time zone 'Africa/Abidjan')::date
   or v_amount<=0 or v_amount>999999999999 or trunc(v_amount)<>v_amount then
   raise exception 'invalidMissingRentCollection'; end if;
 exception when datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'invalidMissingRentCollection'; end;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 perform public.missing_rent_collection_review_rpc(p_contract_id);
 select * into prior from private.missing_rent_collection_requests where request_id=p_request_id;
 if found then
  if prior.actor_id<>actor or prior.contract_id<>p_contract_id or prior.input is distinct from p_input then
   raise exception 'requestIdConflict'; end if;
  return prior.result||jsonb_build_object('idempotent',true);
 end if;
 -- Do not adopt a request already consumed by another collection workflow.
 if exists(select 1 from private.lease_collection_requests where request_id=p_request_id) then
  raise exception 'requestIdConflict'; end if;
 select * into c from public.lease_contracts where id=p_contract_id for update;
 if not found or not coalesce(public.can_access_unit(c.unit_id),false) then
  raise exception 'missingRentPermissionDenied' using errcode='42501'; end if;
 perform 1 from public.payments where source_id=c.id order by id for update;
 perform 1 from public.receivables where source_type='lease_contract' and source_id=c.id order by due_date,id for update;
 before_state:=public.missing_rent_collection_review_rpc(c.id);
 if before_state->>'token' is distinct from p_input->>'expectedToken' then
  raise exception 'missingRentSnapshotChanged'; end if;
 if c.status<>'active' or c.commencement_state<>'started' or c.rent_currency<>'XOF'
  or c.payment_cycle<>'monthly' or c.monthly_rent_xof<>v_amount or c.start_date is null or start_day<c.start_date
  or (c.expected_end_confirmed and (c.expected_end_date is null or end_day>c.expected_end_date)) then
  raise exception 'missingRentContractRequiresReview'; end if;
 -- Due dates identify potential conflicts, never the period of an old bill.
 -- Even cancelled copies require review rather than silently recreating debt.
 if exists(select 1 from public.receivables r where r.source_type='lease_contract' and r.source_id=c.id
  and r.category='lease_rent' and ((r.due_date between start_day and end_day)
   or (r.service_period_start is not null and r.service_period_end is not null
       and r.service_period_start<=end_day and r.service_period_end>=start_day)
   or (r.service_period_start is null and r.service_period_end between start_day and end_day))) then
  raise exception 'missingRentExistingBillRequiresReview'; end if;
 if exists(select 1 from public.payments p where p.source_id=c.id
  and p.source_type in ('lease_rent','lease_contract') and p.payment_date=payment_day
  and p.currency='XOF' and p.amount=v_amount and p.reversal_of_payment_id is null) then
  raise exception 'missingRentExistingPaymentRequiresReview'; end if;
 select * into strict u from public.units where id=c.unit_id;
 source:=btrim(p_input->>'reason');
 insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,
  amount_xof,paid_amount_xof,status,currency,service_period_start,service_period_end,service_period_source,
  service_period_confirmed_by,notes)
 values(u.building_id,c.unit_id,c.customer_id,'lease_contract',c.id,'lease_rent',
  u.unit_no||' 租金 '||start_day||'至'||end_day,start_day,v_amount,0,'pending','XOF',
  start_day,end_day,source,actor,'明确账期补建并收款；请求号：'||p_request_id)
 returning id into r_id;
 collection:=public.lease_collection_rpc(jsonb_build_object(
  'contractId',c.id,'paymentDate',payment_day,'currency','XOF','amount',v_amount,
  'paymentMethod',p_input->>'paymentMethod','notes',source,
  'allocations',jsonb_build_array(jsonb_build_object('receivableId',r_id,'amount',v_amount,'expectedOutstanding',v_amount)))
  ||case when p_input ? 'externalReceiptNo' then jsonb_build_object('externalReceiptNo',p_input->>'externalReceiptNo') else '{}'::jsonb end,
  p_request_id);
 if collection->>'success' is distinct from 'true'
  or collection->>'paidThroughBefore' is distinct from collection->>'paidThroughAfter'
  or not exists(select 1 from public.receivables where id=r_id and status='paid' and paid_amount_xof=v_amount)
  or (select paid_through_date from public.lease_contracts where id=c.id) is distinct from c.paid_through_date then
  raise exception 'missingRentVerificationFailed'; end if;
 result:=jsonb_build_object('status','completed','requestId',p_request_id,'actorId',actor,
  'contractId',c.id,'receivableId',r_id,'periodStart',start_day,'periodEnd',end_day,
  'amountXof',v_amount,'paymentDate',payment_day,'paymentMethod',p_input->>'paymentMethod',
  'paidThroughDate',c.paid_through_date,'collection',collection,'idempotent',false);
 insert into public.audit_logs(actor_id,actor_email,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
 values(actor,auth.jwt()->>'email',public.current_user_role(),'collect_missing_monthly_rent','lease_contract',c.id,
  before_state,result,jsonb_build_object('request_id',p_request_id,'input',p_input,
  'channel','operator_missing_monthly_rent_v1','historical_coverage_unchanged',true));
 insert into private.missing_rent_collection_requests values(p_request_id,actor,c.id,p_input,result,clock_timestamp());
 return result;
end; $$;
revoke all on function private.collect_missing_monthly_rent(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create function public.collect_missing_monthly_rent_rpc(p_contract_id uuid,p_input jsonb,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.collect_missing_monthly_rent($1,$2,$3);
$$;
create function public.missing_rent_collection_status_rpc(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare prior private.missing_rent_collection_requests%rowtype; c public.lease_contracts%rowtype;
begin
 if not private.missing_rent_collection_allowed() then raise exception 'missingRentPermissionDenied' using errcode='42501'; end if;
 select * into prior from private.missing_rent_collection_requests where request_id=p_request_id;
 if not found then return jsonb_build_object('status','not_found','requestId',p_request_id); end if;
 select * into c from public.lease_contracts where id=prior.contract_id;
 if prior.actor_id<>auth.uid() or not coalesce(public.can_access_unit(c.unit_id),false) then
  raise exception 'missingRentPermissionDenied' using errcode='42501'; end if;
 return prior.result||jsonb_build_object('input',prior.input,'currentContract',to_jsonb(c),
  'currentReceivable',(select to_jsonb(r) from public.receivables r where r.id=(prior.result->>'receivableId')::uuid),
  'currentPayments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb)
   from public.payments p where p.id in(select value::uuid from jsonb_array_elements_text(prior.result->'collection'->'paymentIds'))));
end; $$;
revoke all on function public.missing_rent_collection_review_rpc(uuid),public.collect_missing_monthly_rent_rpc(uuid,jsonb,uuid),
 public.missing_rent_collection_status_rpc(uuid) from public,anon,authenticated,service_role;
grant execute on function public.missing_rent_collection_review_rpc(uuid),public.collect_missing_monthly_rent_rpc(uuid,jsonb,uuid),
 public.missing_rent_collection_status_rpc(uuid) to authenticated;
commit;
