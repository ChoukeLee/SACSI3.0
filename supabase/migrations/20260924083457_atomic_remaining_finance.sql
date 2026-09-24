begin;

-- Retain the reviewed posting implementation as an unexposed helper; wrap it
-- with actor/payload-bound replay and a consistent contract-first lock order.
alter function public.record_sale_payment_rpc(uuid,uuid,numeric,date,text,uuid) set schema private;
alter function private.record_sale_payment_rpc(uuid,uuid,numeric,date,text,uuid) rename to post_sale_payment_core;
revoke all on function private.post_sale_payment_core(uuid,uuid,numeric,date,text,uuid) from public,anon,authenticated,service_role;

create table private.finance_operation_requests (
  request_id uuid primary key, actor_id uuid not null, operation text not null,
  payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table private.finance_operation_requests enable row level security;
revoke all on private.finance_operation_requests from public,anon,authenticated,service_role;

-- The public API is deliberately small; operation names are an explicit allowlist.
-- All authorization precedes replay. All effects and the replay result commit together.
create function private.finance_operation(p_operation text,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); previous private.finance_operation_requests%rowtype;
  u public.units%rowtype; c public.sale_contracts%rowtype; s public.sale_payment_schedule%rowtype;
  l public.ledger_entries%rowtype; b public.daily_bookings%rowtype; p public.payments%rowtype;
  building uuid; unit uuid; entity uuid; payment uuid; result jsonb; before_data jsonb;
  amount numeric; rate numeric; xof numeric; currency public.currency_code; dt date;
  n integer; total numeric; paid numeric; start_date date; end_date date; v_category text;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then
    raise exception 'financePermissionDenied' using errcode='42501'; end if;
  if p_operation is null or p_operation not in ('manual_entry','sale_payment','sale_installment','sale_transfer','sale_terminate','daily_backfill','daily_sync','daily_undo_checkin') then
    raise exception 'invalidFinanceOperation'; end if;
  if (p_operation in ('manual_entry','sale_payment') and not public.has_app_role('admin','finance'))
    or (p_operation in ('sale_installment','sale_transfer') and not public.has_app_role('admin','rental_sales'))
    or (p_operation in ('sale_terminate','daily_backfill','daily_sync','daily_undo_checkin') and not public.has_app_role('admin')) then
    raise exception 'financePermissionDenied' using errcode='42501'; end if;
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'requestIdRequired'; end if;
  if p_operation like 'sale_%' then
    select * into c from public.sale_contracts where id=(p_input->>'contractId')::uuid;
    if c.id is null then raise exception 'saleContractNotFound'; end if;
    unit:=c.unit_id;
  elsif p_operation in ('daily_sync','daily_undo_checkin') then
    select * into b from public.daily_bookings where id=(p_input->>'bookingId')::uuid;
    if b.id is null then raise exception 'bookingNotFound'; end if;
    unit:=b.unit_id;
  else unit:=nullif(p_input->>'unitId','')::uuid;
  end if;
  building:=nullif(p_input->>'buildingId','')::uuid;
  if unit is not null then
    if not public.can_access_unit(unit) then raise exception 'financeAccessDenied' using errcode='42501'; end if;
    select * into strict u from public.units where id=unit;
    if building is not null and building<>u.building_id then raise exception 'unitBuildingMismatch'; end if;
    building:=u.building_id;
  elsif p_operation<>'manual_entry' then raise exception 'unitRequired';
  end if;
  if building is not null and not public.can_access_building(building) then raise exception 'financeAccessDenied' using errcode='42501'; end if;
  -- Unallocated entries have no project scope: do not let a restricted account bypass project permissions.
  if building is null and not public.has_app_role('admin') then raise exception 'financeBuildingRequired'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finance-operation:'||p_request_id,0));
  select * into previous from private.finance_operation_requests where request_id=p_request_id;
  if found then
    if previous.actor_id<>actor or previous.operation<>p_operation or previous.payload<>p_input then raise exception 'requestIdConflict'; end if;
    return previous.result||jsonb_build_object('idempotent',true);
  end if;

  if p_operation='manual_entry' then
    amount:=(p_input->>'amount')::numeric; rate:=(p_input->>'exchangeRateToXof')::numeric;
    currency:=(p_input->>'currency')::public.currency_code; dt:=(p_input->>'entryDate')::date;
    if amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or round(amount,2)<>amount
      or rate is null or rate<=0 or rate::text in ('NaN','Infinity','-Infinity')
      or currency is null or (currency='XOF' and rate<>1) or dt is null or not isfinite(dt)
      or coalesce(p_input->>'direction','') not in ('income','expense','liability_in','liability_out')
      or nullif(trim(p_input->>'category'),'') is null then raise exception 'invalidFinancePayload'; end if;
    xof:=round(amount*rate,2);
    payment:=nullif(p_input->>'paymentId','')::uuid;
    if payment is not null then
      if unit is null and not public.has_app_role('admin') then raise exception 'paymentLinkRequiresReview'; end if;
      select * into p from public.payments where id=payment for update;
      if p.id is null or p.unit_id is distinct from unit or round(p.amount*p.exchange_rate_to_xof,2)<>xof
        or p.payment_date<>dt or exists(select 1 from public.ledger_entries where payment_id=payment) then raise exception 'paymentLinkRequiresReview'; end if;
      if nullif(trim(p_input->>'receiptNo'),'') is not null then raise exception 'paymentLinkRequiresReview'; end if;
    end if;
    insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,amount_cny,description)
    values(building,unit,payment,dt,p_input->>'direction',trim(p_input->>'category'),xof,
      case when currency='CNY' then amount end,nullif(p_input->>'description','')) returning * into l;
    -- Preserve existing manual-entry semantics: an incoming entry with a receipt also records a payment.
    if payment is null and nullif(trim(p_input->>'receiptNo'),'') is not null and p_input->>'direction' in ('income','liability_in') then
      insert into public.payments(unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,receipt_no,external_receipt_no,request_id,request_kind)
      values(unit,'manual',l.id,dt,amount,currency,rate,null,trim(p_input->>'receiptNo'),p_request_id,'manual_entry') returning id into payment;
      update public.ledger_entries set payment_id=payment where id=l.id returning * into l;
    end if;
    entity:=l.id; result:=jsonb_build_object('success',true,'data',to_jsonb(l));
  elsif p_operation like 'sale_%' then
    -- Same order as the hardened sale payment entry: contract -> schedule -> receivable.
    select * into strict c from public.sale_contracts where id=c.id for update;
    if c.unit_id<>unit or (p_operation<>'sale_payment' and c.updated_at is distinct from (p_input->>'expectedUpdatedAt')::timestamptz) then raise exception 'financeRecordChanged'; end if;
    if c.status<>'active' then raise exception 'saleContractNotActive'; end if;
    before_data:=to_jsonb(c); entity:=c.id;
    if p_operation='sale_payment' then
      amount:=(p_input->>'amount')::numeric; dt:=(p_input->>'paymentDate')::date;
      if amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or round(amount,2)<>amount or dt is null or not isfinite(dt) then raise exception 'invalidFinancePayload'; end if;
      if exists(select 1 from public.payments where request_id=p_request_id) then raise exception 'requestIdConflict'; end if;
      select * into s from public.sale_payment_schedule where id=(p_input->>'scheduleId')::uuid and sale_contract_id=c.id;
      if s.id is null then raise exception 'installmentNotPayable'; end if;
      v_category:=case when c.payment_plan_type='lump_sum' then 'sale_lump_sum' else 'sale_installment' end;
      if (select count(*) from public.receivables where source_type='sale_contract' and source_id=c.id and category=v_category and due_date=s.due_date and amount_xof=s.amount_xof and status<>'cancelled')<>1 then raise exception 'ambiguousSaleReceivable'; end if;
      result:=private.post_sale_payment_core(c.id,s.id,amount,dt,nullif(p_input->>'receiptNo',''),p_request_id);
    elsif p_operation='sale_installment' then
      n:=(p_input->>'installmentNo')::integer; amount:=(p_input->>'amountXof')::numeric; dt:=(p_input->>'dueDate')::date;
      if c.payment_plan_type<>'flexible_installment' then raise exception 'flexiblePlanRequired'; end if;
      if n is null or n<1 or amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or round(amount,2)<>amount or dt is null or not isfinite(dt) then raise exception 'invalidFinancePayload'; end if;
      if exists(select 1 from public.sale_payment_schedule where sale_contract_id=c.id and installment_no=n) then raise exception 'installmentAlreadyExists'; end if;
      if exists(select 1 from public.receivables where source_type='sale_contract' and source_id=c.id and category='sale_installment' and due_date=dt and amount_xof=amount and status<>'cancelled') then raise exception 'ambiguousSaleReceivable'; end if;
      insert into public.sale_payment_schedule(sale_contract_id,installment_no,due_date,amount_xof,status)
      values(c.id,n,dt,amount,'pending') returning * into s;
      insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,currency)
      values(building,unit,c.customer_id,'sale_contract',c.id,'sale_installment','出售分期 '||c.contract_no||' 第'||n||'期',dt,amount,0,case when dt<current_date then 'overdue' else 'pending' end,'XOF');
      result:=jsonb_build_object('success',true,'data',to_jsonb(s));
    elsif p_operation='sale_transfer' then
      if coalesce(p_input->>'status','') not in ('not_started','in_progress','completed') then raise exception 'invalidTransferStatus'; end if;
      dt:=nullif(p_input->>'transferDate','')::date;
      if dt is not null and not isfinite(dt) then raise exception 'invalidFinancePayload'; end if;
      update public.sale_contracts set transfer_status=p_input->>'status',transfer_date=coalesce(dt,transfer_date),
        title_certificate_no=coalesce(nullif(p_input->>'titleCertificateNo',''),title_certificate_no),updated_at=now() where id=c.id;
    else
      if nullif(trim(p_input->>'reason'),'') is null then raise exception 'reasonRequired'; end if;
      update public.sale_payment_schedule set status='cancelled' where sale_contract_id=c.id and status<>'paid';
      update public.receivables set status='cancelled' where source_type='sale_contract' and source_id=c.id and status<>'paid';
      update public.sale_contracts set status='terminated',updated_at=now() where id=c.id;
      perform 1 from public.units where id=unit for update;
      if not exists(select 1 from public.sale_contracts where unit_id=unit and status='active' and id<>c.id) then
        update public.units set status=case when exists(select 1 from public.lease_contracts where unit_id=unit and status='active') then 'leased'::public.unit_status else 'available'::public.unit_status end
          where id=unit and status='sold';
      end if;
    end if;
    update public.sale_contracts set updated_at=now() where id=c.id;
    result:=coalesce(result,jsonb_build_object('success',true));
  elsif p_operation='daily_backfill' then
    start_date:=(p_input->>'checkIn')::date; end_date:=(p_input->>'checkOut')::date;
    amount:=(p_input->>'nightlyPriceXof')::numeric; paid:=(p_input->>'prepaidAmountXof')::numeric;
    if start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date) or end_date<=start_date or start_date>=current_date or end_date>current_date
      or amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or trunc(amount)<>amount
      or paid is null or paid<0 or paid::text in ('NaN','Infinity','-Infinity') or trunc(paid)<>paid
      or nullif(trim(p_input->>'reason'),'') is null then raise exception 'invalidBackfillPayload'; end if;
    total:=(end_date-start_date)*amount;
    if paid>total then raise exception 'paymentExceedsOutstanding'; end if;
    if not exists(select 1 from public.customers where id=(p_input->>'customerId')::uuid
      and not coalesce(is_blacklisted,false)
      and trim(name) in ('Chouke','Niamke','Fulo','Esai','黄姐','颖','镇淮','悦凯','孙敏','李军','振咏','5号前台')) then
      raise exception 'invalidBookingAgent'; end if;
    perform 1 from public.units where id=unit for update;
    if exists(select 1 from public.daily_bookings where unit_id=unit and status<>'cancelled'
      and check_in<end_date and coalesce(actual_check_out,check_out,'infinity'::date)>start_date) then raise exception 'doubleBooked'; end if;
    insert into public.daily_bookings(unit_id,customer_id,check_in,check_out,checkout_mode,nightly_price_xof,total_amount_xof,final_amount_xof,prepaid_amount_xof,billing_status,status,notes)
    values(unit,(p_input->>'customerId')::uuid,start_date,end_date,'fixed',amount,total,total,paid,
      case when paid>=total then 'settled' when paid>0 then 'partially_paid' else 'need_top_up' end,'checked_out',
      '[历史补录] '||trim(p_input->>'reason')||coalesce(' — '||nullif(p_input->>'notes',''),'')) returning * into b;
    insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,currency)
    values(building,unit,b.customer_id,'daily_booking',b.id,'daily_rental','日租(补录) '||start_date||'–'||end_date,start_date,total,paid,
      case when paid>=total then 'paid' when paid>0 then 'partial' else 'overdue' end,'XOF');
    if paid>0 then
      insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,request_id,request_kind)
      values(b.customer_id,unit,'daily_booking',b.id,end_date,paid,'XOF',1,p_request_id,'daily_backfill') returning id into payment;
      insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description)
      values(building,unit,payment,end_date,'income','daily_rental',paid,'日租历史补录 房间'||u.unit_no);
    end if;
    entity:=b.id; result:=jsonb_build_object('success',true,'data',public.daily_booking_operation_snapshot(b.id,unit));
  else
    select * into strict b from public.daily_bookings where id=b.id for update;
    if b.unit_id<>unit or b.status='cancelled' then raise exception 'bookingNotPayable'; end if;
    before_data:=to_jsonb(b); entity:=b.id;
    if p_operation='daily_undo_checkin' then
      if b.status<>'checked_in' or b.updated_at is distinct from (p_input->>'expectedUpdatedAt')::timestamptz then raise exception 'financeRecordChanged'; end if;
      if coalesce(p_input->>'targetStatus','') not in ('available','reserved','cleaning_pending','maintenance','locked') then raise exception 'invalidUnitStatus'; end if;
      update public.daily_bookings set status='confirmed',updated_at=now() where id=b.id returning * into b;
      update public.units set status=(p_input->>'targetStatus')::public.unit_status where id=unit;
    end if;
    if b.checkout_mode='open' and b.status='checked_in' and b.actual_check_out is null then
      total:=greatest(1,current_date-b.check_in)*b.nightly_price_xof;
      update public.daily_bookings set total_amount_xof=total,final_amount_xof=greatest(0,total-coalesce(manual_discount_amount_xof,0)) where id=b.id;
    end if;
    if (select count(*) from public.receivables where source_type='daily_booking' and source_id=b.id and status<>'cancelled')<>1 then raise exception 'dailyReceivableReviewRequired'; end if;
    if exists(select 1 from public.payments pay where pay.source_type='daily_booking' and pay.source_id=b.id and (pay.currency<>'XOF' or pay.exchange_rate_to_xof<>1)) then raise exception 'dailyCurrencyReviewRequired'; end if;
    -- Reuse the same canonical database calculation used by normal payment RPCs.
    perform public.daily_sync_booking_finance_tx(b.id);
    result:=jsonb_build_object('success',true);
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,metadata)
  values(actor,case when p_operation='daily_backfill' then 'daily_booking_backfill' else p_operation end,
    case when p_operation='manual_entry' then 'ledger_entry' when p_operation like 'sale_%' then 'sale_contract' else 'daily_booking' end,
    entity,before_data,jsonb_build_object('request_id',p_request_id,'input',p_input,'channel','finance_operation_rpc'));
  insert into private.finance_operation_requests(request_id,actor_id,operation,payload,result) values(p_request_id,actor,p_operation,p_input,result);
  return result||jsonb_build_object('idempotent',false);
end $$;
revoke all on function private.finance_operation(text,jsonb,uuid) from public,anon,service_role;
grant execute on function private.finance_operation(text,jsonb,uuid) to authenticated;
create function public.finance_operation_rpc(p_operation text,p_input jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.finance_operation(p_operation,p_input,p_request_id) $$;
revoke all on function public.finance_operation_rpc(text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.finance_operation_rpc(text,jsonb,uuid) to authenticated;

create function public.record_sale_payment_rpc(p_contract_id uuid,p_schedule_id uuid,p_amount numeric,p_payment_date date,p_receipt_no text default null,p_request_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.finance_operation('sale_payment',jsonb_build_object('contractId',p_contract_id,'scheduleId',p_schedule_id,'amount',p_amount,'paymentDate',p_payment_date,'receiptNo',p_receipt_no),p_request_id)
$$;
revoke all on function public.record_sale_payment_rpc(uuid,uuid,numeric,date,text,uuid) from public,anon,service_role;
grant execute on function public.record_sale_payment_rpc(uuid,uuid,numeric,date,text,uuid) to authenticated;

commit;
