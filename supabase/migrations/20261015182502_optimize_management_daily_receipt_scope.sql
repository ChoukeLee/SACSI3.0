begin;

-- A project summary must not repeat the complete strict receipt classifier for
-- every building. Add one optional internal filter; keep all classification,
-- cross-period reversal checks, table RLS and STABLE snapshot semantics intact.
do $migration$
declare definition text; old_text text; new_text text;
begin
  definition:=replace(pg_get_functiondef('public.daily_receipts_read_rpc(jsonb,integer,boolean)'::regprocedure),chr(13)||chr(10),chr(10));
  old_text:='  building_filter uuid;';
  if strpos(definition,old_text)=0 then raise exception 'receiptProjectDeclarationDrift'; end if;
  definition:=replace(definition,old_text,'  project_filter uuid;'||chr(10)||old_text);
  old_text:='''trendFrom'',''trendTo'',''buildingId'',''paymentId'',''query'',''method'',''kind''';
  if strpos(definition,old_text)=0 then raise exception 'receiptProjectInputDrift'; end if;
  definition:=replace(definition,old_text,'''trendFrom'',''trendTo'',''projectId'',''buildingId'',''paymentId'',''query'',''method'',''kind''');
  old_text:=$old$  if p_input ? 'buildingId' and jsonb_typeof(p_input->'buildingId') not in ('string','null') then$old$;
  new_text:=$new$  if p_input ? 'projectId' and jsonb_typeof(p_input->'projectId') not in ('string','null') then
    raise exception 'invalidDailyReceiptsFilter';
  end if;
  begin project_filter := nullif(nullif(p_input->>'projectId',''),'all')::uuid;
  exception when others then raise exception 'invalidDailyReceiptsFilter'; end;
  if project_filter is not null and not coalesce(public.can_access_project(project_filter),false) then
    raise exception 'dailyReceiptsPermissionDenied' using errcode='42501';
  end if;
$new$||old_text;
  if strpos(definition,old_text)=0 then raise exception 'receiptProjectValidationDrift'; end if;
  definition:=replace(definition,old_text,new_text);
  old_text:='select b.* from public.buildings b where public.can_access_project(b.project_id)';
  if strpos(definition,old_text)=0 then raise exception 'receiptProjectScopeDrift'; end if;
  definition:=replace(definition,old_text,'select b.* from public.buildings b where (project_filter is null or b.project_id=project_filter) and public.can_access_project(b.project_id)');
  execute definition;

  definition:=replace(pg_get_functiondef('public.management_operating_snapshot_rpc(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  old_text:=$old$  for building in select b.id from public.buildings b
    where b.project_id=p_project_id and public.can_access_building(b.id) loop
    daily := public.daily_receipts_read_rpc(daily_input||jsonb_build_object('buildingId',building.id),1,false);
    daily_net := daily_net+(daily->'summary'->>'net')::numeric;
    daily_excluded := daily_excluded+(daily->'summary'->>'excludedCount')::bigint;
    for daily_bucket in select x->>'month' as month_key,(x->>'net')::numeric net,
      (x->>'excludedCount')::bigint excluded,(x->>'count')::bigint receipt_count from jsonb_array_elements(daily->'trend') x loop
      trend := jsonb_set(trend,array[daily_bucket.month_key],jsonb_build_object(
        'net',coalesce((trend->daily_bucket.month_key->>'net')::numeric,0)+daily_bucket.net,
        'excluded',coalesce((trend->daily_bucket.month_key->>'excluded')::bigint,0)+daily_bucket.excluded,
        'count',coalesce((trend->daily_bucket.month_key->>'count')::bigint,0)+daily_bucket.receipt_count));
    end loop;
  end loop;$old$;
  new_text:=$new$  daily := public.daily_receipts_read_rpc(daily_input||jsonb_build_object('projectId',p_project_id),1,false);
  daily_net := (daily->'summary'->>'net')::numeric;
  daily_excluded := (daily->'summary'->>'excludedCount')::bigint;
  for daily_bucket in select x->>'month' as month_key,(x->>'net')::numeric net,
    (x->>'excludedCount')::bigint excluded,(x->>'count')::bigint receipt_count from jsonb_array_elements(daily->'trend') x loop
    trend := jsonb_set(trend,array[daily_bucket.month_key],jsonb_build_object(
      'net',daily_bucket.net,'excluded',daily_bucket.excluded,'count',daily_bucket.receipt_count));
  end loop;$new$;
  if strpos(definition,old_text)=0 then raise exception 'managementDailyProjectLoopDrift'; end if;
  execute replace(definition,old_text,new_text);
end; $migration$;

comment on function public.daily_receipts_read_rpc(jsonb,integer,boolean) is
  'Strict read-only daily XOF receipts under existing RLS. Optional projectId scopes one complete snapshot without changing building/query/detail/export behavior. No monetary rows changed.';
notify pgrst,'reload schema';
commit;
