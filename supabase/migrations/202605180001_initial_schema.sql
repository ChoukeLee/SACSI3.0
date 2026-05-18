create extension if not exists pgcrypto;

create type public.unit_kind as enum ('apartment', 'parking', 'storefront', 'office');
create type public.unit_status as enum (
  'available',
  'reserved',
  'daily_occupied',
  'cleaning_pending',
  'leased',
  'sold',
  'maintenance',
  'locked'
);
create type public.business_type as enum ('daily_rental', 'long_lease', 'sale');
create type public.contract_status as enum ('draft', 'active', 'terminated', 'expired');
create type public.payment_status as enum ('pending', 'paid', 'overdue', 'cancelled');
create type public.currency_code as enum ('XOF', 'CNY');

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  address text,
  district text,
  city text,
  built_year integer,
  floors_above_ground integer not null default 0,
  elevator_count integer not null default 0,
  is_active boolean not null default true,
  business_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  code text not null unique,
  unit_no text not null,
  floor_label text not null,
  kind public.unit_kind not null default 'apartment',
  status public.unit_status not null default 'available',
  area_sqm numeric(10, 2),
  layout text,
  furnishing text check (furnishing in ('none', 'basic', 'full') or furnishing is null),
  notes text check (char_length(notes) <= 500 or notes is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, unit_no)
);

create table public.unit_business_flags (
  unit_id uuid not null references public.units(id) on delete cascade,
  business_type public.business_type not null,
  is_enabled boolean not null default true,
  default_price_xof numeric(14, 2),
  primary key (unit_id, business_type)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gender text,
  document_type text,
  encrypted_document_no text,
  phone text,
  notes text,
  is_blacklisted boolean not null default false,
  blacklist_reason text,
  blacklist_operator_id uuid,
  blacklist_date date,
  blacklist_permanent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_bookings (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  customer_id uuid not null references public.customers(id),
  check_in date not null,
  check_out date not null,
  nightly_price_xof numeric(14, 2) not null default 40000,
  total_amount_xof numeric(14, 2) not null,
  prepaid_amount_xof numeric(14, 2) not null default 0,
  status text not null default 'pending_review',
  ota_source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out > check_in)
);

create table public.lease_contracts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  customer_id uuid not null references public.customers(id),
  contract_no text not null unique,
  start_date date not null,
  expected_end_date date not null,
  actual_end_date date,
  payment_cycle text not null,
  payment_day integer not null check (payment_day between 1 and 31),
  monthly_rent_xof numeric(14, 2) not null,
  deposit_amount_xof numeric(14, 2) not null default 0,
  deposit_received boolean not null default false,
  rent_free_days integer not null default 0,
  signer_name text,
  attachment_url text,
  status public.contract_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index lease_one_active_contract_per_unit
  on public.lease_contracts (unit_id)
  where status = 'active';

create table public.sale_contracts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  customer_id uuid not null references public.customers(id),
  contract_no text not null unique,
  signed_date date not null,
  transfer_date date,
  transfer_status text not null default 'not_started',
  title_certificate_no text,
  agency_company text,
  agent_name text,
  agency_commission_amount_xof numeric(14, 2),
  agency_commission_paid boolean not null default false,
  payment_plan_type text not null,
  total_amount_xof numeric(14, 2) not null,
  attachment_url text,
  status public.contract_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sale_payment_schedule (
  id uuid primary key default gen_random_uuid(),
  sale_contract_id uuid not null references public.sale_contracts(id) on delete cascade,
  installment_no integer not null,
  due_date date not null,
  amount_xof numeric(14, 2) not null,
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  unit_id uuid references public.units(id),
  source_type text not null,
  source_id uuid,
  payment_date date not null,
  amount numeric(14, 2) not null,
  currency public.currency_code not null default 'XOF',
  exchange_rate_to_xof numeric(14, 6) not null default 1,
  receipt_no text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references public.buildings(id),
  unit_id uuid references public.units(id),
  payment_id uuid references public.payments(id),
  entry_date date not null,
  direction text not null check (direction in ('income', 'expense', 'liability_in', 'liability_out')),
  category text not null,
  amount_xof numeric(14, 2) not null,
  amount_cny numeric(14, 2),
  description text,
  created_at timestamptz not null default now()
);

create table public.cleaning_tasks (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  daily_booking_id uuid references public.daily_bookings(id),
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  building_id uuid references public.buildings(id),
  title text not null,
  body text not null,
  channel text not null default 'in_app',
  due_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.buildings enable row level security;
alter table public.units enable row level security;
alter table public.unit_business_flags enable row level security;
alter table public.customers enable row level security;
alter table public.daily_bookings enable row level security;
alter table public.lease_contracts enable row level security;
alter table public.sale_contracts enable row level security;
alter table public.sale_payment_schedule enable row level security;
alter table public.payments enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.cleaning_tasks enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
