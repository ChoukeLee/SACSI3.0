-- System settings v1: centralized configuration store.

create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value jsonb not null default '{}'::jsonb,
  category text not null default 'general',
  description text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create index if not exists idx_system_settings_key on public.system_settings (key);
create index if not exists idx_system_settings_category on public.system_settings (category);

alter table public.system_settings enable row level security;

-- admin can read/write all
create policy "Admin can manage settings" on public.system_settings for all
  to authenticated
  using (exists (select 1 from public.user_profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.user_profiles where id = auth.uid() and role = 'admin'));

-- all authenticated can read
create policy "Authenticated can read settings" on public.system_settings for select
  to authenticated
  using (true);

-- Seed defaults
insert into public.system_settings (key, value, category, description) values
  ('company_name', '"科建地产"', 'general', '公司名称'),
  ('project_name', '"SACIS 3.0"', 'general', '项目名称'),
  ('default_currency', '"XOF"', 'general', '默认币种'),
  ('default_daily_price', '40000', 'daily_rules', '日租默认价格'),
  ('open_checkout_alert_days', '3', 'daily_rules', '开放式入住超天数提醒'),
  ('accommodation_unit_types', '["apartment"]', 'unit_rules', '住宿房类型列表'),
  ('overdue_grace_days', '0', 'finance_rules', '逾期宽限天数'),
  ('receipt_number_prefix', '"RCP"', 'print_rules', '收据编号前缀'),
  ('contract_prefix', '"CT"', 'print_rules', '合同编号前缀'),
  ('print_company_name', '"科建地产"', 'print_rules', '打印公司名称'),
  ('print_footer_text', '"SACIS 3.0 — 科建地产房屋管理系统"', 'print_rules', '打印页脚'),
  ('lease_expiry_warning_days', '30', 'reminder_rules', '长租到期提醒天数'),
  ('receivable_overdue_warning_days', '7', 'reminder_rules', '应收逾期提醒天数')
on conflict (key) do nothing;
