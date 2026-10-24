begin;

-- New corrections are append-only facts. Existing payments, ledger entries and
-- positive payment_receivable_allocations are never changed or deleted.
create table private.cimac_collection_adjustments (
  id uuid primary key,request_id uuid not null unique references private.cimac_billing_requests(request_id),
  original_payment_id uuid not null references public.payments(id),payment_id uuid not null unique references public.payments(id),
  customer_id uuid not null references public.customers(id),kind text not null check(kind in ('refund','reversal')),
  amount numeric(14,2) not null check(amount>0 and amount=trunc(amount) and amount::text not in ('NaN','Infinity','-Infinity')),
  payment_date date not null,effective_date date not null,payment_method text not null,
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  actor_id uuid not null references auth.users(id),audit_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
create index cimac_adjustments_original on private.cimac_collection_adjustments(original_payment_id,created_at,id);
create index cimac_adjustments_customer on private.cimac_collection_adjustments(customer_id);
create index cimac_adjustments_actor on private.cimac_collection_adjustments(actor_id);
create unique index cimac_one_customer_reversal on private.cimac_collection_adjustments(original_payment_id) where kind='reversal';
alter table private.cimac_collection_adjustments enable row level security;
revoke all on private.cimac_collection_adjustments from public,anon,authenticated,service_role;

create table private.cimac_collection_adjustment_lines (
  adjustment_id uuid not null references private.cimac_collection_adjustments(id),
  receivable_id uuid not null references public.receivables(id),
  amount numeric(14,2) not null check(amount>0 and amount=trunc(amount) and amount::text not in ('NaN','Infinity','-Infinity')),
  before_paid numeric(14,2) not null,before_remaining numeric(14,2) not null,before_updated_at timestamptz not null,
  primary key(adjustment_id,receivable_id)
);
create index cimac_adjustment_lines_receivable on private.cimac_collection_adjustment_lines(receivable_id);
alter table private.cimac_collection_adjustment_lines enable row level security;
revoke all on private.cimac_collection_adjustment_lines from public,anon,authenticated,service_role;

create function private.cimac_effective_allocated_xof(p_receivable uuid) returns numeric
language sql stable set search_path='' as $$
  select coalesce((select sum(amount_xof) from public.payment_receivable_allocations where receivable_id=p_receivable),0)
    -coalesce((select sum(amount) from private.cimac_collection_adjustment_lines where receivable_id=p_receivable),0);
$$;
create function private.cimac_collection_line_remaining(p_payment uuid,p_receivable uuid) returns numeric
language sql stable set search_path='' as $$
  select a.amount_xof-coalesce((select sum(l.amount) from private.cimac_collection_adjustment_lines l
    join private.cimac_collection_adjustments d on d.id=l.adjustment_id
    where d.original_payment_id=p_payment and l.receivable_id=p_receivable),0)
  from public.payment_receivable_allocations a where a.payment_id=p_payment and a.receivable_id=p_receivable;
$$;
create function private.cimac_adjustment_doc(d private.cimac_collection_adjustments) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',d.id,'requestId',d.request_id,'paymentId',d.payment_id,'originalPaymentId',d.original_payment_id,
    'kind',d.kind,'paymentDate',d.payment_date,'effectiveDate',d.effective_date,'amount',d.amount::text,'currency','XOF',
    'paymentMethod',d.payment_method,'reason',d.reason,'recordedBy',d.actor_id,'auditId',d.audit_id,
    'receiptNo',(select receipt_no from public.payments where id=d.payment_id),'createdAt',d.created_at,
    'allocations',coalesce((select jsonb_agg(jsonb_build_object('receivableId',l.receivable_id,'amount',l.amount::text) order by l.receivable_id)
      from private.cimac_collection_adjustment_lines l where l.adjustment_id=d.id),'[]'::jsonb));
$$;

