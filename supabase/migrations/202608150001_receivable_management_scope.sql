-- Separate operationally confirmed receivables from old balances that still need verification.
alter table public.receivables
  add column if not exists management_status text not null default 'managed';

alter table public.receivables
  drop constraint if exists receivables_management_status_check;

alter table public.receivables
  add constraint receivables_management_status_check
  check (management_status in ('managed', 'historical_pending', 'excluded'));

-- The system owner confirmed that legacy open balances were not fully tracked.
-- Preserve them for reconciliation, but do not mix them into current operating KPIs.
update public.receivables
set management_status = 'historical_pending'
where source_type <> 'daily_booking'
  and status <> 'cancelled'
  and amount_xof > paid_amount_xof
  and due_date < date '2026-07-01'
  and management_status = 'managed';

create index if not exists idx_receivables_management_due
  on public.receivables (management_status, due_date)
  where status <> 'cancelled';

comment on column public.receivables.management_status is
  'managed=current confirmed KPI scope; historical_pending=preserved but excluded pending verification; excluded=invalid/non-operational';
