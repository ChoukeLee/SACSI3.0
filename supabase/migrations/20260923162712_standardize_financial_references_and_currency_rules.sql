begin;

-- `receipt_no` is the system financial reference.  A number printed on a
-- physical receipt or inherited from an import belongs in this separate field
-- and must never control system numbering.
alter table public.payments
  add column if not exists external_receipt_no text;

comment on column public.payments.receipt_no is
  'System-generated financial reference. Never copy a physical receipt number into this field.';
comment on column public.payments.external_receipt_no is
  'Optional physical receipt, bank reference, or legacy import reference preserved as source evidence.';
comment on column public.payments.amount is
  'Amount in the original payment currency.';
comment on column public.payments.exchange_rate_to_xof is
  'Historical XOF value of one unit of the original currency at posting time; immutable accounting evidence.';

alter table public.payments
  drop constraint if exists payments_currency_rate_valid;
alter table public.payments
  add constraint payments_currency_rate_valid check (
    (currency = 'XOF'::public.currency_code and exchange_rate_to_xof = 1)
    or
    (currency <> 'XOF'::public.currency_code and exchange_rate_to_xof > 0)
  ) not valid;
alter table public.payments validate constraint payments_currency_rate_valid;

create or replace function private.lease_payment_business_code(p_source_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_source_type
    when 'lease_contract' then 'RENT'
    when 'lease_rent' then 'RENT'
    when 'lease_deposit' then 'DEP'
    when 'property_fee' then 'PROP'
    when 'lease_agency_income' then 'AGI'
    when 'lease_agency_expense' then 'AGE'
    when 'lease_furniture_income' then 'FURN'
    when 'lease_deposit_refund' then 'DEPREF'
    when 'lease_deposit_deduction' then 'DEDUCT'
    when 'lease_rent_refund' then 'RENTREF'
    when 'lease_other_income' then 'OIN'
    when 'lease_other_expense' then 'OEX'
  end
$$;

create or replace function private.lease_payment_reference_prefix(
  p_unit_id uuid,
  p_source_type text,
  p_payment_date date
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_building_code text;
  v_unit_no text;
  v_building_token text;
  v_unit_token text;
  v_business_code text;
begin
  select b.code, u.unit_no
    into v_building_code, v_unit_no
  from public.units u
  join public.buildings b on b.id = u.building_id
  where u.id = p_unit_id;

  v_business_code := private.lease_payment_business_code(p_source_type);
  if v_building_code is null or v_unit_no is null or v_business_code is null or p_payment_date is null then
    return null;
  end if;

  v_building_token := case
    when v_building_code ~* '^SACSI.+' then
      'WB' || upper(regexp_replace(v_building_code, '^SACSI', '', 'i'))
    else
      'WB-' || upper(regexp_replace(trim(v_building_code), '[^A-Za-z0-9]+', '-', 'g'))
  end;
  v_unit_token := upper(regexp_replace(trim(v_unit_no), '[^A-Za-z0-9]+', '-', 'g'));

  return v_building_token || '-L-' || v_unit_token || '-'
    || to_char(p_payment_date, 'YYYYMMDD') || '-' || v_business_code;
end;
$$;

create or replace function private.assign_lease_payment_reference()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prefix text;
  v_sequence integer;
begin
  v_prefix := private.lease_payment_reference_prefix(new.unit_id, new.source_type, new.payment_date);
  if v_prefix is null then return new; end if;

  -- A supplied non-system value is evidence, not a financial reference.
  if new.receipt_no is not null
     and new.receipt_no !~ ('^' || replace(v_prefix, '-', '\\-') || '-[0-9]{2,}$') then
    new.external_receipt_no := coalesce(new.external_receipt_no, new.receipt_no);
    new.receipt_no := null;
  end if;

  if new.receipt_no is null then
    perform pg_advisory_xact_lock(hashtextextended(v_prefix, 0));
    select coalesce(max((regexp_match(p.receipt_no, '-([0-9]+)$'))[1]::integer), 0) + 1
      into v_sequence
    from public.payments p
    where p.receipt_no like v_prefix || '-%'
      and (tg_op = 'INSERT' or p.id <> new.id);
    new.receipt_no := v_prefix || '-' || lpad(v_sequence::text, 2, '0');
  end if;

  return new;
end;
$$;

drop trigger if exists payments_assign_lease_reference on public.payments;
create trigger payments_assign_lease_reference
before insert or update of unit_id, source_type, payment_date, receipt_no
on public.payments
for each row execute function private.assign_lease_payment_reference();

-- Normalize every legacy long-lease reference while preserving the old value
-- in external_receipt_no.  The trigger allocates the next sequence safely.
do $$
declare
  v_row record;
  v_prefix text;
  v_new_reference text;
  v_run_id uuid := gen_random_uuid();
begin
  for v_row in
    select p.id, p.receipt_no
    from public.payments p
    where private.lease_payment_business_code(p.source_type) is not null
    order by p.created_at, p.id
  loop
    v_prefix := private.lease_payment_reference_prefix(
      (select unit_id from public.payments where id = v_row.id),
      (select source_type from public.payments where id = v_row.id),
      (select payment_date from public.payments where id = v_row.id)
    );
    if v_prefix is not null and (
      v_row.receipt_no is null
      or v_row.receipt_no !~ ('^' || replace(v_prefix, '-', '\\-') || '-[0-9]{2,}$')
    ) then
      update public.payments
      set external_receipt_no = coalesce(external_receipt_no, receipt_no),
          receipt_no = null
      where id = v_row.id
      returning receipt_no into v_new_reference;

      insert into public.audit_logs(action, entity_type, entity_id, before_data, after_data, metadata)
      values (
        'normalize_financial_reference', 'payment', v_row.id,
        jsonb_build_object('receipt_no', v_row.receipt_no),
        jsonb_build_object('receipt_no', v_new_reference, 'external_receipt_no', v_row.receipt_no),
        jsonb_build_object('run_id', v_run_id, 'rule', 'system_reference_independent_of_external_receipt')
      );
    end if;
  end loop;
end $$;

create unique index if not exists payments_lease_reference_unique
on public.payments(receipt_no)
where private.lease_payment_business_code(source_type) is not null;

create or replace function public.record_lease_financial_entry_v2_rpc(
  p_contract_id uuid,
  p_business_type text,
  p_payment_date date,
  p_amount numeric,
  p_currency public.currency_code,
  p_exchange_rate_to_xof numeric,
  p_paid_through_date date default null,
  p_payment_method text default null,
  p_notes text default null,
  p_external_receipt_no text default null,
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
  v_amount_xof numeric;
  v_remaining numeric;
  v_applied numeric;
  v_receivable record;
  v_note text;
begin
  if (select auth.uid()) is null or not public.has_app_role('admin', 'finance') then
    raise exception 'leaseFinancePermissionDenied' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;
  if p_payment_date is null or coalesce(p_amount, 0) <= 0 then
    raise exception 'invalidLeaseFinancialPayload';
  end if;
  if p_currency is null then raise exception 'currencyRequired'; end if;
  if (p_currency = 'XOF'::public.currency_code and p_exchange_rate_to_xof <> 1)
     or (p_currency <> 'XOF'::public.currency_code and coalesce(p_exchange_rate_to_xof, 0) <= 0) then
    raise exception 'invalidHistoricalExchangeRate';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash','check','bank_transfer','offset','other') then
    raise exception 'paymentMethodRequired';
  end if;
  if p_business_type = 'rent_income' and p_paid_through_date is null then
    raise exception 'paidThroughDateRequired';
  end if;

  v_amount_xof := round(p_amount * p_exchange_rate_to_xof, 2);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select source_id, request_kind into v_existing_contract_id, v_existing_kind
  from public.payments where request_id = p_request_id;
  if v_existing_contract_id is not null then
    if v_existing_contract_id <> p_contract_id or v_existing_kind is distinct from 'lease_financial_entry' then
      raise exception 'requestIdConflict';
    end if;
    select id, receipt_no into v_payment_id, v_reference_no
    from public.payments where request_id = p_request_id;
    return jsonb_build_object('success',true,'payment_id',v_payment_id,'reference_no',v_reference_no,'idempotent',true);
  end if;

  select * into v_contract from public.lease_contracts where id=p_contract_id for update;
  if v_contract.id is null then raise exception 'leaseContractNotFound'; end if;
  select * into v_unit from public.units where id=v_contract.unit_id;

  select source_type,direction,category,label into v_source_type,v_direction,v_category,v_label
  from (values
    ('rent_income','lease_rent','income','lease_rent','租金收入'),
    ('deposit_income','lease_deposit','liability_in','lease_deposit','押金收入'),
    ('agency_income','lease_agency_income','income','lease_agency_income','中介费收入'),
    ('agency_expense','lease_agency_expense','expense','lease_agency_expense','中介费支出'),
    ('property_fee_income','property_fee','income','property_fee','物业费收入'),
    ('furniture_income','lease_furniture_income','income','furniture_fee','家具费收入'),
    ('deposit_refund','lease_deposit_refund','liability_out','lease_deposit','押金退还'),
    ('other_income','lease_other_income','income','other_income','其他收入'),
    ('other_expense','lease_other_expense','expense','other_expense','其他支出')
  ) as config(business_type,source_type,direction,category,label)
  where business_type=p_business_type;
  if v_source_type is null then raise exception 'unsupportedLeaseFinancialType'; end if;

  v_note := concat_ws('；',
    '业务类型：'||v_label,
    '方式：'||case p_payment_method when 'cash' then '现金' when 'check' then '支票' when 'bank_transfer' then '银行转账' when 'offset' then '抵扣/转款' else '其他' end,
    '原币：'||p_currency::text||' '||p_amount::text,
    '历史汇率：1 '||p_currency::text||' = '||p_exchange_rate_to_xof::text||' XOF',
    '折合：'||v_amount_xof::text||' XOF',
    case when p_paid_through_date is not null then '已缴至：'||p_paid_through_date::text end,
    nullif(trim(coalesce(p_notes,'')),'')
  );

  insert into public.payments(
    customer_id,unit_id,source_type,source_id,payment_date,amount,currency,
    exchange_rate_to_xof,receipt_no,external_receipt_no,notes,payment_method,request_id,request_kind
  ) values (
    v_contract.customer_id,v_contract.unit_id,v_source_type,v_contract.id,p_payment_date,p_amount,p_currency,
    p_exchange_rate_to_xof,null,nullif(trim(coalesce(p_external_receipt_no,'')),''),v_note,p_payment_method,p_request_id,'lease_financial_entry'
  ) returning id,receipt_no into v_payment_id,v_reference_no;

  insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description)
  values(v_unit.building_id,v_contract.unit_id,v_payment_id,p_payment_date,v_direction,v_category,v_amount_xof,
    v_label||' 房间'||coalesce(v_unit.unit_no,'未设置')||' 合同'||v_contract.contract_no);

  if p_business_type='rent_income' then
    v_remaining:=v_amount_xof;
    for v_receivable in
      select id,amount_xof,paid_amount_xof,due_date from public.receivables
      where source_type='lease_contract' and source_id=v_contract.id and category='lease_rent'
        and status in ('pending','partial','overdue') order by due_date,id for update
    loop
      exit when v_remaining<=0;
      v_applied:=least(greatest(v_receivable.amount_xof-v_receivable.paid_amount_xof,0),v_remaining);
      if v_applied>0 then
        update public.receivables set paid_amount_xof=paid_amount_xof+v_applied,
          status=case when paid_amount_xof+v_applied>=amount_xof then 'paid' when paid_amount_xof+v_applied>0 then 'partial' when due_date<current_date then 'overdue' else 'pending' end,
          updated_at=now() where id=v_receivable.id;
        v_remaining:=v_remaining-v_applied;
      end if;
    end loop;
    if v_contract.paid_through_date is null or p_paid_through_date>v_contract.paid_through_date then
      update public.lease_contracts set paid_through_date=p_paid_through_date,updated_at=now() where id=v_contract.id;
    end if;
  elsif p_business_type='deposit_income' then
    update public.lease_contracts set deposit_received=true,
      deposit_amount_xof=case when coalesce(deposit_amount_xof,0)<=0 then v_amount_xof else deposit_amount_xof end,
      updated_at=now() where id=v_contract.id;
  end if;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values((select auth.uid()),'create','lease_financial_entry',v_payment_id,jsonb_build_object(
    'contract_id',v_contract.id,'contract_no',v_contract.contract_no,'business_type',p_business_type,
    'source_type',v_source_type,'original_amount',p_amount,'currency',p_currency,
    'exchange_rate_to_xof',p_exchange_rate_to_xof,'amount_xof',v_amount_xof,
    'external_receipt_no',nullif(trim(coalesce(p_external_receipt_no,'')),''),
    'paid_through_date',p_paid_through_date,'payment_method',p_payment_method,
    'reference_no',v_reference_no,'request_id',p_request_id
  ));

  return jsonb_build_object('success',true,'payment_id',v_payment_id,'reference_no',v_reference_no,
    'original_amount',p_amount,'currency',p_currency,'exchange_rate_to_xof',p_exchange_rate_to_xof,
    'amount_xof',v_amount_xof,'idempotent',false);
end;
$$;

revoke all on function public.record_lease_financial_entry_v2_rpc(
  uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid
) from public,anon;
grant execute on function public.record_lease_financial_entry_v2_rpc(
  uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid
) to authenticated,service_role;

comment on function public.record_lease_financial_entry_v2_rpc(
  uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid
) is 'Posts the original currency amount and immutable historical XOF rate, generates an internal reference, and stores physical receipt numbers separately.';

commit;