create function private.cimac_collection_adjustments_valid(p_original uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare d private.cimac_collection_adjustments%rowtype; j private.cimac_billing_requests%rowtype; p public.payments%rowtype;
  original public.payments%rowtype; n integer;
begin
  select * into original from public.payments where id=p_original and source_type='cimac_customer_collection';
  if original.id is null then return false; end if;
  if (select count(*) from private.cimac_collection_adjustments where original_payment_id=p_original and kind='reversal')>1
    or (exists(select 1 from private.cimac_collection_adjustments where original_payment_id=p_original and kind='reversal')
      and exists(select 1 from private.cimac_collection_adjustments where original_payment_id=p_original and kind='refund'))
    or coalesce((select sum(amount) from private.cimac_collection_adjustments where original_payment_id=p_original),0)>original.amount
    or exists(select 1 from public.payment_receivable_allocations a where a.payment_id=p_original
      and private.cimac_collection_line_remaining(p_original,a.receivable_id)<0) then return false; end if;
  for d in select * from private.cimac_collection_adjustments where original_payment_id=p_original loop
    select * into j from private.cimac_billing_requests where request_id=d.request_id;
    select * into p from public.payments where id=d.payment_id;
    if j.request_id is null or p.id is null or j.kind is distinct from d.kind or j.actor_id is distinct from d.actor_id
      or j.customer_id is distinct from original.customer_id or d.customer_id is distinct from original.customer_id
      or j.result->'success' is distinct from 'true'::jsonb or j.result->>'status' is distinct from 'completed'
      or j.result->>'paymentId' is distinct from p.id::text or j.result->>'auditId' is distinct from d.audit_id::text
      or j.result->>'entityId' is distinct from p.id::text or j.result->>'requestId' is distinct from d.request_id::text
      or j.result->>'actorId' is distinct from d.actor_id::text or j.result->>'kind' is distinct from d.kind
      or j.result->>'customerId' is distinct from d.customer_id::text or j.result->>'originalPaymentId' is distinct from original.id::text
      or j.result->>'currency' is distinct from 'XOF' or (j.result->>'amount')::numeric is distinct from d.amount
      or j.result->>'paymentDate' is distinct from d.payment_date::text or j.result->>'effectiveDate' is distinct from d.effective_date::text
      or j.result->>'paymentMethod' is distinct from d.payment_method
      or j.input->>'originalPaymentId' is distinct from original.id::text or j.input->>'customerId' is distinct from original.customer_id::text
      or (j.input->>'amount')::numeric is distinct from d.amount or j.input->>'reason' is distinct from d.reason
      or p.source_type is distinct from 'cimac_customer_'||d.kind or p.request_kind is distinct from p.source_type
      or p.source_id is distinct from original.id or p.customer_id is distinct from original.customer_id or p.unit_id is not null
      or p.currency<>'XOF' or p.exchange_rate_to_xof<>1 or p.native_settlement or p.recorded_by is distinct from d.actor_id
      or p.request_id is distinct from d.request_id or p.payment_date is distinct from d.effective_date or d.payment_date<>d.effective_date
      or p.amount is distinct from (case when d.kind='refund' then d.amount else -d.amount end)
      or p.payment_method is distinct from d.payment_method
      or (d.kind='refund' and (p.reversal_of_payment_id is not null or d.payment_method not in ('cash','check','bank_transfer','other')
        or d.payment_date<original.payment_date or d.payment_date is distinct from (j.input->>'paymentDate')::date
        or d.payment_method is distinct from j.input->>'paymentMethod'))
      or (d.kind='reversal' and (p.reversal_of_payment_id is distinct from original.id or d.amount<>original.amount
        or d.payment_method<>'offset' or d.effective_date<>original.payment_date))
      or jsonb_typeof(j.input->'allocations') is distinct from 'array' then return false; end if;
    n:=jsonb_array_length(j.input->'allocations');
    if n not between 1 and 100 or (select count(*) from private.cimac_collection_adjustment_lines where adjustment_id=d.id)<>n
      or (select count(*) from public.ledger_entries where payment_id=p.id)<>n
      or (select sum(amount) from private.cimac_collection_adjustment_lines where adjustment_id=d.id) is distinct from d.amount
      or (select sum(amount_xof) from public.ledger_entries where payment_id=p.id) is distinct from -d.amount
      or exists(select 1 from public.payment_receivable_allocations where payment_id=p.id) then return false; end if;
    if exists(select 1 from private.cimac_collection_adjustment_lines l left join public.payment_receivable_allocations a
      on a.payment_id=original.id and a.receivable_id=l.receivable_id where l.adjustment_id=d.id and
      (a.receivable_id is null or not exists(select 1 from jsonb_array_elements(j.input->'allocations') x
        where (x->>'receivableId')::uuid=l.receivable_id and (x->>'amount')::numeric=l.amount
          and (x->>'expectedPaid')::numeric=l.before_paid and (x->>'expectedRemaining')::numeric=l.before_remaining
          and (x->>'expectedUpdatedAt')::timestamptz=l.before_updated_at))) then return false; end if;
    if exists(
      (select jsonb_build_array(r.building_id,r.unit_id,r.category,-l.amount,'XOF',d.effective_date,'income',null)
        from private.cimac_collection_adjustment_lines l join public.receivables r on r.id=l.receivable_id where l.adjustment_id=d.id
       except all
       select jsonb_build_array(l.building_id,l.unit_id,l.category,l.amount_xof,l.currency,l.entry_date,l.direction,l.amount_native)
        from public.ledger_entries l where l.payment_id=p.id)
      union all
      (select jsonb_build_array(l.building_id,l.unit_id,l.category,l.amount_xof,l.currency,l.entry_date,l.direction,l.amount_native)
        from public.ledger_entries l where l.payment_id=p.id
       except all
       select jsonb_build_array(r.building_id,r.unit_id,r.category,-l.amount,'XOF',d.effective_date,'income',null)
        from private.cimac_collection_adjustment_lines l join public.receivables r on r.id=l.receivable_id where l.adjustment_id=d.id)
    ) then return false; end if;
    if not exists(select 1 from public.audit_logs a where a.id=d.audit_id and a.actor_id=d.actor_id and a.entity_id=p.id
      and a.entity_type='cimac_customer_'||d.kind and a.metadata->>'request_id'=d.request_id::text
      and a.action=d.kind and a.metadata->>'original_payment_id'=original.id::text
      and a.metadata->>'project_id'=(select id::text from public.projects where code='CIMAC')
      and a.metadata->>'customer_id'=original.customer_id::text and (a.metadata->>'amount')::numeric=d.amount
      and a.metadata->>'currency'='XOF' and a.metadata->>'payment_date'=d.payment_date::text
      and a.metadata->'actual_money_returned'=to_jsonb(d.kind='refund')) then return false; end if;
  end loop;
  return true;
exception when data_exception then return false;
end; $$;

-- The original proof verifies the immutable receipt/allocations/ledger. Live
-- paid balances are separately checked using effective allocations; a legitimate
-- refund must not make the original historical receipt fail its sealed proof.
do $proof$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.cimac_customer_collection_proof(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:=$old$      or a.amount_xof>r.amount_xof or a.amount_xof>r.paid_amount_xof
      or coalesce((select sum(other.amount_xof) from public.payment_receivable_allocations other where other.receivable_id=r.id),0)>r.paid_amount_xof
$old$;
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentProofDrift'; end if;
  definition:=replace(definition,anchor,'');
  anchor:='  return true;';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacAdjustmentProofDrift'; end if;
  definition:=replace(definition,anchor,$replacement$  return private.cimac_collection_adjustments_valid(p.id) and not exists(
    select 1 from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id where a.payment_id=p.id
      and (r.amount_xof::text in ('NaN','Infinity','-Infinity') or r.paid_amount_xof::text in ('NaN','Infinity','-Infinity')
        or r.paid_amount_xof<0 or r.paid_amount_xof>r.amount_xof
        or private.cimac_effective_allocated_xof(r.id) not between 0 and r.paid_amount_xof));$replacement$);
  execute definition;
end; $proof$;
create function private.cimac_adjustment_payment_proof(p_payment uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare original uuid;
begin
  select original_payment_id into original from private.cimac_collection_adjustments where payment_id=p_payment;
  return original is not null and private.cimac_customer_collection_proof(original);
end; $$;
create function private.cimac_any_customer_payment_proof(p_payment uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select private.cimac_customer_collection_proof(p_payment) or private.cimac_adjustment_payment_proof(p_payment);
$$;

create function private.cimac_collection_position(p_original_payment_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.payments%rowtype; rows jsonb; history jsonb; refunded numeric; reversed numeric; eligible boolean;
  snapshot jsonb;
begin
  perform private.cimac_billing_scope(false);
  select * into p from public.payments where id=p_original_payment_id and source_type='cimac_customer_collection';
  if p.id is null then raise exception 'cimacBillingTargetMismatch'; end if;
  if not private.cimac_customer_collection_proof(p.id) then raise exception 'cimacBillingVerificationFailed'; end if;
  select coalesce(sum(amount) filter(where kind='refund'),0),coalesce(sum(amount) filter(where kind='reversal'),0),
    coalesce(jsonb_agg(private.cimac_adjustment_doc(d) order by d.created_at,d.id),'[]'::jsonb)
    into refunded,reversed,history from private.cimac_collection_adjustments d where d.original_payment_id=p.id;
  select jsonb_agg(jsonb_build_object('receivableId',r.id,'contractId',r.source_id,'unitId',r.unit_id,'title',r.title,
    'originalAmount',a.amount_xof::text,
    'refundedAmount',coalesce((select sum(l.amount) from private.cimac_collection_adjustment_lines l join private.cimac_collection_adjustments d on d.id=l.adjustment_id where d.original_payment_id=p.id and d.kind='refund' and l.receivable_id=r.id),0)::text,
    'reversedAmount',coalesce((select sum(l.amount) from private.cimac_collection_adjustment_lines l join private.cimac_collection_adjustments d on d.id=l.adjustment_id where d.original_payment_id=p.id and d.kind='reversal' and l.receivable_id=r.id),0)::text,
    'remainingAmount',private.cimac_collection_line_remaining(p.id,r.id)::text,'paidAmount',r.paid_amount_xof::text,'updatedAt',r.updated_at)
    order by r.due_date,r.id),
    bool_and(r.management_status='managed' and r.status in ('paid','partial','pending','overdue') and r.currency='XOF'
      and r.paid_amount_xof<=r.amount_xof and r.paid_amount_xof>=private.cimac_collection_line_remaining(p.id,r.id)
      and private.cimac_effective_allocated_xof(r.id) between 0 and r.paid_amount_xof)
    into rows,eligible from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id where a.payment_id=p.id;
  snapshot:=jsonb_build_object('payment',to_jsonb(p),'allocations',rows,'adjustments',history);
  return jsonb_build_object('originalPaymentId',p.id,'customerId',p.customer_id,'currency','XOF',
    'originalPaymentDate',p.payment_date,'originalPaymentMethod',p.payment_method,'originalReceiptNo',p.receipt_no,
    'originalAmount',p.amount::text,'refundedAmount',refunded::text,'reversedAmount',reversed::text,
    'remainingAmount',(p.amount-refunded-reversed)::text,'positionToken',md5(snapshot::text),
    'canRefund',coalesce(eligible,false) and reversed=0 and p.amount>refunded,
    'canReverse',coalesce(eligible,false) and refunded=0 and reversed=0,
    'allocations',rows,'adjustments',history);
end; $$;

-- A guarded new reversal is the one permitted reference to the immutable
-- customer receipt. A legacy writer or a forged direct insert still fails.
create function private.cimac_adjustment_insert_authorized(p_payment public.payments) returns boolean
language sql stable security definer set search_path='' as $$
  select p_payment.source_type='cimac_customer_reversal' and p_payment.request_kind=p_payment.source_type
    and exists(select 1 from private.cimac_billing_requests j where j.request_id=p_payment.request_id and j.kind='reversal'
      and j.actor_id=auth.uid() and j.result->>'paymentId'=p_payment.id::text and not(j.result?'success')
      and j.input->>'originalPaymentId'=p_payment.reversal_of_payment_id::text);
$$;
do $guard$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.guard_cimac_customer_collection()'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='where p.id=new.reversal_of_payment_id and p.source_type=''cimac_customer_collection'') then';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacAdjustmentGuardDrift'; end if;
  execute replace(definition,anchor,'where p.id=new.reversal_of_payment_id and p.source_type=''cimac_customer_collection'') and not private.cimac_adjustment_insert_authorized(new) then');
end; $guard$;

create function private.guard_cimac_adjustment() returns trigger
language plpgsql security definer set search_path='' as $$
declare j private.cimac_billing_requests%rowtype; d private.cimac_collection_adjustments%rowtype;
  p public.payments%rowtype; original public.payments%rowtype; target_payment uuid;
begin
  if tg_table_schema='private' then
    if tg_op<>'INSERT' then raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    if tg_table_name='cimac_collection_adjustments' then
      select * into j from private.cimac_billing_requests where request_id=new.request_id;
      if j.request_id is null or j.kind is distinct from new.kind or j.actor_id is distinct from auth.uid()
        or j.result->>'paymentId' is distinct from new.payment_id::text or j.result?'success'
        or j.input->>'originalPaymentId' is distinct from new.original_payment_id::text then raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    else
      select * into d from private.cimac_collection_adjustments where id=new.adjustment_id;
      select * into j from private.cimac_billing_requests where request_id=d.request_id;
      if j.request_id is null or j.actor_id is distinct from auth.uid() or j.result?'success'
        or not exists(select 1 from jsonb_array_elements(j.input->'allocations') a where (a->>'receivableId')::uuid=new.receivable_id
          and (a->>'amount')::numeric=new.amount and (a->>'expectedPaid')::numeric=new.before_paid
          and (a->>'expectedRemaining')::numeric=new.before_remaining and (a->>'expectedUpdatedAt')::timestamptz=new.before_updated_at) then
        raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    end if;
    return new;
  end if;
  if tg_table_name='payments' then
    if tg_op<>'INSERT' and old.source_type in ('cimac_customer_refund','cimac_customer_reversal') then raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    if tg_op='DELETE' then return old; end if;
    if new.reversal_of_payment_id is not null and exists(select 1 from public.payments where id=new.reversal_of_payment_id and source_type in ('cimac_customer_refund','cimac_customer_reversal')) then raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    if new.source_type not in ('cimac_customer_refund','cimac_customer_reversal') and coalesce(new.request_kind,'') not in ('cimac_customer_refund','cimac_customer_reversal') then return new; end if;
    select * into j from private.cimac_billing_requests where request_id=new.request_id;
    select * into original from public.payments where id=(j.input->>'originalPaymentId')::uuid;
    if tg_op<>'INSERT' or j.request_id is null or j.actor_id is distinct from auth.uid() or j.kind not in ('refund','reversal')
      or j.result?'success' or j.result->>'paymentId' is distinct from new.id::text
      or new.source_type is distinct from 'cimac_customer_'||j.kind or new.request_kind is distinct from new.source_type
      or new.customer_id is distinct from j.customer_id or new.source_id is distinct from original.id or new.unit_id is not null
      or new.currency<>'XOF' or new.exchange_rate_to_xof<>1 or new.native_settlement
      or new.amount is distinct from (case when j.kind='refund' then (j.input->>'amount')::numeric else -(j.input->>'amount')::numeric end)
      or new.payment_date is distinct from (case when j.kind='refund' then (j.input->>'paymentDate')::date else original.payment_date end)
      or new.payment_method is distinct from (case when j.kind='refund' then j.input->>'paymentMethod' else 'offset' end)
      or new.reversal_of_payment_id is distinct from (case when j.kind='reversal' then original.id else null::uuid end) then
      raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    return new;
  end if;
  if tg_op<>'INSERT' then
    select * into p from public.payments where id=old.payment_id;
    if p.source_type in ('cimac_customer_refund','cimac_customer_reversal') then raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  select * into p from public.payments where id=new.payment_id;
  if p.id is null or coalesce(p.source_type,'') not in ('cimac_customer_refund','cimac_customer_reversal') then return new; end if;
  select * into j from private.cimac_billing_requests where request_id=p.request_id;
  if tg_table_name='payment_receivable_allocations' then raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
  if tg_op<>'INSERT' or j.request_id is null or j.actor_id is distinct from auth.uid() or j.result?'success'
    or new.direction<>'income' or new.amount_native is not null or new.currency<>'XOF' or new.entry_date<>p.payment_date
    or not exists(select 1 from jsonb_array_elements(j.input->'allocations') a join public.receivables r on r.id=(a->>'receivableId')::uuid
      where r.unit_id=new.unit_id and r.building_id=new.building_id and r.category=new.category and -(a->>'amount')::numeric=new.amount_xof) then
    raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
  return new;
end; $$;
create trigger guard_cimac_adjustment_fact before insert or update or delete on private.cimac_collection_adjustments for each row execute function private.guard_cimac_adjustment();
create trigger guard_cimac_adjustment_line before insert or update or delete on private.cimac_collection_adjustment_lines for each row execute function private.guard_cimac_adjustment();
create trigger guard_cimac_adjustment_payment before insert or update or delete on public.payments for each row execute function private.guard_cimac_adjustment();
create trigger guard_cimac_adjustment_ledger before insert or update or delete on public.ledger_entries for each row execute function private.guard_cimac_adjustment();
create trigger guard_cimac_adjustment_allocation before insert or update or delete on public.payment_receivable_allocations for each row execute function private.guard_cimac_adjustment();

create function private.cimac_adjust_collection(p_kind text,p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project uuid; original public.payments%rowtype; prior private.cimac_billing_requests%rowtype;
  position jsonb; item jsonb; target jsonb; bill public.receivables%rowtype; total numeric; allocated numeric:=0; piece numeric;
  payment_day date; method text; reason text; pay uuid:=gen_random_uuid(); audit uuid:=gen_random_uuid(); adjustment uuid:=gen_random_uuid();
  receipt text; before_rows jsonb; after_rows jsonb; output_doc jsonb; links jsonb:='[]'::jsonb;
begin
  project:=private.cimac_billing_scope(true);
  if p_kind not in ('refund','reversal') or p_request_id is null then raise exception 'cimacBillingInvalidInput'; end if;
  perform private.cimac_billing_keys(p_input,
    case when p_kind='refund' then array['originalPaymentId','customerId','currency','amount','reason','expectedPositionToken','allocations','notes','paymentDate','paymentMethod','externalReceiptNo']
      else array['originalPaymentId','customerId','currency','amount','reason','expectedPositionToken','allocations','notes'] end,
    case when p_kind='refund' then array['originalPaymentId','customerId','currency','amount','reason','expectedPositionToken','allocations','paymentDate','paymentMethod']
      else array['originalPaymentId','customerId','currency','amount','reason','expectedPositionToken','allocations'] end);
  if p_input->>'currency'<>'XOF' or jsonb_typeof(p_input->'allocations') is distinct from 'array'
    or jsonb_array_length(p_input->'allocations') not between 1 and 100
    or coalesce(p_input->>'expectedPositionToken','') !~ '^[0-9a-f]{32}$' then raise exception 'cimacBillingInvalidInput'; end if;
  total:=private.cimac_billing_decimal(p_input->'amount',0,true);
  reason:=private.cimac_billing_text(p_input->'reason',1000);
  if reason is distinct from p_input->>'reason' then raise exception 'cimacBillingInvalidInput'; end if;
  perform (p_input->>'originalPaymentId')::uuid; perform (p_input->>'customerId')::uuid;
  if p_kind='refund' then
    payment_day:=private.cimac_billing_date(p_input->'paymentDate'); method:=p_input->>'paymentMethod';
    if payment_day>current_date or method not in ('cash','check','bank_transfer','other') then raise exception 'cimacBillingInvalidInput'; end if;
  end if;
  for item in select value from jsonb_array_elements(p_input->'allocations') loop
    perform private.cimac_billing_keys(item,array['receivableId','amount','expectedRemaining','expectedPaid','expectedUpdatedAt'],array['receivableId','amount','expectedRemaining','expectedPaid','expectedUpdatedAt']);
    perform (item->>'receivableId')::uuid; perform (item->>'expectedUpdatedAt')::timestamptz;
    piece:=private.cimac_billing_decimal(item->'amount',0,true);
    if private.cimac_billing_decimal(item->'expectedRemaining',0,true)<piece
      or private.cimac_billing_decimal(item->'expectedPaid',2)<piece then raise exception 'cimacBillingInvalidInput'; end if;
    allocated:=allocated+piece;
  end loop;
  if allocated<>total or jsonb_array_length(p_input->'allocations')<>(select count(distinct (a->>'receivableId')::uuid) from jsonb_array_elements(p_input->'allocations') a) then raise exception 'cimacBillingInvalidInput'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into original from public.payments where id=(p_input->>'originalPaymentId')::uuid for update;
  if original.id is null or original.source_type<>'cimac_customer_collection' or original.customer_id is distinct from (p_input->>'customerId')::uuid then raise exception 'cimacBillingTargetMismatch'; end if;
  if not private.cimac_customer_collection_proof(original.id) then raise exception 'cimacBillingVerificationFailed'; end if;
  select * into prior from private.cimac_billing_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>auth.uid() or prior.kind<>p_kind or prior.input is distinct from p_input or prior.customer_id<>original.customer_id then raise exception 'cimacBillingRequestIdConflict'; end if;
    return prior.result||jsonb_build_object('idempotent',true);
  end if;
  if exists(select 1 from public.payments where request_id=p_request_id) then raise exception 'cimacBillingRequestIdConflict'; end if;
  perform 1 from public.lease_contracts c where c.id in(select r.source_id from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id where a.payment_id=original.id) order by c.id for update;
  perform 1 from public.receivables r where r.id in(select receivable_id from public.payment_receivable_allocations where payment_id=original.id) order by r.due_date,r.id for update;
  position:=private.cimac_collection_position(original.id);
  if position->>'positionToken' is distinct from p_input->>'expectedPositionToken'
    or (p_kind='refund' and position->'canRefund' is distinct from 'true'::jsonb)
    or (p_kind='reversal' and (position->'canReverse' is distinct from 'true'::jsonb or total<>original.amount
      or jsonb_array_length(p_input->'allocations')<>jsonb_array_length(position->'allocations')))
    or total>(position->>'remainingAmount')::numeric then raise exception 'cimacBillingSnapshotChanged'; end if;
  if p_kind='reversal' then payment_day:=original.payment_date; method:='offset';
  elsif payment_day<original.payment_date then raise exception 'cimacBillingSnapshotChanged'; end if;
  for item in select value from jsonb_array_elements(p_input->'allocations') loop
    select value into target from jsonb_array_elements(position->'allocations') where value->>'receivableId'=item->>'receivableId';
    if target is null or (item->>'amount')::numeric>(target->>'remainingAmount')::numeric
      or (target->>'remainingAmount')::numeric is distinct from (item->>'expectedRemaining')::numeric
      or (target->>'paidAmount')::numeric is distinct from (item->>'expectedPaid')::numeric
      or (target->>'updatedAt')::timestamptz is distinct from (item->>'expectedUpdatedAt')::timestamptz
      or (p_kind='reversal' and (item->>'amount')::numeric<>(target->>'originalAmount')::numeric) then raise exception 'cimacBillingSnapshotChanged'; end if;
  end loop;
  select jsonb_agg(to_jsonb(r) order by r.due_date,r.id) into before_rows from public.receivables r where id in(select (a->>'receivableId')::uuid from jsonb_array_elements(p_input->'allocations') a);
  insert into private.cimac_billing_requests(request_id,actor_id,customer_id,kind,input,result)
    values(p_request_id,auth.uid(),original.customer_id,p_kind,p_input,jsonb_build_object('paymentId',pay));
  insert into public.payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,native_settlement,
    payment_method,request_id,request_kind,external_receipt_no,reversal_of_payment_id,notes)
  values(pay,original.customer_id,null,'cimac_customer_'||p_kind,original.id,payment_day,case when p_kind='refund' then total else -total end,'XOF',1,false,
    method,p_request_id,'cimac_customer_'||p_kind,case when p_kind='refund' then private.cimac_billing_text(p_input->'externalReceiptNo',200,true) else null end,
    case when p_kind='reversal' then original.id else null end,
    concat_ws('；',case when p_kind='refund' then '登记已实际退款；恢复相应应收，不自动免除合同义务' else '错误收款整单冲正；非实际退款，原期纠错' end,reason,private.cimac_billing_text(p_input->'notes',2000,true))) returning receipt_no into receipt;
  insert into private.cimac_collection_adjustments(id,request_id,original_payment_id,payment_id,customer_id,kind,amount,payment_date,effective_date,payment_method,reason,actor_id,audit_id)
    values(adjustment,p_request_id,original.id,pay,original.customer_id,p_kind,total,payment_day,payment_day,method,reason,auth.uid(),audit);
  for item in select a from jsonb_array_elements(p_input->'allocations') a join public.receivables r on r.id=(a->>'receivableId')::uuid order by r.due_date,r.id loop
    select * into strict bill from public.receivables where id=(item->>'receivableId')::uuid;
    piece:=(item->>'amount')::numeric;
    insert into private.cimac_collection_adjustment_lines(adjustment_id,receivable_id,amount,before_paid,before_remaining,before_updated_at)
      values(adjustment,bill.id,piece,bill.paid_amount_xof,(item->>'expectedRemaining')::numeric,bill.updated_at);
    update public.receivables set paid_amount_xof=paid_amount_xof-piece,
      status=case when paid_amount_xof-piece>0 then 'partial' when due_date<current_date then 'overdue' else 'pending' end,updated_at=clock_timestamp() where id=bill.id;
    insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,description)
      values(bill.building_id,bill.unit_id,pay,payment_day,'income',bill.category,-piece,'XOF',case when p_kind='refund' then '客户总账实际退款 · ' else '客户总账错误收款冲正 · ' end||bill.title);
    links:=links||jsonb_build_array(jsonb_build_object('paymentId',pay,'receivableId',bill.id,'currency','XOF','amount',piece::text));
  end loop;
  select jsonb_agg(to_jsonb(r) order by r.due_date,r.id) into after_rows from public.receivables r where id in(select (a->>'receivableId')::uuid from jsonb_array_elements(p_input->'allocations') a);
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
    values(audit,auth.uid(),p_kind,'cimac_customer_'||p_kind,pay,before_rows,after_rows,
      jsonb_build_object('request_id',p_request_id,'project_id',project,'customer_id',original.customer_id,'original_payment_id',original.id,
        'amount',total,'currency','XOF','payment_date',payment_day,'receipt_no',receipt,'actual_money_returned',p_kind='refund',
        'original_facts_preserved',true,'obligation_not_waived',true,'paid_through_unchanged',true,'reason',reason));
  output_doc:=jsonb_build_object('success',true,'status','completed','kind',p_kind,'requestId',p_request_id,'actorId',auth.uid(),
    'customerId',original.customer_id,'entityId',pay,'auditId',audit,'idempotent',false,'paymentId',pay,'receiptNo',receipt,
    'originalPaymentId',original.id,'amount',total::text,'currency','XOF','remainingBefore',position->>'remainingAmount',
    'remainingAfter',((position->>'remainingAmount')::numeric-total)::text,'paymentDate',payment_day,'effectiveDate',payment_day,'paymentMethod',method,'allocations',links);
  update private.cimac_billing_requests set result=output_doc where request_id=p_request_id;
  if not private.cimac_customer_collection_proof(original.id) then raise exception 'cimacBillingVerificationFailed'; end if;
  return output_doc;
end; $$;

create function public.cimac_collection_position_rpc(p_original_payment_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.cimac_collection_position($1); $$;
create function public.cimac_refund_collection_rpc(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.cimac_adjust_collection('refund',$1,$2); $$;
create function public.cimac_reverse_collection_rpc(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.cimac_adjust_collection('reversal',$1,$2); $$;

create function private.cimac_collection_adjustment_docs(p_payment_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.cimac_billing_scope(false);
  if p_payment_ids is null or cardinality(p_payment_ids) not between 1 and 100 or array_position(p_payment_ids,null) is not null
    or cardinality(p_payment_ids)<>(select count(distinct id) from unnest(p_payment_ids) id) then raise exception 'cimacBillingInvalidInput'; end if;
  if exists(select 1 from unnest(p_payment_ids) id where not private.cimac_adjustment_payment_proof(id)) then raise exception 'cimacBillingVerificationFailed'; end if;
  select jsonb_agg(jsonb_build_object('paymentId',d.payment_id,'adjustment',private.cimac_adjustment_doc(d)) order by ids.ordinal)
    into result from unnest(p_payment_ids) with ordinality ids(id,ordinal) join private.cimac_collection_adjustments d on d.payment_id=ids.id;
  return result;
end; $$;
create function public.cimac_collection_adjustments_rpc(p_payment_ids uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.cimac_collection_adjustment_docs($1); $$;

-- Extend the existing header fence without changing access to legacy receipts.
create or replace function private.cimac_collection_visible(p_payment uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and coalesce(public.has_app_role('admin','finance','boss'),false)
    and exists(select 1 from private.cimac_billing_requests r join public.projects p on p.code='CIMAC'
      where r.kind in ('collection','refund','reversal') and r.result->>'paymentId'=p_payment::text and public.can_access_project(p.id));
$$;
create policy "CIMAC correction project restriction" on public.payments as restrictive for all to authenticated
using(source_type not in ('cimac_customer_refund','cimac_customer_reversal') or private.cimac_collection_visible(id))
with check(source_type not in ('cimac_customer_refund','cimac_customer_reversal') or private.cimac_collection_visible(id));
create policy "finance reads CIMAC correction audit" on public.audit_logs for select to authenticated
using(public.has_app_role('finance') and entity_type in ('cimac_customer_refund','cimac_customer_reversal')
  and exists(select 1 from public.projects p where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id)));
create policy "CIMAC correction audit restriction" on public.audit_logs as restrictive for all to authenticated
using(entity_type not in ('cimac_customer_refund','cimac_customer_reversal')
  or exists(select 1 from public.projects p where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id)))
with check(entity_type not in ('cimac_customer_refund','cimac_customer_reversal')
  or exists(select 1 from public.projects p where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id)));

create or replace function public.cimac_customer_collection_proof_rpc(p_payment_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$ select private.cimac_any_customer_payment_proof($1); $$;
create or replace function public.cimac_customer_collection_proofs_rpc(p_payment_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_payment_ids is null or cardinality(p_payment_ids) not between 1 and 100 or array_position(p_payment_ids,null) is not null
    or cardinality(p_payment_ids)<>(select count(distinct id) from unnest(p_payment_ids) id) then raise exception 'cimacBillingInvalidInput'; end if;
  select jsonb_agg(jsonb_build_object('paymentId',id,'verified',private.cimac_any_customer_payment_proof(id)) order by ordinal)
    into result from unnest(p_payment_ids) with ordinality ids(id,ordinal);
  return result;
end; $$;

do $read_models$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.cimac_collect_customer(jsonb,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='coalesce((select sum(a.amount_xof) from public.payment_receivable_allocations a where a.receivable_id=r.id),0)>r.paid_amount_xof';
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentCollectionDrift'; end if;
  execute replace(definition,anchor,'private.cimac_effective_allocated_xof(r.id)>r.paid_amount_xof');
  definition:=replace(pg_get_functiondef('private.cimac_customer_account(uuid,text,integer)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='jsonb_build_object(''protected_collection'',p.source_type=''cimac_customer_collection'')';
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentAccountDrift'; end if;
  execute replace(definition,anchor,$replacement$jsonb_build_object('protected_collection',p.source_type in ('cimac_customer_collection','cimac_customer_refund','cimac_customer_reversal'),
      'cimac_adjustment',(select private.cimac_adjustment_doc(d) from private.cimac_collection_adjustments d where d.payment_id=p.id))$replacement$);
end; $read_models$;

create or replace function private.cimac_lease_collection_projection(p_contract_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.lease_contracts%rowtype; project_code text; ids uuid[]; result jsonb;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance','boss','rental_sales','front_desk'),false) then
    raise exception 'cimacBillingPermissionDenied' using errcode='42501'; end if;
  select * into c from public.lease_contracts where id=p_contract_id;
  if c.id is null then raise exception 'cimacBillingTargetMismatch'; end if;
  if not coalesce(public.can_access_unit(c.unit_id),false) then raise exception 'cimacBillingPermissionDenied' using errcode='42501'; end if;
  select p.code into project_code from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where u.id=c.unit_id;
  if project_code<>'CIMAC' then return jsonb_build_object('contractId',c.id,'paymentCount',0,'payments','[]'::jsonb); end if;
  select coalesce(array_agg(distinct x.payment_id),'{}'::uuid[]) into ids from (
    select a.payment_id from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id
      join public.payments p on p.id=a.payment_id where p.source_type='cimac_customer_collection' and r.source_type='lease_contract' and r.source_id=c.id
    union all select d.payment_id from private.cimac_collection_adjustments d join private.cimac_collection_adjustment_lines a on a.adjustment_id=d.id
      join public.receivables r on r.id=a.receivable_id where r.source_type='lease_contract' and r.source_id=c.id) x;
  if exists(select 1 from unnest(ids) id where not private.cimac_any_customer_payment_proof(id)) then raise exception 'cimacBillingVerificationFailed'; end if;
  select jsonb_build_object('contractId',c.id,'paymentCount',cardinality(ids),'payments',
    coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('cimac_contract_allocation',(
      select jsonb_strip_nulls(jsonb_build_object('contractId',c.id,'amount',sum(x.amount)::text,'currency','XOF',
        'receivableIds',jsonb_agg(r.id order by r.due_date,r.id),
        'adjustmentKind',case when p.source_type='cimac_customer_refund' then 'refund' when p.source_type='cimac_customer_reversal' then 'reversal' end,
        'originalPaymentId',case when p.source_type in ('cimac_customer_refund','cimac_customer_reversal') then p.source_id end))
      from (
        select a.receivable_id,a.amount_xof amount from public.payment_receivable_allocations a where a.payment_id=p.id
        union all select a.receivable_id,-a.amount from private.cimac_collection_adjustment_lines a join private.cimac_collection_adjustments d on d.id=a.adjustment_id where d.payment_id=p.id
      ) x join public.receivables r on r.id=x.receivable_id where r.source_type='lease_contract' and r.source_id=c.id))
      order by p.payment_date desc,p.id) from public.payments p where p.id=any(ids)),'[]'::jsonb)) into result;
  return result;
end; $$;

-- Legacy inspector receives explicit signed correction lines, never a guessed
-- single room for a customer-level payment. The old writer remains forbidden.
create function private.cimac_adjustment_context(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.payments%rowtype;
begin
  if not private.cimac_adjustment_payment_proof(p_id) then raise exception 'cimacBillingVerificationFailed'; end if;
  select * into strict p from public.payments where id=p_id;
  return jsonb_build_object('paymentId',p.id,'unitId',null,'buildingId',null,'paymentDate',p.payment_date,'amount',p.amount,'currency',p.currency,
    'recordedBy',p.recorded_by,'recordedByName',case when p.recorded_by=auth.uid() then (select display_name from public.user_profiles where id=p.recorded_by) end,
    'actualCollector',p.actual_collector,'collectorBasis',p.collector_basis,'version',p.context_version,'token',md5(to_jsonb(p)::text),
    'confirmedBy',p.context_confirmed_by,'confirmedAt',p.context_confirmed_at,'readOnly',true,
    'allocatedXof',(select -sum(a.amount) from private.cimac_collection_adjustments d join private.cimac_collection_adjustment_lines a on a.adjustment_id=d.id where d.payment_id=p.id),
    'allocations',(select jsonb_agg(jsonb_build_object('receivableId',r.id,'title',r.title,'dueDate',r.due_date,'allocatedXof',-a.amount,
      'periodStart',r.service_period_start,'periodEnd',r.service_period_end,'periodSource',r.service_period_source,'token',md5(to_jsonb(r)::text)) order by r.due_date,r.id)
      from private.cimac_collection_adjustments d join private.cimac_collection_adjustment_lines a on a.adjustment_id=d.id join public.receivables r on r.id=a.receivable_id where d.payment_id=p.id));
end; $$;
do $context$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.payment_context_read_rpc(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='  if p.source_type=''cimac_customer_collection'' then';
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentContextDrift'; end if;
  execute replace(definition,anchor,$replacement$  if p.source_type in ('cimac_customer_refund','cimac_customer_reversal') then
    return private.cimac_adjustment_context(p.id);
  end if;
  if p.source_type='cimac_customer_collection' then$replacement$);
end; $context$;

-- Actual refunds are negative income at their actual date. A wrong receipt
-- reversal changes original-period totals only; its offset is not new cash.
create function private.cimac_collection_reversed(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.cimac_customer_collection_proof(p_id) and exists(select 1 from private.cimac_collection_adjustments where original_payment_id=p_id and kind='reversal');
$$;
do $dashboard$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.management_operating_snapshot_rpc(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='where p.source_type=''cimac_customer_collection'' and l.payment_id=p.id';
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentDashboardDrift'; end if;
  definition:=replace(definition,anchor,'where p.source_type in (''cimac_customer_collection'',''cimac_customer_refund'') and private.cimac_any_customer_payment_proof(p.id) and l.payment_id=p.id');
  anchor:='when p.source_type=''cimac_customer_collection'' then p.collection_amount';
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentDashboardDrift'; end if;
  definition:=replace(definition,anchor,$replacement$when p.source_type in ('cimac_customer_collection','cimac_customer_refund') then
        case when private.cimac_collection_reversed(p.id) then null else p.collection_amount end$replacement$);
  anchor:='(p.native_settlement or p.source_type in';
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentDashboardDrift'; end if;
  definition:=replace(definition,anchor,'((case when p.source_type=''cimac_customer_collection'' then private.cimac_collection_reversed(p.id) else false end) or p.native_settlement or p.source_type in');
  anchor:='case when p.source_type=''cimac_customer_collection'' then case when p.collection_category=';
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentDashboardDrift'; end if;
  execute replace(definition,anchor,'case when p.source_type in (''cimac_customer_collection'',''cimac_customer_refund'') then case when p.collection_category=');
end; $dashboard$;

do $reconciliation$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.finance_reconciliation_rpc()'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='not private.cimac_customer_collection_proof(l.payment_id)';
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentReconciliationDrift'; end if;
  definition:=replace(definition,anchor,'not private.cimac_any_customer_payment_proof(l.payment_id)');
  anchor:='p.source_type=''cimac_customer_collection''';
  if strpos(definition,anchor)=0 then raise exception 'cimacAdjustmentReconciliationDrift'; end if;
  definition:=replace(definition,anchor,'p.source_type in (''cimac_customer_collection'',''cimac_customer_refund'',''cimac_customer_reversal'')');
  execute replace(definition,'not private.cimac_customer_collection_proof(p.id)','not private.cimac_any_customer_payment_proof(p.id)');
end; $reconciliation$;

revoke all on function private.cimac_effective_allocated_xof(uuid),private.cimac_collection_line_remaining(uuid,uuid),
  private.cimac_adjustment_doc(private.cimac_collection_adjustments),private.cimac_collection_adjustments_valid(uuid),
  private.cimac_adjustment_insert_authorized(public.payments),private.guard_cimac_adjustment()
  from public,anon,authenticated,service_role;
revoke all on function private.cimac_adjustment_payment_proof(uuid),private.cimac_any_customer_payment_proof(uuid),
  private.cimac_adjustment_context(uuid),private.cimac_collection_reversed(uuid),
  private.cimac_collection_position(uuid),private.cimac_adjust_collection(text,jsonb,uuid),private.cimac_collection_adjustment_docs(uuid[]),
  public.cimac_collection_position_rpc(uuid),public.cimac_refund_collection_rpc(jsonb,uuid),public.cimac_reverse_collection_rpc(jsonb,uuid),
  public.cimac_collection_adjustments_rpc(uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.cimac_adjustment_payment_proof(uuid),private.cimac_any_customer_payment_proof(uuid),
  private.cimac_adjustment_context(uuid),private.cimac_collection_reversed(uuid),
  private.cimac_collection_position(uuid),private.cimac_adjust_collection(text,jsonb,uuid),private.cimac_collection_adjustment_docs(uuid[]),
  public.cimac_collection_position_rpc(uuid),public.cimac_refund_collection_rpc(jsonb,uuid),public.cimac_reverse_collection_rpc(jsonb,uuid),
  public.cimac_collection_adjustments_rpc(uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
