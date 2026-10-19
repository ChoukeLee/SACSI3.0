begin;

-- Read-only directory. Every source table is still evaluated as the caller,
-- including historical relationships; names never establish customer identity.
create function public.customer_directory_read_rpc(
  p_input jsonb,
  p_mode text default 'list',
  p_customer_id uuid default null,
  p_relation_page integer default 1
) returns jsonb language plpgsql stable security invoker
set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare
  v_project uuid; v_building uuid; v_unassigned boolean;
  v_search text; v_filter text; v_page integer; v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','boss','finance','rental_sales'),false) then
    raise exception 'CustomerDirectoryDenied' using errcode='42501';
  end if;
  if p_input is null or jsonb_typeof(p_input)<>'object'
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('projectId','buildingId','search','filter','page'))
    or p_mode is null or p_mode not in ('list','detail')
    or (p_mode='detail' and p_customer_id is null)
    or (p_mode='list' and p_customer_id is not null)
    or p_relation_page is null or p_relation_page<1 or p_relation_page>100000 then
    raise exception 'CustomerDirectoryInvalid' using errcode='22023';
  end if;
  v_unassigned:=coalesce(p_input->>'projectId','')='__unassigned__';
  v_project:=case when v_unassigned then null else nullif(p_input->>'projectId','')::uuid end;
  v_building:=nullif(p_input->>'buildingId','')::uuid;
  v_search:=coalesce(p_input->>'search',''); v_filter:=coalesce(p_input->>'filter','all');
  v_page:=coalesce(p_input->>'page','1')::integer;
  if length(v_search)>200 or v_filter not in ('all','contract','guest','contact','unknown','blacklisted')
    or v_page<1 or v_page>100000 or (v_unassigned and v_building is not null) then
    raise exception 'CustomerDirectoryInvalid' using errcode='22023';
  end if;
  if v_project is not null and not exists(select 1 from public.projects where id=v_project) then
    raise exception 'CustomerDirectoryDenied' using errcode='42501';
  end if;
  if v_building is not null and not exists(select 1 from public.buildings where id=v_building and (v_project is null or project_id=v_project)) then
    raise exception 'CustomerDirectoryDenied' using errcode='42501';
  end if;
  with
  b as materialized (
    select b.id,b.code,b.display_name,p.id project_id,
      case when p.id is null then null else jsonb_build_object('id',p.id,'code',p.code,'label',p.display_name) end project
    from public.buildings b left join public.projects p on p.id=b.project_id
  ),
  u as materialized (select u.id,u.unit_no,u.building_id,b.display_name building_name,b.project_id from public.units u join b on b.id=u.building_id),
  raw_rel as materialized (
    select c.customer_id,c.id,'lease'::text role,c.unit_id,c.contract_no code,c.start_date start_date,
      coalesce(c.actual_end_date,case when c.expected_end_confirmed is distinct from false and c.expected_end_date<date '2099-01-01' then c.expected_end_date end) end_date,
      case when c.actual_end_date is not null then 'actual' when c.expected_end_confirmed is distinct from false and c.expected_end_date<date '2099-01-01' then 'expected' else null end end_date_kind,
      c.status::text status from public.lease_contracts c
    union all
    select c.customer_id,c.id,'sale',c.unit_id,c.contract_no,c.signed_date,null::date,null::text,c.status::text from public.sale_contracts c
    union all
    select c.guest_customer_id,c.id,'daily_guest',c.unit_id,null::text,c.check_in,coalesce(c.actual_check_out,case when c.checkout_mode='fixed' then c.check_out end),
      case when c.actual_check_out is not null then 'actual' when c.checkout_mode='fixed' and c.check_out is not null then 'expected' else null end,c.status::text
      from public.daily_bookings c where c.guest_customer_id is not null
    union all
    select c.booking_agent_id,c.id,'daily_agent',c.unit_id,null::text,c.check_in,coalesce(c.actual_check_out,case when c.checkout_mode='fixed' then c.check_out end),
      case when c.actual_check_out is not null then 'actual' when c.checkout_mode='fixed' and c.check_out is not null then 'expected' else null end,c.status::text
      from public.daily_bookings c where c.booking_agent_id is not null
    union all
    select c.customer_id,c.id,'daily_unknown',c.unit_id,null::text,c.check_in,coalesce(c.actual_check_out,case when c.checkout_mode='fixed' then c.check_out end),
      case when c.actual_check_out is not null then 'actual' when c.checkout_mode='fixed' and c.check_out is not null then 'expected' else null end,c.status::text
      from public.daily_bookings c where c.customer_id is not null
        and c.customer_id is distinct from c.guest_customer_id and c.customer_id is distinct from c.booking_agent_id
  ),
  rel as materialized (
    select r.*,u.unit_no,u.building_id,u.building_name,u.project_id from raw_rel r join u on u.id=r.unit_id
  ),
  scoped_rel as materialized (select * from rel where (v_project is null or project_id=v_project) and (v_building is null or building_id=v_building)),
  scoped as materialized (
    select c.* from public.customers c where
      (v_unassigned and not exists(select 1 from rel r where r.customer_id=c.id and r.project_id is not null))
      or (not v_unassigned and ((v_project is null and v_building is null) or exists(select 1 from scoped_rel r where r.customer_id=c.id)))
  ),
  relation_metrics as materialized (
    select r.customer_id,array_agg(distinct r.role order by r.role) roles,
      to_jsonb((array_agg(distinct (r.building_name||' · '||r.unit_no) order by (r.building_name||' · '||r.unit_no)))[1:3]) rooms,
      count(distinct r.unit_id) room_count,count(*) relationship_count,max(r.start_date) last_business_date,
      string_agg(distinct r.unit_no,' ') searchable_rooms
    from scoped_rel r group by r.customer_id
  ),
  enriched as materialized (
    select c.id,c.name,c.phone,c.is_blacklisted,
      nullif(btrim(c.encrypted_document_no),'') is not null has_document,
      coalesce(m.roles,'{}'::text[]) roles,coalesce(m.rooms,'[]'::jsonb) rooms,
      coalesce(m.room_count,0) room_count,coalesce(m.relationship_count,0) relationship_count,m.last_business_date,
      lower(regexp_replace(normalize(concat_ws(' ',c.name,c.phone,m.searchable_rooms),NFD),U&'[\0300-\036f]','','g')) searchable
    from scoped c left join relation_metrics m on m.customer_id=c.id
  ),
  filtered as materialized (select * from enriched e where
    (v_filter='all' or (v_filter='contract' and roles&&array['lease','sale']) or (v_filter='guest' and 'daily_guest'=any(roles))
      or (v_filter='contact' and 'daily_agent'=any(roles)) or (v_filter='unknown' and 'daily_unknown'=any(roles)) or (v_filter='blacklisted' and is_blacklisted))
    and not exists(select 1 from regexp_split_to_table(lower(regexp_replace(normalize(btrim(v_search),NFD),U&'[\0300-\036f]','','g')),'\s+') word where word<>'' and strpos(e.searchable,word)=0)
  ),
  ordered as materialized (select *,row_number() over(order by name collate public.contract_workspace_order,id) ordinal from filtered),
  selected as materialized (
    select * from ordered where p_mode='list' and ordinal between (v_page-1)*40+1 and v_page*40
    union all select e.*,0::bigint from enriched e where p_mode='detail' and e.id=p_customer_id
  ),
  detail_rel as materialized (
    select r.*,row_number() over(order by r.start_date desc nulls last,r.role,r.id) ordinal from scoped_rel r where p_mode='detail' and r.customer_id=p_customer_id
  )
  select jsonb_build_object(
    'mode',p_mode,'query',p_input,'pageSize',40,'total',(select count(*) from filtered),'scopeCount',(select count(*) from scoped),
    'buildings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'code',b.code,'label',b.display_name,'project',b.project) order by b.code,b.id) from b),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone,'isBlacklisted',s.is_blacklisted,'hasDocument',s.has_document,
      'roles',s.roles,'rooms',s.rooms,'roomCount',s.room_count,'relationshipCount',s.relationship_count,'lastBusinessDate',s.last_business_date) order by s.ordinal) from selected s),'[]'::jsonb),
    'profile',(select (to_jsonb(c)-'encrypted_document_no')||jsonb_build_object('hasDocument',nullif(btrim(c.encrypted_document_no),'') is not null) from scoped c where p_mode='detail' and c.id=p_customer_id),
    'relationships',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'role',r.role,'unitId',r.unit_id,'unitNo',r.unit_no,
      'buildingId',r.building_id,'buildingLabel',r.building_name,'projectId',r.project_id,'code',r.code,'startDate',r.start_date,'endDate',r.end_date,'endDateKind',r.end_date_kind,'status',r.status) order by r.ordinal)
      from detail_rel r where ordinal between (p_relation_page-1)*25+1 and p_relation_page*25),'[]'::jsonb),
    'relationshipPage',p_relation_page,'relationshipTotal',(select count(*) from detail_rel)
  ) into v_result;
  if p_mode='detail' and jsonb_array_length(v_result->'rows')<>1 then raise exception 'CustomerDirectoryNotFound' using errcode='P0002';end if;
  return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'CustomerDirectoryInvalid' using errcode='22023';
end;$$;
revoke all on function public.customer_directory_read_rpc(jsonb,text,uuid,integer) from public,anon,service_role;
grant execute on function public.customer_directory_read_rpc(jsonb,text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
