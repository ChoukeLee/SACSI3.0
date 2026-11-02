begin;

-- Preserve the complete historical note plus the bounded current instruction.
-- Existing application forms retain their smaller input limit. Fail closed if
-- the reviewed old constraint has acquired any other condition.
do $notes$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.units'::regclass and conname='units_notes_check';
  if definition is null or lower(regexp_replace(definition,'[[:space:]()]','','g')) not in
    ('checkchar_lengthnotes<=500ornotesisnull','checkchar_lengthnotes<=500','checklengthnotes<=500') then raise exception 'cimacFinanceNotesConstraintDrift'; end if;
  alter table public.units drop constraint units_notes_check;
  alter table public.units add constraint units_notes_check check(char_length(notes)<=20000);
end; $notes$;

-- New, independently versioned authenticated pre-opening finance workflow.
-- This migration contains no production IDs or business data changes.
create table private.cimac_finance_requests (
  request_id uuid primary key, actor_id uuid not null references auth.users(id),
  request_data jsonb not null, before_state jsonb not null, after_state jsonb,
  result jsonb, deployment text not null,
  status text not null check(status in ('executing','completed')),
  created_at timestamptz not null default clock_timestamp()
);
create index cimac_finance_requests_actor on private.cimac_finance_requests(actor_id,created_at desc);
alter table private.cimac_finance_requests enable row level security;
revoke all on private.cimac_finance_requests from public,anon,authenticated,service_role;

-- Permanent row protection plus transaction-local exact authorization. An
-- executing request and authenticated actor are required; caller-set GUCs do
-- not authorize mutations. Completed authorizations protect OLD rows as well.
create table private.cimac_finance_row_authorizations (
  request_id uuid not null references private.cimac_finance_requests(request_id),
  entity text not null check(entity in ('payment','ledger','receivable','allocation')),
  entity_id uuid not null, before_data jsonb, after_data jsonb not null,
  primary key(request_id,entity,entity_id)
);
create index cimac_finance_authorized_row on private.cimac_finance_row_authorizations(entity,entity_id);
alter table private.cimac_finance_row_authorizations enable row level security;
revoke all on private.cimac_finance_row_authorizations from public,anon,authenticated,service_role;

create function public.cimac_finance_protocol_version() returns integer
language sql immutable security invoker set search_path='' as $$ select 1; $$;
create function public.can_execute_cimac_finance() returns boolean
language sql stable security invoker set search_path='' as $$
  select public.can_execute_cimac_maintenance();
$$;
create function private.cimac_finance_keys(v jsonb,allowed text[],required text[]) returns void
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(v) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(v) k where not(k=any(allowed)))
    or exists(select 1 from unnest(required) k where not(v?k) or v->k='null'::jsonb)
    then raise exception 'cimacFinanceInvalidRequest'; end if;
end; $$;
create function private.cimac_finance_text(v jsonb,k text,cap integer) returns text
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(v->k) is distinct from 'string' or v->>k<>btrim(v->>k)
    or length(v->>k) not between 1 and cap then raise exception 'cimacFinanceInvalidRequest'; end if;
  return v->>k;
end; $$;
create function private.cimac_finance_money(v jsonb,k text,allow_zero boolean default false,cny boolean default false) returns numeric
language plpgsql immutable set search_path='' as $$
declare s text:=private.cimac_finance_text(v,k,15); n numeric;
begin
  if s !~ (case when cny then '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$' else '^(0|[1-9][0-9]{0,11})$' end)
    then raise exception 'cimacFinanceInvalidRequest'; end if;
  n:=s::numeric;
  if (not allow_zero and n<=0) or n>999999999999.99 then raise exception 'cimacFinanceInvalidRequest'; end if;
  return n;
end; $$;
create function private.cimac_finance_uuid(v jsonb,k text) returns uuid
language plpgsql immutable set search_path='' as $$
declare s text:=private.cimac_finance_text(v,k,36);
begin
  if s !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then raise exception 'cimacFinanceInvalidRequest'; end if;
  return s::uuid;
end; $$;
create function private.cimac_finance_date(v jsonb,k text) returns date
language plpgsql immutable set search_path='' as $$
declare s text:=private.cimac_finance_text(v,k,10); d date;
begin
  if s !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'cimacFinanceInvalidRequest'; end if;
  begin d:=s::date; exception when datetime_field_overflow or invalid_datetime_format then raise exception 'cimacFinanceInvalidRequest'; end;
  if to_char(d,'YYYY-MM-DD')<>s then raise exception 'cimacFinanceInvalidRequest'; end if;
  return d;
