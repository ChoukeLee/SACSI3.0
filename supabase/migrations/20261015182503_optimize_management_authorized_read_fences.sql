begin;

-- Performance only: evaluate each source table's existing RLS once, before
-- joining authorized rows. No ACL, policy, classifier, date or attribution change.
-- The daily receipt loop is a separate migration with non-overlapping anchors.
do $migration$
declare definition text; replacement record;
begin
  definition := replace(pg_get_functiondef('public.management_operating_snapshot_rpc(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  for replacement in select * from (values
    ($old$with visible_units as materialized (
    select u.* from public.units u join public.buildings b on b.id=u.building_id
    where b.project_id=p_project_id
  ), visible_payments as materialized ($old$,
     $new$with raw_buildings as materialized (
    select b.* from public.buildings b where b.project_id=p_project_id
  ), raw_units as materialized (
    select u.* from public.units u
  ), raw_payments as materialized (
    select p.* from public.payments p
    where p.source_type<>'daily_booking' and p.payment_date between trend_start and today
  ), raw_receivables as materialized (
    select r.* from public.receivables r where r.status<>'cancelled'
  ), raw_leases as materialized (
    select l.* from public.lease_contracts l
  ), raw_sales as materialized (
    select s.* from public.sale_contracts s
  ), raw_ledger as materialized (
    select l.id,l.payment_id,l.building_id,l.direction,l.amount_xof,l.entry_date,l.category
    from public.ledger_entries l
  ), raw_daily as materialized (
    select d.id,d.unit_id,d.status from public.daily_bookings d where d.status='checked_in'
  ), visible_units as materialized (
    select u.* from raw_units u join raw_buildings b on b.id=u.building_id
    where b.project_id=p_project_id
  ), visible_payments as materialized ($new$),
    ('from public.payments p'||chr(10)||'    left join public.lease_contracts lc',
     'from raw_payments p'||chr(10)||'    left join raw_leases lc'),
    ('left join public.sale_contracts sc on sc.id=p.source_id',
     'left join raw_sales sc on sc.id=p.source_id'),
    ('left join public.ledger_entries ml on p.source_type=',
     'left join raw_ledger ml on p.source_type='),
    ('join public.buildings pb on pb.id=coalesce(u.building_id,ml.building_id)',
     'join raw_buildings pb on pb.id=coalesce(u.building_id,ml.building_id)'),
    ('from public.receivables r left join public.units u on u.id=r.unit_id',
     'from raw_receivables r left join raw_units u on u.id=r.unit_id'),
    ('join public.buildings b on b.id=coalesce(r.building_id,u.building_id)',
     'join raw_buildings b on b.id=coalesce(r.building_id,u.building_id)'),
    ('select l.*,u.unit_no from public.lease_contracts l join visible_units u',
     'select l.*,u.unit_no from raw_leases l join visible_units u'),
    ('select s.*,u.unit_no from public.sale_contracts s join visible_units u',
     'select s.*,u.unit_no from raw_sales s join visible_units u'),
    ('select count(*) from public.daily_bookings d join visible_units u',
     'select count(*) from raw_daily d join visible_units u')
  ) patches(anchor,body) loop
    if (length(definition)-length(replace(definition,replacement.anchor,'')))/length(replacement.anchor)<>1 then
      raise exception 'managementReadFenceMigrationDrift';
    end if;
    definition:=replace(definition,replacement.anchor,replacement.body);
  end loop;
  execute definition;
end; $migration$;

notify pgrst,'reload schema';
commit;
