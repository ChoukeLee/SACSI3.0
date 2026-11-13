begin;

-- A narrow owner-distribution workflow. It records only cash actually received
-- by the named owner; the whole-asset equivalent and opening credit are
-- documentary settlement arithmetic, never new tenant receipts or automatic
-- period-income recognition.
-- No production IDs, source notes or business data are embedded in this DDL.
create index asset_owner_settlement_receipt_link
  on private.asset_operation_requests((result->'data'->>'entryId')) where operation='owner_settlement';
create function private.guard_asset_owner_settlement_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Protect every historical link, not just the latest evidence JSON. A later
  -- settlement may already have consumed the credit created by this receipt.
  if exists(select 1 from private.asset_operation_requests r where r.operation='owner_settlement'
    and r.result->'data'->>'entryId'=old.id::text) then
    raise exception 'ownerSettlementReceiptLinked' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger asset_owner_settlement_receipt_guard before update or delete on public.asset_operation_entries
  for each row execute function private.guard_asset_owner_settlement_receipt();

create function private.asset_owner_settlement_scope(p_asset_id uuid)
returns public.asset_operation_assets language plpgsql stable security definer set search_path='' as $$
declare a public.asset_operation_assets%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance'),false) then
    raise exception 'assetOperationPermissionDenied' using errcode='42501'; end if;
  select * into a from public.asset_operation_assets where id=p_asset_id;
  if a.id is null then raise exception 'assetOperationNotFound'; end if;
  if not coalesce(public.can_access_project(a.project_id),false) then
    raise exception 'assetOperationAccessDenied' using errcode='42501'; end if;
  return a;
end; $$;

create function private.asset_owner_settlement_text(p jsonb,k text,cap integer) returns text
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p->k) is distinct from 'string' or p->>k<>btrim(p->>k)
    or length(p->>k) not between 1 and cap then raise exception 'invalidOwnerSettlement'; end if;
  return p->>k;
end; $$;
create function private.asset_owner_settlement_money(p jsonb,k text,allow_zero boolean default false) returns numeric
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
  if jsonb_typeof(p->k) is distinct from 'number' then raise exception 'invalidOwnerSettlement'; end if;
  n:=(p->>k)::numeric;
  if n<>trunc(n) or n>999999999999 or n<0 or (not allow_zero and n=0) then raise exception 'invalidOwnerSettlement'; end if;
  return n;
end; $$;
create function private.asset_owner_settlement_date(p jsonb,k text) returns date
language plpgsql immutable set search_path='' as $$
declare s text:=private.asset_owner_settlement_text(p,k,10); d date;
begin
  if s !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalidOwnerSettlement'; end if;
  begin d:=s::date; exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalidOwnerSettlement'; end;
  if not isfinite(d) or to_char(d,'YYYY-MM-DD')<>s then raise exception 'invalidOwnerSettlement'; end if;
  return d;
end; $$;

