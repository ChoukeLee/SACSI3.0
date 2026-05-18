-- Basic RLS: authenticated users can read all tables.
-- Write policies are role-gated via application-level checks.
-- This migration ensures no unauthenticated access.

-- Buildings
create policy "Authenticated can read buildings"
  on public.buildings for select
  using (auth.role() = 'authenticated');

-- Units
create policy "Authenticated can read units"
  on public.units for select
  using (auth.role() = 'authenticated');

-- Unit business flags
create policy "Authenticated can read unit_business_flags"
  on public.unit_business_flags for select
  using (auth.role() = 'authenticated');

-- Customers
create policy "Authenticated can read customers"
  on public.customers for select
  using (auth.role() = 'authenticated');

-- Daily bookings
create policy "Authenticated can read daily_bookings"
  on public.daily_bookings for select
  using (auth.role() = 'authenticated');

-- Lease contracts
create policy "Authenticated can read lease_contracts"
  on public.lease_contracts for select
  using (auth.role() = 'authenticated');

-- Sale contracts
create policy "Authenticated can read sale_contracts"
  on public.sale_contracts for select
  using (auth.role() = 'authenticated');

-- Sale payment schedule
create policy "Authenticated can read sale_payment_schedule"
  on public.sale_payment_schedule for select
  using (auth.role() = 'authenticated');

-- Payments
create policy "Authenticated can read payments"
  on public.payments for select
  using (auth.role() = 'authenticated');

-- Ledger entries
create policy "Authenticated can read ledger_entries"
  on public.ledger_entries for select
  using (auth.role() = 'authenticated');

-- Cleaning tasks
create policy "Authenticated can read cleaning_tasks"
  on public.cleaning_tasks for select
  using (auth.role() = 'authenticated');

-- Notifications
create policy "Authenticated can read own notifications"
  on public.notifications for select
  using (auth.role() = 'authenticated');

-- Audit logs
create policy "Authenticated can read audit_logs"
  on public.audit_logs for select
  using (auth.role() = 'authenticated');

-- User profiles
create policy "Authenticated can read profiles"
  on public.user_profiles for select
  using (auth.role() = 'authenticated');

-- Allow all authenticated users to insert/update/delete on business tables
-- (finer-grained restrictions enforced at application level via auth.ts permission checks)

create policy "Authenticated can write buildings"
  on public.buildings for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can write units"
  on public.units for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update units"
  on public.units for update
  using (auth.role() = 'authenticated');

create policy "Authenticated can write customers"
  on public.customers for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update customers"
  on public.customers for update
  using (auth.role() = 'authenticated');

create policy "Authenticated can write daily_bookings"
  on public.daily_bookings for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update daily_bookings"
  on public.daily_bookings for update
  using (auth.role() = 'authenticated');

create policy "Authenticated can write lease_contracts"
  on public.lease_contracts for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update lease_contracts"
  on public.lease_contracts for update
  using (auth.role() = 'authenticated');

create policy "Authenticated can write sale_contracts"
  on public.sale_contracts for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update sale_contracts"
  on public.sale_contracts for update
  using (auth.role() = 'authenticated');

create policy "Authenticated can write sale_payment_schedule"
  on public.sale_payment_schedule for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update sale_payment_schedule"
  on public.sale_payment_schedule for update
  using (auth.role() = 'authenticated');

create policy "Authenticated can write payments"
  on public.payments for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can write ledger_entries"
  on public.ledger_entries for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can write cleaning_tasks"
  on public.cleaning_tasks for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update cleaning_tasks"
  on public.cleaning_tasks for update
  using (auth.role() = 'authenticated');

create policy "Authenticated can write notifications"
  on public.notifications for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can write audit_logs"
  on public.audit_logs for insert
  with check (auth.role() = 'authenticated');
