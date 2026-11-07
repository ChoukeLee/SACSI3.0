begin;

-- Reference rent is an editable management term. Its original source references
-- and fingerprint remain unchanged; every revision retains before/after evidence.
create function private.asset_operations_update_terms(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); asset public.asset_operation_assets%rowtype;
  previous private.asset_operation_requests%rowtype; before_data jsonb; result jsonb;
  rent numeric; currency text; reason text;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance'),false) then
    raise exception 'assetOperationPermissionDenied' using errcode='42501'; end if;
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'invalidAssetOperation'; end if;
  select * into asset from public.asset_operation_assets where id=(p_input->>'assetId')::uuid;
  if asset.id is null then raise exception 'assetOperationNotFound'; end if;
  if not coalesce(public.can_access_project(asset.project_id),false) then raise exception 'assetOperationAccessDenied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('asset-operation-request:'||p_request_id,0));
  select * into previous from private.asset_operation_requests where request_id=p_request_id;
  if found then
    if previous.actor_id<>actor or previous.operation<>'update_asset_terms' or previous.payload<>p_input then raise exception 'requestIdConflict'; end if;
    return previous.result||jsonb_build_object('idempotent',true);
  end if;
  select * into strict asset from public.asset_operation_assets where id=asset.id for update;
  if nullif(p_input->>'expectedUpdatedAt','')::timestamptz is distinct from asset.updated_at then raise exception 'assetOperationRecordChanged'; end if;
  rent:=nullif(p_input->>'monthlyRentNative','')::numeric;
  currency:=nullif(p_input->>'rentCurrency',''); reason:=btrim(p_input->>'reason');
  if not (p_input ? 'monthlyRentNative') or not (p_input ? 'rentCurrency')
    or reason is null or length(reason) not between 1 and 2000
    or (rent is null)<>(currency is null)
    or (rent is not null and (rent<=0 or rent::text in ('NaN','Infinity','-Infinity') or round(rent,2)<>rent
      or coalesce(currency,'') not in ('XOF','CNY','USD'))) then raise exception 'invalidAssetTerms'; end if;
  before_data:=to_jsonb(asset);
  update public.asset_operation_assets set monthly_rent_native=rent,rent_currency=currency,updated_at=clock_timestamp()
    where id=asset.id returning * into asset;
  result:=jsonb_build_object('success',true,'data',jsonb_build_object('assetId',asset.id,'updatedAt',asset.updated_at,
    'monthlyRentNative',asset.monthly_rent_native,'rentCurrency',asset.rent_currency));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
    values(actor,'asset_operations_update_asset_terms','asset_operation',asset.id,before_data,to_jsonb(asset),
      jsonb_build_object('request_id',p_request_id,'reason',reason,'channel','asset_operations_update_terms_rpc'));
  insert into private.asset_operation_requests(request_id,actor_id,operation,payload,result)
    values(p_request_id,actor,'update_asset_terms',p_input,result);
  return result||jsonb_build_object('idempotent',false);
