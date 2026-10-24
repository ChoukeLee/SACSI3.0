begin;

-- Additive only: no historical update, customer merge, bill generation or FX.
create table private.cimac_billing_requests (
  request_id uuid primary key, actor_id uuid not null references auth.users(id),
  customer_id uuid not null references public.customers(id), kind text not null,
  input jsonb not null, result jsonb, created_at timestamptz not null default clock_timestamp()
);
create index cimac_billing_requests_actor on private.cimac_billing_requests(actor_id,created_at desc);
alter table private.cimac_billing_requests enable row level security;
revoke all on private.cimac_billing_requests from public,anon,authenticated,service_role;

create table private.cimac_fee_terms (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
  contract_id uuid not null references public.lease_contracts(id), unit_id uuid not null references public.units(id),
  category text not null, data jsonb not null, recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(contract_id,unit_id,category)
);
create index cimac_fee_terms_customer on private.cimac_fee_terms(customer_id);
create index cimac_fee_terms_unit on private.cimac_fee_terms(unit_id);
alter table private.cimac_fee_terms enable row level security;
revoke all on private.cimac_fee_terms from public,anon,authenticated,service_role;

create table private.cimac_meter_readings (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
  contract_id uuid not null references public.lease_contracts(id), unit_id uuid not null references public.units(id),
  meter_kind text not null, meter_no text not null, service_month date not null,
  data jsonb not null, recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(unit_id,meter_kind,meter_no,service_month)
);
create index cimac_meter_readings_customer on private.cimac_meter_readings(customer_id);
create index cimac_meter_readings_contract on private.cimac_meter_readings(contract_id);
alter table private.cimac_meter_readings enable row level security;
revoke all on private.cimac_meter_readings from public,anon,authenticated,service_role;

-- Scoped capability is based on database profiles and current project ACL, not
-- user-editable JWT metadata. Private definers recheck it even on retries.
create function private.cimac_billing_scope(p_write boolean default false) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance','boss'),false)
    or (p_write and not coalesce(public.has_app_role('admin','finance'),false)) then
    raise exception 'cimacBillingPermissionDenied' using errcode='42501'; end if;
  select p.id into target from public.projects p where p.code='CIMAC';
  if target is null or not coalesce(public.can_access_project(target),false) then
    raise exception 'cimacBillingPermissionDenied' using errcode='42501'; end if;
  return target;
end; $$;

create function private.cimac_billing_keys(v jsonb,allowed text[],required text[]) returns void
language plpgsql immutable set search_path='' as $$
begin
  if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>65536
    or exists(select 1 from jsonb_object_keys(v) k where not(k=any(allowed)))
    or exists(select 1 from unnest(required) k where not(v?k) or v->k='null'::jsonb) then
    raise exception 'cimacBillingInvalidInput'; end if;