create function private.asset_owner_settlement_previous(p_evidence jsonb,p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare previous jsonb:=p_evidence->'ownerSettlement'; entry public.asset_operation_entries%rowtype;
begin
  if previous is null or previous='null'::jsonb then return null; end if;
  if jsonb_typeof(previous)<>'object' or jsonb_typeof(previous->'entryId') is distinct from 'string'
    or previous->>'entryId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(previous->'ownerName') is distinct from 'string'
    or nullif(btrim(previous->>'ownerName'),'') is null
    or jsonb_typeof(previous->'shareBps') is distinct from 'number'
    or jsonb_typeof(previous->'wholeClosingCredit') is distinct from 'number'
    or previous->>'currency' is distinct from 'XOF'
    or jsonb_typeof(previous->'receiptAmountNative') is distinct from 'number'
    or coalesce(previous->>'cashDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    or coalesce(previous->>'periodEnd','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'ownerSettlementHistoryConflict'; end if;
  if (previous->>'shareBps')::numeric not between 1 and 10000
    or (previous->>'shareBps')::numeric<>trunc((previous->>'shareBps')::numeric)
    or (previous->>'wholeClosingCredit')::numeric<0
    or (previous->>'wholeClosingCredit')::numeric>999999999999
    or (previous->>'wholeClosingCredit')::numeric<>trunc((previous->>'wholeClosingCredit')::numeric) then
    raise exception 'ownerSettlementHistoryConflict'; end if;
  select * into entry from public.asset_operation_entries where id=(previous->>'entryId')::uuid;
  if entry.id is null or entry.asset_id<>p_asset or entry.kind<>'income' or entry.category<>'rent'
    or entry.currency<>'XOF' or entry.voided_at is not null or entry.verification<>'verified'
    or entry.period_start is not null or entry.period_end is not null or entry.recognition_method<>'unallocated'
    or entry.amount_native is distinct from (previous->>'receiptAmountNative')::numeric
    or entry.cash_date is distinct from (previous->>'cashDate')::date
    or entry.source_ref is distinct from previous->>'sourceRef' then raise exception 'ownerSettlementHistoryConflict'; end if;
  return previous;
end; $$;

create function private.asset_operations_owner_settlement_context(p_asset_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.asset_operation_assets%rowtype; e public.asset_operation_lease_evidence%rowtype; previous jsonb;
begin
  a:=private.asset_owner_settlement_scope(p_asset_id);
  select * into e from public.asset_operation_lease_evidence where asset_id=a.id;
  if not found then raise exception 'ownerSettlementEvidenceRequired'; end if;
  previous:=private.asset_owner_settlement_previous(e.evidence,a.id);
  return jsonb_build_object('assetId',a.id,'assetName',a.name,'expectedUpdatedAt',a.updated_at,
    'expectedEvidenceHash',md5(to_jsonb(e)::text),'monthlyRentNative',a.monthly_rent_native,
    'currency',a.rent_currency,'previousSettlement',previous);
end; $$;

create function private.asset_operations_record_owner_settlement(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
  a public.asset_operation_assets%rowtype; e public.asset_operation_lease_evidence%rowtype;
  original_asset jsonb; original_evidence jsonb; old_entries jsonb; previous jsonb; settlement jsonb; result_doc jsonb;
  prior private.asset_operation_requests%rowtype; entry public.asset_operation_entries%rowtype;
  asset_id uuid; receipt_request uuid; confirmation_request uuid; actor uuid:=auth.uid(); entry_id uuid;
  expected timestamptz; received numeric; opening numeric; closing numeric; share numeric;
  whole_equivalent numeric; monthly numeric; whole_rent numeric; month_count integer;
  cash_day date; starts date; ends date; owner_name text; source_ref_value text; reason text; method text; summary text;
  child_result jsonb; payload jsonb; new_evidence jsonb; old_row jsonb;
  fields text[]:=array['assetId','expectedUpdatedAt','expectedEvidenceHash','ownerName','shareBps','amountNative','currency','cashDate','paymentMethod','periodStart','periodEnd','openingWholeCredit','closingWholeCredit','sourceRef','reason'];
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance'),false) then raise exception 'assetOperationPermissionDenied' using errcode='42501'; end if;
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>16384
    or exists(select 1 from jsonb_object_keys(p_input) k where not(k=any(fields)))
    or exists(select 1 from unnest(fields) k where not(p_input?k) or p_input->k='null'::jsonb) then raise exception 'invalidOwnerSettlement'; end if;
  if private.asset_owner_settlement_text(p_input,'assetId',36) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or private.asset_owner_settlement_text(p_input,'expectedEvidenceHash',32) !~ '^[0-9a-f]{32}$' then raise exception 'invalidOwnerSettlement'; end if;
  asset_id:=(p_input->>'assetId')::uuid; a:=private.asset_owner_settlement_scope(asset_id);
  -- Same namespace and lock order as the established asset writer. Replay is
  -- actor/payload-bound and precedes stale snapshot checks after reauthorization.
  perform pg_advisory_xact_lock(hashtextextended('asset-operation-request:'||p_request_id,0));
  select * into prior from private.asset_operation_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>actor or prior.operation<>'owner_settlement' or prior.payload<>p_input then raise exception 'requestIdConflict'; end if;
    return prior.result||jsonb_build_object('idempotent',true);
  end if;
  receipt_request:=md5(p_request_id::text||':owner-receipt')::uuid;
  confirmation_request:=md5(p_request_id::text||':confirm-asset')::uuid;
  -- A single ordering protects deterministic child IDs before any asset lock.
  perform pg_advisory_xact_lock(hashtextextended('asset-operation-request:'||id,0))
    from unnest(array[receipt_request,confirmation_request]) id order by id;
  if exists(select 1 from private.asset_operation_requests where request_id in(receipt_request,confirmation_request)) then raise exception 'requestIdConflict'; end if;
  select * into strict a from public.asset_operation_assets where id=asset_id for update;
  perform private.asset_owner_settlement_scope(asset_id);
  select * into e from public.asset_operation_lease_evidence where asset_id=a.id for update;
  if not found then raise exception 'ownerSettlementEvidenceRequired'; end if;
  perform 1 from public.asset_operation_entries where asset_id=a.id order by id for update;
  begin expected:=private.asset_owner_settlement_text(p_input,'expectedUpdatedAt',64)::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalidOwnerSettlement'; end;
  if not isfinite(expected) or expected is distinct from a.updated_at or p_input->>'expectedEvidenceHash'<>md5(to_jsonb(e)::text) then
    raise exception 'assetOperationRecordChanged'; end if;
  owner_name:=private.asset_owner_settlement_text(p_input,'ownerName',200);
  source_ref_value:=private.asset_owner_settlement_text(p_input,'sourceRef',500);
  reason:=private.asset_owner_settlement_text(p_input,'reason',2000);
  method:=private.asset_owner_settlement_text(p_input,'paymentMethod',20);
  if p_input->>'currency' is distinct from 'XOF' or method not in ('cash','bank_transfer','check','other') then raise exception 'invalidOwnerSettlement'; end if;
  received:=private.asset_owner_settlement_money(p_input,'amountNative');
  opening:=private.asset_owner_settlement_money(p_input,'openingWholeCredit',true);
  closing:=private.asset_owner_settlement_money(p_input,'closingWholeCredit',true);
  share:=private.asset_owner_settlement_money(p_input,'shareBps');
  if share>10000 then raise exception 'invalidOwnerSettlement'; end if;
  cash_day:=private.asset_owner_settlement_date(p_input,'cashDate');
  starts:=private.asset_owner_settlement_date(p_input,'periodStart');
  ends:=private.asset_owner_settlement_date(p_input,'periodEnd');
  if cash_day>current_date then raise exception 'invalidOwnerSettlement'; end if;
  if starts>ends or extract(day from starts)<>1
    or ends<>(date_trunc('month',ends)+interval '1 month'-interval '1 day')::date then raise exception 'invalidOwnerSettlementPeriod'; end if;
  month_count:=12*(extract(year from ends)::integer-extract(year from starts)::integer)+extract(month from ends)::integer-extract(month from starts)::integer+1;
  if month_count not between 1 and 120 then raise exception 'invalidOwnerSettlementPeriod'; end if;
  monthly:=a.monthly_rent_native;
  if a.rent_currency is distinct from 'XOF' or monthly is null or monthly<=0 or monthly<>trunc(monthly) or monthly>999999999999 then raise exception 'ownerSettlementRentRequired'; end if;
  whole_equivalent:=received*10000/share; whole_rent:=monthly*month_count;
  if mod(received*10000,share)<>0 or whole_equivalent>999999999999 or whole_rent>999999999999
    or opening+whole_equivalent<>whole_rent+closing then raise exception 'ownerSettlementEquationMismatch'; end if;
  previous:=private.asset_owner_settlement_previous(e.evidence,a.id);
  if previous is not null then
    if previous->>'ownerName'<>owner_name or (previous->>'shareBps')::numeric<>share then raise exception 'ownerSettlementHistoryConflict'; end if;
    if opening<>(previous->>'wholeClosingCredit')::numeric then raise exception 'ownerSettlementCreditConflict'; end if;
    if starts<=(previous->>'periodEnd')::date then raise exception 'ownerSettlementPeriodConflict'; end if;
  end if;
  if e.evidence?'notes' and jsonb_typeof(e.evidence->'notes')<>'array' then raise exception 'ownerSettlementHistoryConflict'; end if;
  if exists(select 1 from public.asset_operation_entries where asset_id=a.id and kind='income' and source_ref=source_ref_value and voided_at is null) then raise exception 'assetSourceAlreadyRecorded'; end if;
  original_asset:=to_jsonb(a); original_evidence:=to_jsonb(e);
  select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into old_entries from public.asset_operation_entries x where asset_id=a.id;
  if a.verification='pending' then
    child_result:=private.asset_operations_write('confirm_asset',jsonb_build_object('assetId',a.id,'expectedUpdatedAt',a.updated_at,'reason',reason),confirmation_request);
    if child_result->>'success' is distinct from 'true' then raise exception 'ownerSettlementVerificationFailed'; end if;
    select * into strict a from public.asset_operation_assets where id=asset_id;
  end if;
  summary:=owner_name||'业主分账实收'||received||'XOF；'||cash_day||'；方式'||
    case method when 'cash' then '现金' when 'bank_transfer' then '银行转账' when 'check' then '支票' else '其他' end||'('||method||')；份额'||share||'/10000；全厂结算等值'||whole_equivalent||
    'XOF仅作结算算式；期初整厂租金信用'||opening||'XOF（不是欠业主款）；'||monthly||'XOF/月×'||month_count||'月='||whole_rent||
    'XOF；结算期间'||starts||'至'||ends||'；期末整厂信用'||closing||'XOF，本期未结0XOF；不代表租客实付流水';
  payload:=jsonb_build_object('assetId',a.id,'expectedUpdatedAt',a.updated_at,'kind','income','category','rent','amountNative',received,'currency','XOF',
    'cashDate',cash_day,'periodStart',null,'periodEnd',null,'verification','verified','recognitionMethod','unallocated','sourceRef',source_ref_value,'description',summary);
  child_result:=private.asset_operations_write('create_entry',payload,receipt_request);
  if child_result->>'success' is distinct from 'true' then raise exception 'ownerSettlementVerificationFailed'; end if;
  entry_id:=(child_result->'data'->>'entryId')::uuid;
  select * into strict entry from public.asset_operation_entries where id=entry_id;
  settlement:=jsonb_build_object('requestId',p_request_id,'entryId',entry.id,'ownerName',owner_name,'shareBps',share,'receiptAmountNative',received,'currency','XOF',
    'cashDate',cash_day,'paymentMethod',method,'periodStart',starts,'periodEnd',ends,'throughDate',ends,'monthlyRentNative',monthly,'monthCount',month_count,
    'wholeEquivalent',whole_equivalent,'wholeOpeningCredit',opening,'wholeRent',whole_rent,'wholeClosingCredit',closing,
    'sourceRef',source_ref_value,'reason',reason,'recordedBy',actor,'recordedAt',clock_timestamp());
  new_evidence:=e.evidence||jsonb_build_object('ownerSettlement',settlement,'notes',
    coalesce(e.evidence->'notes','[]'::jsonb)||jsonb_build_array('【业主分账结算】'||summary,'【用户更正】'||reason));
  update public.asset_operation_lease_evidence set evidence=new_evidence where asset_id=a.id;
  update public.asset_operation_assets set updated_at=clock_timestamp() where id=a.id returning * into a;
  -- Prove exactly one management receipt, no service recognition, no fabricated
  -- payment/ledger link, and no modification to any previous asset entry.
  if entry.asset_id<>a.id or entry.amount_native<>received or entry.currency<>'XOF' or entry.cash_date<>cash_day or entry.kind<>'income' or entry.category<>'rent'
    or entry.period_start is not null or entry.period_end is not null or entry.recognition_method<>'unallocated' or entry.verification<>'verified'
    or entry.recorded_by<>actor or entry.verified_by<>actor or entry.payment_id is not null or entry.ledger_entry_id is not null
    or entry.source_ref<>source_ref_value or (select count(*) from public.asset_operation_entries where asset_id=a.id)<>jsonb_array_length(old_entries)+1
    or (select evidence-'notes'-'ownerSettlement' from public.asset_operation_lease_evidence where asset_id=a.id) is distinct from (e.evidence-'notes'-'ownerSettlement') then
    raise exception 'ownerSettlementVerificationFailed'; end if;
  for old_row in select value from jsonb_array_elements(old_entries) loop
    if not exists(select 1 from public.asset_operation_entries x where x.id=(old_row->>'id')::uuid and to_jsonb(x)=old_row) then raise exception 'ownerSettlementVerificationFailed'; end if;
  end loop;
  result_doc:=jsonb_build_object('success',true,'data',jsonb_build_object('assetId',a.id,'entryId',entry.id,'ownerSettlement',settlement));
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(actor,public.current_user_role(),'asset_operations_owner_settlement','asset_operation',a.id,
      jsonb_build_object('asset',original_asset,'leaseEvidence',original_evidence,'entries',old_entries),
      jsonb_build_object('asset',to_jsonb(a),'leaseEvidence',(select to_jsonb(x) from public.asset_operation_lease_evidence x where asset_id=a.id),'entry',to_jsonb(entry)),
      jsonb_build_object('request_id',p_request_id,'input',p_input,'channel','asset_operations_record_owner_settlement_rpc','actor_id',actor,
        'actual_cash_amount',received,'tenant_payments_created',0,'tenant_ledger_created',0,'source_ref',source_ref_value));
  insert into private.asset_operation_requests(request_id,actor_id,operation,payload,result)
    values(p_request_id,actor,'owner_settlement',p_input,result_doc);
  return result_doc||jsonb_build_object('idempotent',false);
end; $$;

create function public.asset_operations_owner_settlement_context_rpc(p_asset_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.asset_operations_owner_settlement_context($1); $$;
create function public.asset_operations_record_owner_settlement_rpc(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.asset_operations_record_owner_settlement($1,$2); $$;
revoke all on function private.guard_asset_owner_settlement_receipt(),private.asset_owner_settlement_scope(uuid),private.asset_owner_settlement_text(jsonb,text,integer),
  private.asset_owner_settlement_money(jsonb,text,boolean),private.asset_owner_settlement_date(jsonb,text),private.asset_owner_settlement_previous(jsonb,uuid),
  private.asset_operations_owner_settlement_context(uuid),private.asset_operations_record_owner_settlement(jsonb,uuid),
  public.asset_operations_owner_settlement_context_rpc(uuid),public.asset_operations_record_owner_settlement_rpc(jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.asset_operations_owner_settlement_context(uuid),private.asset_operations_record_owner_settlement(jsonb,uuid),
  public.asset_operations_owner_settlement_context_rpc(uuid),public.asset_operations_record_owner_settlement_rpc(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
