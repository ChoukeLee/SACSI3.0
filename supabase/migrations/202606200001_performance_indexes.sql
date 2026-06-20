-- Performance indexes for frequently queried tables
-- Created after profiling slow page loads across the app

-- daily_bookings: filtered by status, ordered by check_in
create index if not exists idx_daily_bookings_status_check_in
  on public.daily_bookings (status, check_in desc);

-- units: filtered by building_id + status (the most common query pattern)
create index if not exists idx_units_building_id_status
  on public.units (building_id, status);

-- unit_business_flags: filtered by unit_id + business_type + is_enabled flag
create index if not exists idx_unit_business_flags_lookup
  on public.unit_business_flags (unit_id, business_type, is_enabled);

-- payments: filtered by source_type, ordered by payment_date desc
create index if not exists idx_payments_source_type_date
  on public.payments (source_type, payment_date desc);

-- cleaning_tasks: filtered by unit_id + completion status
create index if not exists idx_cleaning_tasks_unit_status
  on public.cleaning_tasks (unit_id, is_completed);

-- lease_contracts: filtered by general status (not just 'active')
create index if not exists idx_lease_contracts_status
  on public.lease_contracts (status);

-- sale_contracts: filtered by status
create index if not exists idx_sale_contracts_status
  on public.sale_contracts (status);

-- sale_payment_schedule: filtered by contract + status + due_date
create index if not exists idx_sale_payment_schedule_contract_status
  on public.sale_payment_schedule (sale_contract_id, status, due_date);

-- ledger_entries: ordered by entry_date desc, filtered by building_id
create index if not exists idx_ledger_entries_date
  on public.ledger_entries (entry_date desc);
create index if not exists idx_ledger_entries_building_date
  on public.ledger_entries (building_id, entry_date desc);

-- notifications: filtered by user_id + read status
create index if not exists idx_notifications_user_read
  on public.notifications (user_id, read_at);

-- customers: ordered by name (frequent alphabetical listing)
create index if not exists idx_customers_name
  on public.customers (name);
