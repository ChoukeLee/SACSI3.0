alter table public.payments
  add column if not exists request_id uuid;

create unique index if not exists payments_request_id_unique
  on public.payments (request_id)
  where request_id is not null;

create or replace function public.record_receivable_payment_rpc(
  p_receivable_id uuid,
  p_payment_date date,
  p_receipt_no text default null,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_receivable public.receivables%rowtype;
  v_payment_id uuid;
  v_amount numeric;
  v_unit_no text;
begin
  if not public.has_app_role('admin', 'finance') then
    raise exception 'financeWritePermissionDenied' using errcode = '42501';
  end if;
  if p_payment_date is null or p_request_id is null then
    raise exception 'invalidPaymentPayload';
  end if;

  select id into v_payment_id from public.payments where request_id = p_request_id;
  if found then
    return jsonb_build_object('success', true, 'payment_id', v_payment_id, 'idempotent', true);
  end if;

  select * into v_receivable
  from public.receivables
  where id = p_receivable_id
  for update;
  if not found or v_receivable.status in ('paid', 'cancelled') then
    raise exception 'receivableNotPayable';
  end if;

  v_amount := greatest(v_receivable.amount_xof - v_receivable.paid_amount_xof, 0);
  if v_amount <= 0 then raise exception 'receivableNotPayable'; end if;
  select unit_no into v_unit_no from public.units where id = v_receivable.unit_id;

  insert into public.payments(
    customer_id, unit_id, source_type, source_id, payment_date, amount,
    currency, exchange_rate_to_xof, receipt_no, request_id
  ) values (
    v_receivable.customer_id, v_receivable.unit_id, v_receivable.source_type,
    v_receivable.source_id, p_payment_date, v_amount, 'XOF', 1,
    nullif(p_receipt_no, ''), p_request_id
  ) returning id into v_payment_id;

  insert into public.ledger_entries(
    building_id, unit_id, payment_id, entry_date, direction, category,
    amount_xof, description
  ) values (
    v_receivable.building_id, v_receivable.unit_id, v_payment_id, p_payment_date,
    'income', v_receivable.category, v_amount,
    trim(v_receivable.title || ' 房间' || coalesce(v_unit_no, '未关联'))
  );

  update public.receivables
  set paid_amount_xof = amount_xof, status = 'paid'
  where id = v_receivable.id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'payment', 'receivable', v_receivable.id,
    jsonb_build_object('amount', v_amount, 'date', p_payment_date,
      'receipt_no', nullif(p_receipt_no, ''), 'payment_id', v_payment_id,
      'request_id', p_request_id));

  return jsonb_build_object('success', true, 'payment_id', v_payment_id, 'idempotent', false);
end;
$$;

create or replace function public.record_sale_payment_rpc(
  p_contract_id uuid,
  p_schedule_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_receipt_no text default null,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_schedule public.sale_payment_schedule%rowtype;
  v_contract public.sale_contracts%rowtype;
  v_receivable public.receivables%rowtype;
  v_payment_id uuid;
  v_unpaid numeric;
  v_new_paid numeric;
  v_new_status text;
  v_unit_no text;
  v_building_id uuid;
  v_category text;
begin
  if not public.has_app_role('admin', 'finance') then
    raise exception 'financeWritePermissionDenied' using errcode = '42501';
  end if;
  if coalesce(p_amount, 0) <= 0 or p_payment_date is null or p_request_id is null then
    raise exception 'invalidPaymentPayload';
  end if;

  select id into v_payment_id from public.payments where request_id = p_request_id;
  if found then
    return jsonb_build_object('success', true, 'payment_id', v_payment_id, 'idempotent', true);
  end if;

  select * into v_schedule from public.sale_payment_schedule
  where id = p_schedule_id and sale_contract_id = p_contract_id for update;
  if not found or v_schedule.status in ('paid', 'cancelled') then
    raise exception 'installmentNotPayable';
  end if;

  select * into v_contract from public.sale_contracts
  where id = p_contract_id and status = 'active' for update;
  if not found then raise exception 'saleContractNotActive'; end if;

  v_category := case when v_contract.payment_plan_type = 'lump_sum'
    then 'sale_lump_sum' else 'sale_installment' end;

  select * into v_receivable from public.receivables
  where source_type = 'sale_contract' and source_id = p_contract_id
    and category = v_category and due_date = v_schedule.due_date
    and amount_xof = v_schedule.amount_xof and status <> 'cancelled'
  order by created_at, id limit 1 for update;
  if not found then raise exception 'saleReceivableMissing'; end if;

  v_unpaid := greatest(v_receivable.amount_xof - v_receivable.paid_amount_xof, 0);
  if p_amount > v_unpaid then raise exception 'paymentExceedsOutstanding'; end if;
  v_new_paid := v_receivable.paid_amount_xof + p_amount;
  v_new_status := case
    when v_new_paid >= v_receivable.amount_xof then 'paid'
    when v_receivable.due_date < current_date then 'overdue'
    else 'partial'
  end;
  select unit_no, building_id into v_unit_no, v_building_id
  from public.units where id = v_contract.unit_id;

  insert into public.payments(
    customer_id, unit_id, source_type, source_id, payment_date, amount,
    currency, exchange_rate_to_xof, receipt_no, request_id
  ) values (
    v_contract.customer_id, v_contract.unit_id, 'sale', p_contract_id,
    p_payment_date, p_amount, 'XOF', 1, nullif(p_receipt_no, ''), p_request_id
  ) returning id into v_payment_id;

  insert into public.ledger_entries(
    building_id, unit_id, payment_id, entry_date, direction, category,
    amount_xof, description
  ) values (
    v_building_id, v_contract.unit_id, v_payment_id, p_payment_date, 'income',
    'sale', p_amount,
    format('出售收款 房间%s 第%s期', coalesce(v_unit_no, '未设置'), v_schedule.installment_no)
  );

  update public.receivables
  set paid_amount_xof = v_new_paid, status = v_new_status
  where id = v_receivable.id;
  update public.sale_payment_schedule
  set status = case when v_new_status = 'paid' then 'paid'::public.payment_status
    when v_schedule.due_date < current_date then 'overdue'::public.payment_status
    else 'pending'::public.payment_status end
  where id = v_schedule.id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'payment', 'sale_contract', p_contract_id,
    jsonb_build_object('amount', p_amount, 'schedule_id', p_schedule_id,
      'receipt_no', nullif(p_receipt_no, ''), 'payment_id', v_payment_id,
      'request_id', p_request_id));

  return jsonb_build_object('success', true, 'payment_id', v_payment_id, 'idempotent', false);
end;
$$;

revoke all on function public.record_receivable_payment_rpc(uuid, date, text, uuid) from public, anon;
revoke all on function public.record_sale_payment_rpc(uuid, uuid, numeric, date, text, uuid) from public, anon;
grant execute on function public.record_receivable_payment_rpc(uuid, date, text, uuid) to authenticated, service_role;
grant execute on function public.record_sale_payment_rpc(uuid, uuid, numeric, date, text, uuid) to authenticated, service_role;
