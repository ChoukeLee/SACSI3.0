begin;

-- Daily rental identity fields. customer_id remains the legacy compatibility
-- field until every historical consumer has migrated to booking_agent_id.
alter table public.daily_bookings
  add column if not exists booking_agent_id uuid references public.customers(id) on delete restrict,
  add column if not exists guest_customer_id uuid references public.customers(id) on delete set null,
  add column if not exists guest_name text;

update public.daily_bookings
set booking_agent_id = customer_id
where booking_agent_id is null;

create or replace function public.sync_daily_booking_agent_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.booking_agent_id := coalesce(new.booking_agent_id, new.customer_id);
  if new.booking_agent_id is null then
    raise exception 'dailyBookingAgentRequired';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_daily_booking_agent_identity on public.daily_bookings;
create trigger trg_sync_daily_booking_agent_identity
before insert or update of customer_id, booking_agent_id on public.daily_bookings
for each row execute function public.sync_daily_booking_agent_identity();

alter table public.daily_bookings
  alter column booking_agent_id set not null;

create index if not exists idx_daily_bookings_booking_agent
  on public.daily_bookings (booking_agent_id);

create index if not exists idx_daily_bookings_guest_customer
  on public.daily_bookings (guest_customer_id)
  where guest_customer_id is not null;

comment on column public.daily_bookings.customer_id is
  'Legacy compatibility identity. New code must use booking_agent_id for the handler and guest_customer_id/guest_name for the actual guest.';
comment on column public.daily_bookings.booking_agent_id is
  'Operational handler selected from the approved daily-rental handler list.';
comment on column public.daily_bookings.guest_customer_id is
  'Optional registered actual guest. This is distinct from the booking handler.';
comment on column public.daily_bookings.guest_name is
  'Optional actual guest display name when no customer profile is registered.';

-- Allow an incomplete sale to exist as a draft without inventing a total.
alter table public.sale_contracts
  alter column total_amount_xof drop not null,
  add column if not exists total_amount_confirmed boolean not null default true;

comment on column public.sale_contracts.total_amount_confirmed is
  'False means the sale is an incomplete draft; outstanding amount and collection rate must not be calculated.';

-- Payment method is a structured fact. Existing null values mean unknown.
alter table public.payments
  add column if not exists payment_method text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_payment_method_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_payment_method_check
      check (payment_method is null or payment_method in ('cash', 'check', 'bank_transfer', 'offset', 'other'));
  end if;
end
$$;

comment on column public.payments.payment_method is
  'Structured payment method. Null means unknown and must not be displayed as cash.';

