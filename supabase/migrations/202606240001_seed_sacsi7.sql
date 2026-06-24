-- Seed SACSI7 (7#公寓) with real occupancy data from manual floor chart.
-- 12 floors, 6 units per floor = 72 apartments.
-- Business: long_lease + sale (no daily_rental).
-- No parking units for this building.

-- ── 1. Building record ──

insert into public.buildings (code, display_name, floors_above_ground, elevator_count)
values ('SACSI7', '7#公寓', 12, 2)
on conflict (code) do nothing;

-- ── 2. Apartment units ──
-- Area mapping (same for all floors):
--   01/02 = 181.17 sqm, 03/04 = 96.62 sqm, 05/06 = 150.24 sqm

with building as (
  select id from public.buildings where code = 'SACSI7'
),
floor_units as (
  select
    b.id as building_id,
    f.floor_no,
    r.room_no,
    concat(f.floor_no::text, lpad(r.room_no::text, 2, '0')) as unit_no,
    case
      when r.room_no in (1, 2) then 181.17
      when r.room_no in (3, 4) then 96.62
      when r.room_no in (5, 6) then 150.24
    end as area_sqm
  from building b
  cross join generate_series(1, 12) as f(floor_no)
  cross join generate_series(1, 6) as r(room_no)
),
-- Color coding from the chart:
--   white + name  → sold
--   green         → leased
--   yellow        → sold (purchase payment unpaid)
--   pink empty    → available, furnishing=full
--   pink + name   → leased, furnishing=full
--   white empty   → available
unit_data as (
  select * from (values
    -- 1F
    ('101', 'sold'::text, 'basic'::text, 181.17),
    ('102', 'available', 'basic', 181.17),
    ('103', 'available', 'basic', 96.62),
    ('104', 'available', 'basic', 96.62),
    ('105', 'available', 'basic', 150.24),
    ('106', 'available', 'basic', 150.24),
    -- 2F
    ('201', 'sold', 'basic', 181.17),
    ('202', 'leased', 'basic', 181.17),
    ('203', 'sold', 'basic', 181.17),
    ('204', 'available', 'basic', 96.62),
    ('205', 'sold', 'basic', 150.24),
    ('206', 'leased', 'basic', 150.24),
    -- 3F
    ('301', 'sold', 'basic', 181.17),
    ('302', 'sold', 'basic', 181.17),
    ('303', 'sold', 'basic', 96.62),
    ('304', 'sold', 'basic', 96.62),
    ('305', 'available', 'basic', 150.24),
    ('306', 'leased', 'basic', 150.24),
    -- 4F
    ('401', 'sold', 'basic', 181.17),
    ('402', 'sold', 'basic', 181.17),
    ('403', 'sold', 'basic', 96.62),
    ('404', 'sold', 'basic', 96.62),
    ('405', 'available', 'basic', 150.24),
    ('406', 'available', 'basic', 150.24),
    -- 5F
    ('501', 'sold', 'basic', 181.17),
    ('502', 'sold', 'basic', 181.17),
    ('503', 'leased', 'basic', 96.62),
    ('504', 'sold', 'basic', 96.62),
    ('505', 'available', 'basic', 150.24),
    ('506', 'sold', 'basic', 150.24),  -- yellow = sold (purchase unpaid)
    -- 6F
    ('601', 'sold', 'basic', 181.17),
    ('602', 'sold', 'basic', 181.17),
    ('603', 'sold', 'basic', 96.62),
    ('604', 'sold', 'basic', 96.62),   -- yellow = sold (purchase unpaid)
    ('605', 'available', 'basic', 150.24),
    ('606', 'leased', 'full', 150.24), -- pink + name = leased, furnishing=full
    -- 7F
    ('701', 'sold', 'basic', 181.17),
    ('702', 'sold', 'basic', 181.17),
    ('703', 'available', 'full', 96.62),  -- pink empty
    ('704', 'available', 'full', 96.62),  -- pink empty
    ('705', 'available', 'full', 150.24), -- pink empty
    ('706', 'leased', 'basic', 150.24),
    -- 8F
    ('801', 'leased', 'basic', 181.17),
    ('802', 'sold', 'basic', 181.17),
    ('803', 'available', 'basic', 96.62),
    ('804', 'available', 'basic', 96.62),
    ('805', 'leased', 'basic', 150.24),
    ('806', 'sold', 'basic', 150.24),   -- "已售" = sold
    -- 9F
    ('901', 'sold', 'basic', 181.17),
    ('902', 'leased', 'basic', 181.17),
    ('903', 'available', 'basic', 96.62),
    ('904', 'sold', 'basic', 96.62),
    ('905', 'sold', 'basic', 150.24),   -- yellow = sold (purchase unpaid)
    ('906', 'leased', 'basic', 150.24), -- "已租" = leased
    -- 10F
    ('1001', 'available', 'basic', 181.17),
    ('1002', 'sold', 'basic', 181.17),  -- yellow = sold (purchase unpaid)
    ('1003', 'available', 'basic', 96.62),
    ('1004', 'sold', 'basic', 96.62),
    ('1005', 'sold', 'basic', 150.24),
    ('1006', 'sold', 'basic', 150.24),
    -- 11F (all green empty = leased, unknown tenants)
    ('1101', 'leased', 'basic', 181.17),
    ('1102', 'leased', 'basic', 181.17),
    ('1103', 'leased', 'basic', 96.62),
    ('1104', 'leased', 'basic', 96.62),
    ('1105', 'leased', 'basic', 150.24),
    ('1106', 'leased', 'basic', 150.24),
    -- 12F (all green empty = leased, unknown tenants)
    ('1201', 'leased', 'basic', 181.17),
    ('1202', 'leased', 'basic', 181.17),
    ('1203', 'leased', 'basic', 96.62),
    ('1204', 'leased', 'basic', 96.62),
    ('1205', 'leased', 'basic', 150.24),
    ('1206', 'leased', 'basic', 150.24)
  ) as t(unit_no, status, furnishing, area_sqm)
)
insert into public.units (building_id, code, unit_no, floor_label, kind, status, area_sqm, layout, furnishing)
select
  fu.building_id,
  concat('SACSI7-', fu.unit_no),
  fu.unit_no,
  concat(floor(fu.floor_no), 'F'),
  'apartment',
  ud.status::public.unit_status,
  ud.area_sqm,
  '公寓',
  ud.furnishing
from floor_units fu
join unit_data ud on ud.unit_no = fu.unit_no
on conflict (code) do nothing;

-- ── 3. Business flags: long_lease + sale for all apartments ──

with target_units as (
  select id from public.units
  where code like 'SACSI7-%' and kind = 'apartment'
)
insert into public.unit_business_flags (unit_id, business_type, is_enabled)
select id, unnest(array['long_lease'::public.business_type, 'sale'::public.business_type]), true
from target_units
on conflict (unit_id, business_type) do nothing;
