-- Keep long-lease overdue totals aligned with the authoritative paid-through date.
-- Materialize one current rent receivable when an active contract's coverage has
-- expired and no open rent receivable exists. This applies to every building.

create unique index if not exists lease_open_rent_receivable_due_unique
  on public.receivables (source_id, due_date, category)
  where source_type = 'lease_contract'
    and category = 'lease_rent'
    and status in ('pending', 'partial', 'overdue');

with missing as (
  select
    lc.id as contract_id,
    lc.unit_id,
    lc.customer_id,
    u.building_id,
    u.unit_no,
    lc.paid_through_date,
    (lc.paid_through_date + 1) as due_date,
    lc.monthly_rent_xof
  from public.lease_contracts lc
  join public.units u on u.id = lc.unit_id
  where lc.status = 'active'
    and lc.paid_through_date is not null
    and lc.paid_through_date + 1 < current_date
    and not exists (
      select 1
      from public.receivables r
      where r.source_type = 'lease_contract'
        and r.source_id = lc.id
        and r.category = 'lease_rent'
        and r.status in ('pending', 'partial', 'overdue')
        and r.amount_xof > r.paid_amount_xof
    )
    and not exists (
      select 1
      from public.receivables r
      where r.source_type = 'lease_contract'
        and r.source_id = lc.id
        and r.category = 'lease_rent'
        and r.due_date = lc.paid_through_date + 1
        and r.status <> 'cancelled'
    )
), inserted as (
  insert into public.receivables (
    building_id, unit_id, customer_id, source_type, source_id, category,
    title, due_date, amount_xof, paid_amount_xof, status, currency, notes
  )
  select
    building_id,
    unit_id,
    customer_id,
    'lease_contract',
    contract_id,
    'lease_rent',
    unit_no || ' 长租下一期租金',
    due_date,
    monthly_rent_xof,
    0,
    'overdue',
    'XOF',
    '根据租金已缴至日期 ' || paid_through_date::text || ' 自动补齐'
  from missing
  on conflict do nothing
  returning id, source_id, amount_xof, due_date
)
insert into public.audit_logs (action, entity_type, entity_id, metadata)
select
  'backfill_lease_receivable',
  'receivable',
  id,
  jsonb_build_object(
    'contract_id', source_id,
    'amount_xof', amount_xof,
    'due_date', due_date,
    'scope', 'all_buildings'
  )
from inserted;

