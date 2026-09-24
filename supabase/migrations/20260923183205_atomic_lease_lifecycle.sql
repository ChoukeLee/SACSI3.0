begin;

-- Immutable operation identity, written in the SAME transaction as all effects.
create table private.lease_lifecycle_requests (
  request_id uuid primary key,
  actor_id uuid not null,
  operation text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.lease_lifecycle_requests enable row level security;
revoke all on private.lease_lifecycle_requests from public,anon,authenticated,service_role;

create function private.generate_lease_schedule(p_contract_id uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare
  c public.lease_contracts%rowtype; u public.units%rowtype;
  cursor_date date; due date; months integer; n integer:=0;
begin
  select * into strict c from public.lease_contracts where id=p_contract_id;
  select * into strict u from public.units where id=c.unit_id;
  if c.start_date is null or c.expected_end_date is null or not isfinite(c.start_date) or not isfinite(c.expected_end_date) or c.expected_end_date<c.start_date
    or c.commencement_state<>'started' then raise exception 'leaseDatesRequireReview'; end if;
  if c.expected_end_date>c.start_date+interval '50 years' then raise exception 'leaseTermTooLong'; end if;
  months:=case c.payment_cycle when 'monthly' then 1 when 'quarterly' then 3 when 'semiannual' then 6 when 'annual' then 12 end;
  if months is null or c.payment_day not between 1 and 31 then raise exception 'invalidLeaseCycle'; end if;
  cursor_date:=date_trunc('month',c.start_date)::date;
  while cursor_date<=c.expected_end_date loop
    due:=cursor_date+least(c.payment_day,extract(day from cursor_date+interval '1 month - 1 day')::integer)-1;
    if due between c.start_date and c.expected_end_date and not exists (
      select 1 from public.receivables where source_type='lease_contract' and source_id=c.id
      and category='lease_rent' and due_date=due and status<>'cancelled'
    ) then
      insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,currency)
      values(u.building_id,c.unit_id,c.customer_id,'lease_contract',c.id,'lease_rent',
        '长租租金 '||u.unit_no||' '||to_char(due,'YYYY-MM'),due,months*c.monthly_rent_xof,0,
        case when months*c.monthly_rent_xof<=0 then 'paid' when due<current_date then 'overdue' else 'pending' end,'XOF');
      n:=n+1;
    end if;
    cursor_date:=(cursor_date+make_interval(months=>months))::date;
  end loop;
  update public.receivables set status=case when paid_amount_xof>=amount_xof then 'paid'
    when paid_amount_xof>0 then 'partial' when due_date<current_date then 'overdue' else 'pending' end
    where source_type='lease_contract' and source_id=c.id and category='lease_rent' and status<>'cancelled';
  return n;
end $$;
revoke all on function private.generate_lease_schedule(uuid) from public,anon,authenticated,service_role;

create function private.ensure_next_lease_receivable(p_contract_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.lease_contracts%rowtype; u public.units%rowtype; due date;
begin
  -- Caller holds the contract row lock; this helper is never exposed directly.
  select * into strict c from public.lease_contracts where id=p_contract_id;
  if c.status<>'active' or c.paid_through_date is null then return; end if;
  if exists(select 1 from public.receivables where source_type='lease_contract' and source_id=c.id
    and category='lease_rent' and status in ('pending','partial','overdue') and amount_xof>paid_amount_xof) then return; end if;
  due:=c.paid_through_date+1;
  if exists(select 1 from public.receivables where source_type='lease_contract' and source_id=c.id
    and category='lease_rent' and due_date=due and status<>'cancelled') then return; end if;
  select * into strict u from public.units where id=c.unit_id;
  insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,currency,notes)
  values(u.building_id,c.unit_id,c.customer_id,'lease_contract',c.id,'lease_rent',u.unit_no||' 长租下一期租金',due,c.monthly_rent_xof,0,
    case when c.monthly_rent_xof<=0 then 'paid' when due<current_date then 'overdue' else 'pending' end,'XOF',
    '根据租金已缴至日期 '||c.paid_through_date||' 自动生成');
end $$;
revoke all on function private.ensure_next_lease_receivable(uuid) from public,anon,authenticated,service_role;

create function private.checked_lease_deposit_balance(p_contract_id uuid)
returns numeric language plpgsql security invoker set search_path='' as $$
declare c public.lease_contracts%rowtype; available numeric; ledger_balance numeric;
begin
  select * into strict c from public.lease_contracts where id=p_contract_id;
  select coalesce(sum(case when source_type='lease_deposit' then round(amount*exchange_rate_to_xof,2)
    when source_type in ('lease_deposit_refund','lease_deposit_deduction') then -round(amount*exchange_rate_to_xof,2) else 0 end),0)
    into available from public.payments where source_id=c.id;
  select coalesce(sum(case when l.direction='liability_in' then l.amount_xof when l.direction='liability_out' then -l.amount_xof else 0 end),0)
    into ledger_balance from public.ledger_entries l join public.payments p on p.id=l.payment_id
    where p.source_id=c.id and l.category='lease_deposit';
  if available<0 or available<>ledger_balance or (not c.deposit_received and available<>0)
    or (c.deposit_received and available=0 and c.deposit_amount_xof>0 and not exists(
      select 1 from public.payments where source_id=c.id and source_type='lease_deposit'))
    or exists(select 1 from public.ledger_entries where unit_id=c.unit_id and category='lease_deposit' and payment_id is null)
  then raise exception 'leaseDepositReviewRequired'; end if;
  return available;
end $$;
revoke all on function private.checked_lease_deposit_balance(uuid) from public,anon,authenticated,service_role;

create function private.lease_contract_token(p_value text)
returns text language sql immutable set search_path='' as $$
select case upper(regexp_replace(trim(p_value),'\s+','-','g'))
 when '大门面房' then 'STOREFRONT-L' when '小门面房' then 'STOREFRONT-S' when '门面房' then 'STOREFRONT'
 when '大仓库' then 'WAREHOUSE-LARGE' when '小车库' then 'GARAGE-SMALL' when '车库1' then 'GARAGE01'
 when '6F前楼' then '6F-FRONT' when '8F前楼' then '8F-FRONT' when '顶楼' then 'ROOFTOP'
 else upper(regexp_replace(trim(p_value),'\s+','-','g')) end
$$;
revoke all on function private.lease_contract_token(text) from public,anon,authenticated,service_role;

create function private.lease_lifecycle(p_operation text,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); c public.lease_contracts%rowtype; u public.units%rowtype;
  previous private.lease_lifecycle_requests%rowtype;
  unit_id uuid; contract_id uuid; before_contract jsonb; result jsonb;
  start_date date; end_date date; cycle text; pay_day integer; rent numeric; deposit numeric;
  deduction numeric; refund numeric; collected numeric; available_deposit numeric;
  base_no text; v_contract_no text; building_code text; suffix integer:=1;
  payment_id uuid; settlement_id uuid; schedule_count integer:=0;
  balance numeric; applied numeric; r record;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then
    raise exception 'leasePermissionDenied' using errcode='42501'; end if;
  if p_operation is null or p_operation not in ('create','activate','terminate','move_out') then raise exception 'invalidLeaseOperation'; end if;
  if (p_operation in ('create','activate') and not public.has_app_role('admin','rental_sales'))
    or (p_operation='terminate' and not public.has_app_role('admin'))
    or (p_operation='move_out' and not public.has_app_role('admin','finance')) then
    raise exception 'leasePermissionDenied' using errcode='42501'; end if;
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'leaseRequestIdRequired'; end if;
  if p_operation='create' then unit_id:=(p_input->>'unitId')::uuid;
  else
    contract_id:=(p_input->>'contractId')::uuid;
    select lc.unit_id into unit_id from public.lease_contracts lc where lc.id=contract_id;
  end if;
  if unit_id is null or not public.can_access_unit(unit_id) then raise exception 'leaseAccessDenied' using errcode='42501'; end if;
  -- All lifecycle operations: request lock -> unit -> contract -> receivables.
  perform pg_advisory_xact_lock(hashtextextended('lease-lifecycle:'||p_request_id,0));
  select * into previous from private.lease_lifecycle_requests where request_id=p_request_id;
  if found then
    if previous.actor_id<>actor or previous.operation<>p_operation or previous.payload<>p_input then raise exception 'requestIdConflict'; end if;
    return previous.result||jsonb_build_object('idempotent',true);
  end if;
  select * into strict u from public.units where id=unit_id for update;
  if p_operation<>'create' then
    select * into strict c from public.lease_contracts where id=contract_id for update;
    if c.unit_id<>unit_id then raise exception 'leaseChanged'; end if;
    before_contract:=to_jsonb(c);
    if p_input->>'expectedUpdatedAt' is null or c.updated_at<>(p_input->>'expectedUpdatedAt')::timestamptz then raise exception 'leaseChanged'; end if;
  end if;

  if p_operation in ('create','activate') then
    if u.construction_status<>'operational' or not u.occupancy_verified or u.status='locked' then raise exception 'leaseUnitNotOperational'; end if;
    if exists(select 1 from public.buildings b join public.projects p on p.id=b.project_id where b.id=u.building_id and p.allows_long_lease=false) then raise exception 'leaseProjectDisabled'; end if;
    if exists(select 1 from public.lease_contracts lc where lc.unit_id=u.id and lc.status='active' and lc.id is distinct from contract_id) then raise exception 'leaseActiveConflict'; end if;
  end if;

  if p_operation='create' then
    start_date:=(p_input->>'startDate')::date; end_date:=(p_input->>'expectedEndDate')::date;
    rent:=(p_input->>'monthlyRentXof')::numeric; deposit:=(p_input->>'depositAmountXof')::numeric;
    pay_day:=(p_input->>'paymentDay')::integer; cycle:=p_input->>'paymentCycle';
    if start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date) or end_date<start_date or end_date>start_date+interval '50 years'
      or rent is null or rent<0 or rent::text in ('NaN','Infinity','-Infinity') or round(rent,2)<>rent
      or deposit is null or deposit<0 or deposit::text in ('NaN','Infinity','-Infinity') or round(deposit,2)<>deposit
      or cycle is null or cycle not in ('monthly','quarterly','semiannual','annual') or pay_day is null or pay_day not between 1 and 31
      or coalesce(p_input->>'status','draft') not in ('draft','active')
      or coalesce((p_input->>'rentFreeDays')::integer,-1)<0 then raise exception 'invalidLeasePayload'; end if;
    select code into strict building_code from public.buildings where id=u.building_id;
    base_no:='WB-LEASE-'||private.lease_contract_token(building_code)||'-'||private.lease_contract_token(u.unit_no)||'-'||to_char(start_date,'YYYYMMDD');
    -- Unit lock serializes normal allocation; prefix lock also covers alias collisions.
    perform pg_advisory_xact_lock(hashtextextended('lease-number:'||base_no,0));
    v_contract_no:=base_no;
    while exists(select 1 from public.lease_contracts lc where lc.contract_no=v_contract_no) loop
      suffix:=suffix+1; v_contract_no:=base_no||'-'||lpad(suffix::text,greatest(2,length(suffix::text)),'0');
    end loop;
    insert into public.lease_contracts(unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,
      monthly_rent_xof,deposit_amount_xof,deposit_received,rent_free_days,signer_name,status)
    values(u.id,(p_input->>'customerId')::uuid,v_contract_no,start_date,end_date,cycle,pay_day,rent,deposit,
      coalesce((p_input->>'depositReceived')::boolean,false),(p_input->>'rentFreeDays')::integer,
      nullif(p_input->>'signerName',''),coalesce(p_input->>'status','draft')::public.contract_status) returning * into c;
    if c.status='active' then
      if u.status<>'sold' then update public.units set status='leased' where id=u.id; end if;
      schedule_count:=private.generate_lease_schedule(c.id);
    end if;
    if c.deposit_received and deposit>0 then
      -- Contract creation permission is not financial posting permission.
      if not public.has_app_role('admin','finance') then raise exception 'leaseFinancePermissionDenied' using errcode='42501'; end if;
      insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,request_id,request_kind)
      values(c.customer_id,u.id,'lease_deposit',c.id,start_date,deposit,'XOF',1,p_request_id,'lease_create_deposit') returning id into payment_id;
      insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description)
      values(u.building_id,u.id,payment_id,start_date,'liability_in','lease_deposit',deposit,'长租押金 房间'||u.unit_no);
      insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,currency)
      values(u.building_id,u.id,c.customer_id,'lease_contract',c.id,'lease_deposit','押金 '||c.contract_no,start_date,deposit,deposit,'paid','XOF');
    end if;
  elsif p_operation='activate' then
    if c.status<>'draft' then raise exception 'leaseDraftRequired'; end if;
    schedule_count:=private.generate_lease_schedule(c.id);
    update public.lease_contracts set status='active',updated_at=now() where id=c.id returning * into c;
    if u.status<>'sold' then update public.units set status='leased' where id=u.id; end if;
  elsif p_operation='terminate' then
    if c.status<>'active' then raise exception 'leaseActiveRequired'; end if;
    update public.lease_contracts set status='terminated',actual_end_date=current_date,updated_at=now() where id=c.id returning * into c;
    -- Preserve the existing administrative termination policy; financial settlement is separate.
    update public.receivables set status='cancelled' where source_type='lease_contract' and source_id=c.id;
    if u.status='leased' and not exists(select 1 from public.lease_contracts lc where lc.unit_id=u.id and lc.status='active') then
      update public.units set status='available' where id=u.id;
    end if;
  else
    if c.status not in ('active','expired') then raise exception 'leaseSettlementStateInvalid'; end if;
    end_date:=(p_input->>'actualEndDate')::date;
    collected:=(p_input->>'unpaidRentXof')::numeric; deduction:=(p_input->>'depositDeductionXof')::numeric; refund:=(p_input->>'depositRefundXof')::numeric;
    if end_date is null or not isfinite(end_date) or c.start_date is null or end_date<c.start_date
      or collected is null or deduction is null or refund is null
      or least(collected,deduction,refund)<0
      or collected::text in ('NaN','Infinity','-Infinity') or deduction::text in ('NaN','Infinity','-Infinity') or refund::text in ('NaN','Infinity','-Infinity')
      or round(collected,2)<>collected or round(deduction,2)<>deduction or round(refund,2)<>refund then raise exception 'invalidLeaseSettlement'; end if;
    if exists(select 1 from public.lease_settlements where lease_contract_id=c.id) then raise exception 'leaseAlreadySettled'; end if;
    -- Never fabricate collection from a displayed outstanding balance.
    if (collected>0 or refund>0) and coalesce((p_input->>'rentCollectedConfirmed')::boolean,false)=false then raise exception 'leaseCollectionConfirmationRequired'; end if;
    if (collected>0 or refund>0) and coalesce(p_input->>'paymentMethod','') not in ('cash','check','bank_transfer','offset','other') then raise exception 'paymentMethodRequired'; end if;
    available_deposit:=private.checked_lease_deposit_balance(c.id);
    if deduction+refund<>available_deposit then raise exception 'leaseDepositReviewRequired'; end if;
    -- Partial historical cancellations or excluded rows are not guessed away.
    if exists(select 1 from public.receivables where source_type='lease_contract' and source_id=c.id and category='lease_rent'
      and status<>'cancelled' and (management_status<>'managed' or (due_date>end_date and paid_amount_xof>0))) then raise exception 'leaseReceivableReviewRequired'; end if;
    perform 1 from public.receivables where source_type='lease_contract' and source_id=c.id order by due_date,id for update;
    select coalesce(sum(greatest(amount_xof-paid_amount_xof,0)),0) into balance from public.receivables
      where source_type='lease_contract' and source_id=c.id and category='lease_rent' and due_date<=end_date and status<>'cancelled';
    if collected>balance then raise exception 'leaseCollectionExceedsOutstanding'; end if;
    if collected>0 then
      insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,request_kind)
      values(c.customer_id,u.id,'lease_rent',c.id,end_date,collected,'XOF',1,p_input->>'paymentMethod','lease_move_out') returning id into payment_id;
      insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description)
      values(u.building_id,u.id,payment_id,end_date,'income','lease_rent',collected,'退租实收租金 房间'||u.unit_no);
      balance:=collected;
      for r in select * from public.receivables where source_type='lease_contract' and source_id=c.id and category='lease_rent'
        and due_date<=end_date and status<>'cancelled' order by due_date,id loop
        exit when balance<=0;
        applied:=least(balance,greatest(r.amount_xof-r.paid_amount_xof,0));
        update public.receivables set paid_amount_xof=paid_amount_xof+applied,
          status=case when paid_amount_xof+applied>=amount_xof then 'paid' when paid_amount_xof+applied>0 then 'partial' when due_date<current_date then 'overdue' else 'pending' end where id=r.id;
        balance:=balance-applied;
      end loop;
    end if;
    if refund>0 then
      insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,request_kind)
      values(c.customer_id,u.id,'lease_deposit_refund',c.id,end_date,refund,'XOF',1,p_input->>'paymentMethod','lease_move_out') returning id into payment_id;
      insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description)
      values(u.building_id,u.id,payment_id,end_date,'liability_out','lease_deposit',refund,'退还押金 房间'||u.unit_no);
    end if;
    if deduction>0 then
      insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,request_kind)
      values(c.customer_id,u.id,'lease_deposit_deduction',c.id,end_date,deduction,'XOF',1,'offset','lease_move_out') returning id into payment_id;
      insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description)
      values(u.building_id,u.id,payment_id,end_date,'liability_out','lease_deposit',deduction,'押金扣除转出 房间'||u.unit_no),
        (u.building_id,u.id,payment_id,end_date,'income','other_income',deduction,'押金扣除 房间'||u.unit_no);
    end if;
    insert into public.lease_settlements(lease_contract_id,unit_id,customer_id,actual_end_date,unpaid_rent_xof,utility_cleared,
      deposit_amount_xof,deposit_deduction_xof,deposit_refund_xof,total_due_xof,total_refund_xof,notes)
    values(c.id,u.id,c.customer_id,end_date,collected,coalesce((p_input->>'utilityCleared')::boolean,false),available_deposit,deduction,refund,collected,refund,p_input->>'notes') returning id into settlement_id;
    update public.receivables set status='cancelled',notes=concat_ws('；',notes,'合同退租 '||end_date||'，后续应收取消')
      where source_type='lease_contract' and source_id=c.id and category='lease_rent' and status<>'cancelled' and due_date>end_date and paid_amount_xof=0;
    update public.lease_contracts set status='terminated',actual_end_date=end_date,updated_at=now() where id=c.id returning * into c;
    if u.status='leased' and not exists(select 1 from public.lease_contracts lc where lc.unit_id=u.id and lc.status='active') then
      update public.units set status='available' where id=u.id;
    end if;
  end if;
  result:=jsonb_build_object('success',true,'data',to_jsonb(c),'settlementId',settlement_id,'idempotent',false);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
  values(actor,p_operation,'lease_contract',c.id,before_contract,to_jsonb(c),jsonb_build_object('request_id',p_request_id,
    'input',p_input,'schedule_count',schedule_count,'settlement_id',settlement_id,'channel','lease_lifecycle_rpc'));
  insert into private.lease_lifecycle_requests(request_id,actor_id,operation,payload,result) values(p_request_id,actor,p_operation,p_input,result);
  return result;
