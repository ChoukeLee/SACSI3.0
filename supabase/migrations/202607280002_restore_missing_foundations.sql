-- Restore schema objects that are present in the repository migration history
-- but missing from the production database. All statements are idempotent.

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
create index if not exists idx_lease_settlements_contract on public.lease_settlements (lease_contract_id);
create index if not exists idx_lease_settlements_unit on public.lease_settlements (unit_id);
create index if not exists idx_lease_settlements_end_date on public.lease_settlements (actual_end_date);
alter table public.lease_settlements enable row level security;

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

create or replace function public.update_targets_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_targets_updated_at on public.business_targets;
create trigger trg_targets_updated_at
before update on public.business_targets
for each row execute function public.update_targets_updated_at();

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

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  bucket text not null default 'receipts',
  file_type text not null default 'receipt_image',
  linked_type text not null,
  linked_id uuid not null,
  unit_id uuid references public.units(id),
  customer_id uuid references public.customers(id),
  uploaded_by uuid,
  uploaded_at timestamptz default now(),
  original_filename text,
  mime_type text,
  file_size integer,
  ocr_text text,
  ocr_provider text,
  paper_archive_status text not null default 'pending',
  paper_archive_location text,
  metadata jsonb default '{}'::jsonb
);
alter table public.attachments enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, '{image/jpeg,image/png,image/webp,application/pdf}')
on conflict (id) do nothing;