end $$;
revoke all on function private.asset_operations_update_terms(jsonb,uuid) from public,anon,service_role;
grant execute on function private.asset_operations_update_terms(jsonb,uuid) to authenticated;
create function public.asset_operations_update_terms_rpc(p_input jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.asset_operations_update_terms(p_input,p_request_id) $$;
revoke all on function public.asset_operations_update_terms_rpc(jsonb,uuid) from public,anon,service_role;
grant execute on function public.asset_operations_update_terms_rpc(jsonb,uuid) to authenticated;

-- One all-or-nothing batch delegates to the existing audited writer. Child UUIDs
-- are caller-stable or deterministically derived from batch UUID and row ordinal.
-- Importing a source never confirms a payment or authorizes period recognition.
create function private.asset_operations_import_entries(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); project uuid; fingerprint text; previous private.asset_operation_requests%rowtype;
  child_previous private.asset_operation_requests%rowtype;
  raw jsonb; resolved jsonb:='[]'; item jsonb; asset public.asset_operation_assets%rowtype; section text;
  ordinal integer:=0; child_request uuid; child_requests uuid[]:='{}'; child_result jsonb;
  payload jsonb; result jsonb; ids jsonb:='[]'; term_ids jsonb:='[]'; imported integer:=0; matched integer:=0; updated_terms integer:=0;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated' or not coalesce(public.has_app_role('admin'),false) then
    raise exception 'assetOperationPermissionDenied' using errcode='42501'; end if;
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'invalidAssetOperation'; end if;
  project:=(p_input->>'projectId')::uuid; fingerprint:=lower(p_input->>'sourceFingerprint');
  if project is null or not coalesce(public.can_access_project(project),false) then raise exception 'assetOperationAccessDenied' using errcode='42501'; end if;
  -- Serialize batches before locking their parent/child request UUIDs. Individual
  -- writes keep the existing request-before-asset order used by the core writer.
  perform pg_advisory_xact_lock(hashtextextended('asset-operation-import-batch',0));
  perform pg_advisory_xact_lock(hashtextextended('asset-operation-request:'||p_request_id,0));
  select * into previous from private.asset_operation_requests where request_id=p_request_id;
  if found then
    if previous.actor_id<>actor or previous.operation<>'import_entries' or previous.payload<>p_input then raise exception 'requestIdConflict'; end if;
    return previous.result||jsonb_build_object('idempotent',true);
  end if;
  if fingerprint is null or fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_input->'entries','[]'::jsonb)) is distinct from 'array'
    or jsonb_typeof(coalesce(p_input->'terms','[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(p_input->'entries','[]'::jsonb))>100
    or jsonb_array_length(coalesce(p_input->'terms','[]'::jsonb))>100
    or jsonb_array_length(coalesce(p_input->'entries','[]'::jsonb))+jsonb_array_length(coalesce(p_input->'terms','[]'::jsonb))=0 then
    raise exception 'invalidAssetEntryBatch'; end if;
  foreach section in array array['terms','entries'] loop
    ordinal:=0;
    for raw in select value from jsonb_array_elements(coalesce(p_input->section,'[]'::jsonb)) loop
      ordinal:=ordinal+1;
      if jsonb_typeof(raw)<>'object' or nullif(raw->>'paymentId','') is not null or nullif(raw->>'ledgerEntryId','') is not null then
        raise exception 'invalidAssetEntryBatch'; end if;
      if section='terms' and (not (raw ? 'monthlyRentNative') or not (raw ? 'rentCurrency')) then
        raise exception 'invalidAssetTerms'; end if;
      if nullif(raw->>'assetId','') is not null then
        select * into asset from public.asset_operation_assets where id=(raw->>'assetId')::uuid and project_id=project;
        if asset.id is null or (nullif(raw->>'assetSourceKey','') is not null and asset.source_key<>raw->>'assetSourceKey') then
          raise exception 'assetOperationNotFound'; end if;
      else
        select * into asset from public.asset_operation_assets where project_id=project and source_key=raw->>'assetSourceKey';
        if asset.id is null then raise exception 'assetOperationNotFound'; end if;
      end if;
      if section='terms' and exists(select 1 from jsonb_array_elements(resolved) v where v->>'section'='terms' and (v->>'assetId')::uuid=asset.id) then
        raise exception 'invalidAssetEntryBatch'; end if;
      child_request:=coalesce(nullif(raw->>'requestId','')::uuid,md5(p_request_id::text||':'||section||':'||ordinal::text)::uuid);
      if child_request=p_request_id or child_request=any(child_requests) then raise exception 'invalidAssetEntryBatch'; end if;
      child_requests:=array_append(child_requests,child_request);
      resolved:=resolved||jsonb_build_array(jsonb_build_object('assetId',asset.id,'requestId',child_request,'raw',raw,'section',section));
    end loop;
  end loop;
  -- Lock all child requests before any asset, matching standalone operation order.
  for child_request in select v from unnest(child_requests) v order by v loop
    perform pg_advisory_xact_lock(hashtextextended('asset-operation-request:'||child_request,0));
  end loop;
  perform 1 from public.asset_operation_assets a where a.project_id=project
    and a.id in (select (v->>'assetId')::uuid from jsonb_array_elements(resolved) v) order by a.id for update;
  for item in select value from jsonb_array_elements(resolved) loop
    raw:=item->'raw';
    select * into strict asset from public.asset_operation_assets where id=(item->>'assetId')::uuid;
    if item->>'section'='terms' then
      payload:=jsonb_build_object('assetId',asset.id,'expectedUpdatedAt',raw->>'expectedUpdatedAt',
        'monthlyRentNative',raw->'monthlyRentNative','rentCurrency',raw->>'rentCurrency','reason',raw->>'reason');
      child_result:=private.asset_operations_update_terms(payload,(item->>'requestId')::uuid);
      term_ids:=term_ids||jsonb_build_array(asset.id);
      if not coalesce((child_result->>'idempotent')::boolean,false) then updated_terms:=updated_terms+1; end if;
    else
      payload:=jsonb_build_object('assetId',asset.id,'expectedUpdatedAt',asset.updated_at,
        'kind',raw->>'kind','category',raw->>'category','amountNative',raw->'amountNative','currency',raw->>'currency',
        'cashDate',raw->>'cashDate','periodStart',raw->>'periodStart','periodEnd',raw->>'periodEnd',
        'verification','pending','recognitionMethod','unallocated','sourceRef',raw->>'sourceRef','description',coalesce(raw->>'description',''));
      select * into child_previous from private.asset_operation_requests where request_id=(item->>'requestId')::uuid;
      if found then
        -- Reference-term maintenance advances the asset CAS independently of a
        -- recorded money fact. Reuse the original CAS only for the exact same
        -- actor, operation and business payload; the core still rechecks access.
        if child_previous.actor_id<>actor or child_previous.operation<>'create_entry'
          or (child_previous.payload-'expectedUpdatedAt')<>(payload-'expectedUpdatedAt') then raise exception 'requestIdConflict'; end if;
        payload:=child_previous.payload;
      end if;
      child_result:=private.asset_operations_write('create_entry',payload,(item->>'requestId')::uuid);
      ids:=ids||jsonb_build_array(child_result->'data'->>'entryId');
      if coalesce((child_result->>'idempotent')::boolean,false) then matched:=matched+1; else imported:=imported+1; end if;
    end if;
    if coalesce((child_result->>'success')::boolean,false) is not true then raise exception 'assetOperationResultUnknown'; end if;
  end loop;
  result:=jsonb_build_object('success',true,'data',jsonb_build_object('importedCount',imported,'matchedCount',matched,'entryIds',ids,
    'updatedTermsCount',updated_terms,'termAssetIds',term_ids,'requestIds',to_jsonb(child_requests)));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values(actor,'asset_operations_import_entries','asset_operation_batch',project,
      jsonb_build_object('request_id',p_request_id,'source_fingerprint',fingerprint,'entry_ids',ids,'term_asset_ids',term_ids,'count',jsonb_array_length(ids),'channel','asset_operations_import_entries_rpc'));
  insert into private.asset_operation_requests(request_id,actor_id,operation,payload,result)
    values(p_request_id,actor,'import_entries',p_input,result);
  return result||jsonb_build_object('idempotent',false);
end $$;
revoke all on function private.asset_operations_import_entries(jsonb,uuid) from public,anon,service_role;
grant execute on function private.asset_operations_import_entries(jsonb,uuid) to authenticated;
create function public.asset_operations_import_entries_rpc(p_input jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.asset_operations_import_entries(p_input,p_request_id) $$;
revoke all on function public.asset_operations_import_entries_rpc(jsonb,uuid) from public,anon,service_role;
grant execute on function public.asset_operations_import_entries_rpc(jsonb,uuid) to authenticated;

commit;
