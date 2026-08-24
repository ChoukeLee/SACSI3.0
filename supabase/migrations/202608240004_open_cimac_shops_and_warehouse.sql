-- Open the completed CIMAC commercial assets for delivery.
-- Pre-opening customers are reserved only: the project opening date and formal
-- lease start dates are still pending, so this migration creates no contracts,
-- receivables or synthetic dates.

begin;

update public.projects
set
  construction_status = 'partially_operational',
  notes = '商业区186间商铺及仓库已建成可交付；公寓及公寓底商仍按建设进度单独管理。开业活动为付12个月租金赠12个月，项目开业日期及正式合同起始日期待确认。收款须保留人民币或西法原币金额、币种及入账汇率。',
  updated_at = now()
where code = 'CIMAC';

update public.buildings
set
  construction_status = 'operational',
  business_paused = false,
  updated_at = now()
where code ~ '^CIMAC-B(0[1-9]|10)$';

-- The authoritative income summary identifies 49 current pre-opening shop
-- commitments. Keep them reserved until their real start date is confirmed;
-- the remaining completed shops are available for lease.
with committed_shop_numbers(unit_no) as (
  values
    ('103'), ('105'), ('107'), ('108'),
    ('201'), ('202'), ('203'), ('205'), ('207'), ('211'), ('213'),
    ('227'), ('229'), ('231'),
    ('301'), ('303'), ('306'), ('308'), ('309'), ('310'), ('311'), ('312'), ('318'),
    ('402'), ('403'), ('404'), ('405'), ('413'), ('418'), ('420'),
    ('501'), ('602'), ('611'), ('612'), ('701'), ('803'),
    ('901'), ('909'), ('910'),
    ('1001'), ('1002'), ('1003'), ('1004'), ('1005'), ('1006'), ('1007'),
    ('1008'), ('1009'), ('1010')
)
update public.units u
set
  construction_status = 'operational',
  occupancy_verified = true,
  status = case
    when exists (select 1 from committed_shop_numbers c where c.unit_no = u.unit_no)
      then 'reserved'::public.unit_status
    else 'available'::public.unit_status
  end,
  updated_at = now()
from public.buildings b
join public.projects p on p.id = b.project_id
where u.building_id = b.id
  and p.code = 'CIMAC'
  and u.asset_subtype = 'commercial_shop'
  and not exists (
    select 1 from public.lease_contracts lc
    where lc.unit_id = u.id and lc.status = 'active'
  );

insert into public.buildings (
  project_id, code, display_name, address, district, city,
  floors_above_ground, elevator_count, is_active, business_paused,
  construction_status
)
select
  p.id, 'CIMAC-W01', '仓储区', 'PK24', 'Anyama', 'Abidjan',
  0, 0, true, false, 'operational'
from public.projects p
where p.code = 'CIMAC'
on conflict (code) do update set
  project_id = excluded.project_id,
  display_name = excluded.display_name,
  is_active = true,
  business_paused = false,
  construction_status = 'operational',
  updated_at = now();

insert into public.units (
  building_id, code, unit_no, floor_label, kind, status, area_sqm,
  layout, furnishing, notes, asset_subtype, construction_status,
  location_grade, zone_label, occupancy_verified
)
select
  b.id,
  'CIMAC-W01-WAREHOUSE-TBD',
  '仓库（编号待定）',
  '仓储区',
  'warehouse'::public.unit_kind,
  'reserved'::public.unit_status,
  513,
  '仓库',
  null,
  '主数据来源：科特商贸城销售收入汇总表；租户与多币种收款将在财务导入时单独登记，月租、仓库编号及合同起始日期待确认。',
  'warehouse',
  'operational',
  null,
  '仓储区',
  true
from public.buildings b
where b.code = 'CIMAC-W01'
on conflict (code) do update set
  building_id = excluded.building_id,
  unit_no = excluded.unit_no,
  kind = excluded.kind,
  status = excluded.status,
  area_sqm = excluded.area_sqm,
  notes = excluded.notes,
  asset_subtype = excluded.asset_subtype,
  construction_status = excluded.construction_status,
  zone_label = excluded.zone_label,
  occupancy_verified = excluded.occupancy_verified,
  updated_at = now();

insert into public.unit_business_flags (unit_id, business_type, is_enabled, default_price_xof)
select u.id, 'long_lease'::public.business_type, true, null
from public.units u
where u.code = 'CIMAC-W01-WAREHOUSE-TBD'
on conflict (unit_id, business_type) do update set
  is_enabled = true,
  default_price_xof = null;

insert into public.unit_business_flags (unit_id, business_type, is_enabled, default_price_xof)
select u.id, disabled.business_type, false, null
from public.units u
cross join (values
  ('daily_rental'::public.business_type),
  ('sale'::public.business_type)
) as disabled(business_type)
where u.code = 'CIMAC-W01-WAREHOUSE-TBD'
on conflict (unit_id, business_type) do update set
  is_enabled = false,
  default_price_xof = null;

commit;
