begin;

-- No business rows or existing payment APIs are changed by this migration.
create table private.operator_collection_batches (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
  request_id uuid not null, request_data jsonb not null, expected_snapshot jsonb not null,
  deployment text not null, status text not null default 'pending' check(status in ('pending','completed','superseded')),
  replaces_id uuid references private.operator_collection_batches(id), result jsonb,
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
  confirmed_at timestamptz
);
create unique index operator_collection_batches_current_request on private.operator_collection_batches(request_id) where status <> 'superseded';
create index operator_collection_batches_actor on private.operator_collection_batches(actor_id,created_at desc);
create index operator_collection_batches_replaces on private.operator_collection_batches(replaces_id) where replaces_id is not null;
alter table private.operator_collection_batches enable row level security;
revoke all on private.operator_collection_batches from public,anon,authenticated,service_role;

-- Reserve the parent request in the existing global payments request namespace
-- using the first item; subsequent item ids are deterministic. A retry through
-- an older daily/sale tool cannot spend the same parent request a second time.
create function private.operator_collection_child_request(p_request jsonb,p_receivable uuid)
returns uuid language sql immutable security invoker set search_path='' as $$
  select case when (p_request->'rows'->0->'allocations'->0->>'receivableId')::uuid=p_receivable
    then (p_request->>'requestId')::uuid else md5((p_request->>'requestId')::uuid::text||':'||p_receivable::text)::uuid end;
$$;
revoke all on function private.operator_collection_child_request(jsonb,uuid) from public,anon,authenticated,service_role;