end; $$;
create function private.cimac_finance_request(p jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare op jsonb; part jsonb; keys text[]; required text[]; t text; count_parts integer:=0;
  total numeric; n text; seen text[]:='{}'; names text[]; j jsonb;
begin
  if p is null or octet_length(p::text)>262144 then raise exception 'cimacFinanceInvalidRequest'; end if;
  keys:=array['requestId','protocolVersion','connectorVersion','originalInstruction','inputSource','operations'];
  perform private.cimac_finance_keys(p,keys,keys);
  perform private.cimac_finance_uuid(p,'requestId'); perform private.cimac_finance_text(p,'originalInstruction',4000);
  if p->>'protocolVersion' is distinct from '1.0' or p->>'connectorVersion' is distinct from '0.9.0'
    or p->>'inputSource' is distinct from 'excel_screenshot' or jsonb_typeof(p->'operations') is distinct from 'array'
    or jsonb_array_length(p->'operations') not between 1 and 30 then raise exception 'cimacFinanceInvalidRequest'; end if;
  for op in select value from jsonb_array_elements(p->'operations') loop
    t:=op->>'type'; keys:=array['type','customerName','annotation']; required:=keys;
    case t
      when 'collect' then keys:=keys||array['customerId','category','receipt','parts','servicePeriod']; required:=required||array['customerId','category','receipt','parts'];
      when 'new_deposit' then keys:=keys||array['receipt','units']; required:=keys;
      when 'reclassify' then keys:=array['type','paymentId','expectedSourceType','targetSourceType','amountCny','annotation']; required:=keys;
      when 'identity' then keys:=keys||array['customerId','units','holderName','managementNames']; required:=required||array['customerId','units'];
      else raise exception 'cimacFinanceInvalidRequest';
    end case;
    perform private.cimac_finance_keys(op,keys,required); perform private.cimac_finance_text(op,'annotation',2000);
    if t<>'reclassify' then perform private.cimac_finance_text(op,'customerName',200); end if;
    if t in ('collect','identity') then perform private.cimac_finance_uuid(op,'customerId'); end if;
    if t in ('collect','new_deposit') then
      j:=op->'receipt'; keys:=array['amountXof','paymentDate','paymentMethod','externalReceiptNo','sourceText'];
      perform private.cimac_finance_keys(j,keys,array['amountXof','paymentDate','paymentMethod','sourceText']);
      perform private.cimac_finance_money(j,'amountXof'); perform private.cimac_finance_text(j,'sourceText',2000);
      if j?'externalReceiptNo' then perform private.cimac_finance_text(j,'externalReceiptNo',200); end if;
      if j->>'paymentMethod' is distinct from 'cash' or private.cimac_finance_date(j,'paymentDate')>current_date then raise exception 'cimacFinanceInvalidRequest'; end if;
    end if;
    if t='collect' then
      if op->>'category' not in ('lease_deposit','property_fee') or op->>'category' is null
        or jsonb_typeof(op->'parts') is distinct from 'array' or jsonb_array_length(op->'parts') not between 1 and 100 then raise exception 'cimacFinanceInvalidRequest'; end if;
      if op->>'category'='lease_deposit' and op?'servicePeriod' then raise exception 'cimacFinanceInvalidRequest'; end if;
      if op->>'category'='property_fee' then
        perform private.cimac_finance_keys(op->'servicePeriod',array['start','end'],array['start','end']);
        if private.cimac_finance_date(op->'servicePeriod','end')<>(private.cimac_finance_date(op->'servicePeriod','start')+interval '1 year'-interval '1 day')::date
          then raise exception 'cimacFinanceInvalidRequest'; end if;
      end if;
      total:=0;
      for part in select value from jsonb_array_elements(op->'parts') loop
        keys:=array['contractId','amountXof'];
        if op->>'category'='property_fee' then keys:=keys||array['discountXof']; end if;
        perform private.cimac_finance_keys(part,keys,array['contractId','amountXof']);
        n:=private.cimac_finance_uuid(part,'contractId')::text;
        if ('contract:'||n)=any(seen) then raise exception 'cimacFinanceDuplicateTarget'; end if;
        seen:=array_append(seen,'contract:'||n); total:=total+private.cimac_finance_money(part,'amountXof');
        if part?'discountXof' then perform private.cimac_finance_money(part,'discountXof',true); end if;
      end loop;
      count_parts:=count_parts+jsonb_array_length(op->'parts');
      if total<>(op->'receipt'->>'amountXof')::numeric then raise exception 'cimacFinanceAmountMismatch'; end if;
    elsif t in ('new_deposit','identity') then
      if t='new_deposit' then
        n:='customer-name:'||lower(op->>'customerName');
        if n=any(seen) then raise exception 'cimacFinanceDuplicateTarget'; end if;
        seen:=array_append(seen,n);
      end if;
      if jsonb_typeof(op->'units') is distinct from 'array' or jsonb_array_length(op->'units') not between 1 and 30 then raise exception 'cimacFinanceInvalidRequest'; end if;
      total:=0;
      for part in select value from jsonb_array_elements(op->'units') loop
        keys:=case when t='new_deposit' then array['unitNo','monthlyRentXof','depositXof','amountXof'] else array['unitNo','expectedHolderName'] end;
        perform private.cimac_finance_keys(part,keys,case when t='identity' then array['unitNo'] else keys end);
        if not(part?'expectedHolderName') and t='identity' then raise exception 'cimacFinanceInvalidRequest'; end if;
        n:=private.cimac_finance_text(part,'unitNo',4);
        if n !~ '^[0-9]{3,4}$' then raise exception 'cimacFinanceInvalidRequest'; end if;
        if (t||':'||n)=any(seen) then raise exception 'cimacFinanceDuplicateTarget'; end if;
        seen:=array_append(seen,t||':'||n);
        if t='new_deposit' then
          if private.cimac_finance_money(part,'depositXof')<>3*private.cimac_finance_money(part,'monthlyRentXof')
            or private.cimac_finance_money(part,'amountXof')>(part->>'depositXof')::numeric then raise exception 'cimacFinanceAmountMismatch'; end if;
          total:=total+(part->>'amountXof')::numeric;
        elsif part->'expectedHolderName'<>'null'::jsonb then perform private.cimac_finance_text(part,'expectedHolderName',200); end if;
      end loop;
      count_parts:=count_parts+jsonb_array_length(op->'units');
      if t='new_deposit' and total<>(op->'receipt'->>'amountXof')::numeric then raise exception 'cimacFinanceAmountMismatch'; end if;
      if t='identity' then
        if not(op?'holderName') and not(op?'managementNames') then raise exception 'cimacFinanceInvalidRequest'; end if;
        if op?'holderName' and private.cimac_finance_text(op,'holderName',200)<>op->>'customerName' then raise exception 'cimacFinanceInvalidRequest'; end if;
        if op?'managementNames' then
          if jsonb_typeof(op->'managementNames') is distinct from 'array' or jsonb_array_length(op->'managementNames') not between 1 and 10 then raise exception 'cimacFinanceInvalidRequest'; end if;
          names:='{}';
          for j in select value from jsonb_array_elements(op->'managementNames') loop
            n:=private.cimac_finance_text(jsonb_build_object('n',j),'n',200);
            if n=any(names) then raise exception 'cimacFinanceInvalidRequest'; end if; names:=array_append(names,n);
          end loop;
        end if;
      end if;
    else
      n:=private.cimac_finance_uuid(op,'paymentId')::text;
      if ('payment:'||n)=any(seen) then raise exception 'cimacFinanceDuplicateTarget'; end if;
      seen:=array_append(seen,'payment:'||n); count_parts:=count_parts+1;
      perform private.cimac_finance_money(op,'amountCny',false,true);
      if coalesce(op->>'expectedSourceType','') not in ('lease_rent','lease_deposit')
        or coalesce(op->>'targetSourceType','') not in ('lease_rent','lease_deposit')
        or op->>'targetSourceType'=op->>'expectedSourceType' then raise exception 'cimacFinanceInvalidRequest'; end if;
    end if;
    if count_parts>100 then raise exception 'cimacFinanceInvalidRequest'; end if;
  end loop;
  return p;
end; $$;

create function private.cimac_finance_state() returns jsonb
language sql stable security definer set search_path='' as $$
  with us as (select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC'),
    ps as(select p.id from public.payments p where p.unit_id in(select id from us)),
    rs as(select r.id from public.receivables r where r.unit_id in(select id from us))
  select private.cimac_scope_state()||jsonb_build_object(
    'allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.payment_id,a.receivable_id) from public.payment_receivable_allocations a where a.payment_id in(select id from ps) or a.receivable_id in(select id from rs)),'[]'),
    'nativeAllocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.payment_id,a.receivable_id) from public.lease_native_payment_allocations a where a.payment_id in(select id from ps) or a.receivable_id in(select id from rs)),'[]'));
$$;

create function private.cimac_finance_authorized(entity text,id uuid,before_doc jsonb,after_doc jsonb) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from private.cimac_finance_row_authorizations a
    join private.cimac_finance_requests r on r.request_id=a.request_id
    where a.entity=$1 and a.entity_id=$2 and a.before_data is not distinct from $3
      and a.after_data=$4 and r.actor_id=auth.uid() and r.status='executing');
$$;

-- Retain the system identifier on this exact, authorized whole-payment
-- correction. Preserve the original function's ACL, mode and all other paths.
do $reference$
declare definition text; anchor text:='  v_prefix := private.payment_reference_prefix(new.unit_id,new.source_type,new.payment_date,new.source_id);';
begin
  definition:=replace(pg_get_functiondef('private.assign_lease_payment_reference()'::regprocedure),chr(13)||chr(10),chr(10));
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'cimacFinanceReferenceDefinitionDrift'; end if;
  definition:=replace(definition,anchor,$branch$  if tg_op='UPDATE' then
    if current_user not in ('authenticated','anon','service_role') then
      if private.cimac_finance_authorized('payment',old.id,to_jsonb(old),to_jsonb(new)) then
        return new;
      end if;
    end if;
  end if;
$branch$||anchor);
  execute definition;
end; $reference$;

create function private.guard_cimac_finance_rows() returns trigger
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare entity text; id uuid; old_id uuid; old_doc jsonb; new_doc jsonb; protected boolean; allowed boolean;
begin
  entity:=case tg_table_name when 'payments' then 'payment' when 'ledger_entries' then 'ledger' when 'receivables' then 'receivable' else 'allocation' end;
  if tg_op<>'INSERT' then old_doc:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_doc:=to_jsonb(new); end if;
  id:=case when entity='allocation' then (coalesce(new_doc,old_doc)->>'payment_id')::uuid else (coalesce(new_doc,old_doc)->>'id')::uuid end;
  old_id:=case when entity='allocation' then (old_doc->>'payment_id')::uuid else (old_doc->>'id')::uuid end;
  if entity='payment' and tg_op<>'DELETE' then
   if new.request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,0));
    if exists(select 1 from private.cimac_finance_requests where request_id=new.request_id)
      and not exists(select 1 from private.cimac_finance_row_authorizations a join private.cimac_finance_requests r on r.request_id=a.request_id
        where a.entity='payment' and a.entity_id=id and r.actor_id=auth.uid() and r.status='executing') then raise exception 'cimacFinanceRequestIdConflict'; end if;
   end if;
  end if;
  protected:=exists(select 1 from private.cimac_finance_row_authorizations a where a.entity=entity and a.entity_id in(id,old_id));
  if entity='payment' and coalesce(new_doc->>'request_kind',old_doc->>'request_kind')='cimac_finance' then protected:=true; end if;
  if not protected then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' then raise exception 'cimacFinanceRowProtected' using errcode='42501'; end if;
  if tg_op='UPDATE' then
    allowed:=private.cimac_finance_authorized(entity,id,old_doc,new_doc);
  else
    -- Defaults and generated system references are captured in full after the
    -- insert. Only the listed initial facts may be present before that point.
    allowed:=exists(select 1 from private.cimac_finance_row_authorizations a join private.cimac_finance_requests r on r.request_id=a.request_id
      where a.entity=entity and a.entity_id=id and a.before_data is null and new_doc @> a.after_data
        and r.actor_id=auth.uid() and r.status='executing');
  end if;
  if not coalesce(allowed,false) then raise exception 'cimacFinanceRowProtected' using errcode='42501'; end if;
  return new;
