insert into public.buildings (code, display_name, floors_above_ground, elevator_count)
values ('SASCI11', '11#公寓', 12, 0)
on conflict (code) do nothing;

with building as (
  select id from public.buildings where code = 'SASCI11'
),
rooms as (
  select
    b.id as building_id,
    floor_no,
    room_no,
    concat(floor_no::text, lpad(room_no::text, 2, '0')) as unit_no
  from building b
  cross join generate_series(1, 12) as floor_no
  cross join generate_series(1, 6) as room_no
)
insert into public.units (building_id, code, unit_no, floor_label, kind, status, layout, furnishing)
select
  building_id,
  concat('SASCI11-', unit_no),
  unit_no,
  concat(floor_no::text, 'F'),
  'apartment',
  'available',
  '公寓',
  'basic'
from rooms
on conflict (code) do nothing;

with target_units as (
  select id from public.units where code like 'SASCI11-%' and kind = 'apartment'
)
insert into public.unit_business_flags (unit_id, business_type, is_enabled)
select id, 'long_lease', true from target_units
on conflict (unit_id, business_type) do nothing;

with target_units as (
  select id from public.units where code like 'SASCI11-%' and kind = 'apartment'
)
insert into public.unit_business_flags (unit_id, business_type, is_enabled)
select id, 'sale', true from target_units
on conflict (unit_id, business_type) do nothing;

with daily_rooms(unit_no) as (
  values
    ('503'), ('505'), ('901'), ('902'), ('903'), ('905'), ('906'),
    ('1001'), ('1002'), ('1003'), ('1005'), ('1006'),
    ('1101'), ('1102'), ('1103'), ('1105'), ('1106'),
    ('1201'), ('1202'), ('1205'), ('1206')
)
insert into public.unit_business_flags (unit_id, business_type, is_enabled, default_price_xof)
select u.id, 'daily_rental', true, 40000
from public.units u
join daily_rooms d on d.unit_no = u.unit_no
join public.buildings b on b.id = u.building_id and b.code = 'SASCI11'
on conflict (unit_id, business_type) do update
set is_enabled = excluded.is_enabled,
    default_price_xof = excluded.default_price_xof;

with building as (
  select id from public.buildings where code = 'SASCI11'
),
parking_spaces as (
  select b.id as building_id, level_label, space_no
  from building b
  cross join (values ('G'), ('0')) as levels(level_label)
  cross join generate_series(1, 20) as space_no
)
insert into public.units (building_id, code, unit_no, floor_label, kind, status)
select
  building_id,
  concat('SASCI11-', level_label, '-', lpad(space_no::text, 2, '0')),
  concat(level_label, '-', lpad(space_no::text, 2, '0')),
  level_label,
  'parking',
  'available'
from parking_spaces
on conflict (code) do nothing;

with parking_units as (
  select u.id
  from public.units u
  join public.buildings b on b.id = u.building_id
  where b.code = 'SASCI11' and u.kind = 'parking'
)
insert into public.unit_business_flags (unit_id, business_type, is_enabled)
select id, 'sale', true from parking_units
on conflict (unit_id, business_type) do nothing;