end $$;
revoke all on function private.lease_lifecycle(text,jsonb,uuid) from public,anon,service_role;
grant execute on function private.lease_lifecycle(text,jsonb,uuid) to authenticated;
create function public.lease_lifecycle_rpc(p_operation text,p_input jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.lease_lifecycle(p_operation,p_input,p_request_id)
$$;
revoke all on function public.lease_lifecycle_rpc(text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.lease_lifecycle_rpc(text,jsonb,uuid) to authenticated;

create or replace function private.record_lease_financial_entry_atomic(
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
  if (select auth.uid()) is null or coalesce(auth.jwt()->>'role','')<>'authenticated' or not public.has_app_role('admin', 'finance') then
    raise exception 'leaseFinancePermissionDenied' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;
  if p_payment_date is null or coalesce(p_amount, 0) <= 0 or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<>p_amount then
    raise exception 'invalidLeaseFinancialPayload';
  end if;
  if p_currency is null then raise exception 'currencyRequired'; end if;
  if p_exchange_rate_to_xof is null or p_exchange_rate_to_xof::text in ('NaN','Infinity','-Infinity') or (p_currency = 'XOF'::public.currency_code and p_exchange_rate_to_xof <> 1)
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

  select * into v_contract from public.lease_contracts where id=p_contract_id for update;
  if v_contract.id is null then raise exception 'leaseContractNotFound'; end if;
  select * into v_unit from public.units where id=v_contract.unit_id;
  if not public.can_access_unit(v_contract.unit_id) then raise exception 'leaseAccessDenied' using errcode='42501'; end if;

  select source_id, request_kind into v_existing_contract_id, v_existing_kind
  from public.payments where request_id = p_request_id;
  if v_existing_contract_id is not null then
    if v_existing_contract_id <> p_contract_id or v_existing_kind is distinct from 'lease_financial_entry' then
      raise exception 'requestIdConflict';
    end if;
    if not exists(select 1 from public.audit_logs a where a.entity_type='lease_financial_entry' and a.actor_id=auth.uid()
      and a.metadata->>'request_id'=p_request_id::text and a.metadata->>'business_type'=p_business_type
      and (a.metadata->>'paid_through_date') is not distinct from p_paid_through_date::text
      and (not (a.metadata ? 'input_notes') or a.metadata->>'input_notes' is not distinct from nullif(trim(coalesce(p_notes,'')),'')))
      or not exists(select 1 from public.payments p where p.request_id=p_request_id and p.payment_date=p_payment_date
        and p.amount=p_amount and p.currency=p_currency and p.exchange_rate_to_xof=p_exchange_rate_to_xof
        and p.payment_method=p_payment_method and p.external_receipt_no is not distinct from nullif(trim(coalesce(p_external_receipt_no,'')),'')) then
      raise exception 'requestIdConflict';
    end if;
    select id, receipt_no into v_payment_id, v_reference_no
    from public.payments where request_id = p_request_id;
    return jsonb_build_object('success',true,'payment_id',v_payment_id,'reference_no',v_reference_no,'idempotent',true);
  end if;



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

  if p_business_type='deposit_refund' then
    v_remaining:=private.checked_lease_deposit_balance(v_contract.id);
    if v_amount_xof>v_remaining then raise exception 'leaseDepositReviewRequired'; end if;
  end if;
  -- A terminated lease may still receive existing arrears, but never invent
  -- future rent or credit after settlement. No new period is generated for it.
  if v_contract.status='terminated' and p_business_type='rent_income' then
    select coalesce(sum(greatest(amount_xof-paid_amount_xof,0)),0) into v_remaining
      from public.receivables where source_type='lease_contract' and source_id=v_contract.id and category='lease_rent'
      and status in ('pending','partial','overdue') and due_date<=v_contract.actual_end_date;
    if v_amount_xof>v_remaining or p_paid_through_date>v_contract.actual_end_date then raise exception 'leaseClosedRentReviewRequired'; end if;
  end if;
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

  if p_business_type='rent_income' then perform private.ensure_next_lease_receivable(v_contract.id); end if;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values((select auth.uid()),'create','lease_financial_entry',v_payment_id,jsonb_build_object(
    'contract_id',v_contract.id,'contract_no',v_contract.contract_no,'business_type',p_business_type,
    'source_type',v_source_type,'original_amount',p_amount,'currency',p_currency,
    'exchange_rate_to_xof',p_exchange_rate_to_xof,'amount_xof',v_amount_xof,
    'external_receipt_no',nullif(trim(coalesce(p_external_receipt_no,'')),''),
    'paid_through_date',p_paid_through_date,'payment_method',p_payment_method,
    'reference_no',v_reference_no,'request_id',p_request_id,'input_notes',nullif(trim(coalesce(p_notes,'')),'')
  ));

  return jsonb_build_object('success',true,'payment_id',v_payment_id,'reference_no',v_reference_no,
    'original_amount',p_amount,'currency',p_currency,'exchange_rate_to_xof',p_exchange_rate_to_xof,
    'amount_xof',v_amount_xof,'idempotent',false);
end;
$$;

revoke all on function private.record_lease_financial_entry_atomic(uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid) from public,anon,service_role;
grant execute on function private.record_lease_financial_entry_atomic(uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid) to authenticated;
create or replace function public.record_lease_financial_entry_v2_rpc(
 p_contract_id uuid,p_business_type text,p_payment_date date,p_amount numeric,p_currency public.currency_code,p_exchange_rate_to_xof numeric,
 p_paid_through_date date default null,p_payment_method text default null,p_notes text default null,p_external_receipt_no text default null,p_request_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
 select private.record_lease_financial_entry_atomic(p_contract_id,p_business_type,p_payment_date,p_amount,p_currency,p_exchange_rate_to_xof,p_paid_through_date,p_payment_method,p_notes,p_external_receipt_no,p_request_id)
$$;
revoke all on function public.record_lease_financial_entry_v2_rpc(uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.record_lease_financial_entry_v2_rpc(uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid) to authenticated;

create or replace function public.record_lease_financial_entry_rpc(
 p_contract_id uuid,p_business_type text,p_payment_date date,p_amount_xof numeric,p_paid_through_date date default null,
 p_payment_method text default null,p_notes text default null,p_reference_prefix text default 'LEASE',p_request_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
 select public.record_lease_financial_entry_v2_rpc(p_contract_id,p_business_type,p_payment_date,p_amount_xof,'XOF'::public.currency_code,1,p_paid_through_date,p_payment_method,p_notes,null,p_request_id)
$$;
revoke all on function public.record_lease_financial_entry_rpc(uuid,text,date,numeric,date,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.record_lease_financial_entry_rpc(uuid,text,date,numeric,date,text,text,text,uuid) to authenticated;

create or replace function public.record_lease_financial_entry_core_rpc(
 p_contract_id uuid,p_business_type text,p_payment_date date,p_amount_xof numeric,p_paid_through_date date default null,
 p_payment_method text default null,p_notes text default null,p_reference_prefix text default 'LEASE',p_request_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
 select public.record_lease_financial_entry_v2_rpc(p_contract_id,p_business_type,p_payment_date,p_amount_xof,'XOF'::public.currency_code,1,p_paid_through_date,p_payment_method,p_notes,null,p_request_id)
$$;
revoke all on function public.record_lease_financial_entry_core_rpc(uuid,text,date,numeric,date,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.record_lease_financial_entry_core_rpc(uuid,text,date,numeric,date,text,text,text,uuid) to authenticated;

commit;
