-- Receivables v1: unified accounts receivable model
-- Supports daily_booking, lease_contract, sale_contract, and manual receivables.

create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references public.buildings(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,

  source_type text not null check (source_type in (
    'daily_booking', 'lease_contract', 'sale_contract', 'manual'
  )),
  source_id uuid,

  category text not null check (category in (
    'daily_rental', 'lease_rent', 'lease_deposit',
    'sale_installment', 'sale_lump_sum', 'other'
  )),

  title text not null,
  due_date date not null,
  amount_xof numeric(14,2) not null check (amount_xof >= 0),
  paid_amount_xof numeric(14,2) not null default 0 check (paid_amount_xof >= 0),
  status text not null default 'pending' check (status in (
    'pending', 'partial', 'paid', 'overdue', 'cancelled'
  )),

  currency public.currency_code not null default 'XOF',
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_receivables_building_due
  on public.receivables (building_id, due_date);
create index if not exists idx_receivables_unit_status
  on public.receivables (unit_id, status);
create index if not exists idx_receivables_source
  on public.receivables (source_type, source_id);
create index if not exists idx_receivables_status_due
  on public.receivables (status, due_date);
create index if not exists idx_receivables_customer
  on public.receivables (customer_id);

-- RLS: match existing loose policies (authenticated users can read/write)
alter table public.receivables enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'Allow authenticated select on receivables'
      and tablename = 'receivables'
  ) then
    create policy "Allow authenticated select on receivables"
      on public.receivables for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'Allow authenticated insert on receivables'
      and tablename = 'receivables'
  ) then
    create policy "Allow authenticated insert on receivables"
      on public.receivables for insert
      to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'Allow authenticated update on receivables'
      and tablename = 'receivables'
  ) then
    create policy "Allow authenticated update on receivables"
      on public.receivables for update
      to authenticated
      using (true)
      with check (true);
  end if;
end;
$$;

-- Trigger: auto-update updated_at
create or replace function public.update_receivables_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_receivables_updated_at on public.receivables;
create trigger trg_receivables_updated_at
  before update on public.receivables
  for each row execute function public.update_receivables_updated_at();
