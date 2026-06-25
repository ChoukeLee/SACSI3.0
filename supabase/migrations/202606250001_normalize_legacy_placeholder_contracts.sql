-- Normalize historical placeholder contracts across SACSI11 and SACSI7.
--
-- Goals:
-- 1. Use one contract number shape for historical placeholder records:
--    LEGACY-LEASE-{building_code}-{unit_no}
--    LEGACY-SALE-{building_code}-{unit_no}
-- 2. Replace shared placeholder customers such as "待补充(12F)" with
--    per-room placeholder customers: "资料待补-{building_code}-{unit_no}".
-- 3. Keep real money safe: this migration does not create receivables,
--    payments, or ledger entries.

with targets as (
  select lc.id, 'LEGACY-LEASE-' || b.code || '-' || u.unit_no as target_contract_no
  from public.lease_contracts lc
  join public.units u on u.id = lc.unit_id
  join public.buildings b on b.id = u.building_id
  where b.code in ('SACSI11', 'SACSI7')
    and (lc.contract_no like 'LEGACY-LEASE-%' or lc.contract_no like 'SACSI7-LEASE-%')
)
update public.lease_contracts lc
set contract_no = t.target_contract_no
from targets t
where lc.id = t.id
  and lc.contract_no <> t.target_contract_no
  and not exists (
    select 1 from public.lease_contracts existing
    where existing.contract_no = t.target_contract_no and existing.id <> lc.id
  );

with targets as (
  select sc.id, 'LEGACY-SALE-' || b.code || '-' || u.unit_no as target_contract_no
  from public.sale_contracts sc
  join public.units u on u.id = sc.unit_id
  join public.buildings b on b.id = u.building_id
  where b.code in ('SACSI11', 'SACSI7')
    and (sc.contract_no like 'LEGACY-SALE-%' or sc.contract_no like 'SACSI7-SALE-%')
)
update public.sale_contracts sc
set contract_no = t.target_contract_no
from targets t
where sc.id = t.id
  and sc.contract_no <> t.target_contract_no
  and not exists (
    select 1 from public.sale_contracts existing
    where existing.contract_no = t.target_contract_no and existing.id <> sc.id
  );

insert into public.customers (name, notes)
select distinct
  '资料待补-' || b.code || '-' || u.unit_no,
  'legacy_placeholder=true; source=normalize_legacy_placeholder_contracts; original_customer=' || c.name
from public.lease_contracts lc
join public.units u on u.id = lc.unit_id
join public.buildings b on b.id = u.building_id
join public.customers c on c.id = lc.customer_id
where b.code in ('SACSI11', 'SACSI7')
  and c.name like '%待补%'
  and not exists (
    select 1 from public.customers existing
    where existing.name = '资料待补-' || b.code || '-' || u.unit_no
  );

insert into public.customers (name, notes)
select distinct
  '资料待补-' || b.code || '-' || u.unit_no,
  'legacy_placeholder=true; source=normalize_legacy_placeholder_contracts; original_customer=' || c.name
from public.sale_contracts sc
join public.units u on u.id = sc.unit_id
join public.buildings b on b.id = u.building_id
join public.customers c on c.id = sc.customer_id
where b.code in ('SACSI11', 'SACSI7')
  and c.name like '%待补%'
  and not exists (
    select 1 from public.customers existing
    where existing.name = '资料待补-' || b.code || '-' || u.unit_no
  );

with targets as (
  select lc.id as contract_id, pc.id as placeholder_customer_id
  from public.lease_contracts lc
  join public.units u on u.id = lc.unit_id
  join public.buildings b on b.id = u.building_id
  join public.customers c on c.id = lc.customer_id
  join public.customers pc on pc.name = '资料待补-' || b.code || '-' || u.unit_no
  where b.code in ('SACSI11', 'SACSI7')
    and c.name like '%待补%'
)
update public.lease_contracts lc
set
  customer_id = t.placeholder_customer_id,
  signer_name = case
    when lc.signer_name is null or lc.signer_name like '%待补%' then '资料待补'
    else lc.signer_name
  end
from targets t
where lc.id = t.contract_id
  and lc.customer_id <> t.placeholder_customer_id;

with targets as (
  select sc.id as contract_id, pc.id as placeholder_customer_id
  from public.sale_contracts sc
  join public.units u on u.id = sc.unit_id
  join public.buildings b on b.id = u.building_id
  join public.customers c on c.id = sc.customer_id
  join public.customers pc on pc.name = '资料待补-' || b.code || '-' || u.unit_no
  where b.code in ('SACSI11', 'SACSI7')
    and c.name like '%待补%'
)
update public.sale_contracts sc
set customer_id = t.placeholder_customer_id
from targets t
where sc.id = t.contract_id
  and sc.customer_id <> t.placeholder_customer_id;

insert into public.audit_logs (action, entity_type, metadata)
values (
  'normalize_legacy_placeholder_contracts',
  'system',
  jsonb_build_object(
    'buildings', array['SACSI11', 'SACSI7'],
    'contract_no_format', 'LEGACY-{LEASE|SALE}-{building_code}-{unit_no}',
    'placeholder_customer_format', '资料待补-{building_code}-{unit_no}',
    'finance_entries_created', false
  )
);
