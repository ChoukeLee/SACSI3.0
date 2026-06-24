-- Seed SACSI7 customers + contracts for real occupancy data from floor chart.
-- This enables RoomCard to show customer names instead of "待补充".

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. CUSTOMERS — all names from the chart
-- ══════════════════════════════════════════════════════════════════════════════

-- We use a temp table approach to map names to generated UUIDs for later use.
-- Each customer grouped by unique name from the chart.

insert into public.customers (name)
values
  -- 1F
  ('罗玉新'),
  -- 2F
  ('Anzoumana'),
  ('刘才生'),  -- 刘才生租
  ('115万/月租'),
  -- 3F
  ('张馨月'),
  ('YAPOBI'),
  ('DIALLO'),
  ('KONE'),
  ('一希服饰'),  -- 一希服饰租
  -- 4F
  ('卢国平'),
  ('申瑞来'),
  ('CAMARA'),
  ('RARIDIOULA'),
  -- 5F
  ('李广吴刚启'),
  ('黄樱'),
  ('AIE'),  -- AIE租
  ('AMARA'),
  ('FLAN'),  -- 黄色=购买款未付
  -- 6F
  ('KAKORO'),
  ('高峰'),
  ('AIQI艾旗'),
  ('Kodjo'),  -- 黄色=购买款未付
  ('KIKISSAGBE'),
  -- 7F
  ('陈颖'),
  ('陈定元'),
  ('享通世贸'),
  -- 8F
  ('余辉'),  -- 余辉租
  ('TOURE'),
  ('LOKATOR'),  -- LOKATOR租
  -- 9F
  ('何康'),
  ('BOMBA'),
  ('刘建'),
  ('AMICHIA'),  -- 黄色=购买款未付
  -- 10F
  ('ILENIA'),  -- 黄色=购买款未付
  ('王勇'),
  ('曾灿明');

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Build a lookup: customer_name → customer_id
-- ══════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. LEASE CONTRACTS — green-marked rooms (status=leased in units)
--    Also yellow-marked rooms are sold (sale contract below).
--    Green empty rooms on 11F/12F, 806(已售文字), 906(已租文字) handled here.
--    Pink+name (606 KIKISSAGBE) is leased.
--    Pink empty (703-705) is available — no contract.
-- ══════════════════════════════════════════════════════════════════════════════

-- Helper: get SACSI7 building id
do $$
declare
  b_id uuid;
  c_id uuid;
  u_id uuid;
  seq int := 0;
