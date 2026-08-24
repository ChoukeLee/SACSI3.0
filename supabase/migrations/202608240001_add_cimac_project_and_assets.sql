-- Add a project layer and register the confirmed CIMAC commercial inventory.
-- Handwritten names, ticks, occupancy and finance are intentionally excluded.

begin;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  brand_name text,
  project_kind text not null default 'mixed_use',
  construction_status text not null default 'operational'
    check (construction_status in (
      'planned', 'under_construction', 'inspection_pending', 'fitout_pending',
      'partially_operational', 'operational', 'paused', 'unverified'
    )),
  allows_daily_rental boolean not null default false,
  allows_long_lease boolean not null default true,
  allows_sale boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.projects (
  code, display_name, brand_name, project_kind, construction_status,
  allows_daily_rental, allows_long_lease, allows_sale, notes
)
values
  (
    'SACSI', 'SACSI 公寓项目', '科建地产', 'residential_portfolio', 'operational',
    true, true, true, '现有公寓及配套资产'
  ),
  (
    'CIMAC', '科建建材城', 'CIMAC', 'building_materials_commercial_park',
    'partially_operational', false, true, false,
    '分期建设；商业区商铺按已确认价格图统一统计为 186 间'
  )
on conflict (code) do update set
  display_name = excluded.display_name,
  brand_name = excluded.brand_name,
  project_kind = excluded.project_kind,
  construction_status = excluded.construction_status,
  allows_daily_rental = excluded.allows_daily_rental,
  allows_long_lease = excluded.allows_long_lease,
  allows_sale = excluded.allows_sale,
  notes = excluded.notes,
  updated_at = now();

alter table public.buildings
  add column if not exists project_id uuid references public.projects(id),
  add column if not exists construction_status text not null default 'operational';

alter table public.buildings drop constraint if exists buildings_construction_status_check;
alter table public.buildings add constraint buildings_construction_status_check
  check (construction_status in (
    'planned', 'under_construction', 'inspection_pending', 'fitout_pending',
    'partially_operational', 'operational', 'paused', 'unverified'
  ));

update public.buildings
set project_id = (select id from public.projects where code = 'SACSI')
where project_id is null;

alter table public.buildings alter column project_id set not null;

alter type public.unit_kind add value if not exists 'warehouse';

alter table public.units
  add column if not exists asset_subtype text not null default 'standard',
  add column if not exists construction_status text not null default 'operational',
  add column if not exists location_grade text,
  add column if not exists zone_label text,
  add column if not exists occupancy_verified boolean not null default true;

alter table public.units drop constraint if exists units_construction_status_check;
alter table public.units add constraint units_construction_status_check
  check (construction_status in (
    'planned', 'under_construction', 'inspection_pending', 'fitout_pending',
    'operational', 'paused', 'unverified'
  ));

alter table public.units drop constraint if exists units_location_grade_check;
alter table public.units add constraint units_location_grade_check
  check (location_grade is null or location_grade in ('standard', 'central_avenue_prime'));

update public.units
set asset_subtype = case kind::text
  when 'apartment' then 'apartment'
  when 'parking' then 'parking'
  when 'storefront' then 'storefront'
  when 'office' then 'office'
  else 'standard'
end
where asset_subtype = 'standard';

insert into public.buildings (
  project_id, code, display_name, address, district, city,
  floors_above_ground, elevator_count, is_active, business_paused,
  construction_status
)
select
  p.id,
  'CIMAC-B' || lpad(b.building_no::text, 2, '0'),
  b.display_name,
  'PK24',
  'Anyama',
  'Abidjan',
  0,
  0,
  true,
  false,
  'unverified'
from public.projects p
cross join (values
  (1, '第一栋'), (2, '第二栋'), (3, '第三栋'), (4, '第四栋'), (5, '第五栋'),
  (6, '第六栋'), (7, '第七栋'), (8, '第八栋'), (9, '第九栋'), (10, '第十栋')
) as b(building_no, display_name)
where p.code = 'CIMAC'
on conflict (code) do update set
  project_id = excluded.project_id,
  display_name = excluded.display_name,
  address = excluded.address,
  district = excluded.district,
  city = excluded.city,
  is_active = true,
  updated_at = now();

