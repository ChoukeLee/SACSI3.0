-- Create a sale contract, schedule, receivables and unit-state change in one transaction.

begin;

alter table public.sale_contracts add column if not exists request_id uuid;
create unique index if not exists sale_contracts_request_id_unique
  on public.sale_contracts(request_id) where request_id is not null;

create or replace function public.create_sale_contract_rpc(
  p_unit_id uuid,
  p_customer_id uuid,
  p_contract_no text,
  p_signed_date date,
  p_total_amount_xof numeric,
  p_payment_plan_type text,
  p_num_installments integer default null,
  p_transfer_date date default null,
  p_agency_company text default null,
  p_agent_name text default null,
  p_agency_commission_xof numeric default null,
  p_agency_commission_paid boolean default false,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_contract_id uuid;
  v_building_id uuid;
  v_installments integer;
  v_base_amount numeric;
  v_amount numeric;
  v_due_date date;
  v_index integer;
  v_category text;
begin
  if not public.has_app_role('admin') then
    raise exception 'saleCreatePermissionDenied' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;
  if p_unit_id is null or p_customer_id is null or p_signed_date is null
    or coalesce(p_total_amount_xof, 0) <= 0 or nullif(trim(p_contract_no), '') is null then
    raise exception 'invalidSaleContractPayload';
  end if;
  if p_payment_plan_type not in ('lump_sum', 'fixed_installment', 'flexible_installment') then
    raise exception 'invalidSalePaymentPlan';
  end if;

  select id into v_contract_id from public.sale_contracts where request_id = p_request_id;
  if v_contract_id is not null then
    return jsonb_build_object('success', true, 'contract_id', v_contract_id, 'idempotent', true);
  end if;

  perform 1 from public.units where id = p_unit_id for update;
  if not found then raise exception 'unitNotFound'; end if;
  if exists (
    select 1 from public.sale_contracts
    where unit_id = p_unit_id and status in ('draft', 'active')
  ) then
    raise exception 'unitAlreadyHasCurrentSale';
  end if;
  select building_id into v_building_id from public.units where id = p_unit_id;

  insert into public.sale_contracts(
    unit_id, customer_id, contract_no, signed_date, transfer_date,
    transfer_status, agency_company, agent_name, agency_commission_amount_xof,
    agency_commission_paid, payment_plan_type, total_amount_xof, status, request_id
  ) values (
    p_unit_id, p_customer_id, trim(p_contract_no), p_signed_date, p_transfer_date,
    'not_started', nullif(trim(coalesce(p_agency_company, '')), ''),
    nullif(trim(coalesce(p_agent_name, '')), ''), p_agency_commission_xof,
    coalesce(p_agency_commission_paid, false), p_payment_plan_type,
    p_total_amount_xof, 'active', p_request_id
  ) returning id into v_contract_id;

  if p_payment_plan_type = 'lump_sum' then
    v_installments := 1;
    v_category := 'sale_lump_sum';
  elsif p_payment_plan_type = 'fixed_installment' then
    v_installments := p_num_installments;
    v_category := 'sale_installment';
    if coalesce(v_installments, 0) < 2 or v_installments > 120 then
      raise exception 'invalidInstallmentCount';
    end if;
  else
    v_installments := 0;
    v_category := 'sale_installment';
  end if;

  if v_installments > 0 then
    v_base_amount := round(p_total_amount_xof / v_installments, 2);
    for v_index in 1..v_installments loop
      v_due_date := case when p_payment_plan_type = 'lump_sum'
        then p_signed_date
        else (p_signed_date + make_interval(months => v_index))::date end;
      v_amount := case when v_index = v_installments
        then p_total_amount_xof - v_base_amount * (v_installments - 1)
        else v_base_amount end;

      insert into public.sale_payment_schedule(
        sale_contract_id, installment_no, due_date, amount_xof, status
      ) values (
        v_contract_id, v_index, v_due_date, v_amount,
        case when v_due_date < current_date then 'overdue'::public.payment_status else 'pending'::public.payment_status end
      );

      insert into public.receivables(
        building_id, unit_id, customer_id, source_type, source_id, category,
        title, due_date, amount_xof, paid_amount_xof, status, currency
      ) values (
        v_building_id, p_unit_id, p_customer_id, 'sale_contract', v_contract_id,
        v_category,
        case when p_payment_plan_type = 'lump_sum'
          then '出售房款 ' || trim(p_contract_no)
          else format('出售分期 %s 第%s期', trim(p_contract_no), v_index) end,
        v_due_date, v_amount, 0,
        case when v_due_date < current_date then 'overdue' else 'pending' end,
        'XOF'
      );
    end loop;
  end if;

  update public.units set status = 'sold', updated_at = now() where id = p_unit_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'create', 'sale_contract', v_contract_id,
    jsonb_build_object('contract_no', trim(p_contract_no), 'payment_plan', p_payment_plan_type, 'request_id', p_request_id)
  );

  return jsonb_build_object('success', true, 'contract_id', v_contract_id, 'idempotent', false);
exception
  when unique_violation then
    if exists (select 1 from public.sale_contracts where request_id = p_request_id) then
      select id into v_contract_id from public.sale_contracts where request_id = p_request_id;
      return jsonb_build_object('success', true, 'contract_id', v_contract_id, 'idempotent', true);
    end if;
    raise;
end;
$$;

revoke all on function public.create_sale_contract_rpc(uuid, uuid, text, date, numeric, text, integer, date, text, text, numeric, boolean, uuid) from public, anon;
grant execute on function public.create_sale_contract_rpc(uuid, uuid, text, date, numeric, text, integer, date, text, text, numeric, boolean, uuid) to authenticated, service_role;

commit;
