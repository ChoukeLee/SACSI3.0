-- Lease settlements v1: formal settlement record for move-out.
-- Captures unpaid rent, deposit handling, and utility clearance.

create table if not exists public.lease_settlements (
  id uuid primary key default gen_random_uuid(),
  lease_contract_id uuid not null references public.lease_contracts(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  customer_id uuid not null references public.customers(id),

  actual_end_date date not null,

  unpaid_rent_xof numeric(14,2) not null default 0,
  utility_cleared boolean not null default false,
  deposit_amount_xof numeric(14,2) not null default 0,
  deposit_deduction_xof numeric(14,2) not null default 0,
  deposit_refund_xof numeric(14,2) not null default 0,

  total_due_xof numeric(14,2) not null default 0,
  total_refund_xof numeric(14,2) not null default 0,

  notes text,

  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_lease_settlements_contract
  on public.lease_settlements (lease_contract_id);
create index if not exists idx_lease_settlements_unit
  on public.lease_settlements (unit_id);
create index if not exists idx_lease_settlements_end_date
  on public.lease_settlements (actual_end_date);

-- RLS
alter table public.lease_settlements enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'Allow authenticated select on lease_settlements'
      and tablename = 'lease_settlements'
  ) then
    create policy "Allow authenticated select on lease_settlements"
      on public.lease_settlements for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'Allow authenticated insert on lease_settlements'
      and tablename = 'lease_settlements'
  ) then
    create policy "Allow authenticated insert on lease_settlements"
      on public.lease_settlements for insert
      to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where policyname = 'Allow authenticated update on lease_settlements'
      and tablename = 'lease_settlements'
  ) then
    create policy "Allow authenticated update on lease_settlements"
      on public.lease_settlements for update
      to authenticated
      using (true)
      with check (true);
  end if;
end;
$$;
