begin;

-- Add a transport-specific wrapper, not a second set of money rules. The old
-- web RPC retains its exact input and audit contract. Only owner-run wrappers
-- may supply an execution context; callers cannot forge it through a GUC.
do $migration$
declare
  definition text;
  old_header text := 'CREATE OR REPLACE FUNCTION private.record_lease_collection(p_input jsonb, p_request_id uuid)';
  new_header text := 'CREATE OR REPLACE FUNCTION private.record_lease_collection_with_context(p_input jsonb, p_request_id uuid, p_context jsonb)';
  actor_marker text := '  if actor is null or coalesce(auth.jwt()->>''role'','''')<>''authenticated''';
  audit_marker text := '''coverage_explicitly_confirmed'',coverage is not null,''no_receivables_created'',true));';
  child_marker text := 'native_money:=money_currency<>''XOF''; child_request:=gen_random_uuid();';
  validation text := $context$
  if p_context is not null and (
    jsonb_typeof(p_context) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_context) k where k not in (
      'channel','authorization','original_instruction','input_source','connector_version','protocol_version'))
    or p_context->>'channel' is distinct from 'external_codex'
    or p_context->>'authorization' is distinct from 'explicit_instruction'
    or p_context->>'protocol_version' is distinct from '1.0'
    or p_context->>'connector_version' is distinct from '0.7.0'
    or jsonb_typeof(p_context->'original_instruction') is distinct from 'string'
    or length(btrim(p_context->>'original_instruction'))<1 or length(p_context->>'original_instruction')>4000
    or p_context->>'input_source' is null
    or p_context->>'input_source' not in ('natural_language','excel_screenshot')
    or p_input->>'currency' is null or p_input->>'currency' not in ('USD','CNY')
  ) then raise exception 'nativeCollectionInvalidContext'; end if;
$context$;
begin
  definition := replace(pg_get_functiondef('private.record_lease_collection(jsonb,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  if (length(definition)-length(replace(definition,old_header,'')))/length(old_header)<>1
    or (length(definition)-length(replace(definition,actor_marker,'')))/length(actor_marker)<>1
    or (length(definition)-length(replace(definition,audit_marker,'')))/length(audit_marker)<>1
    or (length(definition)-length(replace(definition,child_marker,'')))/length(child_marker)<>1 then
    raise exception 'nativeCollectionSharedWriterDrift';
  end if;
  definition := replace(definition,old_header,new_header);
  definition := replace(definition,actor_marker,validation||actor_marker);
  definition := replace(definition,audit_marker,
    '''coverage_explicitly_confirmed'',coverage is not null,''no_receivables_created'',true)||coalesce(p_context,''{}''::jsonb));');
  -- The native wrapper has one rent group, so reserve its parent UUID in the
  -- global payments namespace. Older writers cannot reuse it for another flow.
  -- Legacy web requests keep their original random per-category child UUIDs.
  definition := replace(definition,child_marker,
    'native_money:=money_currency<>''XOF''; child_request:=case when p_context is null then gen_random_uuid() else p_request_id end;');
  execute definition;
