-- Audit logs v1 enhancement: add missing columns and tighten RLS.

-- Add columns (if not exist)
alter table public.audit_logs
  add column if not exists actor_email text,
  add column if not exists actor_role text,
  add column if not exists entity_label text,
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb;

-- Convert entity_id to text if it's still uuid (allow both uuid and text)
-- Skip: uuid is fine for our use case.

-- Indexes
create index if not exists idx_audit_logs_created_at
  on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_actor_id
  on public.audit_logs (actor_id);
create index if not exists idx_audit_logs_entity_type
  on public.audit_logs (entity_type);
create index if not exists idx_audit_logs_entity_id
  on public.audit_logs (entity_id);
create index if not exists idx_audit_logs_action
  on public.audit_logs (action);

-- Drop overly permissive existing policies
drop policy if exists "Authenticated can read audit_logs" on public.audit_logs;
drop policy if exists "Authenticated can write audit_logs" on public.audit_logs;

-- RLS: insert — any authenticated user can write audit logs (server actions control who calls it)
create policy "Authenticated can insert audit_logs"
  on public.audit_logs for insert
  to authenticated
  with check (true);

-- RLS: select — role-based filtering
-- We use a helper function for readability.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
as $$
  select coalesce(
    (select role::text from public.user_profiles where id = auth.uid()),
    'front_desk'
  );
$$;

-- admin / boss can read all
create policy "Admin and boss can read all audit_logs"
  on public.audit_logs for select
  to authenticated
  using (
    public.current_user_role() in ('admin', 'boss')
  );

-- finance can read finance/payment/receivable-related logs
create policy "Finance can read financial audit_logs"
  on public.audit_logs for select
  to authenticated
  using (
    public.current_user_role() = 'finance'
    and entity_type in ('payment', 'receivable', 'ledger_entry', 'lease_contract', 'sale_contract', 'daily_booking')
  );

-- Others (front_desk) get nothing
-- (no policy = no access)