end; $$;
create function private.cimac_billing_decimal(v jsonb,scale_limit integer,p_positive boolean default false) returns numeric
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
  if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,3})?$' then
    raise exception 'cimacBillingInvalidInput'; end if;
  n:=(v#>>'{}')::numeric;
  if round(n,scale_limit)<>n or (p_positive and n<=0) then raise exception 'cimacBillingInvalidInput'; end if;
  return n;
end; $$;
create function private.cimac_billing_date(v jsonb) returns date
language plpgsql immutable set search_path='' as $$
declare d date;
begin
  if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'cimacBillingInvalidInput'; end if;
  d:=(v#>>'{}')::date;
  if not isfinite(d) or to_char(d,'YYYY-MM-DD')<>v#>>'{}' then raise exception 'cimacBillingInvalidInput'; end if;
  return d;
end; $$;
create function private.cimac_billing_text(v jsonb,cap integer,p_optional boolean default false) returns text
language plpgsql immutable set search_path='' as $$
begin
  if p_optional and (v is null or v='null'::jsonb) then return null; end if;
  if jsonb_typeof(v) is distinct from 'string' or length(btrim(v#>>'{}')) not between 1 and cap then raise exception 'cimacBillingInvalidInput'; end if;
  return btrim(v#>>'{}');
end; $$;
create function private.cimac_billing_contract_target(p_input jsonb,p_project uuid) returns void
language plpgsql stable set search_path='' as $$
begin
  if not exists(select 1 from public.lease_contracts c join public.units u on u.id=c.unit_id join public.buildings b on b.id=u.building_id
    where c.id=(p_input->>'contractId')::uuid and c.customer_id=(p_input->>'customerId')::uuid
      and c.unit_id=(p_input->>'unitId')::uuid and b.project_id=p_project and public.can_access_unit(u.id)) then
    raise exception 'cimacBillingTargetMismatch'; end if;
end; $$;
create function private.cimac_billing_term_doc(t private.cimac_fee_terms) returns jsonb
language sql immutable set search_path='' as $$
  select t.data||jsonb_build_object('id',t.id,'customerId',t.customer_id,'contractId',t.contract_id,'unitId',t.unit_id,
    'category',t.category,'status','pending_review','recordedBy',t.recorded_by,'createdAt',t.created_at,'updatedAt',t.updated_at);
$$;
create function private.cimac_billing_meter_doc(t private.cimac_meter_readings) returns jsonb
language sql immutable set search_path='' as $$
  select t.data||jsonb_build_object('id',t.id,'customerId',t.customer_id,'contractId',t.contract_id,'unitId',t.unit_id,
    'meterKind',t.meter_kind,'meterNo',t.meter_no,'serviceMonth',t.service_month,'status','recorded_pending_rate',
    'recordedBy',t.recorded_by,'createdAt',t.created_at,'updatedAt',t.updated_at);
$$;

create function private.cimac_save_fee_terms(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project uuid; prior private.cimac_billing_requests%rowtype; old private.cimac_fee_terms%rowtype;
  saved private.cimac_fee_terms%rowtype; doc jsonb; result jsonb; audit uuid:=gen_random_uuid(); k text;
begin
  project:=private.cimac_billing_scope(true);
  perform private.cimac_billing_keys(p_input,array['id','customerId','contractId','unitId','category','currency','monthlyRate','pricingBasis','chargeableArea','startsOn','endsOn','annualStartsOn','annualEndsOn','proration','source','notes','expectedUpdatedAt'],array['customerId','contractId','unitId','category','currency','pricingBasis','proration','source']);
  if p_request_id is null then raise exception 'cimacBillingInvalidInput'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  perform 1 from public.lease_contracts where id=(p_input->>'contractId')::uuid for update;
  perform private.cimac_billing_contract_target(p_input,project);
  select * into prior from private.cimac_billing_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>auth.uid() or prior.kind<>'fee_terms' or prior.input is distinct from p_input then raise exception 'cimacBillingRequestIdConflict'; end if;
    return prior.result||jsonb_build_object('idempotent',true); end if;
  if exists(select 1 from public.payments where request_id=p_request_id) then raise exception 'cimacBillingRequestIdConflict'; end if;
  if p_input->>'category' not in ('lease_rent','lease_deposit','property_fee','water','electricity','management_fee')
    or p_input->>'currency' not in ('XOF','USD','CNY') or p_input->>'pricingBasis' not in ('per_sqm','per_unit','pending')
    or p_input->>'proration' not in ('daily_pending_convention','pending') then raise exception 'cimacBillingInvalidInput'; end if;
  doc:=jsonb_build_object('currency',p_input->>'currency','pricingBasis',p_input->>'pricingBasis','proration',p_input->>'proration',
    'source',private.cimac_billing_text(p_input->'source',1000),'notes',private.cimac_billing_text(p_input->'notes',2000,true));
  foreach k in array array['monthlyRate','chargeableArea'] loop
    doc:=doc||jsonb_build_object(k,case when p_input->k is null or p_input->k='null'::jsonb then null
      else private.cimac_billing_decimal(p_input->k,case when k='chargeableArea' then 3 else 2 end,true)::text end);
  end loop;
  foreach k in array array['startsOn','endsOn','annualStartsOn','annualEndsOn'] loop
    doc:=doc||jsonb_build_object(k,case when p_input->k is null or p_input->k='null'::jsonb then null else private.cimac_billing_date(p_input->k) end);
  end loop;
  if (doc->>'endsOn')::date<(doc->>'startsOn')::date or (doc->>'annualEndsOn')::date<(doc->>'annualStartsOn')::date
    or ((p_input?'id')<>(p_input?'expectedUpdatedAt')) then raise exception 'cimacBillingInvalidInput'; end if;
  if p_input?'id' then
    select * into old from private.cimac_fee_terms where id=(p_input->>'id')::uuid for update;
    if old.id is null or old.contract_id<>(p_input->>'contractId')::uuid or old.customer_id<>(p_input->>'customerId')::uuid
      or old.unit_id<>(p_input->>'unitId')::uuid or old.category<>p_input->>'category' then raise exception 'cimacBillingTargetMismatch'; end if;
    if old.updated_at is distinct from (p_input->>'expectedUpdatedAt')::timestamptz then raise exception 'cimacBillingSnapshotChanged'; end if;
    update private.cimac_fee_terms set data=doc,recorded_by=auth.uid(),updated_at=clock_timestamp() where id=old.id returning * into saved;
  else
    if exists(select 1 from private.cimac_fee_terms t where t.contract_id=(p_input->>'contractId')::uuid
      and t.unit_id=(p_input->>'unitId')::uuid and t.category=p_input->>'category') then raise exception 'cimacBillingSnapshotChanged'; end if;
    insert into private.cimac_fee_terms(customer_id,contract_id,unit_id,category,data,recorded_by)
      values((p_input->>'customerId')::uuid,(p_input->>'contractId')::uuid,(p_input->>'unitId')::uuid,p_input->>'category',doc,auth.uid()) returning * into saved;
  end if;
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
    values(audit,auth.uid(),'save','cimac_fee_terms',saved.id,case when old.id is null then null else private.cimac_billing_term_doc(old) end,
      private.cimac_billing_term_doc(saved),jsonb_build_object('request_id',p_request_id,'project_id',project,
        'unit_id',saved.unit_id,'contract_id',saved.contract_id,'no_receivables_created',true,'pending_review',true));
  result:=jsonb_build_object('success',true,'status','completed','kind','fee_terms','requestId',p_request_id,'actorId',auth.uid(),
    'customerId',saved.customer_id,'entityId',saved.id,'auditId',audit,'idempotent',false,'record',private.cimac_billing_term_doc(saved));
  insert into private.cimac_billing_requests(request_id,actor_id,customer_id,kind,input,result) values(p_request_id,auth.uid(),saved.customer_id,'fee_terms',p_input,result);
  return result;
end; $$;

create function private.cimac_save_meter_reading(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project uuid; prior private.cimac_billing_requests%rowtype; old private.cimac_meter_readings%rowtype;
  saved private.cimac_meter_readings%rowtype; doc jsonb; result jsonb; audit uuid:=gen_random_uuid();
  previous numeric; current_value numeric; service_month date; read_on date; meter text;
begin
  project:=private.cimac_billing_scope(true);
  perform private.cimac_billing_keys(p_input,array['id','customerId','contractId','unitId','meterKind','meterNo','serviceMonth','readOn','previousReading','currentReading','evidence','notes','expectedUpdatedAt'],array['customerId','contractId','unitId','meterKind','meterNo','serviceMonth','readOn','currentReading']);
  if p_request_id is null then raise exception 'cimacBillingInvalidInput'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  perform 1 from public.lease_contracts where id=(p_input->>'contractId')::uuid for update;
  perform private.cimac_billing_contract_target(p_input,project);
  select * into prior from private.cimac_billing_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>auth.uid() or prior.kind<>'meter_reading' or prior.input is distinct from p_input then raise exception 'cimacBillingRequestIdConflict'; end if;
    return prior.result||jsonb_build_object('idempotent',true); end if;
  if exists(select 1 from public.payments where request_id=p_request_id) then raise exception 'cimacBillingRequestIdConflict'; end if;
  if p_input->>'meterKind' not in ('water','electricity') or ((p_input?'id')<>(p_input?'expectedUpdatedAt')) then raise exception 'cimacBillingInvalidInput'; end if;
  meter:=private.cimac_billing_text(p_input->'meterNo',100);
  service_month:=private.cimac_billing_date(p_input->'serviceMonth'); read_on:=private.cimac_billing_date(p_input->'readOn');
  perform pg_advisory_xact_lock(hashtextextended('cimac-meter:'||(p_input->>'unitId')||':'||(p_input->>'meterKind')||':'||meter||':'||service_month::text,0));
  if extract(day from service_month)<>1 or read_on>current_date or date_trunc('month',read_on)<service_month then raise exception 'cimacBillingInvalidInput'; end if;
  current_value:=private.cimac_billing_decimal(p_input->'currentReading',3);
  if p_input->'previousReading' is not null and p_input->'previousReading'<>'null'::jsonb then previous:=private.cimac_billing_decimal(p_input->'previousReading',3); end if;
  if current_value<previous then raise exception 'cimacBillingInvalidInput'; end if;
  doc:=jsonb_build_object('readOn',read_on,'previousReading',previous::text,'currentReading',current_value::text,
    'usage',(current_value-previous)::text,'evidence',private.cimac_billing_text(p_input->'evidence',2000,true),
    'notes',private.cimac_billing_text(p_input->'notes',2000,true));
  if p_input?'id' then
    select * into old from private.cimac_meter_readings where id=(p_input->>'id')::uuid for update;
    if old.id is null or old.contract_id<>(p_input->>'contractId')::uuid or old.customer_id<>(p_input->>'customerId')::uuid
      or old.unit_id<>(p_input->>'unitId')::uuid or old.meter_kind<>p_input->>'meterKind' or old.meter_no<>meter or old.service_month<>service_month then raise exception 'cimacBillingTargetMismatch'; end if;
    if old.updated_at is distinct from (p_input->>'expectedUpdatedAt')::timestamptz then raise exception 'cimacBillingSnapshotChanged'; end if;
    update private.cimac_meter_readings set data=doc,recorded_by=auth.uid(),updated_at=clock_timestamp() where id=old.id returning * into saved;
  else
    if exists(select 1 from private.cimac_meter_readings t where t.unit_id=(p_input->>'unitId')::uuid
      and t.meter_kind=p_input->>'meterKind' and t.meter_no=meter and t.service_month=(p_input->>'serviceMonth')::date) then raise exception 'cimacBillingSnapshotChanged'; end if;
    insert into private.cimac_meter_readings(customer_id,contract_id,unit_id,meter_kind,meter_no,service_month,data,recorded_by)
      values((p_input->>'customerId')::uuid,(p_input->>'contractId')::uuid,(p_input->>'unitId')::uuid,p_input->>'meterKind',meter,service_month,doc,auth.uid()) returning * into saved;
  end if;
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
    values(audit,auth.uid(),'save','cimac_meter_reading',saved.id,case when old.id is null then null else private.cimac_billing_meter_doc(old) end,
      private.cimac_billing_meter_doc(saved),jsonb_build_object('request_id',p_request_id,'project_id',project,
        'unit_id',saved.unit_id,'contract_id',saved.contract_id,'no_receivables_created',true,'rate_pending',true));
  result:=jsonb_build_object('success',true,'status','completed','kind','meter_reading','requestId',p_request_id,'actorId',auth.uid(),
    'customerId',saved.customer_id,'entityId',saved.id,'auditId',audit,'idempotent',false,'record',private.cimac_billing_meter_doc(saved));
  insert into private.cimac_billing_requests(request_id,actor_id,customer_id,kind,input,result) values(p_request_id,auth.uid(),saved.customer_id,'meter_reading',p_input,result);
  return result;
end; $$;

create function private.cimac_collection_visible(p_payment uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and coalesce(public.has_app_role('admin','finance','boss'),false)
    and exists(select 1 from private.cimac_billing_requests r join public.projects p on p.code='CIMAC'
      where r.kind='collection' and r.result->>'paymentId'=p_payment::text and public.can_access_project(p.id));
$$;
create policy "CIMAC customer collection project restriction" on public.payments as restrictive for all to authenticated
using(source_type<>'cimac_customer_collection' or private.cimac_collection_visible(id))
with check(source_type<>'cimac_customer_collection' or private.cimac_collection_visible(id));

create function private.guard_cimac_customer_collection() returns trigger
language plpgsql security definer set search_path='' as $$
declare saved private.cimac_billing_requests%rowtype; pay public.payments%rowtype;
begin
  if tg_table_name='payments' then
    if tg_op<>'INSERT' and (old.source_type='cimac_customer_collection' or old.request_kind='cimac_customer_collection') then
      raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    if tg_op='DELETE' then return old; end if;
    if new.reversal_of_payment_id is not null and exists(select 1 from public.payments p
      where p.id=new.reversal_of_payment_id and p.source_type='cimac_customer_collection') then
      raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    if new.source_type='cimac_customer_collection' or new.request_kind='cimac_customer_collection' then
      select * into saved from private.cimac_billing_requests r where r.request_id=new.request_id;
      if tg_op<>'INSERT' or saved.request_id is null or saved.kind<>'collection' or saved.actor_id is distinct from auth.uid()
        or saved.result->>'paymentId' is distinct from new.id::text or saved.result?'success'
        or new.customer_id is distinct from saved.customer_id or new.source_id is distinct from saved.customer_id
        or new.unit_id is not null or new.source_type<>'cimac_customer_collection' or new.request_kind<>'cimac_customer_collection'
        or new.amount is distinct from (saved.input->>'amount')::numeric or new.currency<>'XOF' or new.exchange_rate_to_xof<>1
        or new.native_settlement or new.payment_date is distinct from (saved.input->>'paymentDate')::date
        or new.payment_method is distinct from saved.input->>'paymentMethod' then
        raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    end if;
    return new;
  end if;
  if tg_op<>'INSERT' then
    select * into pay from public.payments p where p.id=old.payment_id;
    if pay.source_type='cimac_customer_collection' then raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  select * into pay from public.payments p where p.id=new.payment_id;
  if pay.source_type='cimac_customer_collection' then
    select * into saved from private.cimac_billing_requests r where r.request_id=pay.request_id;
    if tg_op<>'INSERT' or saved.request_id is null or saved.result?'success' or saved.actor_id is distinct from auth.uid() then
      raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    if tg_table_name='ledger_entries' then
      if new.currency<>'XOF' or new.amount_native is not null or new.direction<>'income' or new.entry_date<>pay.payment_date
        or not exists(select 1 from jsonb_array_elements(saved.input->'allocations') a join public.receivables r on r.id=(a->>'receivableId')::uuid
          where r.unit_id=new.unit_id and r.building_id=new.building_id and r.category=new.category and (a->>'amount')::numeric=new.amount_xof) then
        raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    elsif tg_table_name='payment_receivable_allocations' then
      if new.actor_id is distinct from auth.uid() or new.request_id is distinct from pay.request_id
        or not exists(select 1 from jsonb_array_elements(saved.input->'allocations') a where (a->>'receivableId')::uuid=new.receivable_id
          and (a->>'amount')::numeric=new.amount_xof) then raise exception 'cimacBillingProtectedPayment' using errcode='42501'; end if;
    end if;
  end if;
  return new;
end; $$;
create trigger guard_cimac_customer_collection_payment before insert or update or delete on public.payments
for each row execute function private.guard_cimac_customer_collection();
create trigger guard_cimac_customer_collection_ledger before insert or update or delete on public.ledger_entries
for each row execute function private.guard_cimac_customer_collection();
create trigger guard_cimac_customer_collection_allocation before insert or update or delete on public.payment_receivable_allocations
for each row execute function private.guard_cimac_customer_collection();

create function private.cimac_collect_customer(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project uuid; target_customer uuid; prior private.cimac_billing_requests%rowtype; r public.receivables%rowtype;
  item jsonb; total numeric; allocated numeric:=0; piece numeric; expected numeric; payment_day date;
  pay uuid:=gen_random_uuid(); audit uuid:=gen_random_uuid(); receipt text; collector text; basis text;
  before_rows jsonb; after_rows jsonb; output_doc jsonb; links jsonb:='[]'::jsonb;
begin
  project:=private.cimac_billing_scope(true);
  perform private.cimac_billing_keys(p_input,array['customerId','paymentDate','currency','amount','paymentMethod','externalReceiptNo','actualCollector','collectorBasis','notes','allocations'],array['customerId','paymentDate','currency','amount','paymentMethod','allocations']);
  if p_request_id is null or jsonb_typeof(p_input->'allocations') is distinct from 'array'
    or jsonb_array_length(p_input->'allocations') not between 1 and 100 then raise exception 'cimacBillingInvalidInput'; end if;
  target_customer:=(p_input->>'customerId')::uuid;
  if p_input->>'currency'<>'XOF' then raise exception 'cimacBillingUnsupportedCurrency'; end if;
  total:=private.cimac_billing_decimal(p_input->'amount',0,true);
  payment_day:=private.cimac_billing_date(p_input->'paymentDate');
  if payment_day>current_date or p_input->>'paymentMethod' not in ('cash','check','bank_transfer','other') then raise exception 'cimacBillingInvalidInput'; end if;
  collector:=private.cimac_billing_text(p_input->'actualCollector',100,true);
  basis:=private.cimac_billing_text(p_input->'collectorBasis',1000,true);
  if (collector is null)<>(basis is null) then raise exception 'cimacBillingInvalidInput'; end if;
  for item in select value from jsonb_array_elements(p_input->'allocations') loop
    perform private.cimac_billing_keys(item,array['receivableId','amount','expectedOutstanding','expectedUpdatedAt'],array['receivableId','amount','expectedOutstanding','expectedUpdatedAt']);
    perform (item->>'receivableId')::uuid;
    piece:=private.cimac_billing_decimal(item->'amount',0,true); expected:=private.cimac_billing_decimal(item->'expectedOutstanding',2,true);
    if piece>expected or jsonb_typeof(item->'expectedUpdatedAt') is distinct from 'string' or length(item->>'expectedUpdatedAt')>100 then raise exception 'cimacBillingInvalidInput'; end if;
    perform (item->>'expectedUpdatedAt')::timestamptz;
    allocated:=allocated+piece;
  end loop;
  if allocated<>total or jsonb_array_length(p_input->'allocations')<>(select count(distinct (a->>'receivableId')::uuid) from jsonb_array_elements(p_input->'allocations') a) then raise exception 'cimacBillingInvalidInput'; end if;
  -- Consistent order with old lease writers: request -> contract IDs -> due,id.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from private.cimac_billing_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>auth.uid() or prior.customer_id<>target_customer or prior.kind<>'collection' or prior.input is distinct from p_input then raise exception 'cimacBillingRequestIdConflict'; end if;
    if not exists(select 1 from public.projects p where p.id=project and public.can_access_project(p.id)) then raise exception 'cimacBillingPermissionDenied'; end if;
    return prior.result||jsonb_build_object('idempotent',true); end if;
  if exists(select 1 from public.payments where request_id=p_request_id) or exists(select 1 from private.lease_collection_requests where request_id=p_request_id)
    or exists(select 1 from private.cimac_maintenance_requests where request_id=p_request_id) then raise exception 'cimacBillingRequestIdConflict'; end if;
  perform 1 from public.lease_contracts c where c.id in(select rr.source_id from jsonb_array_elements(p_input->'allocations') a
    join public.receivables rr on rr.id=(a->>'receivableId')::uuid where rr.source_type='lease_contract') order by c.id for update;
  perform 1 from public.receivables rr where rr.id in(select (a->>'receivableId')::uuid from jsonb_array_elements(p_input->'allocations') a) order by rr.due_date,rr.id for update;
  for item in select value from jsonb_array_elements(p_input->'allocations') loop
    select * into r from public.receivables where id=(item->>'receivableId')::uuid;
    if r.id is null or r.customer_id is distinct from target_customer or r.source_type<>'lease_contract'
      or r.category not in ('lease_rent','property_fee') or r.currency<>'XOF' or r.amount_native is not null or r.paid_amount_native is not null
      or not exists(select 1 from public.lease_contracts c join public.units u on u.id=c.unit_id join public.buildings b on b.id=u.building_id
        where c.id=r.source_id and c.customer_id=target_customer and c.unit_id=r.unit_id and b.id=r.building_id and b.project_id=project
          and (r.category<>'lease_rent' or c.rent_currency='XOF') and public.can_access_unit(u.id)) then raise exception 'cimacBillingTargetMismatch'; end if;
    if r.management_status<>'managed' or r.status not in ('pending','partial','overdue') or r.amount_xof::text in ('NaN','Infinity','-Infinity')
      or r.paid_amount_xof::text in ('NaN','Infinity','-Infinity') or r.paid_amount_xof>r.amount_xof
      or coalesce((select sum(a.amount_xof) from public.payment_receivable_allocations a where a.receivable_id=r.id),0)>r.paid_amount_xof
      or r.amount_xof-r.paid_amount_xof is distinct from (item->>'expectedOutstanding')::numeric
      or (item->>'amount')::numeric>r.amount_xof-r.paid_amount_xof
      or r.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz then raise exception 'cimacBillingSnapshotChanged'; end if;
  end loop;
  select jsonb_agg(to_jsonb(rr) order by rr.due_date,rr.id) into before_rows from public.receivables rr
    where rr.id in(select (a->>'receivableId')::uuid from jsonb_array_elements(p_input->'allocations') a);
  insert into private.cimac_billing_requests(request_id,actor_id,customer_id,kind,input,result)
    values(p_request_id,auth.uid(),target_customer,'collection',p_input,jsonb_build_object('paymentId',pay));
  insert into public.payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,
    native_settlement,payment_method,request_id,request_kind,external_receipt_no,actual_collector,collector_basis,
    context_version,context_confirmed_by,context_confirmed_at,notes)
  values(pay,target_customer,null,'cimac_customer_collection',target_customer,payment_day,total,'XOF',1,false,
    p_input->>'paymentMethod',p_request_id,'cimac_customer_collection',private.cimac_billing_text(p_input->'externalReceiptNo',200,true),collector,basis,
    case when collector is null then 0 else 1 end,case when collector is null then null else auth.uid() end,
    case when collector is null then null else clock_timestamp() end,
    concat_ws('；','客户总账实收；明确账单核销，不改变合同已缴至日期',private.cimac_billing_text(p_input->'notes',2000,true))) returning receipt_no into receipt;
  for item in select a from jsonb_array_elements(p_input->'allocations') a join public.receivables rr on rr.id=(a->>'receivableId')::uuid order by rr.due_date,rr.id loop
    select * into strict r from public.receivables where id=(item->>'receivableId')::uuid;
    piece:=(item->>'amount')::numeric;
    update public.receivables set paid_amount_xof=paid_amount_xof+piece,
      status=case when paid_amount_xof+piece=amount_xof then 'paid' else 'partial' end,updated_at=clock_timestamp() where id=r.id;
    perform private.record_verified_payment_allocation(pay,r.id,piece,p_request_id);
    insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,description)
      values(r.building_id,r.unit_id,pay,payment_day,'income',r.category,piece,'XOF','客户总账明确核销 · '||r.title);
    links:=links||jsonb_build_array(jsonb_build_object('paymentId',pay,'receivableId',r.id,'currency','XOF','amount',piece::text));
  end loop;
  if (select sum(amount_xof) from public.ledger_entries where payment_id=pay) is distinct from total
    or (select sum(amount_xof) from public.payment_receivable_allocations where payment_id=pay) is distinct from total
    or (select count(*) from public.payment_receivable_allocations where payment_id=pay)<>jsonb_array_length(p_input->'allocations')
    or (select count(*) from public.ledger_entries where payment_id=pay)<>jsonb_array_length(p_input->'allocations') then raise exception 'cimacBillingVerificationFailed'; end if;
  select jsonb_agg(to_jsonb(rr) order by rr.due_date,rr.id) into after_rows from public.receivables rr
    where rr.id in(select (a->>'receivableId')::uuid from jsonb_array_elements(p_input->'allocations') a);
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
    values(audit,auth.uid(),'collect','cimac_customer_collection',pay,before_rows,after_rows,
      jsonb_build_object('request_id',p_request_id,'project_id',project,'customer_id',target_customer,
        'amount',total,'payment_date',payment_day,'receipt_no',receipt,
        'one_actual_receipt',true,'allocations',links,'paid_through_unchanged',true));
  output_doc:=jsonb_build_object('success',true,'status','completed','kind','collection','requestId',p_request_id,'actorId',auth.uid(),
    'customerId',target_customer,'entityId',pay,'auditId',audit,'idempotent',false,'paymentId',pay,'receiptNo',receipt,'amount',total::text,'currency','XOF','allocations',links);
  update private.cimac_billing_requests set result=output_doc where request_id=p_request_id;
  return output_doc;
end; $$;

create function private.cimac_billing_customer_units(p_customer uuid,p_project uuid) returns setof uuid
language sql stable set search_path='' as $$
  select u.id from public.units u join public.buildings b on b.id=u.building_id where b.project_id=p_project and public.can_access_unit(u.id)
    and (exists(select 1 from public.lease_contracts c where c.unit_id=u.id and c.customer_id=p_customer)
      or exists(select 1 from public.sale_contracts c where c.unit_id=u.id and c.customer_id=p_customer)
      or exists(select 1 from public.receivables r where r.unit_id=u.id and r.customer_id=p_customer and (r.building_id is null or r.building_id=b.id))
      or exists(select 1 from public.payments p where p.unit_id=u.id and p.customer_id=p_customer)
      or exists(select 1 from public.ledger_entries l join public.payments p on p.id=l.payment_id
        where l.unit_id=u.id and p.customer_id=p_customer and (l.building_id is null or l.building_id=b.id)));
$$;
create function private.cimac_billing_customer_summary(p_customer uuid,p_project uuid) returns jsonb
language sql stable set search_path='' as $$
  with us as materialized(select private.cimac_billing_customer_units(p_customer,p_project) id),
  rs as materialized(select r.*,case when amount_native is not null then currency else 'XOF'::public.currency_code end money_currency,
    coalesce(amount_native,amount_xof) money_amount,coalesce(paid_amount_native,paid_amount_xof) money_paid
    from public.receivables r where r.customer_id=p_customer
      and (r.unit_id in(select id from us) or (r.unit_id is null and exists(select 1 from public.buildings b where b.id=r.building_id and b.project_id=p_project and public.can_access_building(b.id))))
      and (r.building_id is null or exists(select 1 from public.buildings b where b.id=r.building_id and b.project_id=p_project))
      and r.status<>'cancelled' and r.management_status='managed'
      and (r.amount_native is not null or r.currency='XOF')
      and coalesce(r.amount_native,r.amount_xof)::text not in ('NaN','Infinity','-Infinity')
      and coalesce(r.paid_amount_native,r.paid_amount_xof)::text not in ('NaN','Infinity','-Infinity')
      and coalesce(r.paid_amount_native,r.paid_amount_xof)<=coalesce(r.amount_native,r.amount_xof)),
  totals as(select money_currency currency,sum(money_amount)::text receivable,sum(money_paid)::text paid,
    sum(money_amount-money_paid)::text outstanding,
    coalesce(sum(money_amount-money_paid) filter(where due_date<current_date),0)::text overdue from rs group by money_currency)
  select jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'unitCount',(select count(*) from us),
    'contractCount',(select count(*) from public.lease_contracts l where l.customer_id=c.id and l.unit_id in(select id from us))+
      (select count(*) from public.sale_contracts s where s.customer_id=c.id and s.unit_id in(select id from us)),
    'pendingCount',(select count(*) from private.cimac_fee_terms t where t.customer_id=c.id and t.unit_id in(select id from us))+
      (select count(*) from private.cimac_meter_readings t where t.customer_id=c.id and t.unit_id in(select id from us)),
    'balances',coalesce((select jsonb_agg(to_jsonb(t) order by t.currency) from totals t),'[]'::jsonb))
  from public.customers c where c.id=p_customer;
$$;
create function private.cimac_billing_customer_exists(p_customer uuid,p_project uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.cimac_billing_customer_units(p_customer,p_project))
    or exists(select 1 from public.receivables r join public.buildings b on b.id=r.building_id
      where r.customer_id=p_customer and r.unit_id is null and b.project_id=p_project and public.can_access_building(b.id))
    or exists(select 1 from public.payments p join public.ledger_entries l on l.payment_id=p.id join public.buildings b on b.id=l.building_id
      where p.customer_id=p_customer and p.unit_id is null and b.project_id=p_project and public.can_access_building(b.id));
$$;

create function private.cimac_customer_account(p_customer_id uuid,p_search text,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare project uuid; candidates uuid[]; page_ids uuid[]; selected uuid; unit_ids uuid[]; lease_ids uuid[]; sale_ids uuid[];
  receivable_ids uuid[]; payment_ids uuid[]; row_count bigint; result jsonb;
begin
  project:=private.cimac_billing_scope(false);
  if p_page is null or p_page<1 or p_page>2000000 or length(coalesce(p_search,''))>200 then raise exception 'cimacBillingInvalidInput'; end if;
  select coalesce(array_agg(c.id order by c.name,c.id),'{}'::uuid[]) into candidates from public.customers c
    where private.cimac_billing_customer_exists(c.id,project) and
      (nullif(btrim(p_search),'') is null or position(lower(btrim(p_search)) in lower(c.name||' '||coalesce(c.phone,'')))>0
        or exists(select 1 from public.units u where u.id in(select private.cimac_billing_customer_units(c.id,project))
          and position(lower(btrim(p_search)) in lower(u.unit_no||' '||u.code))>0)
        or exists(select 1 from public.lease_contracts contract join public.units u on u.id=contract.unit_id
          join public.buildings b on b.id=u.building_id where contract.customer_id=c.id and b.project_id=project
            and public.can_access_unit(u.id) and position(lower(btrim(p_search)) in lower(contract.contract_no))>0)
        or exists(select 1 from public.sale_contracts contract join public.units u on u.id=contract.unit_id
          join public.buildings b on b.id=u.building_id where contract.customer_id=c.id and b.project_id=project
            and public.can_access_unit(u.id) and position(lower(btrim(p_search)) in lower(contract.contract_no))>0));
  page_ids:=candidates[((p_page-1)*50+1):(p_page*50)];
  selected:=coalesce(p_customer_id,page_ids[1]);
  if p_customer_id is not null and not private.cimac_billing_customer_exists(p_customer_id,project) then
    raise exception 'cimacBillingTargetMismatch'; end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into unit_ids from private.cimac_billing_customer_units(selected,project) id;
  select coalesce(array_agg(id),'{}'::uuid[]) into lease_ids from public.lease_contracts where customer_id=selected and unit_id=any(unit_ids);
  select coalesce(array_agg(id),'{}'::uuid[]) into sale_ids from public.sale_contracts where customer_id=selected and unit_id=any(unit_ids);
  select coalesce(array_agg(r.id),'{}'::uuid[]) into receivable_ids from public.receivables r where r.customer_id=selected
    and (r.unit_id=any(unit_ids) or (r.unit_id is null and r.building_id is not null))
    and (r.building_id is null or exists(select 1 from public.buildings b where b.id=r.building_id and b.project_id=project and public.can_access_building(b.id)));
  select coalesce(array_agg(p.id),'{}'::uuid[]) into payment_ids from public.payments p where
    (p.customer_id=selected or (p.customer_id is null and (p.source_id=any(lease_ids) or p.source_id=any(sale_ids)))) and
    (p.unit_id=any(unit_ids) or (p.unit_id is null and (p.source_id=any(lease_ids) or p.source_id=any(sale_ids)))
      or (p.unit_id is null and exists(select 1 from public.ledger_entries l join public.buildings b on b.id=l.building_id
        where l.payment_id=p.id and b.project_id=project and public.can_access_building(b.id))));
  if greatest(cardinality(unit_ids),cardinality(lease_ids)+cardinality(sale_ids),cardinality(receivable_ids),cardinality(payment_ids))>10000
    or (select count(*) from private.cimac_fee_terms where customer_id=selected)>10000
    or (select count(*) from private.cimac_meter_readings where customer_id=selected)>10000 then raise exception 'cimacBillingAccountTooLarge'; end if;
  select count(*) into row_count from public.payment_receivable_allocations where payment_id=any(payment_ids) and receivable_id=any(receivable_ids);
  row_count:=row_count+(select count(*) from public.lease_native_payment_allocations where payment_id=any(payment_ids) and receivable_id=any(receivable_ids));
  if row_count>10000 then raise exception 'cimacBillingAccountTooLarge'; end if;
  select jsonb_build_object('project',(select jsonb_build_object('id',id,'code',code,'display_name',display_name) from public.projects where id=project),
    'canWrite',public.has_app_role('admin','finance'),'complete',true,'selectedCustomerId',selected,
    'customerPage',jsonb_build_object('page',p_page,'pageSize',50,'total',cardinality(candidates),
      'rows',coalesce((select jsonb_agg(private.cimac_billing_customer_summary(c.id,project) order by c.name,c.id) from public.customers c where c.id=any(page_ids)),'[]'::jsonb)),
    'customer',private.cimac_billing_customer_summary(selected,project),
    'units',coalesce((select jsonb_agg(to_jsonb(u)||jsonb_build_object('building_label',b.display_name,'building_code',b.code) order by b.code,u.unit_no,u.id)
      from public.units u join public.buildings b on b.id=u.building_id where u.id=any(unit_ids)),'[]'::jsonb),
    'contracts',coalesce((select jsonb_agg(x.doc order by x.doc->>'contractNo',x.doc->>'id') from (
      select jsonb_build_object('kind','lease','id',c.id,'unitId',c.unit_id,'customerId',c.customer_id,'contractNo',c.contract_no,'status',c.status,'data',to_jsonb(c)) doc from public.lease_contracts c where c.id=any(lease_ids)
      union all select jsonb_build_object('kind','sale','id',c.id,'unitId',c.unit_id,'customerId',c.customer_id,'contractNo',c.contract_no,'status',c.status,'data',to_jsonb(c)) from public.sale_contracts c where c.id=any(sale_ids)) x),'[]'::jsonb),
    'receivables',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
      'outstanding',case when r.amount_native is not null then greatest(0,r.amount_native-r.paid_amount_native)::text else greatest(0,r.amount_xof-r.paid_amount_xof)::text end,
      'collectible',r.currency='XOF' and r.amount_native is null and r.paid_amount_native is null and r.management_status='managed'
        and r.status in ('pending','partial','overdue') and r.amount_xof>r.paid_amount_xof and r.source_type='lease_contract'
        and r.source_id=any(lease_ids) and r.category in ('lease_rent','property_fee')
        and exists(select 1 from public.lease_contracts c join public.units u on u.id=c.unit_id where c.id=r.source_id
          and c.unit_id=r.unit_id and u.building_id=r.building_id and (r.category<>'lease_rent' or c.rent_currency='XOF')))
      order by r.due_date,r.id) from public.receivables r where r.id=any(receivable_ids)),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('protected_collection',p.source_type='cimac_customer_collection') order by p.payment_date desc,p.id)
      from public.payments p where p.id=any(payment_ids)),'[]'::jsonb),
    'allocations',coalesce((select jsonb_agg(x.doc order by x.doc->>'paymentId',x.doc->>'receivableId') from (
      select jsonb_build_object('paymentId',a.payment_id,'receivableId',a.receivable_id,'currency','XOF','amount',a.amount_xof::text) doc
        from public.payment_receivable_allocations a where a.payment_id=any(payment_ids) and a.receivable_id=any(receivable_ids)
      union all select jsonb_build_object('paymentId',a.payment_id,'receivableId',a.receivable_id,'currency',a.currency,'amount',a.amount_native::text)
        from public.lease_native_payment_allocations a where a.payment_id=any(payment_ids) and a.receivable_id=any(receivable_ids)) x),'[]'::jsonb),
    'feeTerms',coalesce((select jsonb_agg(private.cimac_billing_term_doc(t) order by t.created_at,t.id) from private.cimac_fee_terms t where t.customer_id=selected and t.unit_id=any(unit_ids)),'[]'::jsonb),
    'meterReadings',coalesce((select jsonb_agg(private.cimac_billing_meter_doc(t) order by t.service_month desc,t.id) from private.cimac_meter_readings t where t.customer_id=selected and t.unit_id=any(unit_ids)),'[]'::jsonb)) into result;
  return result;
end; $$;

create function private.cimac_billing_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare saved private.cimac_billing_requests%rowtype;
begin
  perform private.cimac_billing_scope(false);
  if p_request_id is null then raise exception 'cimacBillingInvalidInput'; end if;
  select * into saved from private.cimac_billing_requests where request_id=p_request_id and actor_id=auth.uid();
  if not found then return jsonb_build_object('status','not_found','requestId',p_request_id); end if;
  return saved.result||jsonb_build_object('idempotent',true);
end; $$;

-- A multi-line ledger is legitimate only when the sealed actual receipt,
-- original explicit allocation request, every receivable target, actor, audit
-- and ledger multiset reconcile. A matching total alone is not sufficient.
create function private.cimac_customer_collection_proof(p_payment_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare p public.payments%rowtype; saved private.cimac_billing_requests%rowtype; project uuid; n integer;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance','boss','rental_sales','front_desk'),false) then return false; end if;
  select * into p from public.payments where id=p_payment_id and source_type='cimac_customer_collection';
  if p.id is null or p.request_kind<>'cimac_customer_collection' or p.currency<>'XOF' or p.exchange_rate_to_xof<>1
    or p.native_settlement or p.reversal_of_payment_id is not null or p.unit_id is not null or p.source_id is distinct from p.customer_id
    or p.amount<=0 or p.amount::text in ('NaN','Infinity','-Infinity') then return false; end if;
  select id into project from public.projects where code='CIMAC';
  if project is null or not coalesce(public.can_access_project(project),false) then return false; end if;
  select * into saved from private.cimac_billing_requests where request_id=p.request_id;
  if saved.request_id is null or saved.kind<>'collection' or saved.actor_id is distinct from p.recorded_by
    or saved.customer_id is distinct from p.customer_id or saved.result->>'status' is distinct from 'completed'
    or saved.result->'success' is distinct from 'true'::jsonb or saved.result->>'paymentId' is distinct from p.id::text
    or saved.result->>'requestId' is distinct from p.request_id::text or saved.result->>'actorId' is distinct from saved.actor_id::text
    or saved.input->>'customerId' is distinct from p.customer_id::text or saved.input->>'currency' is distinct from 'XOF'
    or saved.input->>'paymentDate' is distinct from p.payment_date::text or saved.input->>'paymentMethod' is distinct from p.payment_method
    or (saved.input->>'amount')::numeric is distinct from p.amount or jsonb_typeof(saved.input->'allocations') is distinct from 'array' then return false; end if;
  n:=jsonb_array_length(saved.input->'allocations');
  if n not between 1 and 100 or (select count(*) from public.payment_receivable_allocations where payment_id=p.id)<>n
    or (select count(*) from public.ledger_entries where payment_id=p.id)<>n
    or (select sum(amount_xof) from public.payment_receivable_allocations where payment_id=p.id) is distinct from p.amount
    or (select sum(amount_xof) from public.ledger_entries where payment_id=p.id) is distinct from p.amount then return false; end if;
  if exists(select 1 from public.payment_receivable_allocations a
    left join public.receivables r on r.id=a.receivable_id left join public.lease_contracts c on c.id=r.source_id
    left join public.units u on u.id=c.unit_id left join public.buildings b on b.id=u.building_id
    where a.payment_id=p.id and (a.actor_id is distinct from saved.actor_id or a.request_id is distinct from saved.request_id
      or r.id is null or r.source_type is distinct from 'lease_contract' or r.customer_id is distinct from p.customer_id
      or r.category not in ('lease_rent','property_fee') or r.currency<>'XOF' or r.amount_native is not null or r.paid_amount_native is not null
      or a.amount_xof>r.amount_xof or a.amount_xof>r.paid_amount_xof
      or coalesce((select sum(other.amount_xof) from public.payment_receivable_allocations other where other.receivable_id=r.id),0)>r.paid_amount_xof
      or c.id is null or c.customer_id is distinct from p.customer_id or c.unit_id is distinct from r.unit_id
      or b.id is distinct from r.building_id or b.project_id is distinct from project or not coalesce(public.can_access_unit(u.id),false)
      or not exists(select 1 from jsonb_array_elements(saved.input->'allocations') x
        where (x->>'receivableId')::uuid=r.id and (x->>'amount')::numeric=a.amount_xof))) then return false; end if;
  -- EXCEPT ALL preserves multiplicity when two periods have the same unit,
  -- category and amount. Duplicate or shifted ledger lines cannot hide behind
  -- a correctly summed header.
  if exists(
    (select jsonb_build_array(r.building_id,r.unit_id,r.category,a.amount_xof,'XOF',p.payment_date,'income',null) doc
      from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id where a.payment_id=p.id
     except all
     select jsonb_build_array(l.building_id,l.unit_id,l.category,l.amount_xof,l.currency,l.entry_date,l.direction,l.amount_native)
      from public.ledger_entries l where l.payment_id=p.id)
    union all
    (select jsonb_build_array(l.building_id,l.unit_id,l.category,l.amount_xof,l.currency,l.entry_date,l.direction,l.amount_native)
      from public.ledger_entries l where l.payment_id=p.id
     except all
     select jsonb_build_array(r.building_id,r.unit_id,r.category,a.amount_xof,'XOF',p.payment_date,'income',null)
      from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id where a.payment_id=p.id)
  ) then return false; end if;
  if not exists(select 1 from public.audit_logs a where a.id=(saved.result->>'auditId')::uuid and a.actor_id=saved.actor_id
    and a.entity_id=p.id and a.entity_type='cimac_customer_collection' and a.metadata->>'request_id'=saved.request_id::text
    and a.metadata->>'project_id'=project::text) then return false; end if;
  return true;
exception when data_exception then return false;
end; $$;

create function private.cimac_lease_collection_projection(p_contract_id uuid) returns jsonb
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
  select coalesce(array_agg(distinct p.id),'{}'::uuid[]) into ids from public.payments p
    join public.payment_receivable_allocations a on a.payment_id=p.id join public.receivables r on r.id=a.receivable_id
    where p.source_type='cimac_customer_collection' and r.source_type='lease_contract' and r.source_id=c.id;
  if exists(select 1 from unnest(ids) id where not private.cimac_customer_collection_proof(id)) then
    raise exception 'cimacBillingVerificationFailed'; end if;
  select jsonb_build_object('contractId',c.id,'paymentCount',cardinality(ids),'payments',
    coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('cimac_contract_allocation',(
      select jsonb_build_object('contractId',c.id,'amount',sum(a.amount_xof)::text,'currency','XOF','receivableIds',jsonb_agg(r.id order by r.due_date,r.id))
      from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id where a.payment_id=p.id
        and r.source_type='lease_contract' and r.source_id=c.id)) order by p.payment_date desc,p.id)
      from public.payments p where p.id=any(ids)),'[]'::jsonb)) into result;
  return result;
