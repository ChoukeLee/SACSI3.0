begin;

-- New collections only. Existing contracts, receipts, periods and allocations
-- are never backfilled or reinterpreted by this migration.
create table private.lease_collection_requests (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  contract_id uuid not null references public.lease_contracts(id),
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.lease_collection_requests enable row level security;
revoke all on private.lease_collection_requests from public,anon,authenticated,service_role;
create index lease_collection_requests_contract on private.lease_collection_requests(contract_id);
create index lease_collection_requests_actor on private.lease_collection_requests(actor_id);

-- Native money must not be inserted into an amount_xof column. This relation
-- records exact new native allocations, separately from legacy unknown links.
create table public.lease_native_payment_allocations (
  payment_id uuid not null references public.payments(id),
  receivable_id uuid not null references public.receivables(id),
  currency public.currency_code not null check(currency in ('USD','CNY')),
  amount_native numeric(14,2) not null check(amount_native>0 and amount_native::text not in ('NaN','Infinity','-Infinity')),
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(payment_id,receivable_id)
);
create index lease_native_allocations_receivable on public.lease_native_payment_allocations(receivable_id);
create index lease_native_allocations_actor on public.lease_native_payment_allocations(actor_id);
create index lease_native_allocations_request on public.lease_native_payment_allocations(request_id);
alter table public.lease_native_payment_allocations enable row level security;
revoke all on public.lease_native_payment_allocations from public,anon,authenticated,service_role;
grant select on public.lease_native_payment_allocations to authenticated;
create policy "authorized native lease allocation reads"
on public.lease_native_payment_allocations for select to authenticated using (
  public.has_app_role('admin','finance','boss')
  and exists(select 1 from public.payments p join public.receivables r on r.id=receivable_id
    where p.id=payment_id and p.native_settlement and p.currency=lease_native_payment_allocations.currency
      and p.unit_id=r.unit_id and p.source_id=r.source_id and r.source_type='lease_contract'
      and r.category='lease_rent' and r.currency=lease_native_payment_allocations.currency
      and public.can_access_unit(r.unit_id))
);

-- The private definer is necessary only for protected request/allocation tables
-- and confirmed collector facts. The public RPC remains an invoker wrapper.
-- Every call, including replay, checks the real current identity and scope.
create function private.record_lease_collection(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  c public.lease_contracts%rowtype;
  u public.units%rowtype;
  r public.receivables%rowtype;
  prior private.lease_collection_requests%rowtype;
  item jsonb; items jsonb;
  payment_day date; money_currency public.currency_code;
  total numeric; allocated numeric:=0; piece numeric; expected numeric; outstanding numeric;
  group_kind text; group_amount numeric; native_money boolean;
  payment_id uuid; child_request uuid; reference_no text;
  payment_ids jsonb:='[]'::jsonb; references_list jsonb:='[]'::jsonb;
  result_allocations jsonb:='[]'::jsonb; before_rows jsonb;
  collector text; basis text; external_no text; memo text; result jsonb;
  coverage jsonb; proof_ids uuid[]; cursor_day date; through_day date;
  paid_through_after date;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance'),false) then
    raise exception 'leaseCollectionPermissionDenied' using errcode='42501';
  end if;
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object'
    or octet_length(p_input::text)>65536
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in (
      'contractId','paymentDate','currency','amount','paymentMethod','externalReceiptNo',
      'actualCollector','collectorBasis','notes','allocations','coverage'))
    or jsonb_typeof(p_input->'contractId') is distinct from 'string'
    or coalesce(p_input->>'contractId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'paymentDate') is distinct from 'string'
    or coalesce(p_input->>'paymentDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_input->'currency') is distinct from 'string'
    or coalesce(p_input->>'currency','') not in ('XOF','USD','CNY')
    or jsonb_typeof(p_input->'amount') is distinct from 'number'
    or jsonb_typeof(p_input->'paymentMethod') is distinct from 'string'
    or coalesce(p_input->>'paymentMethod','') not in ('cash','check','bank_transfer','other')
    or jsonb_typeof(p_input->'allocations') is distinct from 'array' then
    raise exception 'invalidLeaseCollection';
  end if;
  payment_day:=(p_input->>'paymentDate')::date;
  money_currency:=(p_input->>'currency')::public.currency_code;
  total:=(p_input->>'amount')::numeric;
  if not isfinite(payment_day) or to_char(payment_day,'YYYY-MM-DD')<>p_input->>'paymentDate'
    or payment_day>current_date or total<=0 or total>999999999999.99 or round(total,2)<>total then
    raise exception 'invalidLeaseCollection';
  end if;
  if p_input ? 'externalReceiptNo' then
    if jsonb_typeof(p_input->'externalReceiptNo') is distinct from 'string' or length(p_input->>'externalReceiptNo')>200 then raise exception 'invalidLeaseCollection'; end if;
    external_no:=nullif(btrim(p_input->>'externalReceiptNo'),'');
  end if;
  if p_input ? 'notes' then
    if jsonb_typeof(p_input->'notes') is distinct from 'string' or length(p_input->>'notes')>2000 then raise exception 'invalidLeaseCollection'; end if;
    memo:=nullif(btrim(p_input->>'notes'),'');
  end if;
  if p_input ? 'actualCollector' or p_input ? 'collectorBasis' then
    if jsonb_typeof(p_input->'actualCollector') is distinct from 'string'
      or jsonb_typeof(p_input->'collectorBasis') is distinct from 'string'
      or length(btrim(p_input->>'actualCollector')) not between 1 and 100
      or length(btrim(p_input->>'collectorBasis')) not between 1 and 1000 then raise exception 'invalidLeaseCollection'; end if;
    collector:=btrim(p_input->>'actualCollector'); basis:=btrim(p_input->>'collectorBasis');
  end if;
  items:=p_input->'allocations';
  if jsonb_array_length(items) not between 1 and 100 then raise exception 'invalidLeaseCollection'; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in (
      'receivableId','amount','expectedOutstanding','expectedUpdatedAt'))
      or jsonb_typeof(item->'receivableId') is distinct from 'string'
      or coalesce(item->>'receivableId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'amount') is distinct from 'number'
      or jsonb_typeof(item->'expectedOutstanding') is distinct from 'number' then
      raise exception 'invalidLeaseCollection';
    end if;
    piece:=(item->>'amount')::numeric; expected:=(item->>'expectedOutstanding')::numeric;
    if piece<=0 or piece>999999999999.99 or round(piece,2)<>piece
      or expected<=0 or expected>999999999999.99 or round(expected,2)<>expected or piece>expected then
      raise exception 'invalidLeaseCollection'; end if;
    if item ? 'expectedUpdatedAt' and (jsonb_typeof(item->'expectedUpdatedAt') is distinct from 'string'
      or coalesce(item->>'expectedUpdatedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T') then
      raise exception 'invalidLeaseCollection'; end if;
    allocated:=allocated+piece;
  end loop;
  if allocated<>total or jsonb_array_length(items)<>
    (select count(distinct (x->>'receivableId')::uuid) from jsonb_array_elements(items) x) then
    raise exception 'invalidLeaseCollection'; end if;
  if p_input ? 'coverage' then
    coverage:=p_input->'coverage';
    if jsonb_typeof(coverage) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(coverage) k where k not in (
        'expectedPaidThroughDate','expectedContractUpdatedAt','throughDate','receivableIds'))
      or jsonb_typeof(coverage->'expectedPaidThroughDate') is distinct from 'string'
      or coalesce(coverage->>'expectedPaidThroughDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(coverage->'expectedContractUpdatedAt') is distinct from 'string'
      or coalesce(coverage->>'expectedContractUpdatedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      or length(coverage->>'expectedContractUpdatedAt')>100
      or jsonb_typeof(coverage->'throughDate') is distinct from 'string'
      or coalesce(coverage->>'throughDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(coverage->'receivableIds') is distinct from 'array' then raise exception 'invalidLeaseCollection'; end if;
    if jsonb_array_length(coverage->'receivableIds') not between 1 and 100
      or exists(select 1 from jsonb_array_elements(coverage->'receivableIds') x where jsonb_typeof(x)<>'string'
        or (x#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
      raise exception 'invalidLeaseCollection'; end if;
    select array_agg((x#>>'{}')::uuid) into proof_ids from jsonb_array_elements(coverage->'receivableIds') x;
    if cardinality(proof_ids)<>(select count(distinct id) from unnest(proof_ids) id) then raise exception 'invalidLeaseCollection'; end if;
    through_day:=(coverage->>'throughDate')::date;
    if not isfinite(through_day) or to_char(through_day,'YYYY-MM-DD')<>coverage->>'throughDate'
      or not isfinite((coverage->>'expectedPaidThroughDate')::date)
      or to_char((coverage->>'expectedPaidThroughDate')::date,'YYYY-MM-DD')<>coverage->>'expectedPaidThroughDate'
      or through_day<=(coverage->>'expectedPaidThroughDate')::date then raise exception 'invalidLeaseCollection'; end if;
  end if;

  -- Match existing lease cash writers: request -> contract -> due_date,id rows.
  -- Do not add an opposite unit lock or take receivable locks in client order.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into c from public.lease_contracts where id=(p_input->>'contractId')::uuid for update;
  if not found then raise exception 'leaseCollectionNotFound'; end if;
  if not coalesce(public.can_access_unit(c.unit_id),false) then raise exception 'leaseCollectionAccessDenied' using errcode='42501'; end if;
  select * into prior from private.lease_collection_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>actor or prior.contract_id<>c.id or prior.input is distinct from p_input then raise exception 'requestIdConflict'; end if;
    return prior.result||jsonb_build_object('idempotent',true);
  end if;
  if exists(select 1 from public.payments where request_id=p_request_id) then raise exception 'requestIdConflict'; end if;
  if c.status<>'active' then raise exception 'leaseCollectionContractChanged'; end if;
  paid_through_after:=c.paid_through_date;
  if coverage is not null and (
    c.paid_through_date is null or c.paid_through_date is distinct from (coverage->>'expectedPaidThroughDate')::date
    or c.updated_at is distinct from (coverage->>'expectedContractUpdatedAt')::timestamptz
    or c.commencement_state is distinct from 'started' or c.start_date is null or not isfinite(c.start_date)
    or c.start_date>current_date
    or c.paid_through_date<c.start_date-1 or money_currency is distinct from c.rent_currency
    or c.actual_end_date is not null
    or (c.expected_end_confirmed and (c.expected_end_date is null or not isfinite(c.expected_end_date) or through_day>c.expected_end_date))
  ) then raise exception 'leaseCollectionCoverageChanged'; end if;
  select * into strict u from public.units where id=c.unit_id;
  -- Coverage additionally checks every existing rent obligation under the same
  -- parent lock. A concurrent receipt or period correction cannot change its
  -- proof after this selection. Never lock proof IDs in client array order.
  perform 1 from public.receivables where id in (select (x->>'receivableId')::uuid from jsonb_array_elements(items) x)
    or (coverage is not null and (id=any(proof_ids) or
      (source_type='lease_contract' and source_id=c.id and category='lease_rent' and status<>'cancelled')))
    order by due_date,id for update;
  for item in select value from jsonb_array_elements(items) loop
    select * into r from public.receivables where id=(item->>'receivableId')::uuid;
    if not found or r.source_type<>'lease_contract' or r.source_id is distinct from c.id
      or r.unit_id is distinct from c.unit_id or r.customer_id is distinct from c.customer_id
      or r.building_id is distinct from u.building_id or r.category not in ('lease_rent','property_fee')
      or r.currency is distinct from money_currency then raise exception 'leaseCollectionTargetMismatch'; end if;
    if r.management_status is distinct from 'managed' or r.status not in ('pending','partial','overdue') then
      raise exception 'leaseCollectionBalanceChanged'; end if;
    if r.category='property_fee' and money_currency<>'XOF'
      or r.category='lease_rent' and c.rent_currency is distinct from money_currency then
      raise exception 'leaseCollectionTargetMismatch'; end if;
    if money_currency='XOF' then
      if r.amount_native is not null or r.paid_amount_native is not null then raise exception 'leaseCollectionTargetMismatch'; end if;
      outstanding:=r.amount_xof-r.paid_amount_xof;
    else
      if r.category<>'lease_rent' or r.amount_native is null or r.paid_amount_native is null
        or r.amount_xof<>0 or r.paid_amount_xof<>0 then raise exception 'leaseCollectionTargetMismatch'; end if;
      outstanding:=r.amount_native-r.paid_amount_native;
    end if;
    if outstanding<=0 or outstanding is distinct from (item->>'expectedOutstanding')::numeric
      or (item->>'amount')::numeric>outstanding
      or (item ? 'expectedUpdatedAt' and r.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz) then
      raise exception 'leaseCollectionBalanceChanged'; end if;
  end loop;
  select jsonb_agg(to_jsonb(rr) order by rr.due_date,rr.id) into before_rows
    from public.receivables rr where rr.id in(select (x->>'receivableId')::uuid from jsonb_array_elements(items) x)
      or (coverage is not null and rr.id=any(proof_ids));

  for group_kind,group_amount in
    select rr.category,sum((x->>'amount')::numeric) from jsonb_array_elements(items) x
      join public.receivables rr on rr.id=(x->>'receivableId')::uuid
      group by rr.category order by rr.category
  loop
    native_money:=money_currency<>'XOF'; child_request:=gen_random_uuid();
    insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,
      exchange_rate_to_xof,native_settlement,payment_method,external_receipt_no,notes,request_id,request_kind,
      actual_collector,collector_basis,context_version,context_confirmed_by,context_confirmed_at)
    values(c.customer_id,c.unit_id,group_kind,c.id,payment_day,group_amount,money_currency,
      case when native_money then null else 1 end,native_money,p_input->>'paymentMethod',external_no,
      concat_ws('；','实收按所选账单明确核销',case when coverage is null then '不改变合同已缴至日期'
        else '明确核实连续全额覆盖至 '||through_day end,memo),child_request,'lease_collection',
      collector,basis,case when collector is null then 0 else 1 end,
      case when collector is null then null else actor end,case when collector is null then null else clock_timestamp() end)
    returning id,receipt_no into payment_id,reference_no;
    insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,
      amount_xof,currency,amount_native,description)
    values(u.building_id,c.unit_id,payment_id,payment_day,'income',group_kind,
      case when native_money then 0 else group_amount end,money_currency,
      case when native_money then group_amount else null end,
      '明确账单收款 '||c.contract_no||' · '||case when group_kind='lease_rent' then '租金' else '物业费' end);
    payment_ids:=payment_ids||jsonb_build_array(payment_id);
    references_list:=references_list||jsonb_build_array(reference_no);
    for item in select x from jsonb_array_elements(items) x join public.receivables rr on rr.id=(x->>'receivableId')::uuid
      where rr.category=group_kind order by rr.due_date,rr.id
    loop
      select * into strict r from public.receivables where id=(item->>'receivableId')::uuid;
      piece:=(item->>'amount')::numeric;
      if native_money then
        update public.receivables set paid_amount_native=paid_amount_native+piece,
          status=case when paid_amount_native+piece>=amount_native then 'paid' else 'partial' end,updated_at=now() where id=r.id;
        insert into public.lease_native_payment_allocations(payment_id,receivable_id,currency,amount_native,actor_id,request_id)
          values(payment_id,r.id,money_currency,piece,actor,p_request_id);
      else
        update public.receivables set paid_amount_xof=paid_amount_xof+piece,
          status=case when paid_amount_xof+piece>=amount_xof then 'paid' else 'partial' end,updated_at=now() where id=r.id;
        perform private.record_verified_payment_allocation(payment_id,r.id,piece,p_request_id);
      end if;
      result_allocations:=result_allocations||jsonb_build_array(jsonb_build_object(
        'receivableId',r.id,'amount',piece,'paymentId',payment_id,'currency',money_currency));
    end loop;
  end loop;
  if coverage is not null then
    if (select count(*) from public.receivables where id=any(proof_ids))<>cardinality(proof_ids)
      or not exists(select 1 from jsonb_array_elements(items) x join public.receivables rr on rr.id=(x->>'receivableId')::uuid
        where rr.id=any(proof_ids) and rr.category='lease_rent') then raise exception 'leaseCollectionCoverageChanged'; end if;
    cursor_day:=c.paid_through_date+1;
    for r in select * from public.receivables where id=any(proof_ids) order by service_period_start,id loop
      if r.source_type<>'lease_contract' or r.source_id is distinct from c.id or r.unit_id is distinct from c.unit_id
        or r.customer_id is distinct from c.customer_id or r.building_id is distinct from u.building_id
        or r.category<>'lease_rent' or r.currency is distinct from c.rent_currency
        or r.management_status is distinct from 'managed' or r.status<>'paid'
        or r.service_period_start is null or r.service_period_end is null
        or not isfinite(r.service_period_start) or not isfinite(r.service_period_end)
        or r.amount_xof::text in ('NaN','Infinity','-Infinity') or r.paid_amount_xof::text in ('NaN','Infinity','-Infinity')
        or nullif(btrim(r.service_period_source),'') is null
        or r.service_period_start<>cursor_day or r.service_period_end<r.service_period_start or r.service_period_end>through_day
        or (money_currency='XOF' and (r.amount_xof<=0 or r.paid_amount_xof<>r.amount_xof or r.amount_native is not null or r.paid_amount_native is not null))
        or (money_currency<>'XOF' and (r.amount_native is null or r.amount_native<=0 or r.paid_amount_native is distinct from r.amount_native
          or r.amount_xof<>0 or r.paid_amount_xof<>0)) then raise exception 'leaseCollectionCoverageChanged'; end if;
      cursor_day:=r.service_period_end+1;
    end loop;
    if cursor_day<>through_day+1 then raise exception 'leaseCollectionCoverageChanged'; end if;
    -- Do not prove coverage by selecting one convenient copy of an overlapping
    -- bill. Unknown outstanding rent cannot be dated by its due_date either.
    if exists(select 1 from public.receivables rr where rr.source_type='lease_contract' and rr.source_id=c.id
      and rr.category='lease_rent' and rr.status<>'cancelled' and not(rr.id=any(proof_ids)) and (
        (rr.service_period_start is not null and rr.service_period_end is not null
          and rr.service_period_start<=through_day and rr.service_period_end>c.paid_through_date)
        or (rr.management_status='managed' and
          case when rr.currency='XOF' then rr.amount_xof>rr.paid_amount_xof else rr.amount_native>rr.paid_amount_native end
          and (rr.service_period_start is null or rr.service_period_end is null or rr.service_period_start<=through_day))
      )) then raise exception 'leaseCollectionCoverageChanged'; end if;
    update public.lease_contracts set paid_through_date=through_day,updated_at=now() where id=c.id;
    paid_through_after:=through_day;
  end if;
  result:=jsonb_build_object('success',true,'requestId',p_request_id,'referenceNos',references_list,
    'paymentIds',payment_ids,'allocations',result_allocations,'currency',money_currency,'totalAmount',total,'idempotent',false,
    'paidThroughBefore',c.paid_through_date,'paidThroughAfter',paid_through_after);
  if coverage is not null then result:=result||jsonb_build_object('coverage',jsonb_build_object(
    'throughDate',through_day,'receivableIds',to_jsonb(proof_ids))); end if;
  insert into public.audit_logs(actor_id,actor_email,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
  values(actor,auth.jwt()->>'email',public.current_user_role(),'record_lease_collection','lease_collection',c.id,
    jsonb_build_object('receivables',before_rows,'paidThroughDate',c.paid_through_date,'contract',to_jsonb(c)),result,
    jsonb_build_object('request_id',p_request_id,'channel','sacsi_web','input',p_input,
      'paid_through_unchanged',c.paid_through_date is not distinct from paid_through_after,
      'coverage_explicitly_confirmed',coverage is not null,'no_receivables_created',true));
  insert into private.lease_collection_requests(request_id,actor_id,contract_id,input,result)
    values(p_request_id,actor,c.id,p_input,result);
  return result;
end; $$;

create function public.lease_collection_rpc(p_input jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.record_lease_collection($1,$2);
$$;
revoke all on function private.record_lease_collection(jsonb,uuid),public.lease_collection_rpc(jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.record_lease_collection(jsonb,uuid),public.lease_collection_rpc(jsonb,uuid) to authenticated;
comment on function public.lease_collection_rpc(jsonb,uuid) is
  'Actual lease rent/property collections against explicit managed receivables; optional proven contiguous fully paid coverage only; no implied periods or future bills.';

-- Fully collected contracts are not upcoming debt. Keep this a scope-level SQL
-- count, not a recomputation from the currently visible 25-row page.
do $migration$
declare definition text; marker text:='status=''active'' and accrual is null and attention_due<=current_date+15';
begin
  definition:=pg_get_functiondef('public.contract_workspace_read_rpc(text,jsonb,text,uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
    raise exception 'leaseCollectionDueSoonMigrationDrift'; end if;
  execute replace(definition,marker,'status=''active'' and outstanding>0 and overdue=0 and attention_due between current_date and current_date+15');
end; $migration$;

-- A persisted receipt can be retrieved after reload/transport loss without
-- resubmitting money. Current role and project access are checked on every read.
create function private.read_lease_collection_receipt(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare saved private.lease_collection_requests%rowtype; target_unit uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance','boss'),false) then
    raise exception 'leaseCollectionPermissionDenied' using errcode='42501'; end if;
  select * into saved from private.lease_collection_requests where request_id=p_request_id;
  if not found then raise exception 'leaseCollectionNotFound'; end if;
  select unit_id into target_unit from public.lease_contracts where id=saved.contract_id;
  if target_unit is null or not coalesce(public.can_access_unit(target_unit),false) then
    raise exception 'leaseCollectionAccessDenied' using errcode='42501'; end if;
  return saved.result||jsonb_build_object('contractId',saved.contract_id);
end; $$;
create function public.lease_collection_receipt_read_rpc(p_request_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.read_lease_collection_receipt($1);
$$;
revoke all on function private.read_lease_collection_receipt(uuid),public.lease_collection_receipt_read_rpc(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.read_lease_collection_receipt(uuid),public.lease_collection_receipt_read_rpc(uuid) to authenticated;

-- The old context contract is XOF-only. Fail explicitly for a new native link,
-- never falsely present its empty XOF array as "no allocation" or editable debt.
do $migration$
declare definition text; marker text:='if not found then raise exception ''paymentContextNotFound''; end if;';
begin
  definition:=pg_get_functiondef('public.payment_context_read_rpc(uuid)'::regprocedure);
  if strpos(definition,marker)=0 then raise exception 'leaseCollectionContextMigrationDrift'; end if;
  execute replace(definition,marker,marker||E'\n  if p.native_settlement and exists(select 1 from public.lease_native_payment_allocations a where a.payment_id=p.id) then raise exception ''nativeLeaseAllocationContextRequired''; end if;');
end; $migration$;
notify pgrst,'reload schema';
commit;