-- Each pricing range expands to one row per confirmed shop number.
-- price_wan is the monthly rent shown on the source map, in 10,000 XOF.
with pricing_ranges(building_code, first_no, last_no, area_sqm, price_wan, is_prime, zone_label) as (
  values
    ('CIMAC-B01', 101, 102, 110, 198, true,  '门口大道区'),
    ('CIMAC-B01', 103, 104,  64, 110, true,  '门口大道区'),
    ('CIMAC-B01', 105, 106,  64, 104, true,  '门口大道区'),
    ('CIMAC-B01', 107, 108,  64,  98, true,  '门口大道区'),
    ('CIMAC-B01', 109, 126,  64,  92, false, '门口大道区'),
    ('CIMAC-B01', 127, 128, 110, 158, false, '门口大道区'),

    ('CIMAC-B02', 301, 302, 110, 188, true,  '门口大道区'),
    ('CIMAC-B02', 303, 304,  64, 104, true,  '门口大道区'),
    ('CIMAC-B02', 305, 306,  64,  98, true,  '门口大道区'),
    ('CIMAC-B02', 307, 308,  64,  92, true,  '门口大道区'),
    ('CIMAC-B02', 309, 326,  64,  86, false, '门口大道区'),
    ('CIMAC-B02', 327, 328, 110, 149, false, '门口大道区'),

    ('CIMAC-B03', 201, 202, 110, 198, true,  '门口大道区'),
    ('CIMAC-B03', 203, 204,  64, 110, true,  '门口大道区'),
    ('CIMAC-B03', 205, 206,  64, 104, true,  '门口大道区'),
    ('CIMAC-B03', 207, 208,  64,  98, true,  '门口大道区'),
    ('CIMAC-B03', 209, 230,  64,  92, false, '门口大道区'),
    ('CIMAC-B03', 231, 232, 110, 158, false, '门口大道区'),

    ('CIMAC-B04', 401, 402, 110, 188, true,  '门口大道区'),
    ('CIMAC-B04', 403, 404,  64, 104, true,  '门口大道区'),
    ('CIMAC-B04', 405, 406,  64,  98, true,  '门口大道区'),
    ('CIMAC-B04', 407, 408,  64,  92, true,  '门口大道区'),
    ('CIMAC-B04', 409, 430,  64,  86, false, '门口大道区'),
    ('CIMAC-B04', 431, 432, 110, 149, false, '门口大道区'),

    ('CIMAC-B05', 501, 501, 310, 502, true,  '中心广场区'),
    ('CIMAC-B05', 502, 502, 173, 265, true,  '中心广场区'),
    ('CIMAC-B05', 503, 503, 173, 249, true,  '中心广场区'),
    ('CIMAC-B05', 504, 504, 173, 234, false, '中心广场区'),
    ('CIMAC-B05', 505, 509, 173, 218, false, '中心广场区'),
    ('CIMAC-B05', 510, 510, 310, 390, false, '中心广场区'),

    ('CIMAC-B06', 601, 601, 267, 432, true,  '中心广场区'),
    ('CIMAC-B06', 602, 602, 173, 265, true,  '中心广场区'),
    ('CIMAC-B06', 603, 603, 173, 249, true,  '中心广场区'),
    ('CIMAC-B06', 604, 604, 173, 234, false, '中心广场区'),
    ('CIMAC-B06', 605, 611, 173, 218, false, '中心广场区'),
    ('CIMAC-B06', 612, 612, 267, 336, false, '中心广场区'),

    ('CIMAC-B07', 701, 701, 276, 447, true,  '中心广场区'),
    ('CIMAC-B07', 702, 702, 173, 265, true,  '中心广场区'),
    ('CIMAC-B07', 703, 703, 173, 249, true,  '中心广场区'),
    ('CIMAC-B07', 704, 704, 173, 234, false, '中心广场区'),
    ('CIMAC-B07', 705, 709, 173, 218, false, '中心广场区'),
    ('CIMAC-B07', 710, 710, 310, 390, false, '中心广场区'),

    ('CIMAC-B08', 801, 801, 232, 376, true,  '中心广场区'),
    ('CIMAC-B08', 802, 802, 173, 265, true,  '中心广场区'),
    ('CIMAC-B08', 803, 803, 173, 249, true,  '中心广场区'),
    ('CIMAC-B08', 804, 804, 173, 234, false, '中心广场区'),
    ('CIMAC-B08', 805, 811, 173, 218, false, '中心广场区'),
    ('CIMAC-B08', 812, 812, 267, 336, false, '中心广场区'),

    ('CIMAC-B09', 901, 901, 263, 379, true,  '中心广场区'),
    ('CIMAC-B09', 902, 902, 173, 218, true,  '中心广场区'),
    ('CIMAC-B09', 903, 903, 173, 202, true,  '中心广场区'),
    ('CIMAC-B09', 904, 909, 173, 187, false, '中心广场区'),
    ('CIMAC-B09', 910, 910, 291, 314, false, '中心广场区'),

    ('CIMAC-B10', 1001, 1001, 218, 314, true,  '中心广场区'),
    ('CIMAC-B10', 1002, 1002, 173, 218, true,  '中心广场区'),
    ('CIMAC-B10', 1003, 1003, 173, 202, true,  '中心广场区'),
    ('CIMAC-B10', 1004, 1011, 173, 187, false, '中心广场区'),
    ('CIMAC-B10', 1012, 1012, 260, 281, false, '中心广场区')
), expanded as (
  select
    r.building_code,
    n as unit_no,
    r.area_sqm,
    r.price_wan,
    r.is_prime,
    r.zone_label
  from pricing_ranges r
  cross join lateral generate_series(r.first_no, r.last_no) as n
), upserted_units as (
  insert into public.units (
    building_id, code, unit_no, floor_label, kind, status, area_sqm,
    layout, furnishing, notes, asset_subtype, construction_status,
    location_grade, zone_label, occupancy_verified
  )
  select
    b.id,
    format('%s-%s', e.building_code, e.unit_no),
    e.unit_no::text,
    '商业区',
    'storefront'::public.unit_kind,
    'locked'::public.unit_status,
    e.area_sqm,
    null,
    null,
    null,
    'commercial_shop',
    'unverified',
    case when e.is_prime then 'central_avenue_prime' else 'standard' end,
    e.zone_label,
    false
  from expanded e
  join public.buildings b on b.code = e.building_code
  on conflict (code) do update set
    building_id = excluded.building_id,
    unit_no = excluded.unit_no,
    floor_label = excluded.floor_label,
    kind = excluded.kind,
    area_sqm = excluded.area_sqm,
    asset_subtype = excluded.asset_subtype,
    location_grade = excluded.location_grade,
    zone_label = excluded.zone_label,
    updated_at = now()
  returning id, code
)
insert into public.unit_business_flags (unit_id, business_type, is_enabled, default_price_xof)
select
  u.id,
  'long_lease'::public.business_type,
  true,
  e.price_wan * 10000