-- Replace the lease financial RPC so that payment method is mandatory, the
-- caller identity is retained, and paid_through_date is the only lease date
-- changed by a rent payment.
create or replace function public.record_lease_financial_entry_rpc(
  p_contract_id uuid,
  p_business_type text,
  p_payment_date date,
  p_amount_xof numeric,
  p_paid_through_date date default null,
  p_payment_method text default null,
  p_notes text default null,
  p_reference_prefix text default 'LEASE',
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.lease_contracts%rowtype;
  v_unit public.units%rowtype;
  v_source_type text;
  v_direction text;
  v_category text;
  v_label text;
  v_payment_id uuid;
  v_existing_contract_id uuid;
  v_existing_kind text;
  v_reference_no text;
  v_sequence integer;
  v_remaining numeric;
  v_applied numeric;
  v_receivable record;
  v_note text;
begin
  if (select auth.uid()) is null
    or not public.has_app_role('admin', 'finance') then
    raise exception 'leaseFinancePermissionDenied' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;
  if p_payment_date is null or coalesce(p_amount_xof, 0) <= 0 then
    raise exception 'invalidLeaseFinancialPayload';
  end if;
  if p_payment_method is null
    or p_payment_method not in ('cash', 'check', 'bank_transfer', 'offset', 'other') then
    raise exception 'paymentMethodRequired';
  end if;
  if p_business_type = 'rent_income' and p_paid_through_date is null then
    raise exception 'paidThroughDateRequired';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select source_id, request_kind
    into v_existing_contract_id, v_existing_kind
  from public.payments
  where request_id = p_request_id;
  if v_existing_contract_id is not null then
    if v_existing_contract_id <> p_contract_id
      or v_existing_kind is distinct from 'lease_financial_entry' then
      raise exception 'requestIdConflict';
    end if;
    select id, receipt_no into v_payment_id, v_reference_no
    from public.payments where request_id = p_request_id;
    return jsonb_build_object(
      'success', true,
      'payment_id', v_payment_id,
      'reference_no', v_reference_no,
      'idempotent', true
    );
  end if;

  select * into v_contract
  from public.lease_contracts
  where id = p_contract_id
  for update;
  if v_contract.id is null then raise exception 'leaseContractNotFound'; end if;

  select * into v_unit
  from public.units
  where id = v_contract.unit_id;

  select source_type, direction, category, label
  into v_source_type, v_direction, v_category, v_label
  from (values
    ('rent_income',         'lease_rent',              'income',        'lease_rent',          '租金收入'),
    ('deposit_income',      'lease_deposit',           'liability_in',  'lease_deposit',       '押金收入'),
    ('agency_income',       'lease_agency_income',     'income',        'lease_agency_income', '中介费收入'),
    ('agency_expense',      'lease_agency_expense',    'expense',       'lease_agency_expense','中介费支出'),
    ('property_fee_income', 'property_fee',            'income',        'property_fee',        '物业费收入'),
    ('furniture_income',    'lease_furniture_income',  'income',        'furniture_fee',       '家具费收入'),
    ('deposit_refund',      'lease_deposit_refund',    'liability_out', 'lease_deposit',       '押金退还'),
    ('other_income',        'lease_other_income',      'income',        'other_income',        '其他收入'),
    ('other_expense',       'lease_other_expense',     'expense',       'other_expense',       '其他支出')
  ) as config(business_type, source_type, direction, category, label)
  where business_type = p_business_type;
  if v_source_type is null then raise exception 'unsupportedLeaseFinancialType'; end if;

  select coalesce(max((regexp_match(receipt_no, '-([0-9]+)$'))[1]::integer), 0) + 1
    into v_sequence
  from public.payments
  where source_id = p_contract_id
    and receipt_no like p_reference_prefix || '-%';
  v_reference_no := p_reference_prefix || '-' || lpad(v_sequence::text, 2, '0');
  v_note := concat_ws('；',
    '业务类型：' || v_label,
    '方式：' || case p_payment_method
      when 'cash' then '现金'
      when 'check' then '支票'
      when 'bank_transfer' then '银行转账'
      when 'offset' then '抵扣/转款'
      else '其他'
    end,
    case when p_paid_through_date is not null then '已缴至：' || p_paid_through_date::text end,
    nullif(trim(coalesce(p_notes, '')), '')
  );

  insert into public.payments(
    customer_id, unit_id, source_type, source_id, payment_date, amount,
    currency, exchange_rate_to_xof, receipt_no, notes, payment_method,
    request_id, request_kind
  ) values (
    v_contract.customer_id, v_contract.unit_id, v_source_type, v_contract.id,
    p_payment_date, p_amount_xof, 'XOF', 1, v_reference_no, v_note,
    p_payment_method, p_request_id, 'lease_financial_entry'
  ) returning id into v_payment_id;

  insert into public.ledger_entries(
    building_id, unit_id, payment_id, entry_date, direction, category,
    amount_xof, description
  ) values (
    v_unit.building_id, v_contract.unit_id, v_payment_id, p_payment_date,
    v_direction, v_category, p_amount_xof,
    v_label || ' 房间' || coalesce(v_unit.unit_no, '未设置') || ' 合同' || v_contract.contract_no
  );

  if p_business_type = 'rent_income' then
    v_remaining := p_amount_xof;
    for v_receivable in
      select id, amount_xof, paid_amount_xof, due_date
      from public.receivables
      where source_type = 'lease_contract'
        and source_id = v_contract.id
        and category = 'lease_rent'
        and status in ('pending', 'partial', 'overdue')
      order by due_date, id
      for update
    loop
      exit when v_remaining <= 0;
      v_applied := least(
        greatest(v_receivable.amount_xof - v_receivable.paid_amount_xof, 0),
        v_remaining
      );
      if v_applied > 0 then
        update public.receivables
        set paid_amount_xof = paid_amount_xof + v_applied,
            status = case
              when paid_amount_xof + v_applied >= amount_xof then 'paid'
              when paid_amount_xof + v_applied > 0 then 'partial'
              when due_date < current_date then 'overdue'
              else 'pending'
            end,
            updated_at = now()
        where id = v_receivable.id;
        v_remaining := v_remaining - v_applied;
      end if;
    end loop;

    if v_contract.paid_through_date is null
      or p_paid_through_date > v_contract.paid_through_date then
      update public.lease_contracts
      set paid_through_date = p_paid_through_date,
          updated_at = now()
      where id = v_contract.id;
    end if;
  elsif p_business_type = 'deposit_income' then
    update public.lease_contracts
    set deposit_received = true,
        deposit_amount_xof = case
          when coalesce(deposit_amount_xof, 0) <= 0 then p_amount_xof
          else deposit_amount_xof
        end,
        updated_at = now()
    where id = v_contract.id;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()), 'create', 'lease_financial_entry', v_payment_id,
    jsonb_build_object(
      'contract_id', v_contract.id,
      'contract_no', v_contract.contract_no,
      'business_type', p_business_type,
      'source_type', v_source_type,
      'amount_xof', p_amount_xof,
      'paid_through_date', p_paid_through_date,
      'payment_method', p_payment_method,
      'reference_no', v_reference_no,
      'request_id', p_request_id
    )
  );

  return jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'reference_no', v_reference_no,
    'idempotent', false
  );
end;
$$;

revoke all on function public.record_lease_financial_entry_rpc(
  uuid, text, date, numeric, date, text, text, text, uuid
) from public, anon;
grant execute on function public.record_lease_financial_entry_rpc(
  uuid, text, date, numeric, date, text, text, text, uuid
) to authenticated, service_role;

comment on function public.record_lease_financial_entry_rpc(
  uuid, text, date, numeric, date, text, text, text, uuid
) is 'Records an idempotent lease financial entry without changing the formal contract end date; payment method is mandatory.';

commit;
