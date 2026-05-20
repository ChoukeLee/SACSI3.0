-- Business targets v1: KPI goals for management.

create table if not exists public.business_targets (
  id uuid primary key default gen_random_uuid(),
  period_type text not null check (period_type in ('monthly', 'quarterly', 'yearly')),
  period_start date not null,
  period_end date not null,
  metric_key text not null,
  target_value numeric not null,
  unit text not null default '%',
  scope_type text not null default 'global' check (scope_type in ('global', 'building', 'unit_type', 'business_type')),
  scope_value text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_business_targets_metric on public.business_targets (metric_key, period_start);
create index if not exists idx_business_targets_period on public.business_targets (period_start, period_end);

alter table public.business_targets enable row level security;

-- admin/boss can write
create policy "Admin and boss can manage targets" on public.business_targets for all
  to authenticated
  using (exists (select 1 from public.user_profiles where id = auth.uid() and role in ('admin', 'boss')))
  with check (exists (select 1 from public.user_profiles where id = auth.uid() and role in ('admin', 'boss')));

-- all authenticated can read
create policy "Authenticated can read targets" on public.business_targets for select
  to authenticated
  using (true);

-- Trigger for updated_at
create or replace function public.update_targets_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists trg_targets_updated_at on public.business_targets;
create trigger trg_targets_updated_at before update on public.business_targets
  for each row execute function public.update_targets_updated_at();