end; $migration$;
revoke all on function private.record_lease_collection_with_context(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function private.record_lease_collection(p_input jsonb,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select private.record_lease_collection_with_context($1,$2,null);
$$;
-- Existing grants on this compatibility signature are intentionally unchanged.

create table private.operator_native_collection_requests (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  contract_id uuid not null references public.lease_contracts(id),
  request_data jsonb not null,
  result jsonb not null,
  deployment text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index operator_native_collection_requests_actor on private.operator_native_collection_requests(actor_id,created_at desc);
create index operator_native_collection_requests_contract on private.operator_native_collection_requests(contract_id);
alter table private.operator_native_collection_requests enable row level security;
revoke all on private.operator_native_collection_requests from public,anon,authenticated,service_role;

create function public.can_execute_operator_native_collection()
returns boolean language sql stable security invoker set search_path='' as $$
  select auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated'
    and coalesce(public.has_app_role('admin','finance'),false)
    and coalesce(public.can_execute_operator_action('record_lease_rent','L2'),false);
$$;

-- Validate independently from the HTTP/MCP contract. Decimal strings never
-- pass through floating point or an XOF-labelled field. Normalize equivalent
-- amounts and UUID spellings before storing the request identity.
create function private.operator_native_collection_request(p_request jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  item jsonb; normalized jsonb; allocations jsonb:='[]'; coverage jsonb;
  amount numeric; total numeric:=0; ids uuid[]:='{}'; proof_ids uuid[]:='{}';
  payment_day date; expected_day date; through_day date; updated timestamptz;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  money_pattern text:='^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$';
begin
  if p_request is null or jsonb_typeof(p_request) is distinct from 'object'
    or octet_length(p_request::text)>65536 then raise exception 'nativeCollectionInvalidRequest'; end if;
  if exists(select 1 from jsonb_object_keys(p_request) k where k not in (
      'protocolVersion','connectorVersion','requestId','originalInstruction','inputSource',
      'contractId','currency','amount','paymentDate','paymentMethod','allocations',
      'externalReceiptNo','actualCollector','collectorBasis','notes','coverage'))
    or jsonb_typeof(p_request->'protocolVersion') is distinct from 'string'
    or p_request->>'protocolVersion' is distinct from '1.0'
    or p_request->>'connectorVersion' is distinct from '0.7.0'
    or jsonb_typeof(p_request->'requestId') is distinct from 'string'
    or coalesce(p_request->>'requestId','') !~* uuid_pattern
    or jsonb_typeof(p_request->'contractId') is distinct from 'string'
    or coalesce(p_request->>'contractId','') !~* uuid_pattern
    or jsonb_typeof(p_request->'originalInstruction') is distinct from 'string'
    or length(btrim(p_request->>'originalInstruction'))<1 or length(p_request->>'originalInstruction')>4000
    or p_request->>'inputSource' is null or p_request->>'inputSource' not in ('natural_language','excel_screenshot')
    or p_request->>'currency' is null or p_request->>'currency' not in ('USD','CNY')
    or jsonb_typeof(p_request->'amount') is distinct from 'string'
    or coalesce(p_request->>'amount','') !~ money_pattern
    or jsonb_typeof(p_request->'paymentDate') is distinct from 'string'
    or coalesce(p_request->>'paymentDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_request->>'paymentMethod' is null or p_request->>'paymentMethod' not in ('cash','check','bank_transfer','other')
    or jsonb_typeof(p_request->'allocations') is distinct from 'array' then raise exception 'nativeCollectionInvalidRequest'; end if;
  amount:=(p_request->>'amount')::numeric;
  if amount<=0 or amount>999999999999.99 or jsonb_array_length(p_request->'allocations') not between 1 and 100 then
    raise exception 'nativeCollectionInvalidRequest'; end if;
  begin
    payment_day:=(p_request->>'paymentDate')::date;
    if not isfinite(payment_day) or to_char(payment_day,'YYYY-MM-DD')<>p_request->>'paymentDate' then
      raise exception 'nativeCollectionInvalidRequest'; end if;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception 'nativeCollectionInvalidRequest'; end;
  -- Current-date policy is rechecked in the VOLATILE preview/execute functions.
  if p_request ? 'externalReceiptNo' and (jsonb_typeof(p_request->'externalReceiptNo') is distinct from 'string'
    or length(p_request->>'externalReceiptNo')>200) then raise exception 'nativeCollectionInvalidRequest'; end if;
  if p_request ? 'notes' and (jsonb_typeof(p_request->'notes') is distinct from 'string'
    or length(p_request->>'notes')>2000) then raise exception 'nativeCollectionInvalidRequest'; end if;
  if p_request ? 'actualCollector' or p_request ? 'collectorBasis' then
    if jsonb_typeof(p_request->'actualCollector') is distinct from 'string'
      or jsonb_typeof(p_request->'collectorBasis') is distinct from 'string'
      or length(btrim(p_request->>'actualCollector'))<1 or length(p_request->>'actualCollector')>100
      or length(btrim(p_request->>'collectorBasis'))<1 or length(p_request->>'collectorBasis')>1000 then raise exception 'nativeCollectionInvalidRequest'; end if;
  end if;
  for item in select value from jsonb_array_elements(p_request->'allocations') loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception 'nativeCollectionInvalidRequest'; end if;
    if exists(select 1 from jsonb_object_keys(item) k where k not in ('receivableId','amount'))
      or jsonb_typeof(item->'receivableId') is distinct from 'string'
      or coalesce(item->>'receivableId','') !~* uuid_pattern
      or jsonb_typeof(item->'amount') is distinct from 'string'
      or coalesce(item->>'amount','') !~ money_pattern then raise exception 'nativeCollectionInvalidRequest'; end if;
    if (item->>'receivableId')::uuid=any(ids) or (item->>'amount')::numeric<=0
      or (item->>'amount')::numeric>999999999999.99 then raise exception 'nativeCollectionInvalidRequest'; end if;
    ids:=array_append(ids,(item->>'receivableId')::uuid);
    total:=total+(item->>'amount')::numeric;
    allocations:=allocations||jsonb_build_array(jsonb_build_object('receivableId',(item->>'receivableId')::uuid,
      'amount',((item->>'amount')::numeric(14,2))::text));
  end loop;
  if total<>amount then raise exception 'nativeCollectionAmountMismatch'; end if;
  normalized:=p_request||jsonb_build_object('requestId',(p_request->>'requestId')::uuid,
    'contractId',(p_request->>'contractId')::uuid,'amount',amount::numeric(14,2)::text,'allocations',allocations);
  if p_request ? 'coverage' then
    coverage:=p_request->'coverage';
    if jsonb_typeof(coverage) is distinct from 'object' then raise exception 'nativeCollectionInvalidRequest'; end if;
    if exists(select 1 from jsonb_object_keys(coverage) k where k not in (
      'expectedPaidThroughDate','expectedContractUpdatedAt','throughDate','receivableIds'))
      or jsonb_typeof(coverage->'expectedPaidThroughDate') is distinct from 'string'
      or coalesce(coverage->>'expectedPaidThroughDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(coverage->'throughDate') is distinct from 'string'
      or coalesce(coverage->>'throughDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(coverage->'expectedContractUpdatedAt') is distinct from 'string'
      or length(coverage->>'expectedContractUpdatedAt')>100
      or coalesce(coverage->>'expectedContractUpdatedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or jsonb_typeof(coverage->'receivableIds') is distinct from 'array' then raise exception 'nativeCollectionInvalidRequest'; end if;
    begin
      expected_day:=(coverage->>'expectedPaidThroughDate')::date;
      through_day:=(coverage->>'throughDate')::date;
      updated:=(coverage->>'expectedContractUpdatedAt')::timestamptz;
      if not isfinite(expected_day) or not isfinite(through_day) or not isfinite(updated)
        or to_char(expected_day,'YYYY-MM-DD')<>coverage->>'expectedPaidThroughDate'
        or to_char(through_day,'YYYY-MM-DD')<>coverage->>'throughDate'
        or through_day<=expected_day then raise exception 'nativeCollectionInvalidRequest'; end if;
    exception when datetime_field_overflow or invalid_datetime_format then raise exception 'nativeCollectionInvalidRequest'; end;
    if jsonb_array_length(coverage->'receivableIds') not between 1 and 100 then raise exception 'nativeCollectionInvalidRequest'; end if;
    for item in select value from jsonb_array_elements(coverage->'receivableIds') loop
      if jsonb_typeof(item) is distinct from 'string' or (item#>>'{}') !~* uuid_pattern then raise exception 'nativeCollectionInvalidRequest'; end if;
      if (item#>>'{}')::uuid=any(proof_ids) then raise exception 'nativeCollectionInvalidRequest'; end if;
      proof_ids:=array_append(proof_ids,(item#>>'{}')::uuid);
    end loop;
    if not (ids && proof_ids) then raise exception 'nativeCollectionInvalidRequest'; end if;
    normalized:=normalized||jsonb_build_object('coverage',coverage||jsonb_build_object('receivableIds',to_jsonb(proof_ids)));
  end if;
  return normalized;
end; $$;
revoke all on function private.operator_native_collection_request(jsonb) from public,anon,authenticated,service_role;

create function private.query_operator_native_collection(p_selector jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare candidates jsonb; c public.lease_contracts%rowtype; target uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance','boss'),false)
    or not coalesce(public.can_execute_operator_action('query_lease_position','L0'),false) then
    raise exception 'nativeCollectionForbidden' using errcode='42501'; end if;
  if p_selector is null or jsonb_typeof(p_selector) is distinct from 'object' then raise exception 'nativeCollectionInvalidSelector'; end if;
  if exists(select 1 from jsonb_object_keys(p_selector) k where k not in ('contractId','buildingCode','unitNo'))
    or not ((p_selector ? 'contractId' and not(p_selector ? 'buildingCode' or p_selector ? 'unitNo'))
      or (not(p_selector ? 'contractId') and p_selector ? 'buildingCode' and p_selector ? 'unitNo')) then
    raise exception 'nativeCollectionInvalidSelector'; end if;
  if p_selector ? 'contractId' then
    if jsonb_typeof(p_selector->'contractId') is distinct from 'string'
      or coalesce(p_selector->>'contractId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'nativeCollectionInvalidSelector'; end if;
    target:=(p_selector->>'contractId')::uuid;
  elsif jsonb_typeof(p_selector->'buildingCode') is distinct from 'string'
    or length(btrim(p_selector->>'buildingCode')) not between 1 and 80
    or jsonb_typeof(p_selector->'unitNo') is distinct from 'string'
    or length(btrim(p_selector->>'unitNo')) not between 1 and 80 then raise exception 'nativeCollectionInvalidSelector'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('contractId',x.id,'contractNo',x.contract_no,
    'currency',x.rent_currency,'unitNo',x.unit_no) order by x.id),'[]') into candidates
  from (select lc.id,lc.contract_no,lc.rent_currency,u.unit_no from public.lease_contracts lc
    join public.units u on u.id=lc.unit_id join public.buildings b on b.id=u.building_id
    where lc.rent_currency in ('USD','CNY') and public.can_access_unit(u.id)
      and ((target is not null and lc.id=target) or (target is null
        and lower(b.code)=lower(btrim(p_selector->>'buildingCode')) and lower(u.unit_no)=lower(btrim(p_selector->>'unitNo'))))
    order by lc.id limit 101) x;
  if jsonb_array_length(candidates)<>1 then return jsonb_build_object('status',
    case when jsonb_array_length(candidates)=0 then 'not_found' else 'selection_required' end,'candidates',candidates); end if;
  select * into strict c from public.lease_contracts where id=(candidates->0->>'contractId')::uuid;
  return jsonb_build_object('status','found','candidates',candidates,'contract',to_jsonb(c),
    'receivables',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('outstandingNative',
      greatest(0,r.amount_native-r.paid_amount_native)::numeric(14,2)::text) order by r.due_date,r.id)
      from public.receivables r where r.source_type='lease_contract' and r.source_id=c.id
        and r.category='lease_rent' and r.currency=c.rent_currency and r.amount_native is not null
        and r.unit_id=c.unit_id and r.customer_id=c.customer_id
        and r.building_id=(select building_id from public.units where id=c.unit_id)
        and public.can_access_unit(r.unit_id)),'[]'));
end; $$;

create function private.preview_operator_native_collection(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  req jsonb; c public.lease_contracts%rowtype; u public.units%rowtype; r public.receivables%rowtype;
  item jsonb; selected jsonb:='[]'; inputs jsonb:='[]'; lease_input jsonb; coverage jsonb;
  proof_rows jsonb:='[]'; proof_ids uuid[]; cursor_day date; through_day date; paid_after numeric;
begin
  if not public.can_execute_operator_native_collection() then raise exception 'nativeCollectionForbidden' using errcode='42501'; end if;
  req:=private.operator_native_collection_request(p_request);
  if (req->>'paymentDate')::date>current_date then raise exception 'nativeCollectionInvalidRequest'; end if;
  select * into c from public.lease_contracts where id=(req->>'contractId')::uuid;
  if not found then raise exception 'nativeCollectionNotFound'; end if;
  if not coalesce(public.can_access_unit(c.unit_id),false) then raise exception 'nativeCollectionForbidden' using errcode='42501'; end if;
  if c.rent_currency::text is distinct from req->>'currency' or c.status<>'active' then raise exception 'nativeCollectionContractChanged'; end if;
  select * into strict u from public.units where id=c.unit_id;
  for item in select value from jsonb_array_elements(req->'allocations') loop
    select * into r from public.receivables where id=(item->>'receivableId')::uuid;
    if not found or r.source_type<>'lease_contract' or r.source_id is distinct from c.id
      or r.unit_id is distinct from c.unit_id or r.customer_id is distinct from c.customer_id
      or r.building_id is distinct from u.building_id or r.category<>'lease_rent'
      or r.currency::text is distinct from req->>'currency' or r.management_status is distinct from 'managed'
      or r.status not in ('pending','partial','overdue') or r.amount_native is null or r.paid_amount_native is null
      or r.amount_native::text in ('NaN','Infinity','-Infinity') or r.paid_amount_native::text in ('NaN','Infinity','-Infinity')
      or r.amount_xof<>0 or r.paid_amount_xof<>0 or r.paid_amount_native<0
      or r.amount_native-r.paid_amount_native<=0 or (item->>'amount')::numeric>r.amount_native-r.paid_amount_native then
      raise exception 'nativeCollectionReceivableConflict'; end if;
    selected:=selected||jsonb_build_array(to_jsonb(r));
    inputs:=inputs||jsonb_build_array(jsonb_build_object('receivableId',r.id,'amount',(item->>'amount')::numeric,
      'expectedOutstanding',r.amount_native-r.paid_amount_native,'expectedUpdatedAt',to_jsonb(r)->>'updated_at'));
  end loop;
  lease_input:=jsonb_build_object('contractId',c.id,'paymentDate',req->>'paymentDate','currency',req->>'currency',
    'amount',(req->>'amount')::numeric,'paymentMethod',req->>'paymentMethod','allocations',inputs);
  for item in select to_jsonb(k) from jsonb_object_keys(req) k where k in (
    'externalReceiptNo','actualCollector','collectorBasis','notes') loop
    lease_input:=lease_input||jsonb_build_object(item#>>'{}',req->(item#>>'{}'));
  end loop;
  if req ? 'coverage' then
    coverage:=req->'coverage'; through_day:=(coverage->>'throughDate')::date;
    if c.paid_through_date is null or c.paid_through_date is distinct from (coverage->>'expectedPaidThroughDate')::date
      or c.updated_at is distinct from (coverage->>'expectedContractUpdatedAt')::timestamptz
      or c.commencement_state is distinct from 'started' or c.start_date is null or not isfinite(c.start_date)
      or c.start_date>current_date or c.paid_through_date<c.start_date-1 or c.actual_end_date is not null
      or (c.expected_end_confirmed and (c.expected_end_date is null or not isfinite(c.expected_end_date) or through_day>c.expected_end_date)) then
      raise exception 'nativeCollectionCoverageConflict'; end if;
    select array_agg((x#>>'{}')::uuid) into proof_ids from jsonb_array_elements(coverage->'receivableIds') x;
    if (select count(*) from public.receivables where id=any(proof_ids))<>cardinality(proof_ids) then raise exception 'nativeCollectionCoverageConflict'; end if;
    cursor_day:=c.paid_through_date+1;
    for r in select * from public.receivables where id=any(proof_ids) order by service_period_start,id loop
      select r.paid_amount_native+coalesce(sum((x->>'amount')::numeric),0) into paid_after
        from jsonb_array_elements(req->'allocations') x where (x->>'receivableId')::uuid=r.id;
      if r.source_type<>'lease_contract' or r.source_id is distinct from c.id or r.unit_id is distinct from c.unit_id
        or r.customer_id is distinct from c.customer_id or r.building_id is distinct from u.building_id
        or r.category<>'lease_rent' or r.currency is distinct from c.rent_currency
        or r.management_status is distinct from 'managed' or r.status not in ('pending','partial','overdue','paid')
        or r.service_period_start is null or r.service_period_end is null
        or not isfinite(r.service_period_start) or not isfinite(r.service_period_end)
        or nullif(btrim(r.service_period_source),'') is null or r.service_period_start<>cursor_day
        or r.service_period_end<r.service_period_start or r.service_period_end>through_day
        or r.amount_native is null or r.amount_native<=0 or paid_after is distinct from r.amount_native
        or r.amount_xof<>0 or r.paid_amount_xof<>0 then raise exception 'nativeCollectionCoverageConflict'; end if;
      cursor_day:=r.service_period_end+1;
    end loop;
    if cursor_day<>through_day+1 then raise exception 'nativeCollectionCoverageConflict'; end if;
    if exists(select 1 from public.receivables rr where rr.source_type='lease_contract' and rr.source_id=c.id
      and rr.category='lease_rent' and rr.status<>'cancelled' and not(rr.id=any(proof_ids)) and (
        (rr.service_period_start is not null and rr.service_period_end is not null and rr.service_period_start<=through_day and rr.service_period_end>c.paid_through_date)
        or (rr.management_status='managed' and case when rr.currency='XOF' then rr.amount_xof>rr.paid_amount_xof else rr.amount_native>rr.paid_amount_native end
          and (rr.service_period_start is null or rr.service_period_end is null or rr.service_period_start<=through_day)))) then
      raise exception 'nativeCollectionCoverageConflict'; end if;
    if exists(select 1 from public.receivables rr where rr.source_type='lease_contract' and rr.source_id=c.id
      and rr.category='lease_rent' and rr.status<>'cancelled' and (
        rr.unit_id is distinct from c.unit_id or rr.customer_id is distinct from c.customer_id
        or rr.building_id is distinct from u.building_id or not coalesce(public.can_access_unit(rr.unit_id),false))) then
      raise exception 'nativeCollectionCoverageConflict'; end if;
    select coalesce(jsonb_agg(to_jsonb(rr) order by rr.due_date,rr.id),'[]') into proof_rows
      from public.receivables rr where rr.source_type='lease_contract' and rr.source_id=c.id and rr.category='lease_rent' and rr.status<>'cancelled';
    lease_input:=lease_input||jsonb_build_object('coverage',coverage);
  end if;
  -- Selected rows follow request order, which is part of the request identity.
  return jsonb_build_object('contract',to_jsonb(c),'receivables',selected,'coverageReceivables',proof_rows,'leaseInput',lease_input);
end; $$;

create function private.find_operator_native_collection(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare saved private.operator_native_collection_requests%rowtype; target_unit uuid;
begin
  if not public.can_execute_operator_native_collection() then raise exception 'nativeCollectionForbidden' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'nativeCollectionInvalidRequest'; end if;
  select * into saved from private.operator_native_collection_requests where request_id=p_request_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if saved.actor_id<>auth.uid() then raise exception 'nativeCollectionRequestConflict'; end if;
  select unit_id into target_unit from public.lease_contracts where id=saved.contract_id;
  if target_unit is null or not coalesce(public.can_access_unit(target_unit),false) then raise exception 'nativeCollectionForbidden' using errcode='42501'; end if;
  return jsonb_build_object('status','completed_previously','verified',false,'requestId',saved.request_id,
    'currency',saved.request_data->>'currency','amount',saved.request_data->>'amount','contractId',saved.contract_id,
    'request',saved.request_data,'result',saved.result);
end; $$;

create function private.execute_operator_native_collection(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); req jsonb; live jsonb; context jsonb; shared jsonb; result jsonb;
  saved private.operator_native_collection_requests%rowtype;
  c public.lease_contracts%rowtype; u public.units%rowtype; p public.payments%rowtype; l public.ledger_entries%rowtype;
  r public.receivables%rowtype; a public.lease_native_payment_allocations%rowtype; audit public.audit_logs%rowtype;
  item jsonb; before_row jsonb; payment_id uuid; receipt text; amount numeric;
  result_allocations jsonb:='[]'; evidence_allocations jsonb:='[]'; evidence_receivables jsonb:='[]';
begin
  if not public.can_execute_operator_native_collection() then raise exception 'nativeCollectionForbidden' using errcode='42501'; end if;
  req:=private.operator_native_collection_request(p_request);
  perform pg_advisory_xact_lock(hashtextextended(req->>'requestId',0));
  select * into saved from private.operator_native_collection_requests where request_id=(req->>'requestId')::uuid;
  if found then
    if saved.actor_id<>actor or saved.request_data is distinct from req then raise exception 'nativeCollectionRequestConflict'; end if;
    return private.find_operator_native_collection(saved.request_id);
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp()
    or p_expires_at>clock_timestamp()+interval '10 minutes 5 seconds'
    or p_deployment is null or length(btrim(p_deployment)) not between 1 and 200 then raise exception 'nativeCollectionExpired'; end if;
  if exists(select 1 from private.lease_collection_requests where request_id=(req->>'requestId')::uuid)
    or exists(select 1 from public.payments where request_id=(req->>'requestId')::uuid) then raise exception 'nativeCollectionRequestConflict'; end if;
  receipt:=nullif(btrim(req->>'externalReceiptNo'),'');
  if receipt is not null then
    perform pg_advisory_xact_lock(hashtextextended('operator_native_receipt:'||(req->>'contractId')||':'||lower(receipt),0));
  end if;
  select * into c from public.lease_contracts where id=(req->>'contractId')::uuid for update;
  if not found then raise exception 'nativeCollectionNotFound'; end if;
  if not coalesce(public.can_access_unit(c.unit_id),false) then raise exception 'nativeCollectionForbidden' using errcode='42501'; end if;
  if receipt is not null and exists(select 1 from public.payments where source_type='lease_rent'
    and source_id=c.id and native_settlement and lower(btrim(external_receipt_no))=lower(receipt)) then
    raise exception 'nativeCollectionDuplicateReceipt'; end if;
  -- Use exactly the shared cash writer's lock order, including all coverage
  -- obligations. Never take a unit lock or lock rows in client array order.
  perform 1 from public.receivables rr where rr.id in (
    select (x->>'receivableId')::uuid from jsonb_array_elements(req->'allocations') x)
    or (req ? 'coverage' and (rr.id in (select (x#>>'{}')::uuid from jsonb_array_elements(req->'coverage'->'receivableIds') x)
      or (rr.source_type='lease_contract' and rr.source_id=c.id and rr.category='lease_rent' and rr.status<>'cancelled')))
    order by rr.due_date,rr.id for update;
  live:=private.preview_operator_native_collection(req);
  if live is distinct from p_snapshot then raise exception 'nativeCollectionSnapshotChanged'; end if;
  context:=jsonb_build_object('channel','external_codex','authorization','explicit_instruction',
    'original_instruction',req->>'originalInstruction','input_source',req->>'inputSource',
    'connector_version',req->>'connectorVersion','protocol_version',req->>'protocolVersion');
  shared:=private.record_lease_collection_with_context(live->'leaseInput',(req->>'requestId')::uuid,context);
  if shared->'success' is distinct from 'true'::jsonb or shared->'idempotent' is distinct from 'false'::jsonb
    or shared->>'requestId' is distinct from req->>'requestId' or shared->>'currency' is distinct from req->>'currency'
    or (shared->>'totalAmount')::numeric is distinct from (req->>'amount')::numeric
    or jsonb_typeof(shared->'paymentIds') is distinct from 'array' or jsonb_array_length(shared->'paymentIds')<>1 then
    raise exception 'nativeCollectionVerificationFailed'; end if;
  payment_id:=(shared->'paymentIds'->>0)::uuid;
  select * into p from public.payments where id=payment_id;
  select * into strict u from public.units where id=c.unit_id;
  amount:=(req->>'amount')::numeric;
  if p.id is null or p.unit_id is distinct from c.unit_id or p.customer_id is distinct from c.customer_id
    or p.source_type<>'lease_rent' or p.source_id is distinct from c.id or p.amount is distinct from amount
    or p.currency::text is distinct from req->>'currency' or not p.native_settlement or p.exchange_rate_to_xof is not null
    or p.payment_date is distinct from (req->>'paymentDate')::date or p.payment_method is distinct from req->>'paymentMethod'
    or p.external_receipt_no is distinct from receipt or p.recorded_by is distinct from actor or p.request_kind<>'lease_collection'
    or p.request_id is distinct from (req->>'requestId')::uuid
    or p.reversal_of_payment_id is not null or exists(select 1 from public.payments where reversal_of_payment_id=p.id)
    or p.actual_collector is distinct from nullif(btrim(req->>'actualCollector'),'')
    or p.collector_basis is distinct from nullif(btrim(req->>'collectorBasis'),'')
    or (req ? 'actualCollector' and (p.context_version<>1 or p.context_confirmed_by is distinct from actor or p.context_confirmed_at is null))
    or (not(req ? 'actualCollector') and (p.context_version<>0 or p.context_confirmed_by is not null or p.context_confirmed_at is not null)) then
    raise exception 'nativeCollectionVerificationFailed'; end if;
  if (select count(*) from public.ledger_entries where ledger_entries.payment_id=p.id)<>1 then raise exception 'nativeCollectionVerificationFailed'; end if;
  select * into l from public.ledger_entries where ledger_entries.payment_id=p.id;
  if l.building_id is distinct from u.building_id or l.unit_id is distinct from c.unit_id or l.entry_date is distinct from p.payment_date
    or l.direction<>'income' or l.category<>'lease_rent' or l.currency is distinct from p.currency
    or l.amount_xof<>0 or l.amount_native is distinct from amount then raise exception 'nativeCollectionVerificationFailed'; end if;
  if (select count(*) from public.lease_native_payment_allocations where request_id=(req->>'requestId')::uuid)<>jsonb_array_length(req->'allocations')
    or (select count(*) from public.lease_native_payment_allocations where lease_native_payment_allocations.payment_id=p.id)<>jsonb_array_length(req->'allocations')
    or exists(select 1 from public.payment_receivable_allocations where payment_receivable_allocations.payment_id=p.id) then
    raise exception 'nativeCollectionVerificationFailed'; end if;
  for item in select value from jsonb_array_elements(req->'allocations') loop
    select * into r from public.receivables where id=(item->>'receivableId')::uuid;
    select value into before_row from jsonb_array_elements(live->'receivables') where value->>'id'=r.id::text;
    select * into a from public.lease_native_payment_allocations where lease_native_payment_allocations.payment_id=p.id and receivable_id=r.id;
    if r.id is null or before_row is null or a.payment_id is null or a.currency is distinct from p.currency
      or a.amount_native is distinct from (item->>'amount')::numeric or a.actor_id is distinct from actor
      or a.request_id is distinct from (req->>'requestId')::uuid
      or r.paid_amount_native is distinct from (before_row->>'paid_amount_native')::numeric+(item->>'amount')::numeric
      or r.status is distinct from (case when r.paid_amount_native=r.amount_native then 'paid' else 'partial' end)
      or (to_jsonb(r)-'paid_amount_native'-'status'-'updated_at') is distinct from (before_row-'paid_amount_native'-'status'-'updated_at')
      or r.amount_xof<>0 or r.paid_amount_xof<>0 then raise exception 'nativeCollectionVerificationFailed'; end if;
    result_allocations:=result_allocations||jsonb_build_array(jsonb_build_object('receivableId',r.id,'amount',a.amount_native::numeric(14,2)::text,'paymentId',p.id));
    evidence_allocations:=evidence_allocations||jsonb_build_array(jsonb_build_object('receivableId',r.id,'amount',a.amount_native::numeric(14,2)::text,'paymentId',p.id));
    evidence_receivables:=evidence_receivables||jsonb_build_array(jsonb_build_object('id',r.id,'currency',r.currency,
      'amount',r.amount_native::numeric(14,2)::text,'paidBefore',((before_row->>'paid_amount_native')::numeric(14,2))::text,
      'paidAfter',r.paid_amount_native::numeric(14,2)::text,'amountXof','0.00','paidAmountXof','0.00'));
  end loop;
  if (select count(*) from public.audit_logs al where al.action='record_lease_collection' and al.entity_type='lease_collection'
    and al.entity_id=c.id and al.metadata->>'request_id'=req->>'requestId')<>1 then raise exception 'nativeCollectionVerificationFailed'; end if;
  select * into audit from public.audit_logs al where al.action='record_lease_collection' and al.entity_type='lease_collection'
    and al.entity_id=c.id and al.metadata->>'request_id'=req->>'requestId';
  if audit.actor_id is distinct from actor or audit.metadata->>'channel' is distinct from 'external_codex'
    or audit.metadata->>'authorization' is distinct from 'explicit_instruction'
    or audit.metadata->>'original_instruction' is distinct from req->>'originalInstruction'
    or audit.metadata->>'input_source' is distinct from req->>'inputSource'
    or audit.metadata->>'connector_version' is distinct from req->>'connectorVersion'
    or audit.metadata->>'protocol_version' is distinct from req->>'protocolVersion'
    or audit.metadata->'input' is distinct from live->'leaseInput'
    or audit.after_data is distinct from shared or audit.before_data->'contract' is distinct from live->'contract'
    or not exists(select 1 from private.lease_collection_requests lr where lr.request_id=(req->>'requestId')::uuid
      and lr.actor_id=actor and lr.contract_id=c.id and lr.input=live->'leaseInput' and lr.result=shared) then
    raise exception 'nativeCollectionVerificationFailed'; end if;
  if shared->'paidThroughBefore' is distinct from live->'contract'->'paid_through_date'
    or shared->>'paidThroughAfter' is distinct from (select paid_through_date::text from public.lease_contracts where id=c.id)
    or (not(req ? 'coverage') and shared->'paidThroughBefore' is distinct from shared->'paidThroughAfter')
    or (req ? 'coverage' and shared->>'paidThroughAfter' is distinct from req->'coverage'->>'throughDate') then
    raise exception 'nativeCollectionVerificationFailed'; end if;
  result:=jsonb_build_object('status','completed','verified',true,'requestId',req->>'requestId',
    'currency',req->>'currency','amount',req->>'amount','contractId',c.id,'paymentIds',shared->'paymentIds',
    'allocations',result_allocations,'paidThroughBefore',shared->'paidThroughBefore','paidThroughAfter',shared->'paidThroughAfter',
    'verification',jsonb_build_object('version',1,'actorId',actor,
      'checks',jsonb_build_object('payments',true,'ledger',true,'allocations',true,'receivables',true,'audit',true,'xofUnchanged',true),
      'payments',jsonb_build_array(jsonb_build_object('id',p.id,'amount',p.amount::numeric(14,2)::text,'currency',p.currency,
        'nativeSettlement',p.native_settlement,'exchangeRateToXof',p.exchange_rate_to_xof,'recordedBy',p.recorded_by)),
      'ledger',jsonb_build_array(jsonb_build_object('paymentId',l.payment_id,'amount',l.amount_native::numeric(14,2)::text,'currency',l.currency,'amountXof',l.amount_xof::numeric(14,2)::text)),
      'allocations',evidence_allocations,'receivables',evidence_receivables,
      'audit',jsonb_build_object('id',audit.id,'actorId',audit.actor_id,'requestId',audit.metadata->>'request_id',
        'channel',audit.metadata->>'channel','authorization',audit.metadata->>'authorization')));
  insert into private.operator_native_collection_requests(request_id,actor_id,contract_id,request_data,result,deployment)
    values((req->>'requestId')::uuid,actor,c.id,req,result,p_deployment);
  select * into saved from private.operator_native_collection_requests where request_id=(req->>'requestId')::uuid;
  if not found or saved.actor_id is distinct from actor or saved.contract_id is distinct from c.id
    or saved.request_data is distinct from req or saved.result is distinct from result or saved.deployment is distinct from p_deployment then
    raise exception 'nativeCollectionVerificationFailed'; end if;
  return result;
end; $$;

create function public.query_operator_native_collection(p_selector jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.query_operator_native_collection($1); $$;
create function public.preview_operator_native_collection(p_request jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.preview_operator_native_collection($1); $$;
create function public.execute_operator_native_collection(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text)
returns jsonb language sql security invoker set search_path='' as $$ select private.execute_operator_native_collection($1,$2,$3,$4); $$;
create function public.find_operator_native_collection(p_request_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.find_operator_native_collection($1); $$;
create function public.operator_native_collection_protocol_version()
returns integer language sql immutable security invoker set search_path='' as $$ select 1; $$;

revoke all on function public.can_execute_operator_native_collection(),public.operator_native_collection_protocol_version(),
  private.query_operator_native_collection(jsonb),public.query_operator_native_collection(jsonb),
  private.preview_operator_native_collection(jsonb),public.preview_operator_native_collection(jsonb),
  private.execute_operator_native_collection(jsonb,jsonb,timestamptz,text),public.execute_operator_native_collection(jsonb,jsonb,timestamptz,text),
  private.find_operator_native_collection(uuid),public.find_operator_native_collection(uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_execute_operator_native_collection(),public.operator_native_collection_protocol_version(),
  private.query_operator_native_collection(jsonb),public.query_operator_native_collection(jsonb),
  private.preview_operator_native_collection(jsonb),public.preview_operator_native_collection(jsonb),
  private.execute_operator_native_collection(jsonb,jsonb,timestamptz,text),public.execute_operator_native_collection(jsonb,jsonb,timestamptz,text),
  private.find_operator_native_collection(uuid),public.find_operator_native_collection(uuid) to authenticated;
comment on function public.execute_operator_native_collection(jsonb,jsonb,timestamptz,text) is
  'Authenticated explicit-instruction USD/CNY lease-rent collections. Strict decimal strings, explicit existing managed allocations, no FX, no XOF valuation, locked live snapshot, atomic persisted evidence and audit.';
notify pgrst,'reload schema';
commit;
