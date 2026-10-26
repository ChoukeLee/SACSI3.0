begin;

-- Read models distinguish an allocated future lease from present occupancy.
-- Keep legacy status and every business conflict/readiness guard unchanged.
-- CREATE OR REPLACE preserves the view identity, owner and existing ACLs.
create or replace view public.unit_operational_position with(security_invoker=true) as
select u.id,u.building_id,u.unit_no,u.status legacy_status,
  case when u.status='sold' or exists(select 1 from public.sale_contracts s where s.unit_id=u.id and s.status='active')
    then 'sold' else 'unspecified' end ownership,
  u.operational_condition,u.construction_status,u.occupancy_verified,
  exists(select 1 from public.unit_business_flags f where f.unit_id=u.id and f.business_type='daily_rental' and f.is_enabled) daily_enabled,
  exists(select 1 from public.unit_business_flags f where f.unit_id=u.id and f.business_type='long_lease' and f.is_enabled) lease_enabled,
  exists(select 1 from public.daily_bookings b where b.unit_id=u.id and b.status='checked_in') daily_occupied,
  exists(select 1 from public.lease_contracts l where l.unit_id=u.id and l.status='active'
    and l.start_date<=(statement_timestamp() at time zone 'Africa/Abidjan')::date) lease_occupied,
  exists(select 1 from public.cleaning_tasks c where c.unit_id=u.id and not c.is_completed) cleaning_pending,
  u.updated_at,
  exists(select 1 from public.lease_contracts l where l.unit_id=u.id and l.status='active'
    and l.start_date>(statement_timestamp() at time zone 'Africa/Abidjan')::date) lease_pending,
  (select min(l.start_date) from public.lease_contracts l where l.unit_id=u.id and l.status='active'
    and l.start_date>(statement_timestamp() at time zone 'Africa/Abidjan')::date) lease_start_date
from public.units u;

-- Keep all active contracts in the financial source fence: future deposits,
-- future receivables, and native-currency buckets must not disappear. Only
-- present operating counts and renewal attention use the started subset.
do $migration$
declare definition text; replacement record;
begin
  definition:=replace(pg_get_functiondef('public.management_operating_snapshot_rpc(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  for replacement in select * from (values
    ($old$    where l.status='active'
  ), native_groups as ($old$,
     $new$    where l.status='active'
  ), current_leases as materialized (
    select * from leases where start_date<=today
  ), native_groups as ($new$),
    ('select * from leases where expected_end_confirmed and expected_end_date',
     'select * from current_leases where expected_end_confirmed and expected_end_date'),
    ($old$'leaseCount',(select count(*) from leases),'renewalCount'$old$,
     $new$'leaseCount',(select count(*) from current_leases),
    'pendingLeaseCount',(select count(*) from leases where start_date>today),'renewalCount'$new$)
  ) patches(anchor,body) loop
    if (length(definition)-length(replace(definition,replacement.anchor,'')))/length(replacement.anchor)<>1 then
      raise exception 'futureLeaseOperatingSnapshotDrift';
    end if;
    definition:=replace(definition,replacement.anchor,replacement.body);
  end loop;
  execute definition;
end; $migration$;

-- Contract rows retain their persisted status and all future financial items.
-- Current / all lists still include upcoming contracts; only the active filter
-- and operating rent/count statistics distinguish contracts yet to start.
do $migration$
declare definition text; replacement record;
begin
  definition:=replace(pg_get_functiondef('public.contract_workspace_read_rpc(text,jsonb,text,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  for replacement in select * from (values
    (' v_page integer; v_locale text; v_result jsonb; v_uid uuid := auth.uid();',
     ' v_page integer; v_locale text; v_result jsonb; v_uid uuid := auth.uid();
 v_today date := (statement_timestamp() at time zone ''Africa/Abidjan'')::date;'),
    ($old$(v_status='current' and status<>'terminated' and (p_kind='lease' or status<>'expired')) or status=v_status)$old$,
     $new$(v_status='current' and status<>'terminated' and (p_kind='lease' or status<>'expired'))
   or (status=v_status and (p_kind<>'lease' or v_status<>'active' or period<=v_today)))$new$),
    ($old$'active',count(*) filter(where status='active'),
   'rent',coalesce(sum(amount::double precision) filter(where status='active'),0),'total',coalesce(sum(amount::double precision) filter(where status='active'),0),$old$,
     $new$'active',count(*) filter(where status='active' and (p_kind<>'lease' or period<=v_today)),
   'pending',count(*) filter(where p_kind='lease' and status='active' and period>v_today),
   'rent',coalesce(sum(amount::double precision) filter(where status='active' and (p_kind<>'lease' or period<=v_today)),0),
   'total',coalesce(sum(amount::double precision) filter(where status='active' and (p_kind<>'lease' or period<=v_today)),0),$new$)
  ) patches(anchor,body) loop
    if (length(definition)-length(replace(definition,replacement.anchor,'')))/length(replacement.anchor)<>1 then
      raise exception 'futureLeaseContractWorkspaceDrift';
    end if;
    definition:=replace(definition,replacement.anchor,replacement.body);
  end loop;
  -- Status sorting follows the labels rendered by the lease workspace in both
  -- directions. Sale labels and all persisted lifecycle statuses stay intact.
  for replacement in select * from (values
    ($old$when 'active' then 'Actif'$old$,
     $new$when 'active' then case when p_kind='lease' and period>v_today then 'À venir' else 'Actif' end$new$),
    ($old$when 'active' then '生效中'$old$,
     $new$when 'active' then case when p_kind='lease' and period>v_today then '待起租' else '生效中' end$new$)
  ) patches(anchor,body) loop
    if (length(definition)-length(replace(definition,replacement.anchor,'')))/length(replacement.anchor)<>2 then
      raise exception 'futureLeaseWorkspaceStatusSortDrift';
    end if;
    definition:=replace(definition,replacement.anchor,replacement.body);
  end loop;
  -- The response date and all its existing day-based comparisons share the
  -- same business date even if the caller's session timezone differs.
  definition:=replace(definition,'current_date','v_today');
  execute definition;
end; $migration$;

notify pgrst,'reload schema';
commit;
