begin;

-- Source-backed historical owner cash is independent of the latest confirmed
-- settlement. No historical credit, whole-property equivalent, tenant payment,
-- receivable or service-period income is created by this workflow.
create index asset_owner_history_receipt_links on private.asset_operation_requests
  using gin((result->'data'->'entryIds')) where operation='owner_rent_history';
create function private.guard_asset_owner_history_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.asset_operation_requests r where r.operation='owner_rent_history'
    and r.result->'data'->'entryIds' ? old.id::text) then
    raise exception 'ownerSettlementReceiptLinked' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger asset_owner_history_receipt_guard before update or delete on public.asset_operation_entries
  for each row execute function private.guard_asset_owner_history_receipt();

-- Once an owner rent account accrues every month after its anchor, a later
-- settlement must continue that anchor without silently skipping unpaid months.
-- Assets without this account retain their existing settlement behaviour.
create function private.guard_asset_owner_account_continuation() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
  if old.evidence->'ownerRentAccount' is not null and old.evidence->'ownerRentAccount'<>'null'::jsonb
    and new.evidence->'ownerSettlement' is distinct from old.evidence->'ownerSettlement' then
    previous:=private.asset_owner_settlement_previous(old.evidence,old.asset_id);
    if previous is null or new.evidence->'ownerSettlement'->>'periodStart' is distinct from
      to_char((previous->>'periodEnd')::date+1,'YYYY-MM-DD') then
      raise exception 'ownerSettlementPeriodConflict'; end if;
  end if;
  return new;
end; $$;
create trigger asset_owner_account_continuation_guard before update on public.asset_operation_lease_evidence
  for each row execute function private.guard_asset_owner_account_continuation();

create function private.asset_owner_account_scope(p_asset uuid,p_write boolean default false)
returns public.asset_operation_assets language plpgsql stable security definer set search_path='' as $$
declare a public.asset_operation_assets%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance','boss'),false)
    or (p_write and not coalesce(public.has_app_role('admin','finance'),false)) then
    raise exception 'assetOperationPermissionDenied' using errcode='42501'; end if;
  select * into a from public.asset_operation_assets where id=p_asset;
  if a.id is null then raise exception 'assetOperationNotFound'; end if;
  if not coalesce(public.can_access_project(a.project_id),false) then raise exception 'assetOperationAccessDenied' using errcode='42501'; end if;
  return a;
end; $$;