begin
  select id into b_id from public.buildings where code = 'SACSI7';

  -- ── Leased rooms (green on chart) ──

  -- 202 刘才生租
  select id into u_id from public.units where code = 'SACSI7-202';
  select id into c_id from public.customers where name = '刘才生';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-202-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '资料待补充');

  -- 206 115万/月租
  select id into u_id from public.units where code = 'SACSI7-206';
  select id into c_id from public.customers where name = '115万/月租';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-206-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '资料待补充');

  -- 306 一希服饰租
  select id into u_id from public.units where code = 'SACSI7-306';
  select id into c_id from public.customers where name = '一希服饰';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-306-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '资料待补充');

  -- 503 AIE租
  select id into u_id from public.units where code = 'SACSI7-503';
  select id into c_id from public.customers where name = 'AIE';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-503-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '资料待补充');

  -- 606 KIKISSAGBE (pink + name = leased, furnishing=full)
  select id into u_id from public.units where code = 'SACSI7-606';
  select id into c_id from public.customers where name = 'KIKISSAGBE';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-606-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '资料待补充');

  -- 706 享通世贸
  select id into u_id from public.units where code = 'SACSI7-706';
  select id into c_id from public.customers where name = '享通世贸';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-706-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '资料待补充');

  -- 801 余辉租
  select id into u_id from public.units where code = 'SACSI7-801';
  select id into c_id from public.customers where name = '余辉';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-801-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '资料待补充');

  -- 805 LOKATOR租
  select id into u_id from public.units where code = 'SACSI7-805';
  select id into c_id from public.customers where name = 'LOKATOR';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-805-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '资料待补充');

  -- 902 BOMBA
  select id into u_id from public.units where code = 'SACSI7-902';
  select id into c_id from public.customers where name = 'BOMBA';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-902-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '资料待补充');

  -- 906 已租 (no specific name)
  insert into public.customers (name) values ('待补充') on conflict do nothing;
  select id into c_id from public.customers where name = '待补充';
  select id into u_id from public.units where code = 'SACSI7-906';
  insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
  values (u_id, c_id, 'SACSI7-LEASE-906-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '待补充');

  -- 11F all green empty (1101-1106) — no name
  insert into public.customers (name) values ('待补充(11F)') on conflict do nothing;
  select id into c_id from public.customers where name = '待补充(11F)';
  for i in 1..6 loop
    select id into u_id from public.units where code = 'SACSI7-110' || i;
    insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
    values (u_id, c_id, 'SACSI7-LEASE-110' || i || '-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '待补充');
  end loop;

  -- 12F all green empty (1201-1206) — no name
  insert into public.customers (name) values ('待补充(12F)') on conflict do nothing;
  select id into c_id from public.customers where name = '待补充(12F)';
  for i in 1..6 loop
    select id into u_id from public.units where code = 'SACSI7-120' || i;
    insert into public.lease_contracts (unit_id, customer_id, contract_no, start_date, expected_end_date, payment_cycle, payment_day, monthly_rent_xof, deposit_amount_xof, deposit_received, status, signer_name)
    values (u_id, c_id, 'SACSI7-LEASE-120' || i || '-' || to_char(now(), 'YYYYMMDD'), '2026-01-01', '2026-12-31', 'monthly', 5, 0, 0, false, 'active', '待补充');
  end loop;

  -- ════════════════════════════════════════════════════════════════════════════
  -- 4. SALE CONTRACTS — white background + name = sold
  --    Yellow rooms = sold (purchase payment unpaid) — flagged in notes
  -- ════════════════════════════════════════════════════════════════════════════

  -- 101 罗玉新
  select id into u_id from public.units where code = 'SACSI7-101';
  select id into c_id from public.customers where name = '罗玉新';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-101', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 201 Anzoumana
  select id into u_id from public.units where code = 'SACSI7-201';
  select id into c_id from public.customers where name = 'Anzoumana';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-201', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 203 Anzoumana (same person, same unit? different unit — same name appears on 201,203,205)
  select id into u_id from public.units where code = 'SACSI7-203';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-203', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 205 Anzoumana
  select id into u_id from public.units where code = 'SACSI7-205';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-205', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 301 张馨月
  select id into u_id from public.units where code = 'SACSI7-301';
  select id into c_id from public.customers where name = '张馨月';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-301', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 302 YAPOBI
  select id into u_id from public.units where code = 'SACSI7-302';
  select id into c_id from public.customers where name = 'YAPOBI';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-302', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 303 DIALLO
  select id into u_id from public.units where code = 'SACSI7-303';
  select id into c_id from public.customers where name = 'DIALLO';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-303', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 304 KONE
  select id into u_id from public.units where code = 'SACSI7-304';
  select id into c_id from public.customers where name = 'KONE';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-304', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 401 卢国平
  select id into u_id from public.units where code = 'SACSI7-401';
  select id into c_id from public.customers where name = '卢国平';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-401', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 402 申瑞来
  select id into u_id from public.units where code = 'SACSI7-402';
  select id into c_id from public.customers where name = '申瑞来';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-402', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 403 CAMARA
  select id into u_id from public.units where code = 'SACSI7-403';
  select id into c_id from public.customers where name = 'CAMARA';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-403', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 404 RARIDIOULA
  select id into u_id from public.units where code = 'SACSI7-404';
  select id into c_id from public.customers where name = 'RARIDIOULA';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-404', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 501 李广吴刚启
  select id into u_id from public.units where code = 'SACSI7-501';
  select id into c_id from public.customers where name = '李广吴刚启';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-501', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 502 黄樱
  select id into u_id from public.units where code = 'SACSI7-502';
  select id into c_id from public.customers where name = '黄樱';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-502', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 504 AMARA
  select id into u_id from public.units where code = 'SACSI7-504';
  select id into c_id from public.customers where name = 'AMARA';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-504', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 506 FLAN — yellow = purchase unpaid
  select id into u_id from public.units where code = 'SACSI7-506';
  select id into c_id from public.customers where name = 'FLAN';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-506', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 601 KAKORO
  select id into u_id from public.units where code = 'SACSI7-601';
  select id into c_id from public.customers where name = 'KAKORO';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-601', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 602 高峰
  select id into u_id from public.units where code = 'SACSI7-602';
  select id into c_id from public.customers where name = '高峰';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-602', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 603+ AIQI艾旗
  select id into u_id from public.units where code = 'SACSI7-603';
  select id into c_id from public.customers where name = 'AIQI艾旗';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-603', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 604 Kodjo — yellow = purchase unpaid
  select id into u_id from public.units where code = 'SACSI7-604';
  select id into c_id from public.customers where name = 'Kodjo';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-604', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 701 陈颖
  select id into u_id from public.units where code = 'SACSI7-701';
  select id into c_id from public.customers where name = '陈颖';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-701', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 702 陈定元
  select id into u_id from public.units where code = 'SACSI7-702';
  select id into c_id from public.customers where name = '陈定元';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-702', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 802 TOURE
  select id into u_id from public.units where code = 'SACSI7-802';
  select id into c_id from public.customers where name = 'TOURE';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-802', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 806 已售 (no specific name)
  select id into c_id from public.customers where name = '待补充';
  select id into u_id from public.units where code = 'SACSI7-806';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-806', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 901 何康
  select id into u_id from public.units where code = 'SACSI7-901';
  select id into c_id from public.customers where name = '何康';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-901', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 904 刘建
  select id into u_id from public.units where code = 'SACSI7-904';
  select id into c_id from public.customers where name = '刘建';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-904', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 905 AMICHIA — yellow = purchase unpaid
  select id into u_id from public.units where code = 'SACSI7-905';
  select id into c_id from public.customers where name = 'AMICHIA';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-905', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 1002 ILENIA — yellow = purchase unpaid
  select id into u_id from public.units where code = 'SACSI7-1002';
  select id into c_id from public.customers where name = 'ILENIA';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-1002', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 1004 DIALLO
  select id into u_id from public.units where code = 'SACSI7-1004';
  select id into c_id from public.customers where name = 'DIALLO';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-1004', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 1005 王勇
  select id into u_id from public.units where code = 'SACSI7-1005';
  select id into c_id from public.customers where name = '王勇';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-1005', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

  -- 1006 曾灿明
  select id into u_id from public.units where code = 'SACSI7-1006';
  select id into c_id from public.customers where name = '曾灿明';
  insert into public.sale_contracts (unit_id, customer_id, contract_no, signed_date, transfer_status, payment_plan_type, total_amount_xof, status)
  values (u_id, c_id, 'SACSI7-SALE-1006', '2026-01-01', 'not_started', 'legacy_pending', 0, 'active');

end $$;
