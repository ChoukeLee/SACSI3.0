-- Read-only audit workbench. Existing audit/table RLS is deliberately unchanged.
-- Names in current directories are supplementary, never historical identity proof.
create index if not exists idx_audit_logs_created_at_id on public.audit_logs(created_at desc,id desc);

create function public.audit_workbench_redact(p_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb; entry record;
begin
  if jsonb_typeof(p_value)='object' then
    result:='{}'::jsonb;
    for entry in select key,value from jsonb_each(p_value) loop
      if entry.key ~* '(password|passwd|secret|token|authorization|cookie|credential|api.?key|private.?key|session|connection|database.?url|jwt|(^|[_-])(key|keys|headers|env|dsn)$)' then
        result:=result||jsonb_build_object(entry.key,'[REDACTED]');
      else result:=result||jsonb_build_object(entry.key,public.audit_workbench_redact(entry.value)); end if;
    end loop;
    return result;
  elsif jsonb_typeof(p_value)='array' then
    return coalesce((select jsonb_agg(public.audit_workbench_redact(value) order by ordinality)
      from jsonb_array_elements(p_value) with ordinality),'[]'::jsonb);
  end if;
  return p_value;
end; $$;

create function public.audit_workbench_list_metadata(p_metadata jsonb,p_after jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select coalesce((select jsonb_object_agg(key,value) from jsonb_each(case when jsonb_typeof(p_metadata)='object' then p_metadata else '{}'::jsonb end)
    where key in ('channel','request_id','child_request_id','line_id','unit_id','unit_no','room_no',
      'contract_id','contract_no','booking_agent_id','input_source','payment_date','receipt_no',
      'connector_version','protocol_version','paid_through_unchanged','coverage_explicitly_confirmed','no_receivables_created')
      and jsonb_typeof(value) in ('string','boolean','number','null')),'{}'::jsonb)
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

create function public.audit_workbench_read_rpc(p_input jsonb default '{}'::jsonb,p_mode text default 'list',p_log_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare
  input jsonb:=p_input; key text; text_value text; filters jsonb; result jsonb; page_number int:=1;
  from_day date; to_day date;
begin
  -- RPC access is intentionally narrower than existing financial audit SELECT RLS.
  if auth.uid() is null or auth.role() is distinct from 'authenticated'
    or not public.has_app_role('admin','boss') then
    raise exception using errcode='42501',message='auditWorkbenchPermissionDenied';
  end if;
  if jsonb_typeof(input) is distinct from 'object' or p_mode is null or p_mode not in ('list','detail','export')
    or (p_mode='detail')<>(p_log_id is not null) then
    raise exception using errcode='22023',message='invalidAuditWorkbench';
  end if;
  for key in select jsonb_object_keys(input) loop
    if key not in ('dateFrom','dateTo','action','entityType','actor','channel','identity','search','page') then
      raise exception using errcode='22023',message='invalidAuditWorkbench';
    end if;
    if key='page' then
      if jsonb_typeof(input->key) not in ('number','string') or input->>key !~ '^[1-9][0-9]{0,5}$' then
        raise exception using errcode='22023',message='invalidAuditWorkbench'; end if;
      page_number:=(input->>key)::int;
      if page_number>100000 then raise exception using errcode='22023',message='invalidAuditWorkbench'; end if;
    else
      if jsonb_typeof(input->key) is distinct from 'string' then
        raise exception using errcode='22023',message='invalidAuditWorkbench'; end if;
      text_value:=input->>key;
      if length(text_value)>(case when key in ('search','actor') then 200 else 100 end)
        or text_value ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='invalidAuditWorkbench'; end if;
      input:=jsonb_set(input,array[key],to_jsonb(btrim(text_value)));
    end if;
  end loop;
  filters:=jsonb_build_object('dateFrom',coalesce(input->>'dateFrom',''),'dateTo',coalesce(input->>'dateTo',''),
    'action',coalesce(input->>'action',''),'entityType',coalesce(input->>'entityType',''),
    'actor',coalesce(input->>'actor',''),'channel',coalesce(input->>'channel',''),
    'identity',coalesce(input->>'identity',''),'search',coalesce(input->>'search',''));
  if filters->>'channel' not in ('','external_codex','sacsi_web','explicit_user_authorized_maintenance','unknown')
    or filters->>'identity' not in ('','account_recorded','missing_account','maintenance_without_account') then
    raise exception using errcode='22023',message='invalidAuditWorkbench'; end if;
  begin
    if filters->>'dateFrom'<>'' then
      from_day:=(filters->>'dateFrom')::date;
      if filters->>'dateFrom' !~ '^\d{4}-\d{2}-\d{2}$' or to_char(from_day,'YYYY-MM-DD')<>filters->>'dateFrom' then raise invalid_datetime_format; end if;
    end if;
    if filters->>'dateTo'<>'' then
      to_day:=(filters->>'dateTo')::date;
      if filters->>'dateTo' !~ '^\d{4}-\d{2}-\d{2}$' or to_char(to_day,'YYYY-MM-DD')<>filters->>'dateTo' then raise invalid_datetime_format; end if;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalidAuditWorkbench';
  end;
  if from_day>to_day then raise exception using errcode='22023',message='invalidAuditWorkbench'; end if;

  with raw as materialized (
    select a.id,a.created_at,a.actor_id,a.actor_email,a.actor_role,a.action,a.entity_type,a.entity_id,a.entity_label,
      -- Do not carry historical JSON blobs through materialized list/search joins.
      -- Only the exact selected detail can load before/after/raw metadata.
      case when p_mode='detail' then a.before_data else null end before_data,
      case when p_mode='detail' then a.after_data else null end after_data,
      case when p_mode='detail' then a.metadata
        else public.audit_workbench_list_metadata(a.metadata,a.after_data) end metadata,
      coalesce(a.actor_id::text,nullif(btrim(a.actor_email),''),'unknown') actor_key,
      case when a.metadata->>'channel' in ('external_codex','sacsi_web','explicit_user_authorized_maintenance')
        then a.metadata->>'channel' else 'unknown' end recorded_channel,
      case when a.actor_id is not null or nullif(btrim(a.actor_email),'') is not null then 'account_recorded'
        when a.metadata->>'channel'='explicit_user_authorized_maintenance' then 'maintenance_without_account'
        else 'missing_account' end identity_status
    from public.audit_logs a
    where (p_log_id is null or a.id=p_log_id)
      and (from_day is null or a.created_at>=from_day::timestamp at time zone 'UTC')
      and (to_day is null or a.created_at<(to_day+1)::timestamp at time zone 'UTC')
      and (filters->>'action'='' or a.action=filters->>'action')
      and (filters->>'entityType'='' or a.entity_type=filters->>'entityType')
  ), contextual as materialized (
    select a.*,ap.display_name actor_name,agent.name agent_name,
      coalesce(lc.contract_no,sc.contract_no,plc.contract_no,psc.contract_no) current_contract_no,
      u.unit_no current_unit_no,
      a.metadata safe_metadata
    from raw a
    left join public.user_profiles ap on ap.id=a.actor_id
    left join public.customers agent on agent.id=case when a.metadata->>'booking_agent_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (a.metadata->>'booking_agent_id')::uuid end
    left join public.lease_contracts lc on a.entity_type in ('lease_collection','lease_contract','lease_settlement') and lc.id=a.entity_id
    left join public.sale_contracts sc on a.entity_type='sale_contract' and sc.id=a.entity_id
    left join public.daily_bookings db on a.entity_type='daily_booking' and db.id=a.entity_id
    left join public.payments p on a.entity_type='payment' and p.id=a.entity_id
    left join public.receivables r on a.entity_type='receivable' and r.id=a.entity_id
    left join public.ledger_entries le on a.entity_type='ledger_entry' and le.id=a.entity_id
    left join public.cleaning_tasks ct on a.entity_type='cleaning_task' and ct.id=a.entity_id
    left join public.lease_contracts plc on (p.source_type in ('lease_rent','property_fee') and plc.id=p.source_id)
      or (r.source_type='lease_contract' and plc.id=r.source_id)
    left join public.sale_contracts psc on (p.source_type in ('sale','sale_payment','sale_installment') and psc.id=p.source_id)
      or (r.source_type='sale_contract' and psc.id=r.source_id)
    left join public.units u on u.id=coalesce(lc.unit_id,sc.unit_id,db.unit_id,p.unit_id,r.unit_id,le.unit_id,ct.unit_id,
      case when a.entity_type='unit' then a.entity_id end,
      case when a.metadata->>'unit_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (a.metadata->>'unit_id')::uuid end)
  ), filtered as materialized (
    select * from contextual a
    where (filters->>'actor'='' or a.actor_key=filters->>'actor')
      and (filters->>'channel'='' or a.recorded_channel=filters->>'channel')
      and (filters->>'identity'='' or a.identity_status=filters->>'identity')
      and (filters->>'search'='' or strpos(lower(concat_ws(' ',a.id::text,a.entity_id::text,a.entity_label,
        a.actor_id::text,a.actor_email,a.actor_name,a.current_contract_no,a.current_unit_no,
        a.safe_metadata->>'request_id',a.safe_metadata->>'child_request_id',a.safe_metadata->>'contract_id',
        a.safe_metadata->>'contract_no',a.safe_metadata->>'unit_no',a.safe_metadata->>'room_no',
        a.safe_metadata->'collection_result'->>'requestId',a.safe_metadata->'collection_input'->>'externalReceiptNo')),
        lower(filters->>'search'))>0)
  ), selected as (
    select * from filtered
    where p_mode<>'export' or (select count(*) from filtered)<=100000
    order by created_at desc,id desc
    limit case when p_mode='list' then 30 when p_mode='detail' then 1 else 100001 end
    offset case when p_mode='list' then (page_number-1)*30 else 0 end
  ), projected as (
    select created_at,id,jsonb_build_object('id',id,'created_at',created_at,'actor_id',actor_id,'actor_email',actor_email,
      'actor_role',actor_role,'action',action,'entity_type',entity_type,'entity_id',entity_id,'entity_label',entity_label,
      'resolved_actor_display_name',case when actor_id is not null then actor_name end,'resolved_booking_agent_name',agent_name,
      'before_data',case when p_mode='detail' and before_data is not null then
        case when jsonb_typeof(before_data)='object' then public.audit_workbench_redact(before_data)
          else jsonb_build_object('_recorded_value',public.audit_workbench_redact(before_data)) end else null end,
      'after_data',case when p_mode='detail' and after_data is not null then
        case when jsonb_typeof(after_data)='object' then public.audit_workbench_redact(after_data)
          else jsonb_build_object('_recorded_value',public.audit_workbench_redact(after_data)) end else null end,
      'metadata',(case when p_mode='detail' then
        case when jsonb_typeof(metadata)='object' then public.audit_workbench_redact(metadata-'collection_result'-'collection_input')
          else jsonb_build_object('_recorded_value',public.audit_workbench_redact(metadata)) end else safe_metadata end)
        ||case when nullif(btrim(metadata->>'unit_no'),'') is null and current_unit_no is not null then jsonb_build_object('unit_no',current_unit_no) else '{}'::jsonb end
        ||case when current_contract_no is not null then jsonb_build_object('resolved_contract_no',current_contract_no) else '{}'::jsonb end) doc
    from selected
  ), counts as (
    select count(*) total,count(*) filter(where identity_status='account_recorded') recorded,
      count(*) filter(where identity_status='missing_account') missing_identity,
      count(*) filter(where identity_status='maintenance_without_account') maintenance from filtered
  )
  select case when p_mode='detail' then jsonb_build_object('log',(select doc from projected))
    else jsonb_build_object('rows',coalesce((select jsonb_agg(doc order by created_at desc,id desc) from projected),'[]'::jsonb),
      'total',total,'page',page_number,'pageSize',30,'filters',filters,
      'summary',jsonb_build_object('total',total,'recorded',recorded,'missingIdentity',missing_identity,'maintenance',maintenance),
      'options',case when p_mode='export' then '{}'::jsonb else jsonb_build_object(
        'actions',coalesce((select jsonb_agg(action order by action) from (select distinct action from contextual) x),'[]'::jsonb),
        'entityTypes',coalesce((select jsonb_agg(entity_type order by entity_type) from (select distinct entity_type from contextual) x),'[]'::jsonb),
        'actors',coalesce((select jsonb_agg(jsonb_build_object('key',actor_key,'label',label) order by actor_key)
          from (select actor_key,min(coalesce(nullif(actor_name,''),nullif(btrim(actor_email),''),actor_id::text,'unknown')) label from contextual group by actor_key) x),'[]'::jsonb)) end) end
    into result from counts;
  if p_mode='export' and (result->>'total')::bigint>100000 then
    raise exception using errcode='54000',message='auditWorkbenchExportTooLarge'; end if;
  if p_mode='detail' and result->'log'='null'::jsonb then
    raise exception using errcode='P0002',message='auditWorkbenchNotFound'; end if;
  return result;
end; $$;

revoke all on function public.audit_workbench_redact(jsonb),public.audit_workbench_list_metadata(jsonb,jsonb),
  public.audit_workbench_read_rpc(jsonb,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.audit_workbench_redact(jsonb),public.audit_workbench_list_metadata(jsonb,jsonb),
  public.audit_workbench_read_rpc(jsonb,text,uuid) to authenticated;
