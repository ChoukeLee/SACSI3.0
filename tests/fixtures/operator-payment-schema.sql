-- Minimal, synthetic schema for the payment SQL slice, NOT a production schema dump.
-- No credentials or copied business rows. Also used by the temporary loopback test cluster.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema private;
grant usage on schema public, auth, private to authenticated, service_role;
grant usage on schema public, auth to anon;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select (auth.jwt()->>'sub')::uuid;
$$;
-- Compatibility helper used by the existing authenticated-audit trigger.
create function auth.role() returns text language sql stable as $$
  select auth.jwt()->>'role';
$$;
create table auth.users (id uuid primary key, email text);
create table public.user_profiles (id uuid primary key references auth.users, role text, display_name text);
create type public.currency_code as enum ('XOF', 'CNY', 'EUR', 'USD');
create table public.buildings (id uuid primary key, code text, display_name text);
create table public.customers (id uuid primary key, name text);
create table public.units (
  id uuid primary key, building_id uuid references public.buildings, code text, unit_no text
);
create table public.daily_bookings (
  id uuid primary key, unit_id uuid not null references public.units,
  customer_id uuid not null references public.customers, booking_agent_id uuid not null references public.customers,
  guest_customer_id uuid references public.customers, guest_name text,
  check_in date not null, check_out date, actual_check_out date,
  nightly_price_xof numeric(14,2) not null, total_amount_xof numeric(14,2) not null,
  prepaid_amount_xof numeric(14,2) not null default 0, final_amount_xof numeric(14,2),
  manual_discount_amount_xof numeric(14,2) not null default 0,
  status text not null, checkout_mode text not null default 'fixed', billing_status text not null default 'need_top_up',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(), customer_id uuid references public.customers,
  unit_id uuid references public.units, source_type text not null, source_id uuid,
  payment_date date not null, amount numeric(14,2) not null, currency public.currency_code not null,
  exchange_rate_to_xof numeric(14,6) not null, receipt_no text, request_id uuid unique, request_kind text,
  reversal_of_payment_id uuid references public.payments, reversal_reason text, notes text,
  created_at timestamptz not null default now()
);
create unique index payments_one_reversal_per_payment_key on public.payments(reversal_of_payment_id)
where reversal_of_payment_id is not null;
create table public.receivables (
  id uuid primary key default gen_random_uuid(), building_id uuid references public.buildings,
  unit_id uuid references public.units, customer_id uuid references public.customers,
  source_type text not null, source_id uuid, category text not null, due_date date not null,
  amount_xof numeric(14,2) not null, paid_amount_xof numeric(14,2) not null default 0,
  status text not null, currency public.currency_code not null default 'XOF',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(), building_id uuid references public.buildings,
  unit_id uuid references public.units, payment_id uuid references public.payments,
  entry_date date not null, direction text not null, category text not null,
  amount_xof numeric(14,2) not null, description text
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid, actor_email text, actor_role text,
  action text not null, entity_type text not null, entity_id uuid, entity_label text,
  before_data jsonb, after_data jsonb, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.cleaning_tasks (id uuid primary key, unit_id uuid, created_at timestamptz default now());
-- No direct business-table privileges for callers. Successful RPC calls must
-- cross the actual invoker/definer boundary, not run as the fixture owner.
alter table public.payments enable row level security;
alter table public.receivables enable row level security;
alter table public.daily_bookings enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_logs enable row level security;