create function private.operator_collection_snapshot(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  row_data jsonb; allocation jsonb; target uuid; domain text; contract jsonb; v_unit_id uuid;
  v_customer_id uuid; r public.receivables%rowtype; items jsonb; result jsonb := '[]';
  schedule jsonb; rules jsonb; amount numeric; row_total numeric; total numeric := 0;
  targets text[] := '{}'; receivable_ids uuid[] := '{}'; action_name text; expected_source text;
begin
  if (select auth.uid()) is null then raise exception 'collectionForbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_request->'rows') is distinct from 'array' then raise exception 'invalidCollectionRequest'; end if;
  if jsonb_array_length(p_request->'rows') not between 1 and 30
    or p_request->>'protocolVersion' is distinct from '1.0'
    or nullif(btrim(p_request->>'originalInstruction'),'') is null
    or length(p_request->>'originalInstruction')>4000
    or (p_request->>'requestId')::uuid is null then raise exception 'invalidCollectionRequest'; end if;
  for row_data in select value from jsonb_array_elements(p_request->'rows') loop
    domain := row_data->>'domain'; target := (row_data->>'targetId')::uuid;
    if domain not in ('daily','lease','sale') or domain is null or target is null
      or nullif(btrim(row_data->>'lineId'),'') is null or length(row_data->>'lineId')>40
      or nullif(btrim(row_data->>'sourceText'),'') is null or length(row_data->>'sourceText')>1000
      or coalesce(row_data->>'paymentMethod','') not in ('cash','check','bank_transfer','offset','other')
      or (row_data->>'paymentDate')::date is null or not isfinite((row_data->>'paymentDate')::date)
      or length(row_data->>'receiptNo')>120 then raise exception 'invalidCollectionRow'; end if;
    if (domain||target::text)=any(targets) then raise exception 'duplicateCollectionTarget'; end if;
    targets := array_append(targets,domain||target::text);
    if domain='daily' then
      select to_jsonb(b),b.unit_id,b.customer_id into contract,v_unit_id,v_customer_id from public.daily_bookings b where id=target;
      expected_source := 'daily_booking';
      if coalesce(contract->>'status','') not in ('confirmed','checked_in','checked_out') or contract->>'checkout_mode'='open' then raise exception 'collectionTargetNotPayable'; end if;
    elsif domain='lease' then
      select to_jsonb(c),c.unit_id,c.customer_id into contract,v_unit_id,v_customer_id from public.lease_contracts c where id=target;
      expected_source := 'lease_contract';
      if coalesce(contract->>'status','')<>'active' or contract->>'commencement_state'='pending_project_opening' then raise exception 'collectionTargetNotPayable'; end if;
      if row_data ? 'paidThroughDate' and ((row_data->>'paidThroughDate')::date is null or not isfinite((row_data->>'paidThroughDate')::date)
        or (row_data->>'paidThroughDate')::date < (contract->>'paid_through_date')::date
        or (row_data->>'paidThroughDate')::date < (contract->>'start_date')::date
        or (row_data->>'paidThroughDate')::date > (contract->>'expected_end_date')::date) then raise exception 'collectionPaidThroughConflict'; end if;
    else
      select to_jsonb(c),c.unit_id,c.customer_id into contract,v_unit_id,v_customer_id from public.sale_contracts c where id=target;
      expected_source := 'sale_contract';
      if coalesce(contract->>'status','')<>'active' or coalesce((contract->>'total_amount_confirmed')::boolean,false)=false then raise exception 'collectionTargetNotPayable'; end if;
    end if;
    if contract is null or not coalesce(public.can_access_unit(v_unit_id),false) then raise exception 'collectionForbidden' using errcode='42501'; end if;
    if jsonb_typeof(row_data->'allocations') is distinct from 'array' then raise exception 'invalidCollectionAllocation'; end if;
    if jsonb_array_length(row_data->'allocations') not between 1 and 36 then raise exception 'invalidCollectionAllocation'; end if;
    if domain='daily' and jsonb_array_length(row_data->'allocations')<>1 then raise exception 'invalidCollectionAllocation'; end if;
    row_total:=0; items:='[]'; schedule:='[]';
    for allocation in select value from jsonb_array_elements(row_data->'allocations') loop
      if (allocation->>'receivableId')::uuid=any(receivable_ids) then raise exception 'duplicateCollectionReceivable'; end if;
      receivable_ids:=array_append(receivable_ids,(allocation->>'receivableId')::uuid);
      select * into r from public.receivables where id=(allocation->>'receivableId')::uuid;
      if r.id is null or r.source_id is distinct from target or r.source_type is distinct from expected_source
        or r.unit_id is distinct from v_unit_id or r.customer_id is distinct from v_customer_id
        or r.building_id is distinct from (select u.building_id from public.units u where u.id=v_unit_id)
        or r.currency::text <> 'XOF' or r.status in ('paid','cancelled')
        or r.management_status in ('historical_pending','excluded') then raise exception 'collectionReceivableConflict'; end if;
      action_name := case when domain='daily' and r.category='daily_rental' then 'record_daily_payment'
        when domain='lease' and r.category='lease_rent' then 'record_lease_rent'
        when domain='lease' and r.category='property_fee' then 'record_property_fee'
        when domain='lease' and r.category='lease_deposit' then 'record_lease_deposit'
        when domain='sale' and r.category in ('sale_lump_sum','sale_installment') then 'record_sale_payment' end;
      if action_name is null then raise exception 'collectionCategoryUnsupported'; end if;
      if not coalesce(private.current_operator_action_allowed(action_name,'L2'),false) then raise exception 'collectionForbidden' using errcode='42501'; end if;
      amount:=(allocation->>'amountXof')::numeric;
      if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount<>trunc(amount)
        or amount>999999999999 or r.paid_amount_xof<0 or amount>r.amount_xof-r.paid_amount_xof then raise exception 'collectionAmountConflict'; end if;
      if domain='sale' then
        if (select count(*) from public.receivables rr where rr.source_type='sale_contract' and rr.source_id=target and rr.category=r.category and rr.due_date=r.due_date and rr.amount_xof=r.amount_xof and rr.status<>'cancelled')<>1 then raise exception 'collectionScheduleAmbiguous'; end if;
        if (select count(*) from public.sale_payment_schedule s where s.sale_contract_id=target and s.due_date=r.due_date and s.amount_xof=r.amount_xof and s.status<>'cancelled')<>1 then raise exception 'collectionScheduleAmbiguous'; end if;
        schedule:=schedule||(select jsonb_agg(to_jsonb(s)) from public.sale_payment_schedule s where s.sale_contract_id=target and s.due_date=r.due_date and s.amount_xof=r.amount_xof and s.status<>'cancelled');
      end if;
      row_total:=row_total+amount; items:=items||jsonb_build_array(to_jsonb(r));
    end loop;
    if domain='lease' and jsonb_array_length(row_data->'allocations')>1 and not private.current_operator_action_allowed('record_combined_lease_payment','L3') then raise exception 'collectionForbidden' using errcode='42501'; end if;
    if domain='lease' and exists(select 1 from jsonb_array_elements(items) x where x->>'category'='lease_rent') and row_data->>'paidThroughDate' is null then raise exception 'collectionPaidThroughRequired'; end if;
    if row_data ? 'paidThroughDate' and (domain<>'lease' or not exists(select 1 from jsonb_array_elements(items) x where x->>'category'='lease_rent')) then raise exception 'collectionPaidThroughConflict'; end if;
    if domain='lease' and row_data ? 'paidThroughDate' and exists(
      select 1 from public.receivables rr where rr.source_type='lease_contract' and rr.source_id=target and rr.category='lease_rent'
        and rr.status<>'cancelled' and rr.management_status not in ('excluded','historical_pending')
        and rr.due_date<=(row_data->>'paidThroughDate')::date and rr.amount_xof-rr.paid_amount_xof>
          coalesce((select (x->>'amountXof')::numeric from jsonb_array_elements(row_data->'allocations') x where (x->>'receivableId')::uuid=rr.id),0)
    ) then raise exception 'collectionPaidThroughConflict'; end if;
    if row_total is distinct from (row_data->>'totalXof')::numeric then raise exception 'collectionTotalMismatch'; end if;
    total:=total+row_total;
    select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') into rules from public.property_fee_rules f where f.unit_id=v_unit_id and f.is_active;
    result:=result||jsonb_build_array(jsonb_build_object('lineId',row_data->>'lineId','contract',contract,
      'unit',(select jsonb_build_object('id',u.id,'code',u.code,'unit_no',u.unit_no) from public.units u where u.id=v_unit_id),
      'customer',(select jsonb_build_object('id',c.id,'name',c.name) from public.customers c where c.id=v_customer_id),
      'receivables',items,'schedules',schedule,'propertyFeeRules',rules,
      'daily',case when domain='daily' then public.daily_booking_operation_snapshot(target,null) else null end));
  end loop;
  if cardinality(receivable_ids)>100 or total is distinct from (p_request->>'totalXof')::numeric or total>999999999999 then raise exception 'collectionTotalMismatch'; end if;
  return result;
end; $$;

create function public.preview_operator_collection(p_request jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.operator_collection_snapshot($1); $$;

create function private.query_operator_collection(p_domain text,p_target_id uuid,p_building_code text,p_unit_no text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidates jsonb; target uuid; v_unit_id uuid; contract jsonb; action_name text;
begin
  action_name:=case p_domain when 'daily' then 'query_daily_booking' when 'lease' then 'query_lease_position' when 'sale' then 'query_sale_position' end;
  if action_name is null or not coalesce(private.current_operator_action_allowed(action_name,'L0'),false) then raise exception 'collectionForbidden' using errcode='42501'; end if;
  if p_target_id is null and (nullif(trim(p_building_code),'') is null or nullif(trim(p_unit_no),'') is null) then raise exception 'collectionSelectorRequired'; end if;
  if p_target_id is not null and (p_building_code is not null or p_unit_no is not null) then raise exception 'collectionSelectorRequired'; end if;
  select coalesce(jsonb_agg(x.data order by x.id),'[]') into candidates from (
    select d.id,d.unit_id,to_jsonb(d) data from public.daily_bookings d where p_domain='daily'
    union all select c.id,c.unit_id,to_jsonb(c) from public.lease_contracts c where p_domain='lease'
    union all select c.id,c.unit_id,to_jsonb(c) from public.sale_contracts c where p_domain='sale'
  ) x join public.units u on u.id=x.unit_id join public.buildings b on b.id=u.building_id
  where public.can_access_unit(u.id) and ((p_target_id is not null and x.id=p_target_id) or
    (p_target_id is null and lower(b.code)=lower(trim(p_building_code)) and lower(u.unit_no)=lower(trim(p_unit_no))));
  if jsonb_array_length(candidates)<>1 then return jsonb_build_object('status',case when jsonb_array_length(candidates)=0 then 'not_found' else 'selection_required' end,'candidates',candidates); end if;
  contract:=candidates->0; target:=(contract->>'id')::uuid; v_unit_id:=(contract->>'unit_id')::uuid;
  return jsonb_build_object('status','found','contract',contract,
    'unit',(select jsonb_build_object('code',u.code,'unit_no',u.unit_no) from public.units u where u.id=v_unit_id),
    'customer',(select jsonb_build_object('name',c.name) from public.customers c where c.id=(contract->>'customer_id')::uuid),
    'receivables',coalesce((select jsonb_agg(to_jsonb(r) order by r.due_date,r.id) from public.receivables r where r.source_id=target and r.source_type=case p_domain when 'daily' then 'daily_booking' when 'lease' then 'lease_contract' else 'sale_contract' end),'[]'),
    'propertyFeeRules',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.property_fee_rules f where f.unit_id=v_unit_id and f.is_active),'[]'),
    'schedules',coalesce((select jsonb_agg(to_jsonb(s) order by s.installment_no) from public.sale_payment_schedule s where p_domain='sale' and s.sale_contract_id=target),'[]'));
end; $$;
create function public.query_operator_collection(p_domain text,p_target_id uuid default null,p_building_code text default null,p_unit_no text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.query_operator_collection($1,$2,$3,$4); $$;

create function private.create_operator_collection(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text,p_replaces_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.operator_collection_batches%rowtype; created private.operator_collection_batches%rowtype; actor uuid:=(select auth.uid());
begin
  if actor is null then raise exception 'collectionForbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended((p_request->>'requestId'),0));
  select * into existing from private.operator_collection_batches where request_id=(p_request->>'requestId')::uuid and status<>'superseded' for update;
  if found then
    if existing.actor_id<>actor then raise exception 'collectionRequestConflict'; end if;
    if existing.request_data=p_request and existing.deployment=p_deployment and (p_replaces_id is null or existing.replaces_id=p_replaces_id) then
      return jsonb_build_object('id',existing.id,'status',existing.status,'expiresAt',existing.expires_at); end if;
    if existing.status='completed' or p_replaces_id is distinct from existing.id then raise exception 'collectionRequestConflict'; end if;
  elsif p_replaces_id is not null then raise exception 'collectionRequestConflict'; end if;
  if exists(select 1 from public.payments where request_id=(p_request->>'requestId')::uuid) then raise exception 'collectionRequestConflict'; end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '10 minutes'
    or nullif(p_deployment,'') is null then raise exception 'collectionExpired'; end if;
  if private.operator_collection_snapshot(p_request) is distinct from p_snapshot then raise exception 'collectionSnapshotChanged'; end if;
  if existing.id is not null then update private.operator_collection_batches set status='superseded' where id=existing.id; end if;
  insert into private.operator_collection_batches(actor_id,request_id,request_data,expected_snapshot,expires_at,deployment,replaces_id)
  values(actor,(p_request->>'requestId')::uuid,p_request,p_snapshot,p_expires_at,p_deployment,p_replaces_id) returning * into created;
  return jsonb_build_object('id',created.id,'status',created.status,'expiresAt',created.expires_at);
end; $$;
create function public.create_operator_collection(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text,p_replaces_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.create_operator_collection($1,$2,$3,$4,$5); $$;

create function private.get_operator_collection(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.operator_collection_batches%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'collectionForbidden' using errcode='42501'; end if;
  select * into b from private.operator_collection_batches where id=p_id and actor_id=(select auth.uid());
  if not found then raise exception 'collectionNotFound'; end if;
  return to_jsonb(b);
end; $$;
create function public.get_operator_collection(p_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.get_operator_collection($1); $$;

create function private.verify_operator_collection(p_batch private.operator_collection_batches)
returns boolean language plpgsql security definer set search_path='' as $$
declare row_data jsonb; a jsonb; p public.payments%rowtype; child uuid; expected_type text; category text; r public.receivables%rowtype;
begin
  for row_data in select value from jsonb_array_elements(p_batch.request_data->'rows') loop
    for a in select value from jsonb_array_elements(row_data->'allocations') loop
      child:=private.operator_collection_child_request(p_batch.request_data,(a->>'receivableId')::uuid);
      select * into p from public.payments where request_id=child;
      select rr.* into r from public.receivables rr where rr.id=(a->>'receivableId')::uuid;
      category:=r.category;
      expected_type:=case row_data->>'domain' when 'daily' then 'daily_booking' when 'sale' then 'sale' else category end;
      if p.id is null or p.source_id is distinct from (row_data->>'targetId')::uuid or p.source_type is distinct from expected_type
        or p.amount is distinct from (a->>'amountXof')::numeric or p.payment_date is distinct from (row_data->>'paymentDate')::date
        or p.currency::text<>'XOF' or p.exchange_rate_to_xof<>1 or p.receipt_no is distinct from nullif(btrim(row_data->>'receiptNo'),'')
        or p.payment_method is distinct from row_data->>'paymentMethod'
        or p.unit_id is distinct from r.unit_id or p.customer_id is distinct from r.customer_id
        or p.request_kind is distinct from (case when row_data->>'domain'='daily' then 'daily_payment' else 'operator_collection' end)
        or exists(select 1 from public.payments where reversal_of_payment_id=p.id)
        or (select count(*) from public.ledger_entries l where l.payment_id=p.id)<>1
        or (select count(*) from public.ledger_entries l where l.payment_id=p.id and l.amount_xof=p.amount
          and l.unit_id=p.unit_id and l.building_id=r.building_id and l.entry_date=p.payment_date
          and l.category=case when row_data->>'domain'='sale' then 'sale' else r.category end
          and l.direction=case when r.category='lease_deposit' then 'liability_in' else 'income' end)<>1
        or (select count(*) from public.audit_logs l where l.action='operator_collection_item' and l.actor_id=p_batch.actor_id and l.metadata->>'payment_id'=p.id::text and l.metadata->>'request_id'=p_batch.request_id::text)<>1
      then return false; end if;
    end loop;
  end loop;
  return true;
end; $$;

create function private.confirm_operator_collection(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.operator_collection_batches%rowtype; row_data jsonb; a jsonb; r public.receivables%rowtype;
  child uuid; payment_id uuid; before_row jsonb; after_row jsonb; v_result jsonb:='[]'; source text; category text;
  actor uuid:=(select auth.uid()); next_paid numeric; action_name text;
begin
  if actor is null then raise exception 'collectionForbidden' using errcode='42501'; end if;
  select * into b from private.operator_collection_batches where id=p_id and actor_id=actor;
  if not found then raise exception 'collectionNotFound'; end if;
  perform pg_advisory_xact_lock(hashtextextended(b.request_id::text,0));
  select * into b from private.operator_collection_batches where id=p_id and actor_id=actor for update;
  if b.status='superseded' then raise exception 'collectionSuperseded'; end if;
  -- Recheck permissions even on an idempotent retry after the account loses a grant.
  for row_data in select value from jsonb_array_elements(b.request_data->'rows') loop
    for a in select value from jsonb_array_elements(row_data->'allocations') loop
      select * into r from public.receivables where id=(a->>'receivableId')::uuid;
      action_name:=case row_data->>'domain' when 'daily' then 'record_daily_payment' when 'sale' then 'record_sale_payment'
        else case r.category when 'lease_rent' then 'record_lease_rent' when 'property_fee' then 'record_property_fee' when 'lease_deposit' then 'record_lease_deposit' end end;
      if not coalesce(private.current_operator_action_allowed(action_name,'L2'),false) or not coalesce(public.can_access_unit(r.unit_id),false) then raise exception 'collectionForbidden' using errcode='42501'; end if;
    end loop;
    if row_data->>'domain'='lease' and jsonb_array_length(row_data->'allocations')>1 and not private.current_operator_action_allowed('record_combined_lease_payment','L3') then raise exception 'collectionForbidden' using errcode='42501'; end if;
  end loop;
  if b.status='completed' then
    if not private.verify_operator_collection(b) then raise exception 'collectionResultInvalid'; end if;
    return b.result;
  end if;
  if b.expires_at<=clock_timestamp() or b.created_at::date<>current_date then raise exception 'collectionExpired'; end if;
  -- Request locks first, then daily bookings, sale schedules before contracts
  -- (same order as existing sale RPC), lease contracts, then receivables.
  for child in select private.operator_collection_child_request(b.request_data,(x->>'receivableId')::uuid) from jsonb_array_elements(b.request_data->'rows') t cross join lateral jsonb_array_elements(t->'allocations') x order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(child::text,0));
    if exists(select 1 from public.payments where request_id=child) then raise exception 'collectionRequestConflict'; end if;
  end loop;
  perform 1 from public.daily_bookings d where d.id in (select (x->>'targetId')::uuid from jsonb_array_elements(b.request_data->'rows') x where x->>'domain'='daily') order by d.id for update;
  perform 1 from public.sale_payment_schedule s where s.sale_contract_id in (select (x->>'targetId')::uuid from jsonb_array_elements(b.request_data->'rows') x where x->>'domain'='sale') order by s.id for update;
  perform 1 from public.sale_contracts c where c.id in (select (x->>'targetId')::uuid from jsonb_array_elements(b.request_data->'rows') x where x->>'domain'='sale') order by c.id for update;
  perform 1 from public.lease_contracts c where c.id in (select (x->>'targetId')::uuid from jsonb_array_elements(b.request_data->'rows') x where x->>'domain'='lease') order by c.id for update;
  perform 1 from public.receivables rr where rr.id in (select (x->>'receivableId')::uuid from jsonb_array_elements(b.request_data->'rows') t cross join lateral jsonb_array_elements(t->'allocations') x) order by rr.id for update;
  if private.operator_collection_snapshot(b.request_data) is distinct from b.expected_snapshot then raise exception 'collectionSnapshotChanged'; end if;
  for row_data in select value from jsonb_array_elements(b.request_data->'rows') loop
    for a in select value from jsonb_array_elements(row_data->'allocations') loop
      select * into r from public.receivables where id=(a->>'receivableId')::uuid;
      before_row:=to_jsonb(r); child:=private.operator_collection_child_request(b.request_data,r.id);
      if row_data->>'domain'='daily' then
        perform private.operator_record_daily_payment((row_data->>'targetId')::uuid,(a->>'amountXof')::numeric,(row_data->>'paymentDate')::date,row_data->>'receiptNo',child,
          jsonb_build_object('channel','external_codex','input_source','structured_batch','original_instruction',b.request_data->>'originalInstruction','connector_version',b.request_data->>'connectorVersion','protocol_version','1.0'));
        select id into payment_id from public.payments where request_id=child;
        update public.payments set payment_method=row_data->>'paymentMethod' where id=payment_id;
      else
        source:=case when row_data->>'domain'='sale' then 'sale' else r.category end;
        category:=case when row_data->>'domain'='sale' then 'sale' else r.category end;
        insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,receipt_no,payment_method,request_id,request_kind,notes)
        values(r.customer_id,r.unit_id,source,r.source_id,(row_data->>'paymentDate')::date,(a->>'amountXof')::numeric,'XOF',1,nullif(btrim(row_data->>'receiptNo'),''),row_data->>'paymentMethod',child,'operator_collection',row_data->>'sourceText') returning id into payment_id;
        insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description)
        values(r.building_id,r.unit_id,payment_id,(row_data->>'paymentDate')::date,case when r.category='lease_deposit' then 'liability_in' else 'income' end,category,(a->>'amountXof')::numeric,'截图分账：'||r.title);
        next_paid:=r.paid_amount_xof+(a->>'amountXof')::numeric;
        update public.receivables set paid_amount_xof=next_paid,status=case when next_paid=amount_xof then 'paid' when due_date<current_date then 'overdue' else 'partial' end where id=r.id;
        if row_data->>'domain'='sale' then
          update public.sale_payment_schedule set status=case when next_paid=r.amount_xof then 'paid'::public.payment_status when due_date<current_date then 'overdue'::public.payment_status else 'pending'::public.payment_status end
          where sale_contract_id=r.source_id and due_date=r.due_date and amount_xof=r.amount_xof and status<>'cancelled';
        end if;
      end if;
      select to_jsonb(rr) into after_row from public.receivables rr where id=r.id;
      if (after_row->>'paid_amount_xof')::numeric is distinct from r.paid_amount_xof+(a->>'amountXof')::numeric then raise exception 'collectionResultInvalid'; end if;
      insert into public.audit_logs(actor_id,actor_email,actor_role,action,entity_type,entity_id,entity_label,before_data,after_data,metadata)
      values(actor,left(coalesce((select auth.jwt()->>'email'),''),320),public.current_user_role(),'operator_collection_item','receivable',r.id,r.title,before_row,after_row,
        jsonb_build_object('channel','external_codex','input_source','structured_batch','request_id',b.request_id,'child_request_id',child,'payment_id',payment_id,'confirmation_id',b.id,
          'amount',(a->>'amountXof')::numeric,'payment_date',row_data->>'paymentDate','receipt_no',row_data->>'receiptNo','line_id',row_data->>'lineId','original_instruction',b.request_data->>'originalInstruction',
          'source_text',row_data->>'sourceText','allocation_basis',before_row,'connector_version',b.request_data->>'connectorVersion','protocol_version','1.0'));
      v_result:=v_result||jsonb_build_array(jsonb_build_object('receivableId',r.id,'paymentId',payment_id,'amountXof',(a->>'amountXof')::numeric,'childRequestId',child));
    end loop;
    if row_data->>'domain'='lease' and row_data ? 'paidThroughDate' then
      update public.lease_contracts set paid_through_date=(row_data->>'paidThroughDate')::date where id=(row_data->>'targetId')::uuid;
    end if;
    if row_data->>'domain'='lease' and exists(select 1 from jsonb_array_elements(row_data->'allocations') x join public.receivables rr on rr.id=(x->>'receivableId')::uuid where rr.category='lease_deposit') then
      update public.lease_contracts c set deposit_received=c.deposit_amount_xof>0 and
        (select coalesce(sum(case when p.source_type='lease_deposit_refund' then -p.amount*p.exchange_rate_to_xof else p.amount*p.exchange_rate_to_xof end),0) from public.payments p where p.source_id=c.id and p.source_type in ('lease_deposit','lease_deposit_refund'))>=c.deposit_amount_xof
      where c.id=(row_data->>'targetId')::uuid;
    end if;
  end loop;
  if not private.verify_operator_collection(b) then raise exception 'collectionResultInvalid'; end if;
  v_result:=jsonb_build_object('status','completed','requestId',b.request_id,'totalXof',b.request_data->'totalXof','items',v_result,'verified',true);
  update private.operator_collection_batches set status='completed',confirmed_at=clock_timestamp(),result=v_result where id=b.id;
  return v_result;
end; $$;
create function public.confirm_operator_collection(p_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.confirm_operator_collection($1); $$;

revoke all on function private.verify_operator_collection(private.operator_collection_batches) from public,anon,authenticated,service_role;
revoke all on function private.operator_collection_snapshot(jsonb),public.preview_operator_collection(jsonb),
  private.query_operator_collection(text,uuid,text,text),public.query_operator_collection(text,uuid,text,text),
  private.create_operator_collection(jsonb,jsonb,timestamptz,text,uuid),public.create_operator_collection(jsonb,jsonb,timestamptz,text,uuid),
  private.get_operator_collection(uuid),public.get_operator_collection(uuid),private.confirm_operator_collection(uuid),public.confirm_operator_collection(uuid) from public,anon,authenticated,service_role;
grant execute on function private.operator_collection_snapshot(jsonb),public.preview_operator_collection(jsonb),
  private.query_operator_collection(text,uuid,text,text),public.query_operator_collection(text,uuid,text,text),
  private.create_operator_collection(jsonb,jsonb,timestamptz,text,uuid),public.create_operator_collection(jsonb,jsonb,timestamptz,text,uuid),
  private.get_operator_collection(uuid),public.get_operator_collection(uuid),private.confirm_operator_collection(uuid),public.confirm_operator_collection(uuid) to authenticated;
notify pgrst,'reload schema';
create function public.operator_collection_protocol_version() returns integer language sql immutable security invoker set search_path='' as $$ select 1; $$;
revoke all on function public.operator_collection_protocol_version() from public,anon,service_role;
grant execute on function public.operator_collection_protocol_version() to authenticated;
create function private.find_operator_collection(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b private.operator_collection_batches%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'collectionForbidden' using errcode='42501'; end if;
  select * into b from private.operator_collection_batches where request_id=p_request_id and actor_id=(select auth.uid()) and status<>'superseded';
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status',b.status,'id',b.id,'requestId',b.request_id,'expiresAt',b.expires_at,
    'verified',case when b.status='completed' then private.verify_operator_collection(b) else false end);
end; $$;
create function public.find_operator_collection(p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.find_operator_collection($1); $$;
revoke all on function private.find_operator_collection(uuid),public.find_operator_collection(uuid) from public,anon,service_role;
grant execute on function private.find_operator_collection(uuid),public.find_operator_collection(uuid) to authenticated;
commit;
