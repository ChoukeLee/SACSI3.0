-- Reconcile only deterministic production inconsistencies and expose a
-- reusable, database-backed quality report. Ambiguous financial and contract
-- records remain visible for human review.

alter table public.audit_logs
  add column if not exists actor_email text,
  add column if not exists actor_role text,
  add column if not exists entity_label text,
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb;

create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_actor_id on public.audit_logs (actor_id);
create index if not exists idx_audit_logs_entity_type on public.audit_logs (entity_type);
create index if not exists idx_audit_logs_entity_id on public.audit_logs (entity_id);
create index if not exists idx_audit_logs_action on public.audit_logs (action);

-- A checked-in stay, active sale/lease, open cleaning task, or reservation is
-- authoritative. We intentionally do not auto-change stale statuses to
-- "available", because a missing legacy contract may still represent a real
-- occupant.
with candidates as (
  select
    u.id,
    u.status as previous_status,
    public.daily_resolve_unit_status(u.id, null) as expected_status
  from public.units u
  where u.status not in ('maintenance', 'locked')
), repaired as (
  update public.units u
  set status = c.expected_status,
      updated_at = now()
  from candidates c
  where u.id = c.id
    and c.expected_status <> 'available'
    and u.status is distinct from c.expected_status
  returning u.id, c.previous_status, c.expected_status
)
insert into public.audit_logs(action, entity_type, entity_id, before_data, after_data, metadata)
select
  'reconcile_unit_status',
  'unit',
  id,
  jsonb_build_object('status', previous_status),
  jsonb_build_object('status', expected_status),
  jsonb_build_object('migration', '202607280004_reconcile_data_quality')
from repaired;

-- Status is derived from dates and balances. This changes no amounts.
with repaired as (
  update public.receivables
  set status = 'overdue',
      updated_at = now()
  where status not in ('paid', 'cancelled', 'overdue')
    and due_date < current_date
    and paid_amount_xof < amount_xof
  returning id, source_type, source_id, due_date, amount_xof, paid_amount_xof
)
insert into public.audit_logs(action, entity_type, entity_id, after_data, metadata)
select
  'reconcile_receivable_overdue',
  'receivable',
  id,
  jsonb_build_object('status', 'overdue'),
  jsonb_build_object(
    'migration', '202607280004_reconcile_data_quality',
    'source_type', source_type,
    'source_id', source_id,
    'due_date', due_date,
    'amount_xof', amount_xof,
    'paid_amount_xof', paid_amount_xof
  )
from repaired;

-- Backfill deterministic positive income payments that have no ledger entry.
-- Exclude a source with an overpaid receivable; that case requires a decision
-- between duplicate-payment correction and an explicit customer refund.
with inserted as (
  insert into public.ledger_entries (
    building_id,
    unit_id,
    payment_id,
    entry_date,
    direction,
    category,
    amount_xof,
    amount_cny,
    description
  )
  select
    u.building_id,
    p.unit_id,
    p.id,
    p.payment_date,
    'income',
    case
      when p.source_type = 'daily_booking' then 'daily_rental'
      when p.source_type = 'sale_contract' then 'sale'
      else p.source_type
    end,
    case
      when p.currency = 'XOF' then p.amount
      else round(p.amount * coalesce(p.exchange_rate_to_xof, 1), 2)
    end,
    case when p.currency = 'CNY' then p.amount else null end,
    'Data reconciliation: missing ledger for payment ' || p.id::text
  from public.payments p
  join public.units u on u.id = p.unit_id
  where p.amount > 0
    and p.source_type in ('daily_booking', 'sale_contract')
    and not exists (
      select 1 from public.ledger_entries l where l.payment_id = p.id
    )
    and not exists (
      select 1
      from public.receivables r
      where r.source_type = p.source_type
        and r.source_id = p.source_id
        and r.status <> 'cancelled'
        and r.paid_amount_xof > r.amount_xof
    )
  returning id, payment_id, unit_id, amount_xof, entry_date, category
)
insert into public.audit_logs(action, entity_type, entity_id, after_data, metadata)
select
  'reconcile_missing_ledger',
  'payment',
  payment_id,
  jsonb_build_object(
    'ledger_entry_id', id,
    'amount_xof', amount_xof,
    'entry_date', entry_date,
    'category', category
  ),
  jsonb_build_object('migration', '202607280004_reconcile_data_quality')
from inserted;

