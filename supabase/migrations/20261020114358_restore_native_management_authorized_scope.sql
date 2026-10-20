begin;

-- Forward-only repair of the native-money dashboard replacement. Preserve the
-- released cash classifier and every native field, while restoring published
-- authorization/performance fences. This migration changes no business rows.

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
        -- Native paid/receivable totals include fully paid obligations too.
        -- Their zero XOF slots are not proof of an empty native balance.
        or r.amount_native is not null
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


-- The native-money replacement accidentally restored a per-building classifier
-- loop. Restore one project call, retaining the strict shared cash classifier.
do $migration$
declare definition text; old_text text; new_text text;
begin
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
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
    raise exception 'nativeManagementDailyProjectDrift';
  end if;
  definition:=replace(definition,old_text,new_text);
  -- Active contracts keep their explicit zero bucket; historical receipts and
  -- managed obligations must survive a contract's later termination as well.
  old_text:=$old$native_groups as (
    select distinct rent_currency currency from leases where rent_currency<>'XOF'
  )$old$;
  new_text:=$new$native_groups as (
    select rent_currency currency from leases where rent_currency<>'XOF'
    union
    select c.currency from classified c where c.native_settlement
    union
    select r.currency from managed r where r.amount_native is not null
  )$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
    raise exception 'nativeManagementCurrencyGroupDrift';
  end if;
  definition:=replace(definition,old_text,new_text);
  if strpos(definition,'p.native_settlement or p.source_type')=0
    or strpos(definition,'''nativeSummary''')=0
    or strpos(definition,'native_totals as (')=0
    or strpos(definition,'for building in')<>0 then
    raise exception 'nativeManagementPreservationDrift';
  end if;
  execute definition;
end; $migration$;

comment on function public.management_operating_snapshot_rpc(uuid) is
  'Project-scoped STABLE invoker dashboard with materialized authorized source fences and one strict daily classifier call. Native currency totals remain independent; no currency conversion, historical rewrite or permission change.';
notify pgrst,'reload schema';
commit;

