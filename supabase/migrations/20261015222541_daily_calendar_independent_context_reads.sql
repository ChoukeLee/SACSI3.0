begin;
-- The original calendar RPC remains unchanged for deployed clients. V2 removes
-- receipt-only history, not payment evidence of any actionable/visible booking.
do $migration$
declare
  definition text := replace(pg_catalog.pg_get_functiondef('public.daily_calendar_window_rpc(uuid,date,date)'::regprocedure),chr(13),'');
  old_fragment text;
  new_fragment text;
  patch record;
begin
  for patch in select * from (values
    ('FUNCTION public.daily_calendar_window_rpc(', 'FUNCTION public.daily_calendar_context_rpc('),
    ('unit_ids uuid[]; booking_ids uuid[]; month_booking_ids uuid[]; cleaning_booking_ids uuid[];',
     'unit_ids uuid[]; cleaning_booking_ids uuid[]; customer_result jsonb;'),
    ($old$  select coalesce(array_agg(b.id),'{}'::uuid[]) into booking_ids from public.daily_bookings b where b.unit_id=any(unit_ids);
  select coalesce(array_agg(p.source_id) filter(where p.source_id is not null),'{}'::uuid[]) into month_booking_ids
    from public.payments p where p.source_type='daily_booking' and p.payment_date>=month_start and p.payment_date<=today
      and (p.unit_id=any(unit_ids) or p.source_id=any(booking_ids));
$old$, ''),
    ('or b.id=any(month_booking_ids) or b.id=any(cleaning_booking_ids)',
     'or b.id=any(cleaning_booking_ids)'),
    ($old$p.source_id=any(selected_ids) or (p.payment_date>=month_start and p.payment_date<=today
        and (p.unit_id=any(unit_ids) or p.source_id=any(booking_ids)))$old$,
     'p.source_id=any(selected_ids)'),
    ($old$  return jsonb_build_object('buildingId',p_building_id$old$,
     $new$  -- Only identities referenced by this window; candidate choices are read on demand.
  with customer_ids as materialized (
    select distinct identity_id from jsonb_array_elements(booking_result->'rows') b
    cross join lateral unnest(array[(b->>'customer_id')::uuid,(b->>'booking_agent_id')::uuid,(b->>'guest_customer_id')::uuid]) identity_id
    where identity_id is not null
  ), selected_customers as materialized (
    select c.id,c.name,c.phone,c.is_blacklisted from public.customers c where c.id in(select identity_id from customer_ids)
  ), active_leases as materialized (
    select distinct lc.customer_id from public.lease_contracts lc where lc.status='active' and lc.customer_id in(select id from selected_customers)
  ), active_sales as materialized (
    select distinct sc.customer_id from public.sale_contracts sc where sc.status='active' and sc.customer_id in(select id from selected_customers)
  ) select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object(
    'has_active_lease_contract',c.id in(select customer_id from active_leases),
    'has_active_sale_contract',c.id in(select customer_id from active_sales)) order by c.name,c.id),'[]'::jsonb)
    into customer_result from selected_customers c;
  return jsonb_build_object('buildingId',p_building_id$new$),
    ($old$'dailyUnits',daily_unit_result,'unitLookupUnits',unit_result,'buildingCounts',counts);$old$,
     $new$'dailyUnits',daily_unit_result,'unitLookupUnits',unit_result,'buildingCounts',counts,
    'customers',customer_result,'customerCount',jsonb_array_length(customer_result));$new$)
  ) patches(old_value,new_value) loop
    old_fragment:=patch.old_value; new_fragment:=patch.new_value;
    if position(old_fragment in definition)=0 or
      (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
      raise exception 'dailyCalendarContextDefinitionDrift';
    end if;
    definition:=replace(definition,old_fragment,new_fragment);
  end loop;
  execute definition;
end $migration$;

-- One complete strict cash aggregate, no all-month detail download. This calls
-- the existing classifier once, so refunds/reversals/exclusions cannot diverge.
create function public.daily_calendar_cash_summary_rpc(p_building_id uuid)
returns jsonb language plpgsql stable security invoker
set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare today date:=current_date; month_start date:=date_trunc('month',current_date)::date; result jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','boss','finance'),false) then
    raise exception 'calendarPermissionDenied' using errcode='42501'; end if;
  if p_building_id is null or not coalesce(public.can_access_building(p_building_id),false) or not exists(
    select 1 from public.buildings b where b.id=p_building_id and b.is_active and b.code in ('SACSI11','SACSI5')
  ) then raise exception 'calendarPermissionDenied' using errcode='42501'; end if;
  result:=public.daily_receipts_read_rpc(jsonb_build_object(
    'dateFrom',month_start,'dateTo',today,'previousFrom',month_start,'previousTo',today,
    'yearFrom',month_start,'yearTo',today,'trendFrom',month_start,'trendTo',today,
    'buildingId',p_building_id,'query','','method','all','kind','all'),1,false);
  return jsonb_build_object('buildingId',p_building_id,'today',today,'month',to_char(today,'YYYY-MM'),
    'cash',result->'summary','generatedAt',result->'generatedAt');
end; $$;

-- Names are a query filter, never authority. Every customer and active-contract
-- marker is read under the caller's existing RLS. API supplies existing agents.
create function public.daily_customer_candidates_rpc(p_building_id uuid,p_query text default '',p_page integer default 1,p_names text[] default null)
returns jsonb language plpgsql stable security invoker
set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare result jsonb; search_text text:=btrim(coalesce(p_query,''));
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','boss','finance','front_desk','rental_sales'),false) then
    raise exception 'calendarPermissionDenied' using errcode='42501'; end if;
  if length(search_text)>80 or p_page is null or p_page<1 or p_page>2000 or cardinality(p_names)>32 or
    exists(select 1 from unnest(p_names) n where n is null or length(n)>64) then
    raise exception 'invalidDailyCustomerQuery' using errcode='22023'; end if;
  if p_building_id is null or not coalesce(public.can_access_building(p_building_id),false) or not exists(
    select 1 from public.buildings b where b.id=p_building_id and b.is_active and b.code in ('SACSI11','SACSI5')
  ) then raise exception 'calendarPermissionDenied' using errcode='42501'; end if;
  with candidates as materialized (
    select c.id,c.name,c.phone,c.is_blacklisted from public.customers c
    where (p_names is null or btrim(c.name)=any(p_names)) and
      (search_text='' or position(lower(search_text) in lower(c.name||' '||coalesce(c.phone,'')))>0)
    order by c.name,c.id offset (p_page-1)*50 limit 51
  ), selected as materialized (
    select * from candidates order by name,id limit 50
  ), active_leases as materialized (
    select distinct lc.customer_id from public.lease_contracts lc where lc.status='active' and lc.customer_id in(select id from selected)
  ), active_sales as materialized (
    select distinct sc.customer_id from public.sale_contracts sc where sc.status='active' and sc.customer_id in(select id from selected)
  ) select jsonb_build_object('buildingId',p_building_id,'query',search_text,'page',p_page,
    'hasMore',(select count(*) from candidates)>50,
    'rows',coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object(
      'has_active_lease_contract',c.id in(select customer_id from active_leases),
      'has_active_sale_contract',c.id in(select customer_id from active_sales)) order by c.name,c.id),'[]'::jsonb))
    into result from selected c;
  return result;
end; $$;

revoke all on function public.daily_calendar_context_rpc(uuid,date,date),public.daily_calendar_cash_summary_rpc(uuid),public.daily_customer_candidates_rpc(uuid,text,integer,text[]) from public,anon,service_role;
grant execute on function public.daily_calendar_context_rpc(uuid,date,date),public.daily_calendar_cash_summary_rpc(uuid),public.daily_customer_candidates_rpc(uuid,text,integer,text[]) to authenticated;
notify pgrst,'reload schema';
commit;