create or replace view public.system_data_quality_findings
with (security_invoker = true)
as
with unit_truth as (
  select
    u.id,
    u.building_id,
    b.code as building_code,
    u.unit_no,
    u.status::text as current_status,
    public.daily_resolve_unit_status(u.id, null)::text as expected_status,
    exists (
      select 1 from public.lease_contracts l
      where l.unit_id = u.id and l.status = 'active'
    ) as active_lease,
    exists (
      select 1 from public.sale_contracts s
      where s.unit_id = u.id and s.status = 'active'
    ) as active_sale
  from public.units u
  join public.buildings b on b.id = u.building_id
)
select
  'unit_status:' || u.id::text as issue_key,
  case when u.expected_status = 'available' then 'medium' else 'high' end as severity,
  'unit'::text as category,
  'unit'::text as entity_type,
  u.id as entity_id,
  u.building_code,
  u.unit_no,
  'Unit status does not match active business records'::text as title,
  jsonb_build_object(
    'current_status', u.current_status,
    'expected_status', u.expected_status,
    'active_lease', u.active_lease,
    'active_sale', u.active_sale
  ) as detail,
  (u.expected_status <> 'available') as auto_fixable,
  current_date as detected_at
from unit_truth u
where u.current_status <> u.expected_status

union all

select
  'receivable_status:' || r.id::text,
  'medium',
  'finance',
  'receivable',
  r.id,
  b.code,
  u.unit_no,
  'Past-due receivable is not marked overdue',
  jsonb_build_object(
    'status', r.status,
    'due_date', r.due_date,
    'amount_xof', r.amount_xof,
    'paid_amount_xof', r.paid_amount_xof,
    'source_type', r.source_type,
    'source_id', r.source_id
  ),
  true,
  current_date
from public.receivables r
left join public.units u on u.id = r.unit_id
left join public.buildings b on b.id = r.building_id
where r.status not in ('paid', 'cancelled', 'overdue')
  and r.due_date < current_date
  and r.paid_amount_xof < r.amount_xof

union all

select
  'receivable_overpaid:' || r.id::text,
  'high',
  'finance',
  'receivable',
  r.id,
  b.code,
  u.unit_no,
  'Paid amount exceeds receivable amount',
  jsonb_build_object(
    'amount_xof', r.amount_xof,
    'paid_amount_xof', r.paid_amount_xof,
    'excess_xof', r.paid_amount_xof - r.amount_xof,
    'source_type', r.source_type,
    'source_id', r.source_id
  ),
  false,
  current_date
from public.receivables r
left join public.units u on u.id = r.unit_id
left join public.buildings b on b.id = r.building_id
where r.status <> 'cancelled'
  and r.paid_amount_xof > r.amount_xof

union all

select
  'payment_missing_ledger:' || p.id::text,
  'high',
  'finance',
  'payment',
  p.id,
  b.code,
  u.unit_no,
  'Payment has no ledger entry',
  jsonb_build_object(
    'payment_date', p.payment_date,
    'amount', p.amount,
    'currency', p.currency,
    'source_type', p.source_type,
    'source_id', p.source_id,
    'receipt_no', p.receipt_no
  ),
  not exists (
    select 1 from public.receivables r
    where r.source_type = p.source_type
      and r.source_id = p.source_id
      and r.status <> 'cancelled'
      and r.paid_amount_xof > r.amount_xof
  ),
  current_date
from public.payments p
left join public.units u on u.id = p.unit_id
left join public.buildings b on b.id = u.building_id
where not exists (
  select 1 from public.ledger_entries l where l.payment_id = p.id
)

union all

select
  'sale_missing_receivable:' || s.id::text,
  'high',
  'sale',
  'sale_contract',
  s.id,
  b.code,
  u.unit_no,
  'Active sale has no receivable',
  jsonb_build_object(
    'contract_no', s.contract_no,
    'total_amount_xof', s.total_amount_xof,
    'status', s.status
  ),
  (s.total_amount_xof > 0),
  current_date
from public.sale_contracts s
join public.units u on u.id = s.unit_id
join public.buildings b on b.id = u.building_id
where s.status = 'active'
  and not exists (
    select 1 from public.receivables r
    where r.source_type = 'sale_contract'
      and r.source_id = s.id
      and r.status <> 'cancelled'
  )

union all

select
  'lease_sale_overlap:' || u.id::text,
  'low',
  'system',
  'unit',
  u.id,
  u.building_code,
  u.unit_no,
  'Unit has both an active lease and active sale',
  jsonb_build_object(
    'review_reason', 'Confirm this is an intentional sale-with-tenant / managed-lease arrangement'
  ),
  false,
  current_date
from unit_truth u
where u.active_lease and u.active_sale;

revoke all on public.system_data_quality_findings from public, anon;
grant select on public.system_data_quality_findings to authenticated, service_role;
