-- Preserve pre-opening merchant details without inventing lease contracts or dates.
-- Source: 商贸城签约客户统计表(1).xlsx, reviewed 2026-08-24.

begin;

alter table public.units
  add column if not exists reservation_holder_name text,
  add column if not exists reservation_main_business text;

comment on column public.units.reservation_holder_name is
  'Merchant or customer holding a unit before a formal lease contract exists.';
comment on column public.units.reservation_main_business is
  'Declared main business for the current pre-opening reservation.';

with reservation_details(unit_no, merchant_name, main_business) as (
  values
    ('103',  '栾青',             '小家电'),
    ('105',  '栾青',             '小家电'),
    ('107',  '陈勤文',           '家具'),
    ('108',  '陈勤文',           '家具'),
    ('201',  '胡建初',           '防水'),
    ('202',  '刘勇',             '餐厅、五金'),
    ('203',  '蒋小超',           '铝合金门窗'),
    ('205',  '陈长升',           '卫浴软管'),
    ('207',  '李运红',           '铁丝网'),
    ('211',  '易阳峰',           '吊手架'),
    ('213',  '金宝',             '五金'),
    ('227',  '陈高祥',           '雨虹防水'),
    ('229',  '黄为中',           '家具'),
    ('231',  '黄为中',           '家具'),
    ('301',  '金艳',             '联塑管'),
    ('306',  '黄金龙',           '电缆'),
    ('308',  '黄金龙',           '电缆'),
    ('309',  '郑国飞',           '小家电、五金'),
    ('310',  '黄金龙',           '电缆'),
    ('311',  '郑国飞',           '小家电、五金'),
    ('312',  '黄金龙',           '电缆'),
    ('318',  '王希',             '建材、防水'),
    ('402',  '李强',             '五金、小家电'),
    ('403',  '高俊会',           '五金、机电、全屋定制'),
    ('404',  '李强',             '五金、小家电'),
    ('405',  '高俊会',           '五金、机电、全屋定制'),
    ('413',  '王小龙',           '涂料'),
    ('418',  '黄帅',             '货架'),
    ('420',  '黄帅',             '货架'),
    ('501',  '韦信书',           null),
    ('602',  '曾春明',           '电线电缆'),
    ('611',  '彭力松',           '家具'),
    ('612',  '彭力松',           '家具'),
    ('701',  '张辉明',           '门、涂料、卫浴'),
    ('803',  '叶有斌',           '钢材、油漆'),
    ('901',  '刘勇',             '餐厅、五金'),
    ('910',  '王志刚',           '诊所'),
    ('1001', '刘均（罗玉新）',   '超市'),
    ('1002', '刘均（罗玉新）',   '超市'),
    ('1003', '刘均（罗玉新）',   '超市'),
    ('1004', '张馨月',           '宾馆'),
    ('1005', '张馨月',           '宾馆'),
    ('1006', '张馨月',           '宾馆'),
    ('1007', '张馨月',           '宾馆'),
    ('1008', '张馨月',           '宾馆'),
    ('1009', '张馨月',           '宾馆'),
    ('1010', '张馨月',           '宾馆')
)
update public.units u
set
  reservation_holder_name = details.merchant_name,
  reservation_main_business = details.main_business,
  updated_at = now()
from reservation_details details
join public.buildings b on b.code ~ '^CIMAC-B(0[1-9]|10)$'
join public.projects p on p.id = b.project_id and p.code = 'CIMAC'
where u.building_id = b.id
  and u.unit_no = details.unit_no
  and u.asset_subtype = 'commercial_shop'
  and u.status = 'reserved';

commit;