-- Transactional receipt confirmation. Authorization is checked both here and
-- in the API/RLS layers, and audit identity always comes from auth.uid().
create or replace function public.confirm_receipt_payment(payload jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_room_no text := payload->>'room_no';
  v_receipt_no text := nullif(payload->>'receipt_no', '');
  v_receipt_date date := (payload->>'receipt_date')::date;
  v_amount_xof numeric := (payload->>'amount_xof')::numeric;
  v_currency text := coalesce(nullif(payload->>'currency', ''), 'XOF');
  v_period_start date := nullif(payload->>'period_start', '')::date;
  v_period_end date := nullif(payload->>'period_end', '')::date;
  v_business_type text := nullif(payload->>'business_type', '');
  v_payer_name text := nullif(payload->>'payer_name', '');
  v_notes text := nullif(payload->>'notes', '');
  v_image_path text := nullif(payload->>'image_path', '');
  v_ocr_text text := nullif(payload->>'ocr_text', '');
  v_ocr_provider text := coalesce(nullif(payload->>'ocr_provider', ''), 'manual');
  v_override_duplicate boolean := coalesce((payload->>'overrideDuplicate')::boolean, false);
  v_unit_id uuid;
  v_building_id uuid;
  v_source_type text;
  v_matched_receivable_id uuid;
  v_payment_id uuid;
  v_attachment_id uuid;
  v_payment_source_type text;
  v_payment_source_id uuid;
  v_payment_customer_id uuid;
  v_matched_source_type text;
  v_matched_source_id uuid;
  v_matched_customer_id uuid;
  v_matched_amount_xof numeric;
  v_matched_paid_xof numeric;
  v_existing record;
begin
  if public.current_user_role() not in ('admin', 'finance') then
    raise exception 'financeWritePermissionDenied' using errcode = '42501';
  end if;
  if v_room_no is null or v_receipt_date is null or coalesce(v_amount_xof, 0) <= 0 then
    raise exception 'invalidReceiptPayload';
  end if;

  select u.id, u.building_id
  into v_unit_id, v_building_id
  from public.units u
  where u.unit_no = v_room_no
    and (
      nullif(payload->>'building_id', '') is null
      or u.building_id = (payload->>'building_id')::uuid
    );
  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found: ' || v_room_no);
  end if;

  v_source_type := case v_business_type
    when 'daily_rental' then 'daily_booking'
    when 'lease_rent' then 'lease_contract'
    when 'managed_lease_rent' then 'lease_contract'
    when 'sale' then 'sale_contract'
    else 'manual'
  end;

  if v_receipt_no is not null then
    select p.id, p.payment_date, p.amount
    into v_existing
    from public.payments p
    join public.units u on u.id = p.unit_id
    where p.receipt_no = v_receipt_no
      and extract(year from p.payment_date) = extract(year from v_receipt_date)
      and u.building_id = v_building_id
    limit 1;
    if found and not v_override_duplicate then
      return jsonb_build_object(
        'success', false,
        'requiresOverride', true,
        'duplicateWarning', format(
          'Duplicate receipt %s (amount %s, date %s)',
          v_receipt_no, v_existing.amount, v_existing.payment_date
        )
      );
    end if;
  end if;

  if v_source_type <> 'manual' then
    if v_period_start is not null and v_period_end is not null then
      select id, source_id, source_type, customer_id, amount_xof, paid_amount_xof
      into v_matched_receivable_id, v_matched_source_id, v_matched_source_type,
           v_matched_customer_id, v_matched_amount_xof, v_matched_paid_xof
      from public.receivables
      where unit_id = v_unit_id
        and source_type = v_source_type
        and status not in ('paid', 'cancelled')
        and due_date between v_period_start and v_period_end
      order by due_date, created_at
      limit 1
      for update;
    end if;

    if v_matched_receivable_id is null then
      select id, source_id, source_type, customer_id, amount_xof, paid_amount_xof
      into v_matched_receivable_id, v_matched_source_id, v_matched_source_type,
           v_matched_customer_id, v_matched_amount_xof, v_matched_paid_xof
      from public.receivables
      where unit_id = v_unit_id
        and source_type = v_source_type
        and status not in ('paid', 'cancelled')
      order by abs((amount_xof - paid_amount_xof) - v_amount_xof), due_date
      limit 1
      for update;
      if v_matched_receivable_id is not null
        and abs((v_matched_amount_xof - v_matched_paid_xof) - v_amount_xof) > v_amount_xof * 0.5
      then
        v_matched_receivable_id := null;
      end if;
    end if;
  end if;

  if v_matched_receivable_id is not null then
    v_payment_source_type := v_matched_source_type;
    v_payment_source_id := v_matched_source_id;
    v_payment_customer_id := v_matched_customer_id;
    update public.receivables
    set paid_amount_xof = paid_amount_xof + v_amount_xof,
        status = case
          when paid_amount_xof + v_amount_xof >= amount_xof then 'paid'
          else 'partial'
        end,
        updated_at = now()
    where id = v_matched_receivable_id;
  else
    v_payment_source_type := v_source_type;
  end if;

  insert into public.payments (
    unit_id, customer_id, source_type, source_id, payment_date,
    amount, currency, exchange_rate_to_xof, receipt_no, notes
  )
  values (
    v_unit_id, v_payment_customer_id, v_payment_source_type, v_payment_source_id,
    v_receipt_date, v_amount_xof, v_currency, 1, v_receipt_no, v_notes
  )
  returning id into v_payment_id;

  insert into public.ledger_entries (
    building_id, unit_id, payment_id, entry_date, direction,
    category, amount_xof, description
  )
  values (
    v_building_id, v_unit_id, v_payment_id, v_receipt_date, 'income',
    coalesce(v_business_type, 'manual'), v_amount_xof,
    trim('Receipt scan: ' || coalesce(v_receipt_no, 'no receipt no') ||
      ' | ' || coalesce(v_payer_name, ''))
  );

  if v_image_path is not null then
    insert into public.attachments (
      storage_path, bucket, file_type, linked_type, linked_id, unit_id,
      customer_id, uploaded_by, ocr_text, ocr_provider, metadata
    )
    values (
      v_image_path, 'receipts', 'receipt_image', 'payment', v_payment_id,
      v_unit_id, v_payment_customer_id, auth.uid(), v_ocr_text, v_ocr_provider,
      jsonb_build_object(
        'receipt_no', v_receipt_no,
        'period_start', v_period_start,
        'period_end', v_period_end,
        'business_type', v_business_type,
        'receipt_date', v_receipt_date,
        'amount_xof', v_amount_xof
      )
    )
    returning id into v_attachment_id;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'receipt_scan_confirm', 'payment', v_payment_id,
    jsonb_build_object(
      'room_no', v_room_no,
      'unit_id', v_unit_id,
      'amount_xof', v_amount_xof,
      'receipt_no', v_receipt_no,
      'receipt_date', v_receipt_date,
      'business_type', v_business_type,
      'attachment_id', v_attachment_id,
      'matched_receivable_id', v_matched_receivable_id,
      'unmatched_receivable', v_matched_receivable_id is null
    )
  );

  return jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'attachmentId', v_attachment_id,
    'matchedReceivableId', v_matched_receivable_id,
    'unmatchedReceivable', v_matched_receivable_id is null,
    'duplicateOverridden', v_override_duplicate
  );
end;
$$;

revoke all on function public.confirm_receipt_payment(jsonb) from public, anon;
grant execute on function public.confirm_receipt_payment(jsonb) to authenticated, service_role;
