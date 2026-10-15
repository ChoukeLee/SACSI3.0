begin;
set local search_path='';

-- Preserve the published finding definitions and invoker RLS. Materialize each
-- authorized source once instead of repeating role/project checks inside joins.
-- No business record, repair action, rule, finding identity or ACL is changed.
do $migration$
declare definition text; item record; occurrences integer;
begin
  definition:=replace(pg_get_viewdef('public.system_data_quality_findings'::regclass,true),chr(13)||chr(10),chr(10));
  for item in select * from (values
    ('public.units ','quality_units ',5),
    ('public.buildings ','quality_buildings ',5),
    ('public.lease_contracts ','quality_leases ',1),
    ('public.sale_contracts ','quality_sales ',2),
    ('public.receivables ','quality_receivables ',4),
    ('public.payments ','quality_payments ',1),
    ('public.ledger_entries ','quality_ledger ',1)
  ) patches(anchor,body,expected) loop
    occurrences:=(length(definition)-length(replace(definition,item.anchor,'')))/length(item.anchor);
    if occurrences<>item.expected then raise exception 'qualityReadFenceMigrationDrift'; end if;
    definition:=replace(definition,item.anchor,item.body);
  end loop;
  if strpos(definition,'WITH unit_truth AS (')=0 then raise exception 'qualityReadTruthMigrationDrift'; end if;
  definition:=replace(definition,'WITH unit_truth AS (',$scope$WITH quality_units AS MATERIALIZED (
    select u.* from public.units u
  ), quality_buildings AS MATERIALIZED (
    select b.* from public.buildings b
  ), quality_leases AS MATERIALIZED (
    select l.* from public.lease_contracts l where l.status='active'
  ), quality_sales AS MATERIALIZED (
    select s.* from public.sale_contracts s where s.status='active'
  ), quality_receivables AS MATERIALIZED (
    select r.* from public.receivables r where r.status<>'cancelled'
  ), quality_payments AS MATERIALIZED (
    select p.* from public.payments p
  ), quality_ledger AS MATERIALIZED (
    select l.* from public.ledger_entries l where l.payment_id is not null
  ), unit_truth AS ($scope$);
  execute 'create or replace view public.system_data_quality_findings with(security_invoker=true) as '||definition;
end; $migration$;

-- A scalar JSON result avoids the Data API row cap and a second COUNT scan.
-- Each source is a complete STABLE snapshot; the application bounds concurrency
-- so the full legacy scan does not overload the existing RLS checks.
create function public.database_quality_read_rpc(p_source text default 'findings')
returns jsonb language plpgsql stable security invoker set search_path='' as $body$
declare result jsonb; source_sql text; order_sql text; filter_sql text:='';
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','boss','finance','front_desk','rental_sales'),false) then
    raise exception 'qualityPermissionDenied' using errcode='42501';
  end if;
  case p_source
    when 'findings' then source_sql:='public.system_data_quality_findings'; order_sql:='s.severity,s.building_code,s.unit_no,s.issue_key';
    when 'units' then source_sql:='public.units'; order_sql:='s.unit_no,s.id';
    when 'customers' then source_sql:='public.customers'; order_sql:='s.name,s.id';
    when 'dailyBookings' then source_sql:='public.daily_bookings'; order_sql:='s.check_in desc,s.id';
    when 'leaseContracts' then source_sql:='public.lease_contracts'; order_sql:='s.start_date desc,s.id';
    when 'saleContracts' then source_sql:='public.sale_contracts'; order_sql:='s.signed_date desc,s.id';
    when 'saleSchedules' then source_sql:='public.sale_payment_schedule'; order_sql:='s.installment_no,s.id';
    when 'receivables' then source_sql:='public.receivables'; order_sql:='s.due_date desc,s.id'; filter_sql:='where s.status<>''cancelled''';
    when 'payments' then source_sql:='public.payments'; order_sql:='s.payment_date desc,s.id';
    when 'cleaningTasks' then source_sql:='public.cleaning_tasks'; order_sql:='s.id';
    when 'ledgerEntries' then source_sql:='public.ledger_entries'; order_sql:='s.entry_date desc,s.id'; filter_sql:='where s.payment_id is not null';
    when 'auditLogs' then source_sql:='public.audit_logs'; order_sql:='s.created_at desc,s.id'; filter_sql:='where s.entity_type in (''daily_booking'',''unit'')';
    else raise exception 'invalidQualitySource';
  end case;
  -- All SQL fragments above are fixed allowlisted literals, never client SQL.
  execute format('select jsonb_build_object(''rows'',coalesce(jsonb_agg(to_jsonb(s) order by %s),''[]''::jsonb),''total'',count(*)) from %s s %s',
    order_sql,source_sql,filter_sql) into result;
  return result;
end; $body$;
revoke all on function public.database_quality_read_rpc(text) from public,anon,service_role;
grant execute on function public.database_quality_read_rpc(text) to authenticated;
comment on function public.database_quality_read_rpc(text) is
  'Complete per-source authorized quality reads without count/page rescans. Finding rules, identities and existing project RLS are unchanged.';
notify pgrst,'reload schema';
commit;
