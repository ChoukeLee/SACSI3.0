begin;

-- Scope authorized base reads before their RLS fences. Preserve explicit
-- receivable-building precedence, payment-unit precedence and unknown amounts.
-- No policy, ACL, cash classification or permission helper is changed.
do $migration$
declare definition text; replacement record;
begin
  definition:=replace(pg_get_functiondef('public.management_operating_snapshot_rpc(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  for replacement in select * from (values
    ($old$raw_units as materialized (
    select u.* from public.units u
  )$old$,
     $new$raw_units as materialized (
    select u.* from public.units u where u.building_id in (select id from raw_buildings)
  )$new$),
    ($old$raw_payments as materialized (
    select p.* from public.payments p
    where p.source_type<>'daily_booking' and p.payment_date between trend_start and today
  )$old$,
     $new$raw_payments as materialized (
    select p.* from public.payments p
    where p.source_type<>'daily_booking' and p.payment_date between trend_start and today
      and (p.unit_id is null or p.unit_id in (select id from raw_units))
  )$new$),
    ($old$raw_receivables as materialized (
    select r.* from public.receivables r where r.status<>'cancelled'
  )$old$,
     $new$raw_receivables as materialized (
    select r.* from public.receivables r where r.status<>'cancelled'
      and (r.amount_xof>r.paid_amount_xof
        or r.amount_xof::text in ('NaN','Infinity','-Infinity')
        or r.paid_amount_xof::text in ('NaN','Infinity','-Infinity'))
      and (r.building_id in (select id from raw_buildings)
        or (r.building_id is null and r.unit_id in (select id from raw_units)))
  ), raw_receivable_units as materialized (
    -- A record's explicit building may disagree with its unit. Keep the original
    -- authorized unit label instead of changing its reporting project or room.
    select u.id,u.unit_no,u.building_id from public.units u
    where u.id in (select unit_id from raw_receivables where unit_id is not null)
  )$new$),
    ($old$raw_leases as materialized (
    select l.* from public.lease_contracts l
  )$old$,
     $new$raw_leases as materialized (
    select l.* from public.lease_contracts l
    where (l.status='active' and l.unit_id in (select id from raw_units))
      or l.id in (select p.source_id from raw_payments p where p.unit_id is null
        and (p.source_type like 'lease%' or p.source_type in ('property_fee','parking_fee')))
  )$new$),
    ($old$raw_sales as materialized (
    select s.* from public.sale_contracts s
  )$old$,
     $new$raw_sales as materialized (
    select s.* from public.sale_contracts s
    where (s.status in ('active','draft') and s.unit_id in (select id from raw_units))
      or s.id in (select p.source_id from raw_payments p where p.unit_id is null
        and (p.source_type like 'sale%' or p.source_type in ('property_fee','parking_fee')))
  )$new$),
    ($old$raw_ledger as materialized (
    select l.id,l.payment_id,l.building_id,l.direction,l.amount_xof,l.entry_date,l.category
    from public.ledger_entries l
  )$old$,
     $new$raw_ledger as materialized (
    select l.id,l.payment_id,l.building_id,l.direction,l.amount_xof,l.entry_date,l.category
    from public.ledger_entries l
    where l.id in (select source_id from raw_payments where source_type='manual')
  )$new$),
    ($old$raw_daily as materialized (
    select d.id,d.unit_id,d.status from public.daily_bookings d where d.status='checked_in'
  )$old$,
     $new$raw_daily as materialized (
    select d.id,d.unit_id,d.status from public.daily_bookings d where d.status='checked_in'
      and d.unit_id in (select id from raw_units)
  )$new$),
    ('from raw_receivables r left join raw_units u on u.id=r.unit_id',
     'from raw_receivables r left join raw_receivable_units u on u.id=r.unit_id')
  ) patches(anchor,body) loop
    if (length(definition)-length(replace(definition,replacement.anchor,'')))/length(replacement.anchor)<>1 then
      raise exception 'managementScopedReadMigrationDrift';
    end if;
    definition:=replace(definition,replacement.anchor,replacement.body);
  end loop;
  execute definition;
end; $migration$;

notify pgrst,'reload schema';
commit;
