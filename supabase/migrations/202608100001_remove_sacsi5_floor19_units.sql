-- Remove the five erroneous SACSI5 floor-19 placeholder units.
-- Production verification on 2026-08-10 confirmed that these units have no
-- contracts, bookings, financial records, cleaning tasks, or attachments.

do $$
declare
  v_building_id uuid;
  v_unit_ids uuid[];
  v_unit_nos text[];
  v_count integer;
begin
  select id into strict v_building_id
  from public.buildings
  where code = 'SACSI5';

  select
    coalesce(array_agg(id order by unit_no), '{}'::uuid[]),
    coalesce(array_agg(unit_no order by unit_no), '{}'::text[]),
    count(*)
  into v_unit_ids, v_unit_nos, v_count
  from public.units
  where building_id = v_building_id
    and floor_label = '19F';

  if v_count = 0 then
    update public.buildings
    set floors_above_ground = 18,
        updated_at = now()
    where id = v_building_id
      and floors_above_ground = 19;
    return;
  end if;

  if v_count <> 5 or v_unit_nos <> array['1901', '1902', '1903', '1904', '1905']::text[] then
    raise exception 'Unexpected SACSI5 floor-19 units: %', v_unit_nos;
  end if;

  if exists (select 1 from public.daily_bookings where unit_id = any(v_unit_ids))
    or exists (select 1 from public.lease_contracts where unit_id = any(v_unit_ids))
    or exists (select 1 from public.sale_contracts where unit_id = any(v_unit_ids))
    or exists (select 1 from public.payments where unit_id = any(v_unit_ids))
    or exists (select 1 from public.ledger_entries where unit_id = any(v_unit_ids))
    or exists (select 1 from public.cleaning_tasks where unit_id = any(v_unit_ids))
    or exists (select 1 from public.receivables where unit_id = any(v_unit_ids))
    or exists (select 1 from public.lease_settlements where unit_id = any(v_unit_ids))
    or exists (select 1 from public.attachments where unit_id = any(v_unit_ids)) then
    raise exception 'SACSI5 floor-19 units have business references; deletion aborted';
  end if;

  insert into public.audit_logs(action, entity_type, entity_id, metadata)
  values (
    'delete_erroneous_floor_units',
    'building',
    v_building_id,
    jsonb_build_object(
      'building_code', 'SACSI5',
      'floor_label', '19F',
      'deleted_unit_ids', to_jsonb(v_unit_ids),
      'deleted_unit_nos', to_jsonb(v_unit_nos),
      'reason', 'User confirmed floor 19 is erroneous',
      'source', 'Codex correction 2026-08-10'
    )
  );

  delete from public.units
  where id = any(v_unit_ids);

  update public.buildings
  set floors_above_ground = 18,
      updated_at = now()
  where id = v_building_id;
end;
$$;
