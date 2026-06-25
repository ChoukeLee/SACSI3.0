-- Finalize SACSI11 room 103 lease contract number.
--
-- This repairs a historical placeholder number after the room's customer,
-- rent, deposit, and contract dates were confirmed. It intentionally does
-- not create or modify receivables, payments, ledger entries, or deposits.

with target as (
  select
    lc.id,
    lc.contract_no as old_contract_no,
    'MANAGED-LEASE-103-20260507'::text as new_contract_no
  from public.lease_contracts lc
  join public.units u on u.id = lc.unit_id
  join public.buildings b on b.id = u.building_id
  where b.code = 'SACSI11'
    and u.unit_no = '103'
    and lc.contract_no = 'LEGACY-LEASE-SACSI11-103'
),
updated as (
update public.lease_contracts lc
set contract_no = t.new_contract_no
from target t
where lc.id = t.id
  and not exists (
    select 1
    from public.lease_contracts existing
    where existing.contract_no = t.new_contract_no
      and existing.id <> lc.id
  )
returning lc.id, t.old_contract_no, t.new_contract_no
)
insert into public.audit_logs (action, entity_type, entity_id, metadata)
select
  'finalize_legacy_lease_contract_no',
  'lease_contract',
  updated.id,
  jsonb_build_object(
    'building_code', 'SACSI11',
    'unit_no', '103',
    'old_contract_no', updated.old_contract_no,
    'new_contract_no', updated.new_contract_no,
    'finance_entries_created', false,
    'reason', 'Customer, rent, deposit, and dates confirmed; finalize historical placeholder number.'
  )
from updated;
