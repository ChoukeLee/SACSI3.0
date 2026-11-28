begin;

-- A reviewed period identifies the imported balance without changing the source
-- amount, receipt, due date or original coverage. Receipt matching stays derived.
create function private.asset_operations_confirm_outstanding_period(p_input jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  asset public.asset_operation_assets%rowtype;
  lease public.asset_operation_lease_evidence%rowtype;
  previous private.asset_operation_requests%rowtype;
  original_balance jsonb;
  expected_balance jsonb;
  reviewed_balance jsonb;
  revised_evidence jsonb;
  starts text := p_input->>'periodStart';
  ends text := p_input->>'periodEnd';
  due text := p_input->>'dueDate';
  cutoff text;
  reason text := btrim(p_input->>'reason');
  result jsonb;
begin
  if actor is null or coalesce(auth.jwt()->>'role','') <> 'authenticated'
     or not coalesce(public.has_app_role('admin','finance'),false) then
    raise exception 'assetOperationPermissionDenied' using errcode='42501';
  end if;
  expected_balance := p_input->'expectedOutstanding';
  if p_request_id is null or jsonb_typeof(p_input) is distinct from 'object'
     or jsonb_typeof(expected_balance) is distinct from 'object' then
    raise exception 'invalidAssetOperation';
  end if;

  select * into asset from public.asset_operation_assets where id = (p_input->>'assetId')::uuid;
  if not found then raise exception 'assetOperationNotFound'; end if;
  if not coalesce(public.can_access_project(asset.project_id),false) then
    raise exception 'assetOperationAccessDenied' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('asset-operation-request:' || p_request_id,0));
  select * into previous from private.asset_operation_requests where request_id = p_request_id;
  if found then
    if previous.actor_id <> actor or previous.operation <> 'confirm_outstanding_period'
       or previous.payload <> p_input then raise exception 'requestIdConflict'; end if;
    return previous.result || jsonb_build_object('idempotent',true);
  end if;

  select * into strict asset from public.asset_operation_assets where id = asset.id for update;
  if not coalesce(public.can_access_project(asset.project_id),false) then
    raise exception 'assetOperationAccessDenied' using errcode='42501';
  end if;
  select * into lease from public.asset_operation_lease_evidence where asset_id = asset.id for update;
  original_balance := lease.evidence->'outstanding';
  if not found or asset.verification <> 'verified' or asset.unit_id is not null
     or lease.evidence->>'selfUse' = 'true'
     or coalesce(lease.evidence->'ownerSettlement','null'::jsonb) <> 'null'::jsonb
     or coalesce(lease.evidence->'ownerRentAccount','null'::jsonb) <> 'null'::jsonb
     or coalesce(lease.evidence->'billingGroup','null'::jsonb) <> 'null'::jsonb
     or coalesce(lease.evidence->'leaseGroups','null'::jsonb) not in ('null'::jsonb,'[]'::jsonb)
     or jsonb_typeof(original_balance) is distinct from 'object'
     or jsonb_typeof(original_balance->'amountNative') is distinct from 'number'
     or coalesce(original_balance->>'currency','') not in ('XOF','CNY','USD')
     or nullif(btrim(original_balance->>'sourceRef'),'') is null then
    raise exception 'assetOutstandingPeriodUnavailable';
  end if;
  if (original_balance->>'amountNative')::numeric <= 0 then
    raise exception 'assetOutstandingPeriodUnavailable';
  end if;

  if p_input->>'expectedReviewedOn' is distinct from to_char(lease.reviewed_on,'YYYY-MM-DD')
     or jsonb_strip_nulls(expected_balance) is distinct from jsonb_strip_nulls(jsonb_build_object(
       'amountNative',original_balance->'amountNative','currency',original_balance->'currency',
       'sourceRef',original_balance->'sourceRef','periodStart',original_balance->'periodStart',
       'periodEnd',original_balance->'periodEnd','dueDate',original_balance->'dueDate')) then
    raise exception 'assetOperationRecordChanged';
  end if;

  if reason is null or length(reason) not between 1 and 2000
     or coalesce(starts,'') !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(starts,'date')
     or coalesce(ends,'') !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(ends,'date')
     or (due is not null and (due !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(due,'date')
       or due is distinct from (lease.evidence->'nextPayment'->>'dueDate')
       or (lease.evidence->'nextPayment'->'unpaid') is distinct from 'true'::jsonb)) then
    raise exception 'invalidAssetOutstandingPeriod';
  end if;
  cutoff := lease.evidence->'paidThrough'->>'date';
  if cutoff is not null and (cutoff !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(cutoff,'date')) then
    raise exception 'assetOutstandingPeriodUnavailable';
  end if;
  if starts::date > ends::date or (cutoff is not null and starts::date <= cutoff::date) then
    raise exception 'invalidAssetOutstandingPeriod';
  end if;

  reviewed_balance := (original_balance - 'dueDate') || jsonb_strip_nulls(jsonb_build_object(
    'periodStart',starts,'periodEnd',ends,'dueDate',due));
  revised_evidence := jsonb_set(lease.evidence,'{outstanding}',reviewed_balance);
  update public.asset_operation_lease_evidence set evidence = revised_evidence where asset_id = asset.id;
  result := jsonb_build_object('success',true,'data',jsonb_build_object('assetId',asset.id));
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(actor,public.current_user_role(),'asset_operations_confirm_outstanding_period','asset_operation',asset.id,
      lease.evidence,revised_evidence,jsonb_build_object('request_id',p_request_id,'project_id',asset.project_id,
        'reason',reason,'source_ref',original_balance->>'sourceRef','channel','asset_operations_confirm_outstanding_period_rpc'));
  insert into private.asset_operation_requests(request_id,actor_id,operation,payload,result)
    values(p_request_id,actor,'confirm_outstanding_period',p_input,result);
  return result || jsonb_build_object('idempotent',false);
end $$;
revoke all on function private.asset_operations_confirm_outstanding_period(jsonb,uuid) from public,anon,service_role;
grant execute on function private.asset_operations_confirm_outstanding_period(jsonb,uuid) to authenticated;

create function public.asset_operations_confirm_outstanding_period_rpc(p_input jsonb, p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.asset_operations_confirm_outstanding_period(p_input,p_request_id)
$$;
revoke all on function public.asset_operations_confirm_outstanding_period_rpc(jsonb,uuid) from public,anon,service_role;
grant execute on function public.asset_operations_confirm_outstanding_period_rpc(jsonb,uuid) to authenticated;

commit;
