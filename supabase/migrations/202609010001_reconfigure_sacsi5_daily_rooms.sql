-- Replace SACSI5 daily rooms 104/105 with 204/205 and add 304/305.
-- Historical unit and booking records are preserved; only daily-rental eligibility changes.

do $$
declare
  v_unit_count integer;
  v_conflict_count integer;
begin
  select count(*) into v_unit_count
  from public.units u
  join public.buildings b on b.id = u.building_id
  where b.code = 'SACSI5'
    and u.unit_no in ('104', '105', '204', '205', '304', '305')
    and u.kind = 'apartment';

  if v_unit_count <> 6 then
    raise exception 'Expected all six SACSI5 apartments 104/105/204/205/304/305, found %', v_unit_count;
  end if;

  select count(*) into v_conflict_count
  from public.units u
  join public.buildings b on b.id = u.building_id
  where b.code = 'SACSI5'
    and u.unit_no in ('204', '205', '304', '305')
    and (
      exists (
        select 1 from public.daily_bookings d
        where d.unit_id = u.id and d.status in ('pending_review', 'confirmed', 'checked_in')
      )
      or exists (
        select 1 from public.lease_contracts l
        where l.unit_id = u.id and l.status = 'active'
      )
      or exists (
        select 1 from public.sale_contracts s
        where s.unit_id = u.id and s.status = 'active'
      )
    );

  if v_conflict_count <> 0 then
    raise exception 'SACSI5 replacement daily rooms have % active business conflicts', v_conflict_count;
  end if;
end;
$$;

update public.unit_business_flags f
set is_enabled = false
from public.units u
join public.buildings b on b.id = u.building_id
where f.unit_id = u.id
  and f.business_type = 'daily_rental'
  and b.code = 'SACSI5'
  and u.unit_no in ('104', '105');

insert into public.unit_business_flags(unit_id, business_type, is_enabled, default_price_xof)
select u.id, 'daily_rental'::public.business_type, true, 100000
from public.units u
join public.buildings b on b.id = u.building_id
where b.code = 'SACSI5'
  and u.unit_no in ('204', '205', '304', '305')
on conflict (unit_id, business_type) do update
set is_enabled = excluded.is_enabled,
    default_price_xof = excluded.default_price_xof;

insert into public.audit_logs(action, entity_type, entity_id, after_data, metadata)
select
  'reconfigure_daily_rental',
  'unit',
  u.id,
  jsonb_build_object(
    'building_code', b.code,
    'unit_no', u.unit_no,
    'daily_rental_enabled', f.is_enabled,
    'default_price_xof', f.default_price_xof
  ),
  jsonb_build_object(
    'source', 'confirmed SACSI5 daily-room replacement 2026-09-01',
    'replaced_rooms', jsonb_build_array('104', '105'),
    'enabled_rooms', jsonb_build_array('204', '205', '304', '305')
  )
from public.units u
join public.buildings b on b.id = u.building_id
join public.unit_business_flags f on f.unit_id = u.id
  and f.business_type = 'daily_rental'
where b.code = 'SACSI5'
  and u.unit_no in ('104', '105', '204', '205', '304', '305');