from expanded e
join upserted_units u on u.code = format('%s-%s', e.building_code, e.unit_no)
on conflict (unit_id, business_type) do update set
  is_enabled = true,
  default_price_xof = excluded.default_price_xof;

insert into public.unit_business_flags (unit_id, business_type, is_enabled, default_price_xof)
select
  u.id,
  disabled_type.business_type,
  false,
  null
from public.units u
join public.buildings b on b.id = u.building_id
join public.projects p on p.id = b.project_id
cross join (
  values
    ('daily_rental'::public.business_type),
    ('sale'::public.business_type)
) as disabled_type(business_type)
where p.code = 'CIMAC'
on conflict (unit_id, business_type) do update set
  is_enabled = false,
  default_price_xof = null;

create index if not exists idx_buildings_project_active
  on public.buildings(project_id, is_active, code);
create index if not exists idx_units_construction_status
  on public.units(construction_status, occupancy_verified);
create index if not exists idx_units_location_grade
  on public.units(location_grade) where location_grade is not null;

-- Project policy is authoritative for all future booking/contract writes.
create or replace function public.enforce_project_business_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allows_daily boolean;
  v_allows_lease boolean;
  v_allows_sale boolean;
begin
  select p.allows_daily_rental, p.allows_long_lease, p.allows_sale
  into v_allows_daily, v_allows_lease, v_allows_sale
  from public.units u
  join public.buildings b on b.id = u.building_id
  join public.projects p on p.id = b.project_id
  where u.id = new.unit_id;

  if not found then
    raise exception 'projectBusinessModeNotFound' using errcode = '23503';
  end if;

  if tg_table_name = 'daily_bookings' and not v_allows_daily then
    raise exception 'projectDailyRentalDisabled' using errcode = '23514';
  elsif tg_table_name = 'lease_contracts' and not v_allows_lease then
    raise exception 'projectLongLeaseDisabled' using errcode = '23514';
  elsif tg_table_name = 'sale_contracts' and not v_allows_sale then
    raise exception 'projectSaleDisabled' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_daily_project_business_mode on public.daily_bookings;
create trigger trg_daily_project_business_mode
before insert or update of unit_id on public.daily_bookings
for each row execute function public.enforce_project_business_mode();

drop trigger if exists trg_lease_project_business_mode on public.lease_contracts;
create trigger trg_lease_project_business_mode
before insert or update of unit_id on public.lease_contracts
for each row execute function public.enforce_project_business_mode();

drop trigger if exists trg_sale_project_business_mode on public.sale_contracts;
create trigger trg_sale_project_business_mode
before insert or update of unit_id on public.sale_contracts
for each row execute function public.enforce_project_business_mode();

alter table public.projects enable row level security;
drop policy if exists "app roles read projects" on public.projects;
create policy "app roles read projects" on public.projects for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
drop policy if exists "admin manages projects" on public.projects;
create policy "admin manages projects" on public.projects for all to authenticated
  using (public.has_app_role('admin'))
  with check (public.has_app_role('admin'));

grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;

commit;