create function private.asset_owner_account_settlement_ids(p_asset uuid,p_latest jsonb,p_owner text,p_share numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.asset_operation_requests%rowtype; s jsonb; checked jsonb; ids jsonb:='[]'; entry public.asset_operation_entries%rowtype; found_latest boolean:=false;
begin
  for j in select * from private.asset_operation_requests where operation='owner_settlement'
    and result->'data'->>'assetId'=p_asset::text order by created_at,request_id loop
    s:=j.result->'data'->'ownerSettlement';
    if s->>'ownerName' is distinct from p_owner or (s->>'shareBps')::numeric is distinct from p_share
      or s->>'currency' is distinct from 'XOF' or s->>'requestId' is distinct from j.request_id::text
      or s->>'recordedBy' is distinct from j.actor_id::text or j.payload->>'assetId' is distinct from p_asset::text then
      raise exception 'ownerRentAccountHistoryConflict'; end if;
    checked:=private.asset_owner_settlement_previous(jsonb_build_object('ownerSettlement',s),p_asset);
    select * into strict entry from public.asset_operation_entries where id=(checked->>'entryId')::uuid;
    if entry.recorded_by<>j.actor_id or entry.verified_by<>j.actor_id or entry.request_id<>md5(j.request_id::text||':owner-receipt')::uuid
      or ids ? entry.id::text then raise exception 'ownerRentAccountHistoryConflict'; end if;
    if j.request_id::text=p_latest->>'requestId' then
      if s<>p_latest then raise exception 'ownerRentAccountAnchorConflict'; end if;
      found_latest:=true;
    end if;
    ids:=ids||jsonb_build_array(entry.id);
  end loop;
  if not found_latest then raise exception 'ownerRentAccountAnchorConflict'; end if;
  return ids;
end; $$;

create function private.asset_operations_owner_rent_account(p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.asset_operation_assets%rowtype; e public.asset_operation_lease_evidence%rowtype; account jsonb; latest jsonb; ids jsonb;
  parent private.asset_operation_requests%rowtype; child private.asset_operation_requests%rowtype; item jsonb; original jsonb;
  entry public.asset_operation_entries%rowtype; history_ids jsonb:='[]'; sources text[]:='{}'; last_day date; day date; idx integer:=0;
  keys text[]:=array['version','ownerName','shareBps','currency','wholeMonthlyRentNative','rateSourceRef','chargingRule','history','settlementEntryIds','reason','recordedBy','recordedAt','requestId'];
begin
  a:=private.asset_owner_account_scope(p_asset_id,false);
  select * into e from public.asset_operation_lease_evidence where asset_id=a.id;
  account:=e.evidence->'ownerRentAccount';
  if account is null or account='null'::jsonb then return jsonb_build_object('assetId',a.id,'account',null,'settlementEntryIds','[]'::jsonb); end if;
  if jsonb_typeof(account)<>'object' or exists(select 1 from jsonb_object_keys(account) k where not(k=any(keys)))
    or exists(select 1 from unnest(keys) k where not(account?k) or account->k='null'::jsonb)
    or account->>'version' is distinct from '1' or account->>'currency' is distinct from 'XOF'
    or account->>'chargingRule' is distinct from 'full_calendar_month'
    or jsonb_typeof(account->'history') is distinct from 'array' or jsonb_array_length(account->'history') not between 1 and 100
    or jsonb_typeof(account->'settlementEntryIds') is distinct from 'array'
    or coalesce(account->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'ownerRentAccountHistoryConflict'; end if;
  select * into parent from private.asset_operation_requests where request_id=(account->>'requestId')::uuid;
  if parent.request_id is null or parent.operation is distinct from 'owner_rent_history' or parent.actor_id::text is distinct from account->>'recordedBy'
    or (parent.payload->>'assetId')::uuid is distinct from a.id or parent.result->'data'->>'assetId' is distinct from a.id::text
    or parent.result->'data'->'ownerRentAccount' is distinct from account then raise exception 'ownerRentAccountHistoryConflict'; end if;
  latest:=private.asset_owner_settlement_previous(e.evidence,a.id);
  if latest is null or latest->>'ownerName' is distinct from account->>'ownerName' or latest->'shareBps' is distinct from account->'shareBps' then raise exception 'ownerRentAccountAnchorConflict'; end if;
  if a.rent_currency is distinct from 'XOF' or a.monthly_rent_native is distinct from (account->>'wholeMonthlyRentNative')::numeric then raise exception 'ownerRentAccountRateConflict'; end if;
  ids:=private.asset_owner_account_settlement_ids(a.id,latest,account->>'ownerName',(account->>'shareBps')::numeric);
  if not(ids @> (account->'settlementEntryIds')) then raise exception 'ownerRentAccountHistoryConflict'; end if;
  for item in select value from jsonb_array_elements(account->'history') loop
    idx:=idx+1; original:=parent.payload->'history'->(idx-1);
    if item-'entryId' is distinct from original or coalesce(item->>'entryId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or history_ids ? (item->>'entryId') or (item->>'sourceRef')=any(sources) then raise exception 'ownerRentAccountHistoryConflict'; end if;
    day:=private.asset_owner_settlement_date(item,'cashDate');
    if last_day is not null and day<=last_day then raise exception 'ownerHistoryOrderConflict'; end if; last_day:=day;
    select * into entry from public.asset_operation_entries where id=(item->>'entryId')::uuid;
    select * into child from private.asset_operation_requests where request_id=entry.request_id;
    if entry.id is null or entry.asset_id<>a.id or entry.kind<>'income' or entry.category<>'rent' or entry.currency<>'XOF'
      or entry.amount_native is distinct from (item->>'amountNative')::numeric or entry.cash_date<>day
      or entry.period_start is not null or entry.period_end is not null or entry.recognition_method<>'unallocated'
      or entry.voided_at is not null or entry.verification<>'verified' or entry.recorded_by<>parent.actor_id or entry.verified_by<>parent.actor_id
      or entry.source_ref<>item->>'sourceRef' or entry.payment_id is not null or entry.ledger_entry_id is not null
      or entry.request_id<>md5(parent.request_id::text||':owner-history:'||idx)::uuid
      or child.actor_id is distinct from parent.actor_id or child.operation is distinct from 'create_entry'
      or child.result->'data'->>'entryId' is distinct from entry.id::text or child.payload->>'assetId' is distinct from a.id::text
      or child.payload->>'sourceRef' is distinct from entry.source_ref
      or child.payload->>'cashDate' is distinct from item->>'cashDate'
      or (child.payload->>'amountNative')::numeric is distinct from entry.amount_native then raise exception 'ownerRentAccountHistoryConflict'; end if;
    sources:=array_append(sources,item->>'sourceRef'); history_ids:=history_ids||jsonb_build_array(entry.id);
  end loop;
  if history_ids is distinct from parent.result->'data'->'entryIds' or jsonb_array_length(parent.payload->'history') is distinct from idx then raise exception 'ownerRentAccountHistoryConflict'; end if;
  return jsonb_build_object('assetId',a.id,'account',account,'settlementEntryIds',ids);
end; $$;

create function private.asset_operations_backfill_owner_rent_history(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare a public.asset_operation_assets%rowtype; e public.asset_operation_lease_evidence%rowtype; previous private.asset_operation_requests%rowtype;
  latest jsonb; initial_settlement_ids jsonb; before_asset jsonb; before_evidence jsonb; before_entries jsonb;
  item jsonb; amount numeric; day date; last_day date; ref text; refs text[]:='{}'; raw_source text; method text; reason text; rate_ref text;
  asset_id uuid; expected timestamptz; idx integer:=0; child_id uuid; children uuid[]:='{}'; child_result jsonb; entry_id uuid;
  history jsonb:='[]'; entry_ids jsonb:='[]'; account jsonb; result_doc jsonb; new_evidence jsonb; checked jsonb; old_row jsonb;
  fields text[]:=array['assetId','expectedUpdatedAt','expectedEvidenceHash','expectedSettlementRequestId','rateSourceRef','reason','history'];
  row_fields text[]:=array['cashDate','amountNative','currency','paymentMethod','sourceRef','sourceText'];
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated' or not coalesce(public.has_app_role('admin','finance'),false) then raise exception 'assetOperationPermissionDenied' using errcode='42501'; end if;
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>262144
    or exists(select 1 from jsonb_object_keys(p_input) k where not(k=any(fields)))
    or exists(select 1 from unnest(fields) k where not(p_input?k) or p_input->k='null'::jsonb)
    or jsonb_typeof(p_input->'history') is distinct from 'array' or jsonb_array_length(p_input->'history') not between 1 and 100 then raise exception 'invalidOwnerSettlement'; end if;
  if coalesce(p_input->>'assetId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_input->>'expectedSettlementRequestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_input->>'expectedEvidenceHash','') !~ '^[0-9a-f]{32}$' then raise exception 'invalidOwnerSettlement'; end if;
  asset_id:=(p_input->>'assetId')::uuid; a:=private.asset_owner_account_scope(asset_id,true);
  perform pg_advisory_xact_lock(hashtextextended('asset-operation-request:'||p_request_id,0));
  select * into previous from private.asset_operation_requests where request_id=p_request_id;
  if found then
    if previous.actor_id<>auth.uid() or previous.operation<>'owner_rent_history' or previous.payload<>p_input then raise exception 'requestIdConflict'; end if;
    perform private.asset_operations_owner_rent_account(asset_id);
    return previous.result||jsonb_build_object('idempotent',true);
  end if;
  for idx in 1..jsonb_array_length(p_input->'history') loop children:=array_append(children,md5(p_request_id::text||':owner-history:'||idx)::uuid); end loop;
  perform pg_advisory_xact_lock(hashtextextended('asset-operation-request:'||id,0)) from unnest(children) id order by id;
  if exists(select 1 from private.asset_operation_requests where request_id=any(children)) then raise exception 'requestIdConflict'; end if;
  select * into strict a from public.asset_operation_assets where id=asset_id for update;
  perform private.asset_owner_account_scope(asset_id,true);
  select * into e from public.asset_operation_lease_evidence where asset_id=a.id for update;
  if not found then raise exception 'ownerSettlementEvidenceRequired'; end if;
  perform 1 from public.asset_operation_entries where asset_id=a.id order by id for update;
  begin expected:=private.asset_owner_settlement_text(p_input,'expectedUpdatedAt',64)::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalidOwnerSettlement'; end;
  if not isfinite(expected) or expected is distinct from a.updated_at or p_input->>'expectedEvidenceHash'<>md5(to_jsonb(e)::text) then raise exception 'assetOperationRecordChanged'; end if;
  if e.evidence?'ownerRentAccount' and e.evidence->'ownerRentAccount'<>'null'::jsonb then raise exception 'ownerRentAccountAlreadyRecorded'; end if;
  latest:=private.asset_owner_settlement_previous(e.evidence,a.id);
  if latest is null or latest->>'requestId'<>p_input->>'expectedSettlementRequestId' then raise exception 'ownerRentAccountAnchorConflict'; end if;
  if a.verification<>'verified' or a.rent_currency is distinct from 'XOF' or a.monthly_rent_native is distinct from (latest->>'monthlyRentNative')::numeric
    or a.monthly_rent_native<=0 or a.monthly_rent_native<>trunc(a.monthly_rent_native)
    or mod(a.monthly_rent_native*(latest->>'shareBps')::numeric,10000)<>0 then raise exception 'ownerRentAccountRateConflict'; end if;
  initial_settlement_ids:=private.asset_owner_account_settlement_ids(a.id,latest,latest->>'ownerName',(latest->>'shareBps')::numeric);
  reason:=private.asset_owner_settlement_text(p_input,'reason',2000); rate_ref:=private.asset_owner_settlement_text(p_input,'rateSourceRef',500);
  if e.evidence?'notes' and jsonb_typeof(e.evidence->'notes')<>'array' then raise exception 'ownerRentAccountHistoryConflict'; end if;
  -- Validate the complete source batch before recording any cash.
  for item in select value from jsonb_array_elements(p_input->'history') loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where not(k=any(row_fields)))
      or exists(select 1 from unnest(row_fields) k where not(item?k) or (k<>'paymentMethod' and item->k='null'::jsonb)) then raise exception 'invalidOwnerSettlement'; end if;
    amount:=private.asset_owner_settlement_money(item,'amountNative'); day:=private.asset_owner_settlement_date(item,'cashDate');
    ref:=private.asset_owner_settlement_text(item,'sourceRef',500);
    if jsonb_typeof(item->'sourceText') is distinct from 'string' or length(item->>'sourceText') not between 1 and 2000 or nullif(btrim(item->>'sourceText'),'') is null
      or item->>'currency' is distinct from 'XOF' or (item->'paymentMethod'<>'null'::jsonb and coalesce(item->>'paymentMethod','') not in ('cash','bank_transfer','check','other')) then raise exception 'invalidOwnerSettlement'; end if;
    if (last_day is not null and day<=last_day) or day>(latest->>'cashDate')::date or day>current_date then raise exception 'ownerHistoryOrderConflict'; end if; last_day:=day;
    if ref=any(refs) then raise exception 'assetSourceAlreadyRecorded'; end if; refs:=array_append(refs,ref);
    if exists(select 1 from public.asset_operation_entries x where x.asset_id=a.id and x.voided_at is null and
      ((x.kind='income' and x.source_ref=ref) or (x.kind='income' and x.category='rent' and x.cash_date=day and x.currency='XOF' and x.amount_native=amount))) then raise exception 'ownerHistoryReceiptCollision'; end if;
  end loop;
  before_asset:=to_jsonb(a); before_evidence:=to_jsonb(e);
  select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into before_entries from public.asset_operation_entries x where asset_id=a.id;
  idx:=0;
  for item in select value from jsonb_array_elements(p_input->'history') loop
    idx:=idx+1; child_id:=children[idx]; method:=item->>'paymentMethod';
    child_result:=private.asset_operations_write('create_entry',jsonb_build_object('assetId',a.id,'expectedUpdatedAt',a.updated_at,'kind','income','category','rent',
      'amountNative',item->'amountNative','currency','XOF','cashDate',item->>'cashDate','periodStart',null,'periodEnd',null,'verification','verified','recognitionMethod','unallocated',
      'sourceRef',item->>'sourceRef','description',(latest->>'ownerName')||'业主历史租金分账实收'||(item->>'amountNative')||'XOF；'||(item->>'cashDate')||
        '；方式'||coalesce(method,'原表未记载')||'；原始资料见来源；仅补历史实际到手款，不重算或抵减最新结清日之后的欠款'),child_id);
    if child_result->>'success' is distinct from 'true' then raise exception 'ownerSettlementVerificationFailed'; end if;
    entry_id:=(child_result->'data'->>'entryId')::uuid;
    history:=history||jsonb_build_array(item||jsonb_build_object('entryId',entry_id)); entry_ids:=entry_ids||jsonb_build_array(entry_id);
  end loop;
  account:=jsonb_build_object('version',1,'ownerName',latest->>'ownerName','shareBps',latest->'shareBps','currency','XOF','wholeMonthlyRentNative',a.monthly_rent_native,
    'rateSourceRef',rate_ref,'chargingRule','full_calendar_month','history',history,'settlementEntryIds',initial_settlement_ids,'reason',reason,
    'recordedBy',auth.uid(),'recordedAt',clock_timestamp(),'requestId',p_request_id);
  new_evidence:=e.evidence||jsonb_build_object('ownerRentAccount',account,'notes',coalesce(e.evidence->'notes','[]')||jsonb_build_array(
    '【业主历史实收补录】本批'||jsonb_array_length(history)||'笔，仅计实际到手金额；原表未列付款方式的保留未记载；旧整厂信用不再作为现金或再次抵减后续欠款。',
    '【历史资料更正及分账应收依据】'||reason));
  update public.asset_operation_lease_evidence set evidence=new_evidence where asset_id=a.id;
  update public.asset_operation_assets set updated_at=clock_timestamp() where id=a.id returning * into a;
  if new_evidence->'ownerSettlement' is distinct from e.evidence->'ownerSettlement'
    or (new_evidence-'notes'-'ownerRentAccount') is distinct from (e.evidence-'notes'-'ownerRentAccount')
    or (select count(*) from public.asset_operation_entries where asset_id=a.id)<>jsonb_array_length(before_entries)+jsonb_array_length(history) then raise exception 'ownerSettlementVerificationFailed'; end if;
  for old_row in select value from jsonb_array_elements(before_entries) loop
    if not exists(select 1 from public.asset_operation_entries x where id=(old_row->>'id')::uuid and to_jsonb(x)=old_row) then raise exception 'ownerSettlementVerificationFailed'; end if;
  end loop;
  result_doc:=jsonb_build_object('success',true,'data',jsonb_build_object('assetId',a.id,'ownerRentAccount',account,'entryIds',entry_ids));
  insert into private.asset_operation_requests(request_id,actor_id,operation,payload,result) values(p_request_id,auth.uid(),'owner_rent_history',p_input,result_doc);
  checked:=private.asset_operations_owner_rent_account(a.id);
  if checked->'account'<>account or checked->'settlementEntryIds'<>initial_settlement_ids then raise exception 'ownerSettlementVerificationFailed'; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(auth.uid(),public.current_user_role(),'asset_operations_owner_rent_history','asset_operation',a.id,
      jsonb_build_object('asset',before_asset,'leaseEvidence',before_evidence,'entries',before_entries),
      jsonb_build_object('asset',to_jsonb(a),'leaseEvidence',(select to_jsonb(x) from public.asset_operation_lease_evidence x where asset_id=a.id),'entryIds',entry_ids),
      jsonb_build_object('request_id',p_request_id,'input',p_input,'channel','asset_operations_backfill_owner_rent_history_rpc','tenant_payments_created',0,'tenant_receivables_created',0));
  return result_doc||jsonb_build_object('idempotent',false);
end; $$;

create function public.asset_operations_owner_rent_account_rpc(p_asset_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.asset_operations_owner_rent_account($1); $$;
create function public.asset_operations_backfill_owner_rent_history_rpc(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.asset_operations_backfill_owner_rent_history($1,$2); $$;
revoke all on function private.guard_asset_owner_history_receipt(),private.guard_asset_owner_account_continuation(),private.asset_owner_account_scope(uuid,boolean),private.asset_owner_account_settlement_ids(uuid,jsonb,text,numeric),
  private.asset_operations_owner_rent_account(uuid),private.asset_operations_backfill_owner_rent_history(jsonb,uuid),
  public.asset_operations_owner_rent_account_rpc(uuid),public.asset_operations_backfill_owner_rent_history_rpc(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.asset_operations_owner_rent_account(uuid),private.asset_operations_backfill_owner_rent_history(jsonb,uuid),
  public.asset_operations_owner_rent_account_rpc(uuid),public.asset_operations_backfill_owner_rent_history_rpc(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
