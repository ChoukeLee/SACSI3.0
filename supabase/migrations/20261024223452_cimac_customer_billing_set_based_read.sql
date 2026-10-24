begin;

-- Advisor FK coverage for the new private tables.
create index cimac_billing_requests_customer on private.cimac_billing_requests(customer_id);
create index cimac_fee_terms_recorder on private.cimac_fee_terms(recorded_by);
create index cimac_meter_readings_recorder on private.cimac_meter_readings(recorded_by);
-- Reverse customer association and exact payment/ledger joins, rather than
-- rescanning the entire asset inventory for every customer in the directory.
create index cimac_billing_lease_customer_unit on public.lease_contracts(customer_id,unit_id);
create index cimac_billing_sale_customer_unit on public.sale_contracts(customer_id,unit_id);
create index cimac_billing_payment_customer_unit on public.payments(customer_id,unit_id);
create index cimac_billing_ledger_payment_unit on public.ledger_entries(payment_id,unit_id,building_id);

create or replace function private.cimac_billing_customer_units(p_customer uuid,p_project uuid) returns setof uuid
language sql stable set search_path='' as $$
  with links as materialized (
    select c.unit_id,null::uuid expected_building from public.lease_contracts c where c.customer_id=p_customer
    union select c.unit_id,null::uuid from public.sale_contracts c where c.customer_id=p_customer
    union select r.unit_id,r.building_id from public.receivables r where r.customer_id=p_customer and r.unit_id is not null
    union select p.unit_id,null::uuid from public.payments p where p.customer_id=p_customer and p.unit_id is not null
    union select l.unit_id,l.building_id from public.payments p join public.ledger_entries l on l.payment_id=p.id
      where p.customer_id=p_customer and l.unit_id is not null
  ), scoped as materialized (
    select distinct u.id from links link join public.units u on u.id=link.unit_id join public.buildings b on b.id=u.building_id
    where b.project_id=p_project and (link.expected_building is null or link.expected_building=b.id)
  ) select id from scoped where public.can_access_unit(id);
$$;

-- Keep the published response, scope guards, balances, history completeness
-- checks and all selected-customer detail verbatim. Replace only the directory
-- selection's per-customer nested helper calls with one scoped association set.
do $read$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.cimac_customer_account(uuid,text,integer)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='  receivable_ids uuid[]; payment_ids uuid[]; row_count bigint; result jsonb;';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingReadOptimizationDrift'; end if;
  definition:=replace(definition,anchor,anchor||E'\n  authorized_buildings uuid[]; authorized_units uuid[];');
  anchor:=$old$  select coalesce(array_agg(c.id order by c.name,c.id),'{}'::uuid[]) into candidates from public.customers c
    where private.cimac_billing_customer_exists(c.id,project) and
      (nullif(btrim(p_search),'') is null or position(lower(btrim(p_search)) in lower(c.name||' '||coalesce(c.phone,'')))>0
        or exists(select 1 from public.units u where u.id in(select private.cimac_billing_customer_units(c.id,project))
          and position(lower(btrim(p_search)) in lower(u.unit_no||' '||u.code))>0)
        or exists(select 1 from public.lease_contracts contract join public.units u on u.id=contract.unit_id
          join public.buildings b on b.id=u.building_id where contract.customer_id=c.id and b.project_id=project
            and public.can_access_unit(u.id) and position(lower(btrim(p_search)) in lower(contract.contract_no))>0)
        or exists(select 1 from public.sale_contracts contract join public.units u on u.id=contract.unit_id
          join public.buildings b on b.id=u.building_id where contract.customer_id=c.id and b.project_id=project
            and public.can_access_unit(u.id) and position(lower(btrim(p_search)) in lower(contract.contract_no))>0));$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingReadOptimizationDrift'; end if;
  definition:=replace(definition,anchor,$new$  select coalesce(array_agg(b.id),'{}'::uuid[]) into authorized_buildings from public.buildings b
    where b.project_id=project and public.can_access_building(b.id);
  select coalesce(array_agg(u.id),'{}'::uuid[]) into authorized_units from public.units u
    where u.building_id=any(authorized_buildings) and public.can_access_unit(u.id);
  with unit_links as materialized (
    select l.customer_id,l.unit_id from public.lease_contracts l where l.unit_id=any(authorized_units)
    union select s.customer_id,s.unit_id from public.sale_contracts s where s.unit_id=any(authorized_units)
    union select r.customer_id,r.unit_id from public.receivables r join public.units u on u.id=r.unit_id
      where r.unit_id=any(authorized_units) and (r.building_id is null or r.building_id=u.building_id)
    union select p.customer_id,p.unit_id from public.payments p where p.unit_id=any(authorized_units)
    union select p.customer_id,l.unit_id from public.payments p join public.ledger_entries l on l.payment_id=p.id
      join public.units u on u.id=l.unit_id where l.unit_id=any(authorized_units) and (l.building_id is null or l.building_id=u.building_id)
  ), eligible as materialized (
    select customer_id from unit_links where customer_id is not null
    union select r.customer_id from public.receivables r where r.unit_id is null and r.building_id=any(authorized_buildings) and r.customer_id is not null
    union select p.customer_id from public.payments p join public.ledger_entries l on l.payment_id=p.id
      where p.unit_id is null and l.building_id=any(authorized_buildings) and p.customer_id is not null
  ) select coalesce(array_agg(c.id order by c.name,c.id),'{}'::uuid[]) into candidates from public.customers c
    where c.id in(select customer_id from eligible) and
      (nullif(btrim(p_search),'') is null or position(lower(btrim(p_search)) in lower(c.name||' '||coalesce(c.phone,'')))>0
        or exists(select 1 from unit_links link join public.units u on u.id=link.unit_id where link.customer_id=c.id
          and position(lower(btrim(p_search)) in lower(u.unit_no||' '||u.code))>0)
        or exists(select 1 from public.lease_contracts contract where contract.customer_id=c.id and contract.unit_id=any(authorized_units)
          and position(lower(btrim(p_search)) in lower(contract.contract_no))>0)
        or exists(select 1 from public.sale_contracts contract where contract.customer_id=c.id and contract.unit_id=any(authorized_units)
          and position(lower(btrim(p_search)) in lower(contract.contract_no))>0));$new$);
  execute definition;
end; $read$;
-- Parameters choose a narrow project/customer page. Avoid a generic cached
-- plan reintroducing whole-table scans after repeated requests.
alter function private.cimac_customer_account(uuid,text,integer) set plan_cache_mode='force_custom_plan';

-- Retain contradictory historical rows in the account's read-only detail, but
-- never present a unit/building mismatch as a valid managed balance. A genuine
-- building-only obligation (unit_id null) remains valid and visible.
do $summary$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.cimac_billing_customer_summary(uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='      and (r.building_id is null or exists(select 1 from public.buildings b where b.id=r.building_id and b.project_id=p_project))';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingSummaryOptimizationDrift'; end if;
  definition:=replace(definition,anchor,anchor||E'\n      and (r.unit_id is null or r.building_id is null or exists(select 1 from public.units actual_unit where actual_unit.id=r.unit_id and actual_unit.building_id=r.building_id))');
  execute definition;
end; $summary$;
notify pgrst,'reload schema';
commit;
