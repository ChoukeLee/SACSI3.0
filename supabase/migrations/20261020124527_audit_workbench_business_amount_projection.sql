-- Forward-only compatibility for already published audit pagination.
-- Preserve recorded business amounts without loading plans or historical blobs.
create or replace function public.audit_workbench_list_metadata(p_metadata jsonb,p_after jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select coalesce((select jsonb_object_agg(key,value) from jsonb_each(case when jsonb_typeof(p_metadata)='object' then p_metadata else '{}'::jsonb end)
    where key in ('channel','request_id','child_request_id','line_id','unit_id','unit_no','room_no',
      'contract_id','contract_no','booking_agent_id','input_source','payment_date','receipt_no','amount',
      'connector_version','protocol_version','paid_through_unchanged','coverage_explicitly_confirmed','no_receivables_created')
      and jsonb_typeof(value) in ('string','boolean','number','null')),'{}'::jsonb)
  || case when jsonb_typeof(p_metadata->'plan')='object' then jsonb_build_object('plan',
    (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_metadata->'plan')
      where key in ('amountXof','unitCode','targetUnitCode')
        and jsonb_typeof(value) in ('string','boolean','number','null')))
    else '{}'::jsonb end
  || case when p_after->'success'='true'::jsonb then jsonb_build_object('collection_result',
    (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_after)
      where key in ('success','requestId','currency','totalAmount','referenceNos','paymentIds','paidThroughBefore','paidThroughAfter')))
    else '{}'::jsonb end
  || case when jsonb_typeof(p_metadata->'input')='object' then jsonb_build_object('collection_input',
    (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_metadata->'input')
      where key in ('paymentDate','paymentMethod','externalReceiptNo','actualCollector','collectorBasis')
        and jsonb_typeof(value) in ('string','null')))
    else '{}'::jsonb end;
$$;

revoke all on function public.audit_workbench_list_metadata(jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.audit_workbench_list_metadata(jsonb,jsonb) to authenticated;