end; $$;
create trigger guard_cimac_finance_payment before insert or update or delete on public.payments for each row execute function private.guard_cimac_finance_rows();
create trigger guard_cimac_finance_ledger before insert or update or delete on public.ledger_entries for each row execute function private.guard_cimac_finance_rows();
create trigger guard_cimac_finance_receivable before insert or update or delete on public.receivables for each row execute function private.guard_cimac_finance_rows();
create trigger guard_cimac_finance_allocation before insert or update or delete on public.payment_receivable_allocations for each row execute function private.guard_cimac_finance_rows();

create function private.cimac_finance_history(contract uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare c public.lease_contracts%rowtype; p public.payments%rowtype; l public.ledger_entries%rowtype; kind text; dir text;
begin
  select * into strict c from public.lease_contracts where id=contract;
  for p in select * from public.payments where source_id=c.id order by id loop
    kind:=case when p.source_type in ('lease_deposit','lease_deposit_refund') then 'lease_deposit' else p.source_type end;
    dir:=case when p.source_type='lease_deposit' then 'liability_in' when p.source_type='lease_deposit_refund' then 'liability_out' else 'income' end;
    if p.customer_id is distinct from c.customer_id or p.unit_id is distinct from c.unit_id or p.amount<=0 or p.amount::text in ('NaN','Infinity','-Infinity')
      or p.source_type not in ('lease_deposit','lease_deposit_refund','lease_rent','property_fee')
      or (select count(*) from public.ledger_entries where payment_id=p.id)<>1 then raise exception 'cimacFinanceHistoryConflict'; end if;
    select * into strict l from public.ledger_entries where payment_id=p.id;
    if l.unit_id is distinct from c.unit_id or l.building_id is distinct from (select building_id from public.units where id=c.unit_id)
      or l.entry_date<>p.payment_date or l.category<>kind or l.direction<>dir
      or (p.native_settlement and (p.exchange_rate_to_xof is not null or l.currency<>p.currency or l.amount_native<>p.amount or l.amount_xof<>0))
      or (not p.native_settlement and (p.exchange_rate_to_xof is null or p.exchange_rate_to_xof<=0 or p.exchange_rate_to_xof::text in ('NaN','Infinity','-Infinity')
        or l.currency<>'XOF' or l.amount_native is not null or l.amount_xof<>round(p.amount*p.exchange_rate_to_xof,2))) then raise exception 'cimacFinanceHistoryConflict'; end if;
  end loop;
end; $$;
create function private.cimac_finance_contract(contract uuid,customer uuid,customer_name text) returns public.lease_contracts
language plpgsql stable security definer set search_path='' as $$
declare c public.lease_contracts%rowtype; u public.units%rowtype;
begin
  select * into c from public.lease_contracts where id=contract;
  select * into u from public.units where id=c.unit_id;
  if c.id is null or c.customer_id is distinct from customer or (select name from public.customers where id=customer) is distinct from customer_name
    or c.status<>'draft' or c.commencement_state<>'pending_project_opening' or c.start_date is not null or c.expected_end_date is not null
    or c.actual_end_date is not null or c.expected_end_confirmed or c.paid_through_date is not null or u.status<>'reserved'
    or u.kind<>'storefront' or u.asset_subtype<>'commercial_shop' or u.unit_no='231' or not public.can_access_unit(u.id)
    or not exists(select 1 from public.buildings b join public.projects p on p.id=b.project_id where b.id=u.building_id and p.code='CIMAC' and b.is_active)
    or exists(select 1 from public.lease_contracts x where x.unit_id=u.id and x.id<>c.id and x.status in ('draft','active')) then raise exception 'cimacFinanceScopeConflict'; end if;
  perform private.cimac_finance_history(c.id);
  return c;
end; $$;

create function private.cimac_finance_validate_scope(r jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare op jsonb; part jsonb; c public.lease_contracts%rowtype; u public.units%rowtype; p public.payments%rowtype;
  used uuid[]:='{}'; identities uuid[]:='{}'; reclasses uuid[]:='{}'; id uuid; gross numeric; rate numeric; f public.property_fee_rules%rowtype;
begin
  for op in select value from jsonb_array_elements(r->'operations') loop
    if op->>'type'='collect' then
      for part in select value from jsonb_array_elements(op->'parts') loop
        c:=private.cimac_finance_contract((part->>'contractId')::uuid,(op->>'customerId')::uuid,op->>'customerName');
        if c.unit_id=any(used) or c.unit_id=any(reclasses) then raise exception 'cimacFinanceDuplicateTarget'; end if;
        used:=array_append(used,c.unit_id);
        if op->>'category'='lease_deposit' then
          if exists(select 1 from public.payments where source_id=c.id and native_settlement and source_type in ('lease_deposit','lease_deposit_refund','lease_deposit_deduction'))
            or (part->>'amountXof')::numeric>c.deposit_amount_xof-private.cimac_known_deposit_balance(c.id) then raise exception 'cimacFinanceDepositConflict'; end if;
        else
          if (select count(*) from public.property_fee_rules where unit_id=c.unit_id and is_active and start_date<=(op->'servicePeriod'->>'end')::date and (end_date is null or end_date>=(op->'servicePeriod'->>'start')::date))<>1 then raise exception 'cimacFinancePropertyConflict'; end if;
          select * into f from public.property_fee_rules where unit_id=c.unit_id and is_active and start_date=(op->'servicePeriod'->>'start')::date and end_date=(op->'servicePeriod'->>'end')::date;
          select area_sqm into rate from public.units where id=c.unit_id;
          gross:=rate*900*12;
          if f.id is null or rate is null or rate<=0 or f.monthly_amount_xof<>rate*900 or gross<>trunc(gross)
            or (part->>'amountXof')::numeric+coalesce(part->>'discountXof','0')::numeric<>gross
            or exists(select 1 from public.receivables where unit_id=c.unit_id and category='property_fee' and status<>'cancelled'
              and (service_period_start is null or (service_period_start<=(op->'servicePeriod'->>'end')::date and service_period_end>=(op->'servicePeriod'->>'start')::date)))
            or exists(select 1 from public.payments where source_id=c.id and source_type='property_fee') then raise exception 'cimacFinancePropertyConflict'; end if;
        end if;
        -- Different UUIDs cannot replay the same physical receipt facts.
        if exists(select 1 from public.payments where source_id=c.id and source_type=op->>'category' and payment_date=(op->'receipt'->>'paymentDate')::date
          and currency='XOF' and amount=(part->>'amountXof')::numeric and payment_method='cash') then raise exception 'cimacFinanceDuplicateReceipt'; end if;
      end loop;
    elsif op->>'type'='new_deposit' then
      if exists(select 1 from public.customers where lower(btrim(name))=lower(op->>'customerName')) then raise exception 'cimacFinanceCustomerConflict'; end if;
      for part in select value from jsonb_array_elements(op->'units') loop
        if (select count(*) from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC' and u.unit_no=part->>'unitNo')<>1 then raise exception 'cimacFinanceScopeConflict'; end if;
        select us.* into strict u from public.units us join public.buildings b on b.id=us.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC' and us.unit_no=part->>'unitNo';
        if u.id=any(used) or u.id=any(identities) or u.id=any(reclasses) then raise exception 'cimacFinanceDuplicateTarget'; end if; used:=array_append(used,u.id);
        if u.status<>'available' or u.kind<>'storefront' or u.asset_subtype<>'commercial_shop' or u.unit_no='231' or not public.can_access_unit(u.id)
          or u.area_sqm is null or u.area_sqm<=0 or not exists(select 1 from public.buildings where id=u.building_id and is_active)
          or exists(select 1 from public.lease_contracts where unit_id=u.id and status in ('draft','active'))
          or exists(select 1 from public.sale_contracts where unit_id=u.id and status in ('draft','active'))
          or exists(select 1 from public.receivables where unit_id=u.id and status in ('pending','partial','overdue') and management_status='managed') then raise exception 'cimacFinanceScopeConflict'; end if;
      end loop;
    elsif op->>'type'='identity' then
      for part in select value from jsonb_array_elements(op->'units') loop
        if (select count(*) from public.units us join public.buildings b on b.id=us.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC' and us.unit_no=part->>'unitNo')<>1 then raise exception 'cimacFinanceScopeConflict'; end if;
        select us.* into strict u from public.units us join public.buildings b on b.id=us.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC' and us.unit_no=part->>'unitNo';
        if u.id=any(identities) or u.id=any(reclasses) then raise exception 'cimacFinanceDuplicateTarget'; end if; identities:=array_append(identities,u.id);
        select lc.id into id from public.lease_contracts lc where lc.unit_id=u.id and lc.status in ('draft','active');
        c:=private.cimac_finance_contract(id,(op->>'customerId')::uuid,op->>'customerName');
        if u.reservation_holder_name is distinct from (part->>'expectedHolderName') then raise exception 'cimacFinanceIdentityConflict'; end if;
      end loop;
    else
      select * into p from public.payments where id=(op->>'paymentId')::uuid;
      c:=private.cimac_finance_contract(p.source_id,p.customer_id,(select name from public.customers where id=p.customer_id));
      if c.unit_id=any(used) or c.unit_id=any(identities) or c.unit_id=any(reclasses) then raise exception 'cimacFinanceDuplicateTarget'; end if; reclasses:=array_append(reclasses,c.unit_id);
      if p.currency<>'CNY' or p.native_settlement or p.source_type<>op->>'expectedSourceType' or p.amount<>(op->>'amountCny')::numeric
        or p.exchange_rate_to_xof is null or p.exchange_rate_to_xof<=0 or p.reversal_of_payment_id is not null
        or p.request_kind in ('cimac_maintenance','cimac_finance')
        or exists(select 1 from public.payments x where x.reversal_of_payment_id=p.id or (x.source_id=p.source_id and x.source_type in ('lease_deposit_refund','lease_rent_refund','lease_deposit_deduction')))
        or exists(select 1 from public.payment_receivable_allocations where payment_id=p.id)
        or exists(select 1 from public.lease_native_payment_allocations where payment_id=p.id) then raise exception 'cimacFinanceReclassificationConflict'; end if;
    end if;
  end loop;
end; $$;

create function private.cimac_finance_request_conflict(id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.payments where request_id=$1 or payments.id=$1)
    or exists(select 1 from private.cimac_maintenance_requests where request_id=$1)
    or exists(select 1 from private.cimac_billing_requests where request_id=$1)
    or exists(select 1 from private.operator_native_collection_requests where request_id=$1)
    or exists(select 1 from private.lease_collection_requests where request_id=$1)
    or exists(select 1 from private.finance_operation_requests where request_id=$1)
    or exists(select 1 from private.payment_context_requests where request_id=$1)
    or exists(select 1 from private.lease_rent_period_requests where request_id=$1)
    or exists(select 1 from private.lease_lifecycle_requests where request_id=$1)
    or exists(select 1 from private.operator_payment_confirmations where request_id=$1)
    or exists(select 1 from private.operator_collection_batches where request_id=$1)
    or exists(select 1 from private.operator_daily_workflows where request_id=$1)
    or exists(select 1 from private.operator_booking_operations where request_id=$1);
$$;

-- Identity-only batches also reserve their UUID against every legacy journal,
-- even when there is no payment row. No legacy execution path is broadened.
create function private.guard_cimac_finance_request_namespace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,0));
  if exists(select 1 from private.cimac_finance_requests where request_id=new.request_id) then raise exception 'cimacFinanceRequestIdConflict'; end if;
  return new;
end; $$;
do $journals$
declare n text;
begin
  foreach n in array array['cimac_maintenance_requests','cimac_billing_requests','operator_native_collection_requests','lease_collection_requests','finance_operation_requests','payment_context_requests','lease_rent_period_requests','lease_lifecycle_requests',
    'operator_payment_confirmations','operator_collection_batches','operator_daily_workflows','operator_booking_operations'] loop
    execute format('create trigger cimac_finance_request_namespace before insert on private.%I for each row execute function private.guard_cimac_finance_request_namespace()',n);
  end loop;
end; $journals$;

create function private.cimac_finance_post(batch uuid,part_key text,contract uuid,kind text,piece jsonb,receipt jsonb,period jsonb default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.lease_contracts%rowtype; u public.units%rowtype; pay uuid:=private.cimac_child_uuid(batch,part_key||':payment');
  child uuid:=private.cimac_child_uuid(batch,part_key||':request'); lid uuid:=private.cimac_child_uuid(batch,part_key||':ledger');
  rid uuid:=private.cimac_child_uuid(batch,part_key||':receivable'); val numeric:=(piece->>'amountXof')::numeric;
  data jsonb; bill jsonb; description text;
begin
  select * into strict c from public.lease_contracts where id=contract;
  select * into strict u from public.units where id=c.unit_id;
  if private.cimac_finance_request_conflict(child) or exists(select 1 from private.cimac_finance_requests where request_id=child) then raise exception 'cimacFinanceRequestIdConflict'; end if;
  description:='CIMAC财务核对；批次'||batch||'；实际收款组'||split_part(part_key,':',1)||'；逐铺分账序号'||part_key||'；'||(receipt->>'sourceText');
  data:=jsonb_build_object('id',pay,'customer_id',c.customer_id,'unit_id',u.id,'source_type',kind,'source_id',c.id,
    'payment_date',(receipt->>'paymentDate')::date,'amount',val,'currency','XOF','exchange_rate_to_xof',1,'native_settlement',false,
    'payment_method','cash','request_id',child,'request_kind','cimac_finance','external_receipt_no',receipt->>'externalReceiptNo','notes',description);
  insert into private.cimac_finance_row_authorizations values(batch,'payment',pay,null,data);
  insert into public.payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,native_settlement,payment_method,request_id,request_kind,external_receipt_no,notes)
    values(pay,c.customer_id,u.id,kind,c.id,(receipt->>'paymentDate')::date,val,'XOF',1,false,'cash',child,'cimac_finance',receipt->>'externalReceiptNo',description);
  update private.cimac_finance_row_authorizations set after_data=(select to_jsonb(p) from public.payments p where id=pay) where request_id=batch and entity='payment' and entity_id=pay;
  data:=jsonb_build_object('id',lid,'building_id',u.building_id,'unit_id',u.id,'payment_id',pay,'entry_date',(receipt->>'paymentDate')::date,
    'direction',case when kind='lease_deposit' then 'liability_in' else 'income' end,'category',kind,'amount_xof',val,'amount_cny',null,'currency','XOF','amount_native',null,'description',description);
  insert into private.cimac_finance_row_authorizations values(batch,'ledger',lid,null,data);
  insert into public.ledger_entries(id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,description)
    values(lid,u.building_id,u.id,pay,(receipt->>'paymentDate')::date,case when kind='lease_deposit' then 'liability_in' else 'income' end,kind,val,'XOF',description);
  update private.cimac_finance_row_authorizations set after_data=(select to_jsonb(l) from public.ledger_entries l where id=lid) where request_id=batch and entity='ledger' and entity_id=lid;
  if kind='property_fee' then
    description:='年度物业费；标准'||(val+coalesce(piece->>'discountXof','0')::numeric)||'XOF；已批准优惠'||coalesce(piece->>'discountXof','0')||'XOF；实收'||val||'XOF；批次'||batch;
    data:=jsonb_build_object('id',rid,'building_id',u.building_id,'unit_id',u.id,'customer_id',c.customer_id,'source_type','lease_contract','source_id',c.id,
      'category','property_fee','title',description,'due_date',(period->>'start')::date,'amount_xof',val,'paid_amount_xof',val,'status','paid','currency','XOF','management_status','managed',
      'service_period_start',(period->>'start')::date,'service_period_end',(period->>'end')::date,'service_period_source',left(receipt->>'sourceText',1000),'service_period_confirmed_by',auth.uid());
    insert into private.cimac_finance_row_authorizations values(batch,'receivable',rid,null,data);
    insert into public.receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,currency,management_status,
      service_period_start,service_period_end,service_period_source,service_period_confirmed_by)
      values(rid,u.building_id,u.id,c.customer_id,'lease_contract',c.id,'property_fee',description,(period->>'start')::date,val,val,'paid','XOF','managed',
        (period->>'start')::date,(period->>'end')::date,left(receipt->>'sourceText',1000),auth.uid());
    update private.cimac_finance_row_authorizations set after_data=(select to_jsonb(r) from public.receivables r where id=rid) where request_id=batch and entity='receivable' and entity_id=rid;
    data:=jsonb_build_object('payment_id',pay,'receivable_id',rid,'amount_xof',val,'actor_id',auth.uid(),'request_id',child);
    insert into private.cimac_finance_row_authorizations values(batch,'allocation',pay,null,data);
    perform private.record_verified_payment_allocation(pay,rid,val,child);
    update private.cimac_finance_row_authorizations set after_data=(select to_jsonb(a) from public.payment_receivable_allocations a where payment_id=pay and receivable_id=rid) where request_id=batch and entity='allocation' and entity_id=pay;
  end if;
  return pay;
end; $$;

create function private.preview_cimac_finance(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  if not coalesce(public.can_execute_cimac_finance(),false) then raise exception 'cimacFinanceForbidden' using errcode='42501'; end if;
  r:=private.cimac_finance_request(p_request); perform private.cimac_finance_validate_scope(r);
  return jsonb_build_object('status','previewed','requestId',r->>'requestId','operationCount',jsonb_array_length(r->'operations'),
    'snapshot',jsonb_build_object('fingerprint',md5(private.cimac_finance_state()::text),'requestHash',md5(r::text)));
end; $$;

create function private.execute_cimac_finance(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r jsonb; batch uuid; saved private.cimac_finance_requests%rowtype; before_doc jsonb; after_doc jsonb;
  op jsonb; part jsonb; idx integer:=0; part_idx integer; c public.lease_contracts%rowtype; u public.units%rowtype;
  p public.payments%rowtype; l public.ledger_entries%rowtype; old_payment jsonb; old_ledger jsonb; expected jsonb;
  customer uuid; contract uuid; pay uuid; audit uuid:=gen_random_uuid(); result_doc jsonb; proof jsonb; reclasses jsonb:='[]';
  operations jsonb:='[]'; op_units uuid[]; op_contracts uuid[]; op_pays uuid[]; all_contracts uuid[]:='{}';
  pays uuid[]:='{}'; ledgers uuid[]:='{}'; bills uuid[]:='{}'; note text; management text;
  old_row jsonb; new_row jsonb; key text; actual jsonb;
begin
  if not coalesce(public.can_execute_cimac_finance(),false) then raise exception 'cimacFinanceForbidden' using errcode='42501'; end if;
  r:=private.cimac_finance_request(p_request); batch:=(r->>'requestId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(batch::text,0));
  select * into saved from private.cimac_finance_requests where request_id=batch;
  if found then
    if saved.actor_id<>auth.uid() or saved.request_data<>r or saved.status<>'completed' then raise exception 'cimacFinanceRequestIdConflict'; end if;
    return saved.result||jsonb_build_object('status','completed_previously','verified',false,'idempotent',true);
  end if;
  if private.cimac_finance_request_conflict(batch) then raise exception 'cimacFinanceRequestIdConflict'; end if;
  if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '10 minutes'
    or p_deployment is null or length(btrim(p_deployment)) not between 1 and 500 then raise exception 'cimacFinanceExpired'; end if;
  perform private.cimac_finance_keys(p_snapshot,array['fingerprint','requestHash'],array['fingerprint','requestHash']);
  -- Same serial order as maintenance v1; all visible children and FK parents
  -- are locked before CAS. Customer table lock also prevents duplicate-name
  -- inserts from legacy writers during new-customer construction.
  perform pg_advisory_xact_lock(hashtextextended('cimac-maintenance-project',0));
  perform 1 from public.projects where code='CIMAC' order by id for update;
  perform 1 from public.buildings where project_id in(select id from public.projects where code='CIMAC') order by id for update;
  perform 1 from public.units where building_id in(select b.id from public.buildings b join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.lease_contracts where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  lock table public.customers in share row exclusive mode;
  perform 1 from public.customers where id in(select c.customer_id from public.lease_contracts c join public.units u on u.id=c.unit_id join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.payments where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.ledger_entries where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.receivables where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.property_fee_rules where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.payment_receivable_allocations where payment_id in(select p.id from public.payments p join public.units u on u.id=p.unit_id join public.buildings b on b.id=u.building_id join public.projects x on x.id=b.project_id where x.code='CIMAC') order by payment_id,receivable_id for update;
  perform 1 from public.lease_native_payment_allocations where payment_id in(select p.id from public.payments p join public.units u on u.id=p.unit_id join public.buildings b on b.id=u.building_id join public.projects x on x.id=b.project_id where x.code='CIMAC') order by payment_id,receivable_id for update;
  before_doc:=private.cimac_finance_state();
  if p_snapshot<>jsonb_build_object('fingerprint',md5(before_doc::text),'requestHash',md5(r::text)) then raise exception 'cimacFinanceSnapshotChanged'; end if;
  perform private.cimac_finance_validate_scope(r);
  insert into private.cimac_finance_requests(request_id,actor_id,request_data,before_state,deployment,status) values(batch,auth.uid(),r,before_doc,p_deployment,'executing');
  for op in select value from jsonb_array_elements(r->'operations') loop
    idx:=idx+1; part_idx:=0; op_units:='{}'; op_contracts:='{}'; op_pays:='{}';
    if op->>'type'='collect' then
      customer:=(op->>'customerId')::uuid;
      for part in select value from jsonb_array_elements(op->'parts') loop
        part_idx:=part_idx+1; select * into strict c from public.lease_contracts where id=(part->>'contractId')::uuid;
        pay:=private.cimac_finance_post(batch,idx||':'||part_idx,c.id,op->>'category',part,op->'receipt',op->'servicePeriod');
        op_pays:=array_append(op_pays,pay); op_units:=array_append(op_units,c.unit_id); op_contracts:=array_append(op_contracts,c.id);
        if op->>'category'='lease_deposit' then
          update public.lease_contracts set deposit_received=private.cimac_known_deposit_balance(id)>=deposit_amount_xof,updated_at=clock_timestamp() where id=c.id;
          note:='最新押金收款：'||(op->>'customerName')||'；'||(op->'receipt'->>'paymentDate')||'本次收'||(part->>'amountXof')||'XOF；累计已收'||
            private.cimac_known_deposit_balance(c.id)||'XOF；应押'||c.deposit_amount_xof||'XOF；尚需补'||greatest(0,c.deposit_amount_xof-private.cimac_known_deposit_balance(c.id))||'XOF；'||(op->>'annotation');
        else
          note:='最新年度物业已结清：'||(op->>'customerName')||'；覆盖'||(op->'servicePeriod'->>'start')||'至'||(op->'servicePeriod'->>'end')||'；'||
            (op->'receipt'->>'paymentDate')||'已收'||(part->>'amountXof')||'XOF；已批准优惠'||coalesce(part->>'discountXof','0')||'XOF；标准900XOF/㎡/月；'||(op->>'annotation');
        end if;
        update public.lease_contracts set source_reference=concat_ws(E'\n',source_reference,note),updated_at=clock_timestamp() where id=c.id;
        update public.units set notes=note||E'\n【历史备注】'||coalesce(notes,''),updated_at=clock_timestamp() where id=c.unit_id;
      end loop;
    elsif op->>'type'='new_deposit' then
      customer:=private.cimac_child_uuid(batch,idx||':customer');
      insert into public.customers(id,name,notes) values(customer,op->>'customerName','CIMAC真实预留；未签约/未起租；'||(op->>'annotation'));
      for part in select value from jsonb_array_elements(op->'units') loop
        part_idx:=part_idx+1;
        select us.* into strict u from public.units us join public.buildings b on b.id=us.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC' and us.unit_no=part->>'unitNo';
        contract:=private.cimac_child_uuid(batch,idx||':'||part_idx||':contract');
        note:='最新预留：'||(op->>'customerName')||'；月租'||(part->>'monthlyRentXof')||'XOF；应押'||(part->>'depositXof')||'XOF；实际收押'||(part->>'amountXof')||'XOF；未签约/未起租；租金2028-04-01起计；2027-04-01至2028-03-31免租；物业900XOF/㎡/月；'||(op->>'annotation');
        insert into public.lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,deposit_months,status,commencement_state,signing_state,expected_end_confirmed,source_reference,free_months,agreement_group_no)
          values(contract,u.id,customer,'CIMAC-FIN-'||batch||'-'||idx||'-'||part_idx,'annual',5,(part->>'monthlyRentXof')::numeric,(part->>'depositXof')::numeric,3,'draft','pending_project_opening','pending_confirmation',false,note,12,'CIMAC-FIN-'||batch||'-'||idx);
        update public.units set status='reserved',reservation_holder_name=op->>'customerName',notes=note||E'\n【历史备注】'||coalesce(notes,''),updated_at=clock_timestamp() where id=u.id;
        -- Reuse the unit's unique rule row. The complete previous rule remains
        -- in before/audit and documentary history; never delete old receipts.
        insert into public.property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,is_active,notes)
          values(u.id,u.area_sqm*900,'2027-04-01','2028-03-31',true,'CIMAC最新预留物业政策；批次'||batch)
          on conflict(unit_id) do update set monthly_amount_xof=excluded.monthly_amount_xof,start_date=excluded.start_date,end_date=excluded.end_date,
            is_active=true,notes=concat_ws(E'\n',excluded.notes,'【历史规则】'||to_jsonb(property_fee_rules)::text);
        pay:=private.cimac_finance_post(batch,idx||':'||part_idx,contract,'lease_deposit',part,op->'receipt');
        update public.lease_contracts set deposit_received=private.cimac_known_deposit_balance(id)>=deposit_amount_xof,updated_at=clock_timestamp() where id=contract;
        op_pays:=array_append(op_pays,pay); op_units:=array_append(op_units,u.id); op_contracts:=array_append(op_contracts,contract);
      end loop;
    elsif op->>'type'='reclassify' then
      select * into strict p from public.payments where id=(op->>'paymentId')::uuid;
      select * into strict l from public.ledger_entries where payment_id=p.id;
      customer:=p.customer_id; old_payment:=to_jsonb(p); old_ledger:=to_jsonb(l);
      expected:=old_payment||jsonb_build_object('source_type',op->>'targetSourceType');
      insert into private.cimac_finance_row_authorizations values(batch,'payment',p.id,old_payment,expected);
      update public.payments set source_type=op->>'targetSourceType' where id=p.id;
      note:='CIMAC整笔原收款分类纠正；'||(op->>'expectedSourceType')||'→'||(op->>'targetSourceType')||'；原金额/日期/汇率/编号保留；批次'||batch||'；'||(op->>'annotation');
      expected:=old_ledger||jsonb_build_object('direction',case when op->>'targetSourceType'='lease_deposit' then 'liability_in' else 'income' end,'category',op->>'targetSourceType','description',note);
      insert into private.cimac_finance_row_authorizations values(batch,'ledger',l.id,old_ledger,expected);
      update public.ledger_entries set direction=expected->>'direction',category=expected->>'category',description=expected->>'description' where id=l.id;
      update public.lease_contracts set deposit_received=private.cimac_known_deposit_balance(id)>=deposit_amount_xof,source_reference=concat_ws(E'\n',source_reference,note),updated_at=clock_timestamp() where id=p.source_id;
      update public.units set notes=note||E'\n【历史备注】'||coalesce(notes,''),updated_at=clock_timestamp() where id=p.unit_id;
      reclasses:=reclasses||jsonb_build_array(jsonb_build_object('paymentBefore',old_payment,'paymentAfter',(select to_jsonb(z) from public.payments z where id=p.id),
        'ledgerBefore',old_ledger,'ledgerAfter',(select to_jsonb(z) from public.ledger_entries z where id=l.id)));
      op_units:=array[p.unit_id]; op_contracts:=array[p.source_id];
    else
      customer:=(op->>'customerId')::uuid;
      management:=case when op?'managementNames' then (select string_agg(value#>>'{}',' / ' order by ord) from jsonb_array_elements(op->'managementNames') with ordinality x(value,ord)) else null end;
      note:=concat_ws('；','最新客户标识核对',case when management is not null then '同一商铺不同管理人：'||management end,op->>'annotation','批次'||batch);
      for part in select value from jsonb_array_elements(op->'units') loop
        select us.* into strict u from public.units us join public.buildings b on b.id=us.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC' and us.unit_no=part->>'unitNo';
        select * into strict c from public.lease_contracts where unit_id=u.id and customer_id=customer and status='draft';
        update public.units set reservation_holder_name=case when op?'holderName' then op->>'holderName' else reservation_holder_name end,
          notes=note||E'\n【历史备注】'||coalesce(notes,''),updated_at=clock_timestamp() where id=u.id;
        update public.lease_contracts set source_reference=concat_ws(E'\n',source_reference,note),updated_at=clock_timestamp() where id=c.id;
        op_units:=array_append(op_units,u.id); op_contracts:=array_append(op_contracts,c.id);
      end loop;
    end if;
    pays:=pays||op_pays; all_contracts:=all_contracts||op_contracts;
    operations:=operations||jsonb_build_array(jsonb_build_object('index',idx-1,'type',op->>'type','customerId',customer,'unitIds',to_jsonb(op_units),'contractIds',to_jsonb(op_contracts),
      'paymentIds',case when op->>'type'='reclassify' then jsonb_build_array(p.id) else to_jsonb(op_pays) end,
      'ledgerIds',case when op->>'type'='reclassify' then jsonb_build_array(l.id) else coalesce((select jsonb_agg(id order by id) from public.ledger_entries where payment_id=any(op_pays)),'[]') end,
      'receivableIds',case when op->>'type'='collect' and op->>'category'='property_fee' then coalesce((select jsonb_agg(entity_id order by entity_id) from private.cimac_finance_row_authorizations where request_id=batch and entity='receivable' and after_data->>'source_id'=any(select x::text from unnest(op_contracts) x)),'[]') else '[]'::jsonb end));
  end loop;
  after_doc:=private.cimac_finance_state();
  -- Prove preservation, not merely expected new row counts. Every old row is
  -- unchanged except exact audited classification/contract/unit operations.
  foreach key in array array['payments','ledger','receivables','allocations','nativeAllocations'] loop
    for old_row in select value from jsonb_array_elements(before_doc->key) loop
      select value into new_row from jsonb_array_elements(after_doc->key) where
        case when key in ('allocations','nativeAllocations') then value->>'payment_id'=old_row->>'payment_id' and value->>'receivable_id'=old_row->>'receivable_id' else value->>'id'=old_row->>'id' end;
      if new_row is distinct from old_row then
        if key not in ('payments','ledger') or not exists(select 1 from private.cimac_finance_row_authorizations a where a.request_id=batch
          and a.entity=case when key='payments' then 'payment' else 'ledger' end and a.before_data=old_row and a.after_data=new_row) then raise exception 'cimacFinanceVerificationFailed'; end if;
      end if;
    end loop;
  end loop;
  for old_row in select value from jsonb_array_elements(before_doc->'units') where value->>'unit_no'='231' or value->>'asset_subtype'<>'commercial_shop' loop
    if not(after_doc->'units' @> jsonb_build_array(old_row)) then raise exception 'cimacFinanceExclusionChanged'; end if;
  end loop;
  if (select count(*) from public.payments where id=any(pays))<>cardinality(pays)
    or (select count(*) from public.ledger_entries where payment_id=any(pays))<>cardinality(pays)
    or jsonb_array_length(after_doc->'payments')-jsonb_array_length(before_doc->'payments')<>cardinality(pays)
    or jsonb_array_length(after_doc->'ledger')-jsonb_array_length(before_doc->'ledger')<>cardinality(pays) then raise exception 'cimacFinanceVerificationFailed'; end if;
  for contract in select distinct x from unnest(all_contracts) x loop perform private.cimac_finance_history(contract); end loop;
  insert into public.audit_logs(id,actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(audit,auth.uid(),public.current_user_role(),'cimac_finance','cimac_finance',batch,before_doc,after_doc,
      jsonb_build_object('request_id',batch,'channel','external_codex','authorization','explicit_instruction','request',r,'physical_receipt_operations',
        (select count(*) from jsonb_array_elements(r->'operations') o where o->>'type' in ('collect','new_deposit'))));
  proof:=jsonb_build_object('version',1,'actorId',auth.uid(),'checks',jsonb_build_object('scope',true,'payments',true,'ledger',true,'receivables',true,'contracts',true,'units',true,'cashFactsPreserved',true,'audit',true,'exclusions',true),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by id) from public.payments p where id=any(pays)),'[]'),
    'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by id) from public.ledger_entries l where payment_id=any(pays)),'[]'),
    'receivables',coalesce((select jsonb_agg(to_jsonb(rr) order by rr.id) from public.receivables rr join private.cimac_finance_row_authorizations a on a.entity='receivable' and a.entity_id=rr.id and a.request_id=batch),'[]'),
    'allocations',coalesce((select jsonb_agg(to_jsonb(a) order by payment_id,receivable_id) from public.payment_receivable_allocations a where payment_id=any(pays)),'[]'),
    'contracts',coalesce((select jsonb_agg(to_jsonb(c) order by id) from public.lease_contracts c where id=any(all_contracts)),'[]'),
    'customers',coalesce((select jsonb_agg(to_jsonb(c) order by id) from public.customers c where id in(select customer_id from public.lease_contracts where id=any(all_contracts))),'[]'),
    'units',coalesce((select jsonb_agg(to_jsonb(u) order by id) from public.units u where id in(select unit_id from public.lease_contracts where id=any(all_contracts))),'[]'),
    'depositPayments',coalesce((select jsonb_agg(to_jsonb(p) order by id) from public.payments p where source_id=any(all_contracts) and source_type in ('lease_deposit','lease_deposit_refund','lease_deposit_deduction')),'[]'),
    'depositLedger',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.ledger_entries l join public.payments p on p.id=l.payment_id where p.source_id=any(all_contracts) and p.source_type in ('lease_deposit','lease_deposit_refund','lease_deposit_deduction')),'[]'),
    'reclassifications',reclasses,'audit',jsonb_build_object('id',audit,'actorId',auth.uid(),'requestId',batch,'channel','external_codex','authorization','explicit_instruction'));
  result_doc:=jsonb_build_object('status','completed','verified',true,'requestId',batch,'actorId',auth.uid(),'request',r,'operationCount',jsonb_array_length(r->'operations'),
    'auditId',audit,'paymentIds',to_jsonb(pays),'operationResults',operations,'verification',proof,'idempotent',false);
  update private.cimac_finance_requests set after_state=after_doc,result=result_doc,status='completed' where request_id=batch;
  return result_doc;
end; $$;

create function private.find_cimac_finance(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare saved private.cimac_finance_requests%rowtype;
begin
  if not coalesce(public.can_execute_cimac_finance(),false) then raise exception 'cimacFinanceForbidden' using errcode='42501'; end if;
  select * into saved from private.cimac_finance_requests where request_id=p_request_id;
  if not found then return jsonb_build_object('status','not_found','requestId',p_request_id,'verified',false); end if;
  if saved.actor_id<>auth.uid() then raise exception 'cimacFinanceForbidden' using errcode='42501'; end if;
  return saved.result||jsonb_build_object('status','completed_previously','verified',false,'idempotent',true);
end; $$;
create function public.preview_cimac_finance(p_request jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.preview_cimac_finance($1); $$;
create function public.execute_cimac_finance(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text) returns jsonb language sql security invoker set search_path='' as $$ select private.execute_cimac_finance($1,$2,$3,$4); $$;
create function public.find_cimac_finance(p_request_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.find_cimac_finance($1); $$;

-- Grant only named entry points and their private implementation to normal
-- authenticated callers; every implementation independently rechecks scope.
do $acl$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and (p.proname like 'cimac_finance_%' or p.proname in ('guard_cimac_finance_rows','guard_cimac_finance_request_namespace','preview_cimac_finance','execute_cimac_finance','find_cimac_finance')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end; $acl$;
revoke all on function public.cimac_finance_protocol_version(),public.can_execute_cimac_finance(),public.preview_cimac_finance(jsonb),public.execute_cimac_finance(jsonb,jsonb,timestamptz,text),public.find_cimac_finance(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cimac_finance_protocol_version(),public.can_execute_cimac_finance(),public.preview_cimac_finance(jsonb),public.execute_cimac_finance(jsonb,jsonb,timestamptz,text),public.find_cimac_finance(uuid),
  private.preview_cimac_finance(jsonb),private.execute_cimac_finance(jsonb,jsonb,timestamptz,text),private.find_cimac_finance(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