end; $$;

create function public.cimac_customer_account_rpc(p_customer_id uuid default null,p_search text default null,p_page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.cimac_customer_account($1,$2,$3); $$;
create function public.cimac_save_fee_terms_rpc(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.cimac_save_fee_terms($1,$2); $$;
create function public.cimac_save_meter_reading_rpc(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.cimac_save_meter_reading($1,$2); $$;
create function public.cimac_collect_customer_rpc(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.cimac_collect_customer($1,$2); $$;
create function public.cimac_billing_request_rpc(p_request_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.cimac_billing_request($1); $$;
create function public.cimac_lease_collection_projection_rpc(p_contract_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.cimac_lease_collection_projection($1); $$;
create function public.cimac_customer_collection_proof_rpc(p_payment_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$ select private.cimac_customer_collection_proof($1); $$;
create function public.cimac_customer_collection_proofs_rpc(p_payment_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_payment_ids is null or cardinality(p_payment_ids) not between 1 and 100 or array_position(p_payment_ids,null) is not null
    or cardinality(p_payment_ids)<>(select count(distinct id) from unnest(p_payment_ids) id) then raise exception 'cimacBillingInvalidInput'; end if;
  select jsonb_agg(jsonb_build_object('paymentId',id,'verified',private.cimac_customer_collection_proof(id)) order by ordinal)
    into result from unnest(p_payment_ids) with ordinality ids(id,ordinal);
  return result;
end; $$;

-- The legacy financial audit whitelist predates these entity types. Expose
-- only their CIMAC-scoped events to finance; retain all legacy policies while
-- adding a restrictive scope fence for these new event kinds to every role.
create policy "finance reads CIMAC billing audit" on public.audit_logs for select to authenticated
using(public.has_app_role('finance') and entity_type in ('cimac_fee_terms','cimac_meter_reading','cimac_customer_collection')
  and exists(select 1 from public.projects p where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id)));
create policy "CIMAC billing audit project restriction" on public.audit_logs as restrictive for all to authenticated
using(entity_type not in ('cimac_fee_terms','cimac_meter_reading','cimac_customer_collection')
  or exists(select 1 from public.projects p where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id)))
with check(entity_type not in ('cimac_fee_terms','cimac_meter_reading','cimac_customer_collection')
  or exists(select 1 from public.projects p where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id)));

revoke all on function private.cimac_billing_scope(boolean),private.cimac_billing_keys(jsonb,text[],text[]),private.cimac_billing_decimal(jsonb,integer,boolean),
  private.cimac_billing_date(jsonb),private.cimac_billing_text(jsonb,integer,boolean),private.cimac_billing_contract_target(jsonb,uuid),
  private.cimac_billing_term_doc(private.cimac_fee_terms),private.cimac_billing_meter_doc(private.cimac_meter_readings),
  private.cimac_billing_customer_units(uuid,uuid),private.cimac_billing_customer_summary(uuid,uuid),private.cimac_billing_customer_exists(uuid,uuid),private.guard_cimac_customer_collection()
  from public,anon,authenticated,service_role;
revoke all on function private.cimac_collection_visible(uuid) from public,anon,authenticated,service_role;
grant execute on function private.cimac_collection_visible(uuid) to authenticated;
revoke all on function private.cimac_customer_collection_proof(uuid),private.cimac_lease_collection_projection(uuid),public.cimac_lease_collection_projection_rpc(uuid),
  public.cimac_customer_collection_proof_rpc(uuid),public.cimac_customer_collection_proofs_rpc(uuid[])
  from public,anon,authenticated,service_role;
grant execute on function private.cimac_customer_collection_proof(uuid),private.cimac_lease_collection_projection(uuid),public.cimac_lease_collection_projection_rpc(uuid),
  public.cimac_customer_collection_proof_rpc(uuid),public.cimac_customer_collection_proofs_rpc(uuid[])
  to authenticated;
revoke all on function private.cimac_customer_account(uuid,text,integer),private.cimac_save_fee_terms(jsonb,uuid),private.cimac_save_meter_reading(jsonb,uuid),
  private.cimac_collect_customer(jsonb,uuid),private.cimac_billing_request(uuid),public.cimac_customer_account_rpc(uuid,text,integer),
  public.cimac_save_fee_terms_rpc(jsonb,uuid),public.cimac_save_meter_reading_rpc(jsonb,uuid),public.cimac_collect_customer_rpc(jsonb,uuid),public.cimac_billing_request_rpc(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.cimac_customer_account(uuid,text,integer),private.cimac_save_fee_terms(jsonb,uuid),private.cimac_save_meter_reading(jsonb,uuid),
  private.cimac_collect_customer(jsonb,uuid),private.cimac_billing_request(uuid),public.cimac_customer_account_rpc(uuid,text,integer),
  public.cimac_save_fee_terms_rpc(jsonb,uuid),public.cimac_save_meter_reading_rpc(jsonb,uuid),public.cimac_collect_customer_rpc(jsonb,uuid),public.cimac_billing_request_rpc(uuid)
  to authenticated;

-- Operating dashboard projects the actual receipt into its ledger categories;
-- it does not count the header amount once per ledger line or hide null-unit
-- headers. Legacy branches and their explicit project/RLS fences stay intact.
do $projection$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.management_operating_snapshot_rpc(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='select p.*,coalesce(u.building_id,ml.building_id) building_id,';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingProjectionDrift'; end if;
  definition:=replace(definition,anchor,'select p.*,coalesce(u.building_id,ml.building_id,cc.building_id) building_id,cc.amount collection_amount,cc.category collection_category,');
  anchor:='join raw_buildings pb on pb.id=coalesce(u.building_id,ml.building_id) and pb.project_id=p_project_id';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingProjectionDrift'; end if;
  definition:=replace(definition,anchor,$replacement$left join lateral (
      select l.building_id,l.category,sum(l.amount_xof) amount from public.ledger_entries l
      where p.source_type='cimac_customer_collection' and l.payment_id=p.id and l.direction='income'
        and l.currency='XOF' and l.entry_date=p.payment_date group by l.building_id,l.category
    ) cc on true
    join raw_buildings pb on pb.id=coalesce(u.building_id,ml.building_id,cc.building_id) and pb.project_id=p_project_id$replacement$);
  anchor:='when p.source_type=''manual'' then case when p.manual_direction=''income''';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingProjectionDrift'; end if;
  definition:=replace(definition,anchor,'when p.source_type=''cimac_customer_collection'' then p.collection_amount '||anchor);
  anchor:='case when p.source_type in (''sale'',''sale_contract'',''sale_agency_income'',''sale_other_income'',''sale_registration_fee'',''sale_refund'') then ''sale''';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingProjectionDrift'; end if;
  definition:=replace(definition,anchor,'case when p.source_type=''cimac_customer_collection'' then case when p.collection_category=''property_fee'' then ''asset'' else ''lease'' end '||substring(anchor from 6));
  anchor:='count(c.id) filter(where c.cash_xof is not null)';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingProjectionDrift'; end if;
  definition:=replace(definition,anchor,'count(distinct c.id) filter(where c.cash_xof is not null)');
  execute definition;
end; $projection$;

-- Preserve the legacy anomaly checks. Only a fully proven new customer
-- collection may have multiple legitimate ledger lines without a duplicate
-- warning. A damaged new receipt remains an anomaly even with a single line.
do $reconciliation$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.finance_reconciliation_rpc()'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='where l.payment_id is not null group by l.payment_id having count(*)>1';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingReconciliationDrift'; end if;
  definition:=replace(definition,anchor,'where l.payment_id is not null group by l.payment_id having count(*)>1 and not private.cimac_customer_collection_proof(l.payment_id)');
  anchor:='  ) select jsonb_build_object(''count'',(select count(*) from issues),';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingReconciliationDrift'; end if;
  definition:=replace(definition,anchor,$replacement$    union all
    select 'cimac_customer_collection_mismatch',p.id from public.payments p where p.source_type='cimac_customer_collection'
      and not private.cimac_customer_collection_proof(p.id)
  ) select jsonb_build_object('count',(select count(*) from issues),$replacement$);
  execute definition;
end; $reconciliation$;

-- The existing inspector must not infer one unit/building from a customer
-- receipt spanning multiple contracts. Supply a verified read-only context;
-- keep its old writer and the protected financial facts unchanged.
do $context$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.payment_context_read_rpc(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='if not found then raise exception ''paymentContextNotFound''; end if;';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacBillingContextDrift'; end if;
  definition:=replace(definition,anchor,anchor||$replacement$
  if p.source_type='cimac_customer_collection' then
    if not private.cimac_customer_collection_proof(p.id) then raise exception 'cimacBillingVerificationFailed'; end if;
    return jsonb_build_object(
      'paymentId',p.id,'unitId',null,'buildingId',null,'paymentDate',p.payment_date,'amount',p.amount,'currency',p.currency,
      'recordedBy',p.recorded_by,'recordedByName',case when p.recorded_by=auth.uid() then (select display_name from public.user_profiles where id=p.recorded_by) end,
      'actualCollector',p.actual_collector,'collectorBasis',p.collector_basis,'version',p.context_version,'token',md5(to_jsonb(p)::text),
      'confirmedBy',p.context_confirmed_by,'confirmedAt',p.context_confirmed_at,'readOnly',true,
      'allocatedXof',(select sum(a.amount_xof) from public.payment_receivable_allocations a where a.payment_id=p.id),
      'allocations',(select jsonb_agg(jsonb_build_object(
        'receivableId',r.id,'title',r.title,'dueDate',r.due_date,'allocatedXof',a.amount_xof,
        'periodStart',r.service_period_start,'periodEnd',r.service_period_end,'periodSource',r.service_period_source,
        'token',md5(to_jsonb(r)::text)) order by r.due_date,r.id)
        from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id where a.payment_id=p.id));
  end if;
$replacement$);
  execute definition;
end; $context$;

notify pgrst,'reload schema';
commit;
