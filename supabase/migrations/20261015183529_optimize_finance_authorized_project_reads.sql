begin;

-- Keep RLS and the public finance result contract unchanged. Project joins must
-- not repeatedly rescan an RLS-protected ledger for every visible building.
-- A STABLE invoker shares one calling-statement snapshot across the authorized
-- scope reads and the detail/summary/export query; it never writes business data.
-- Scope arrays are PL/pgSQL parameters, not SubPlans evaluated after every RLS
-- check. A call-local custom plan retains cheap scope rejection before those
-- checks even after PostgreSQL would normally switch to a generic cached plan.
create or replace function public.finance_read_rpc(p_kind text,p_filters jsonb default '{}',
  p_page integer default 1,p_export boolean default false)
returns jsonb language plpgsql stable security invoker
set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare
  result jsonb;
  requested_project uuid;
  scope_buildings uuid[];
  scope_units uuid[];
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','finance','boss'),false) then
    raise exception 'financePermissionDenied' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('ledger','receivables') or p_page is null or p_page<1 or p_page>2000000 or p_export is null
    or p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'invalidFinanceFilter'; end if;
  requested_project := nullif(p_filters->>'projectId','')::uuid;
  if requested_project is not null and not coalesce(public.can_access_project(requested_project),false) then
    raise exception 'financePermissionDenied' using errcode='42501'; end if;
  if nullif(p_filters->>'dateFrom','')::date> nullif(p_filters->>'dateTo','')::date then
    raise exception 'invalidFinanceDateRange'; end if;

  if requested_project is not null then
    select coalesce(array_agg(b.id),'{}'::uuid[]) into scope_buildings
    from public.buildings b where b.project_id=requested_project;
    select coalesce(array_agg(u.id),'{}'::uuid[]) into scope_units
    from public.units u where u.building_id=any(scope_buildings);
  end if;

  with visible_units as materialized (
    -- An explicit building wins over the unit's building for scope, but a
    -- separately authorized unit still supplies its original label/search text.
    select u.id,u.unit_no,u.building_id from public.units u
  ), visible_buildings as materialized (
    select b.id,b.project_id,b.display_name from public.buildings b
    where requested_project is null or b.project_id=requested_project
  ), source as materialized (
    select l.id,l.entry_date dt,l.building_id,l.unit_id,to_jsonb(l) doc
    from public.ledger_entries l where p_kind='ledger'
      and (requested_project is null or l.building_id=any(scope_buildings)
        or (l.building_id is null and l.unit_id=any(scope_units)))
    union all
    select r.id,r.due_date,r.building_id,r.unit_id,to_jsonb(r)
    from public.receivables r where p_kind='receivables'
      and (requested_project is null or r.building_id=any(scope_buildings)
        or (r.building_id is null and r.unit_id=any(scope_units)))
  ), filtered as materialized (
    select s.id,s.dt,s.doc||jsonb_build_object('unit_label',u.unit_no,
      'building_label',b.display_name) doc from source s
    left join visible_units u on u.id=s.unit_id
    left join visible_buildings b on b.id=coalesce(s.building_id,u.building_id)
    where (requested_project is null or b.project_id=requested_project)
    and (nullif(p_filters->>'dateFrom','') is null or s.dt>=(p_filters->>'dateFrom')::date)
    and (nullif(p_filters->>'dateTo','') is null or s.dt<=(p_filters->>'dateTo')::date)
    and (nullif(p_filters->>'buildingId','') is null or coalesce(s.building_id,u.building_id)=(p_filters->>'buildingId')::uuid)
    and (nullif(p_filters->>'direction','') is null or s.doc->>'direction'=p_filters->>'direction')
    and (nullif(p_filters->>'category','') is null or s.doc->>'category'=p_filters->>'category')
    and (p_kind<>'receivables' or coalesce(p_filters->>'outstandingOnly','false')<>'true'
      or (s.doc->>'status'<>'cancelled' and (s.doc->>'amount_xof')::numeric>(s.doc->>'paid_amount_xof')::numeric))
    and (nullif(p_filters->>'status','') is null or s.doc->>'status'=p_filters->>'status')
    and (p_kind<>'receivables' or coalesce(nullif(p_filters->>'management',''),'managed')='all'
      or s.doc->>'management_status'=coalesce(nullif(p_filters->>'management',''),'managed'))
    and (nullif(p_filters->>'search','') is null or
      position(lower(p_filters->>'search') in lower(coalesce(s.doc->>'description',s.doc->>'title','')||' '||coalesce(u.unit_no,'')))>0)
  ), totals as (
    select count(*) n,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='income'),0) income,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='expense'),0) expense,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='liability_in'),0) liability_in,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='liability_out'),0) liability_out,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) receivable,
      coalesce(sum((doc->>'paid_amount_xof')::numeric) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) paid,
      coalesce(sum(greatest(0,(doc->>'amount_xof')::numeric-(doc->>'paid_amount_xof')::numeric)) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) outstanding,
      coalesce(sum(greatest(0,(doc->>'amount_xof')::numeric-(doc->>'paid_amount_xof')::numeric)) filter(where doc->>'status' not in ('cancelled','paid') and doc->>'management_status'='managed' and dt<current_date),0) overdue
    from filtered
  ), detail as (
    select doc,dt,id from filtered order by dt desc,id
    limit case when p_export then 100001 else 50 end
    offset case when p_export then 0 else (p_page-1)*50 end
  ) select jsonb_build_object('kind',p_kind,'page',p_page,'pageSize',50,
    'total',n,'summary',to_jsonb(totals)-'n',
    'rows',coalesce((select jsonb_agg(doc order by dt desc,id) from detail),'[]'::jsonb))
  into result from totals;
  if p_export and (result->>'total')::bigint>100000 then raise exception 'exportTooLarge'; end if;
  return result;
end; $$;
revoke all on function public.finance_read_rpc(text,jsonb,integer,boolean) from public,anon;
grant execute on function public.finance_read_rpc(text,jsonb,integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
