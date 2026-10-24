begin;

-- Deliberately separate from active-lease lifecycle and ordinary cash entry.
-- This is an authenticated, admin-only, preview-bound pre-opening maintenance
-- transaction. It never signs/starts a lease or invents an FX rate or receivable.
create table private.cimac_maintenance_requests (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  request_data jsonb not null,
  before_state jsonb not null,
  after_state jsonb,
  result jsonb,
  deployment text not null,
  status text not null check (status in ('executing','completed')),
  created_at timestamptz not null default clock_timestamp()
);
create index cimac_maintenance_actor_idx on private.cimac_maintenance_requests(actor_id,created_at desc);
alter table private.cimac_maintenance_requests enable row level security;
revoke all on private.cimac_maintenance_requests from public,anon,authenticated,service_role;

create table private.cimac_maintenance_payment_authorizations (
  payment_id uuid primary key,
  request_id uuid not null references private.cimac_maintenance_requests(request_id),
  payment_data jsonb not null,
  original_payment_ids uuid[] not null default '{}'
);
alter table private.cimac_maintenance_payment_authorizations enable row level security;
revoke all on private.cimac_maintenance_payment_authorizations from public,anon,authenticated,service_role;

create function public.cimac_maintenance_protocol_version() returns integer
language sql immutable security invoker set search_path='' as $$ select 1; $$;
create function public.can_execute_cimac_maintenance() returns boolean
language sql stable security invoker set search_path='' as $$
  select auth.uid() is not null and coalesce(auth.jwt()->>'role','')='authenticated'
    and coalesce(public.has_app_role('admin'),false)
    and exists(select 1 from public.projects p where p.code='CIMAC' and public.can_access_project(p.id));
$$;

create function private.cimac_keys(p jsonb, allowed text[], required text[]) returns void
language plpgsql immutable security invoker set search_path='' as $$
begin
  if jsonb_typeof(p) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p) k where not(k=any(allowed)))
    or exists(select 1 from unnest(required) k where not(p?k) or p->k='null'::jsonb)
  then raise exception 'cimacMaintenanceInvalidRequest'; end if;
end; $$;
create function private.cimac_text(p jsonb,k text,max_length integer) returns text
language plpgsql immutable security invoker set search_path='' as $$
begin
  if jsonb_typeof(p->k) is distinct from 'string' or length(btrim(p->>k)) not between 1 and max_length
    or p->>k<>btrim(p->>k) then raise exception 'cimacMaintenanceInvalidRequest'; end if;
  return p->>k;
end; $$;
create function private.cimac_money(p jsonb,k text,integral boolean default true) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare v text;
begin
  v:=private.cimac_text(p,k,15);
  if v !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$' or v::numeric<=0
    or v::numeric>999999999999.99 or (integral and v::numeric<>trunc(v::numeric)) then
    raise exception 'cimacMaintenanceInvalidRequest'; end if;
  return v::numeric;
end; $$;
create function private.cimac_uuids(p jsonb,k text,allow_empty boolean default false) returns uuid[]
language plpgsql immutable security invoker set search_path='' as $$
declare a uuid[]:='{}'; v jsonb; id uuid;
begin
  if jsonb_typeof(p->k) is distinct from 'array' or jsonb_array_length(p->k)>30
    or (not allow_empty and jsonb_array_length(p->k)=0) then raise exception 'cimacMaintenanceInvalidRequest'; end if;
  for v in select value from jsonb_array_elements(p->k) loop
    if jsonb_typeof(v) is distinct from 'string'
      or (v#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'cimacMaintenanceInvalidRequest'; end if;
    id:=(v#>>'{}')::uuid;
    if id=any(a) then raise exception 'cimacMaintenanceInvalidRequest'; end if;
    a:=array_append(a,id);
  end loop;
  return a;
end; $$;
create function private.cimac_date(p jsonb,k text) returns date
language plpgsql immutable security invoker set search_path='' as $$
declare v text; d date;
begin
  v:=private.cimac_text(p,k,10);
  if v !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'cimacMaintenanceInvalidRequest'; end if;
  begin d:=v::date; exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'cimacMaintenanceInvalidRequest'; end;
  if to_char(d,'YYYY-MM-DD')<>v then raise exception 'cimacMaintenanceInvalidRequest'; end if;
  return d;
end; $$;
create function private.cimac_payment_input(p jsonb,kind text) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare keys text[]:=array['amount','currency','paymentDate','paymentMethod'];
begin
  if kind='note' then keys:=keys||array['contractId','noteMarker']; end if;
  if kind='refund' then keys:=keys||array['originalPaymentIds']; end if;
  perform private.cimac_keys(p,keys,keys);
  if p->>'currency' is distinct from (case when kind='receipt' then 'XOF' else 'CNY' end)
    or p->>'paymentMethod' is distinct from (case when kind='receipt' then 'cash' else 'bank_transfer' end) then
    raise exception 'cimacMaintenanceInvalidRequest'; end if;
  perform private.cimac_money(p,'amount',kind='receipt');
  perform private.cimac_date(p,'paymentDate');
  if kind='refund' then perform private.cimac_uuids(p,'originalPaymentIds',true); end if;
  if kind='note' then
    perform private.cimac_uuids(jsonb_build_object('ids',jsonb_build_array(p->>'contractId')),'ids');
    perform private.cimac_text(p,'noteMarker',1000);
  end if;
end; $$;

create function private.cimac_maintenance_request(p jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare op jsonb; keys text[]; required text[]; t text; a uuid[]; v jsonb; seen text[]:='{}'; n text;
begin
  if p is null or octet_length(p::text)>131072 then raise exception 'cimacMaintenanceInvalidRequest'; end if;
  perform private.cimac_keys(p,array['protocolVersion','connectorVersion','requestId','originalInstruction','inputSource','operations'],
    array['protocolVersion','connectorVersion','requestId','originalInstruction','inputSource','operations']);
  if p->>'protocolVersion' is distinct from '1.0' or p->>'connectorVersion' is distinct from '0.8.0'
    or coalesce(p->>'inputSource','') not in ('natural_language','excel_screenshot') then raise exception 'cimacMaintenanceInvalidRequest'; end if;
  perform private.cimac_text(p,'originalInstruction',4000);
  perform private.cimac_uuids(jsonb_build_object('ids',jsonb_build_array(p->>'requestId')),'ids');
  if jsonb_typeof(p->'operations') is distinct from 'array' or jsonb_array_length(p->'operations') not between 1 and 30 then
    raise exception 'cimacMaintenanceInvalidRequest'; end if;
  for op in select value from jsonb_array_elements(p->'operations') loop
    t:=op->>'type'; keys:=array['type','customerName','annotation'];
    case t
      when 'terms' then keys:=keys||array['contractIds','monthlyRentXof','depositXof','freeMonths','rentFreeStart','rentFreeEnd','propertyRateXofPerSqm'];
      when 'close' then keys:=keys||array['contractIds','refund','noteReceipt','correctedCustomerName'];
      when 'replace' then keys:=keys||array['contractIds','refund','newCustomerName','monthlyRentXof','depositXof','receipt'];
      when 'reserve' then keys:=keys||array['unitNos','groupMonthlyRentXof','groupDepositXof'];
      when 'area' then keys:=keys||array['unitNo','areaSqm','propertyRateXofPerSqm'];
      when 'create_reservation' then keys:=keys||array['buildingCode','unitNo','areaSqm','monthlyRentXof','depositXof','propertyRateXofPerSqm'];
      when 'note_receipt' then keys:=keys||array['contractIds','receipt'];
      else raise exception 'cimacMaintenanceInvalidRequest';
    end case;
    required:=array(select unnest(keys) except select unnest(case when t='close' then array['noteReceipt','correctedCustomerName'] else '{}'::text[] end));
    perform private.cimac_keys(op,keys,required);
    perform private.cimac_text(op,'customerName',200); perform private.cimac_text(op,'annotation',2000);
    if op?'contractIds' then
      a:=private.cimac_uuids(op,'contractIds');
      if t in ('replace','note_receipt') and cardinality(a)<>1 then raise exception 'cimacMaintenanceInvalidRequest'; end if;
      foreach n in array a::text[] loop
        if ('contract:'||n)=any(seen) then raise exception 'cimacMaintenanceDuplicateTarget'; end if;
        seen:=array_append(seen,'contract:'||n);
      end loop;
    end if;
    if op?'monthlyRentXof' then perform private.cimac_money(op,'monthlyRentXof'); perform private.cimac_money(op,'depositXof');
      if (op->>'depositXof')::numeric<>3*(op->>'monthlyRentXof')::numeric then raise exception 'cimacMaintenanceInvalidRequest'; end if;
    end if;
    if op?'propertyRateXofPerSqm' and private.cimac_money(op,'propertyRateXofPerSqm')<>900 then raise exception 'cimacMaintenanceInvalidRequest'; end if;
    if op?'areaSqm' and private.cimac_money(op,'areaSqm',false)>99999999.99 then raise exception 'cimacMaintenanceInvalidRequest'; end if;
    if op?'correctedCustomerName' then perform private.cimac_text(op,'correctedCustomerName',200); end if;
    if op?'newCustomerName' then perform private.cimac_text(op,'newCustomerName',200); end if;
    if t='terms' then
      if jsonb_typeof(op->'freeMonths') is distinct from 'number' or op->>'freeMonths' !~ '^[0-9]{1,2}$'
        or (op->>'freeMonths')::integer not between 0 and 24 then raise exception 'cimacMaintenanceInvalidRequest'; end if;
      if private.cimac_date(op,'rentFreeStart')<>'2027-04-01'::date or private.cimac_date(op,'rentFreeEnd')<>'2028-03-31'::date
        or (op->>'freeMonths')::integer<>12 then raise exception 'cimacMaintenanceInvalidRequest'; end if;
    elsif t='reserve' then
      if jsonb_typeof(op->'unitNos') is distinct from 'array' or jsonb_array_length(op->'unitNos') not between 1 and 30 then raise exception 'cimacMaintenanceInvalidRequest'; end if;
      for v in select value from jsonb_array_elements(op->'unitNos') loop
        n:=private.cimac_text(jsonb_build_object('n',v),'n',20);
        if n !~ '^[0-9]{3,4}$' or ('unit:'||n)=any(seen) then raise exception 'cimacMaintenanceDuplicateTarget'; end if;
        seen:=array_append(seen,'unit:'||n);
      end loop;
      perform private.cimac_money(op,'groupMonthlyRentXof'); perform private.cimac_money(op,'groupDepositXof');
      if (op->>'groupDepositXof')::numeric<>3*(op->>'groupMonthlyRentXof')::numeric then raise exception 'cimacMaintenanceInvalidRequest'; end if;
    end if;
    if op?'unitNo' then
      n:=private.cimac_text(op,'unitNo',20);
      if n !~ '^[0-9]{3,4}$' or ('unit:'||n)=any(seen) then raise exception 'cimacMaintenanceDuplicateTarget'; end if;
      seen:=array_append(seen,'unit:'||n);
    end if;
    if t='create_reservation' then perform private.cimac_text(op,'buildingCode',80); end if;
    if op?'refund' then perform private.cimac_payment_input(op->'refund','refund'); end if;
    if op?'noteReceipt' then perform private.cimac_payment_input(op->'noteReceipt','note'); end if;
    if op?'receipt' then perform private.cimac_payment_input(op->'receipt',case when t='note_receipt' then 'note' else 'receipt' end); end if;
  end loop;
  return p;
end; $$;

create function private.cimac_scope_state() returns jsonb
language sql stable security definer set search_path='' as $$
  with bs as (select b.* from public.buildings b join public.projects p on p.id=b.project_id where p.code='CIMAC'),
    us as (select u.* from public.units u join bs b on b.id=u.building_id),
    cs as (select c.* from public.lease_contracts c join us u on u.id=c.unit_id),
    ps as (select p.* from public.payments p join us u on u.id=p.unit_id)
  select jsonb_build_object(
    'buildings',coalesce((select jsonb_agg(to_jsonb(b) order by id) from bs b),'[]'),
    'units',coalesce((select jsonb_agg(to_jsonb(u) order by id) from us u),'[]'),
    'contracts',coalesce((select jsonb_agg(to_jsonb(c) order by id) from cs c),'[]'),
    'customers',coalesce((select jsonb_agg(to_jsonb(c) order by id) from public.customers c where c.id in (select customer_id from cs)),'[]'),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by id) from ps p),'[]'),
    'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by id) from public.ledger_entries l where l.unit_id in(select id from us)),'[]'),
    'receivables',coalesce((select jsonb_agg(to_jsonb(r) order by id) from public.receivables r where r.unit_id in(select id from us)),'[]'),
    'fees',coalesce((select jsonb_agg(to_jsonb(f) order by id) from public.property_fee_rules f where f.unit_id in(select id from us)),'[]'));
$$;
create function private.cimac_child_uuid(request uuid,part text) returns uuid
language sql immutable security invoker set search_path='' as $$
  select (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
  from (select md5(request::text||':'||part) h) x;
$$;

-- A CNY note-only deposit can be posted without inventing its XOF valuation.
-- The private exact-row authorization prevents legacy Data API grants from
-- making this exception a general-purpose native-money bypass.
alter table public.payments drop constraint payment_native_settlement_check;
alter table public.payments add constraint payment_native_settlement_check check (
  (native_settlement and currency in ('USD','CNY') and
    (source_type='lease_rent' or (currency='CNY' and source_type in ('lease_deposit','lease_deposit_refund') and request_kind='cimac_maintenance'))
    and amount>0 and amount::text not in ('NaN','Infinity','-Infinity') and exchange_rate_to_xof is null)
  or (not native_settlement and exchange_rate_to_xof is not null));
create function private.guard_cimac_maintenance_payment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op in ('UPDATE','DELETE') and (old.request_kind='cimac_maintenance'
    or (old.native_settlement and old.source_type in ('lease_deposit','lease_deposit_refund'))
    or exists(select 1 from private.cimac_maintenance_payment_authorizations a where a.payment_id=old.id)) then
    raise exception 'cimacMaintenancePaymentImmutable' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if;
  -- Share the same global UUID lock as audited writers, including legacy raw
  -- table inserts. An uncommitted maintenance journal must not be raced by a
  -- different writer before its parent UUID reservation becomes visible.
  if new.request_id is not null then perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,0)); end if;
  if exists(select 1 from private.cimac_maintenance_requests r where r.request_id=new.request_id) then
    raise exception 'cimacMaintenanceRequestIdConflict'; end if;
  if new.request_kind='cimac_maintenance' or (new.native_settlement and new.source_type in ('lease_deposit','lease_deposit_refund')) then
    if tg_op<>'INSERT' or auth.uid() is null or not exists(
      select 1 from private.cimac_maintenance_payment_authorizations a
      join private.cimac_maintenance_requests r on r.request_id=a.request_id
      join public.lease_contracts c on c.id=new.source_id
      join public.units u on u.id=c.unit_id join public.buildings b on b.id=u.building_id
      join public.projects p on p.id=b.project_id
      where a.payment_id=new.id and r.actor_id=auth.uid() and r.status='executing' and p.code='CIMAC'
        and c.status='draft' and c.commencement_state='pending_project_opening'
        and c.customer_id=new.customer_id and c.unit_id=new.unit_id
        and a.payment_data=jsonb_build_object('sourceId',new.source_id,'customerId',new.customer_id,'unitId',new.unit_id,
          'sourceType',new.source_type,'paymentDate',new.payment_date,'amount',new.amount,'currency',new.currency,
          'exchangeRate',new.exchange_rate_to_xof,'nativeSettlement',new.native_settlement,'requestId',new.request_id,'paymentMethod',new.payment_method)
    ) then raise exception 'cimacMaintenancePaymentNotAuthorized' using errcode='42501'; end if;
  end if;
  return new;
end; $$;
create trigger guard_cimac_maintenance_payment before insert or update or delete on public.payments
  for each row execute function private.guard_cimac_maintenance_payment();

create function private.guard_cimac_maintenance_ledger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op in ('UPDATE','DELETE') and exists(select 1 from private.cimac_maintenance_payment_authorizations a where a.payment_id=old.payment_id) then
    raise exception 'cimacMaintenanceLedgerImmutable' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if;
  if exists(select 1 from private.cimac_maintenance_payment_authorizations a where a.payment_id=new.payment_id) then
    if tg_op<>'INSERT' or auth.uid() is null or not exists(select 1 from public.payments p
      join private.cimac_maintenance_payment_authorizations a on a.payment_id=p.id
      join private.cimac_maintenance_requests r on r.request_id=a.request_id
      join public.units u on u.id=p.unit_id
      where p.id=new.payment_id and r.status='executing' and r.actor_id=auth.uid()
        and new.unit_id=p.unit_id and new.building_id=u.building_id and new.entry_date=p.payment_date
        and new.category='lease_deposit' and new.direction=(case when p.source_type='lease_deposit' then 'liability_in' else 'liability_out' end)
        and new.amount_xof=(case when p.native_settlement then 0 else round(p.amount*p.exchange_rate_to_xof,2) end)
        and ((p.native_settlement and new.currency=p.currency and new.amount_native=p.amount and new.amount_cny is null)
          or (not p.native_settlement and new.currency='XOF' and new.amount_native is null
            and new.amount_cny is not distinct from (case when p.currency='CNY' then p.amount else null end)))
    ) or exists(select 1 from public.ledger_entries l where l.payment_id=new.payment_id) then
      raise exception 'cimacMaintenanceLedgerNotAuthorized' using errcode='42501'; end if;
  end if;
  return new;
end; $$;
create trigger guard_cimac_maintenance_ledger before insert or update or delete on public.ledger_entries
  for each row execute function private.guard_cimac_maintenance_ledger();

create function private.cimac_post_payment(batch uuid,part text,contract uuid,kind text,p jsonb,fx numeric,original_ids uuid[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.lease_contracts%rowtype; u public.units%rowtype; pid uuid:=private.cimac_child_uuid(batch,part||':payment');
  rid uuid:=private.cimac_child_uuid(batch,part||':request'); native boolean:=fx is null; val numeric:=(p->>'amount')::numeric;
begin
  select * into strict c from public.lease_contracts where id=contract;
  select * into strict u from public.units where id=c.unit_id;
  if exists(select 1 from public.payments where request_id in (batch,rid) or id=pid) then raise exception 'cimacMaintenanceRequestIdConflict'; end if;
  insert into private.cimac_maintenance_payment_authorizations(payment_id,request_id,payment_data,original_payment_ids)
  values(pid,batch,jsonb_build_object('sourceId',c.id,'customerId',c.customer_id,'unitId',u.id,'sourceType',kind,
    'paymentDate',(p->>'paymentDate')::date,'amount',val,'currency',p->>'currency','exchangeRate',fx,
    'nativeSettlement',native,'requestId',rid,'paymentMethod',p->>'paymentMethod'),original_ids);
  insert into public.payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,
    native_settlement,payment_method,request_id,request_kind,notes)
  values(pid,c.customer_id,u.id,kind,c.id,(p->>'paymentDate')::date,val,(p->>'currency')::public.currency_code,fx,native,
    p->>'paymentMethod',rid,'cimac_maintenance','CIMAC受控核对；批次'||batch||'；原币登记；'||coalesce(p->>'noteMarker','已确认真实收退款'));
  insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,amount_cny,currency,amount_native,description)
  values(u.building_id,u.id,pid,(p->>'paymentDate')::date,case when kind='lease_deposit' then 'liability_in' else 'liability_out' end,
    'lease_deposit',case when native then 0 else round(val*fx,2) end,case when not native and p->>'currency'='CNY' then val else null end,
    case when native then (p->>'currency')::public.currency_code else 'XOF'::public.currency_code end,
    case when native then val else null end,'CIMAC受控押金核对；批次'||batch);
  return pid;
end; $$;

create function private.cimac_note_receipt(batch uuid,part text,op jsonb,note jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.lease_contracts%rowtype;
begin
  select * into strict c from public.lease_contracts where id=(note->>'contractId')::uuid;
  if not(c.id=any(private.cimac_uuids(op,'contractIds')))
    or position(note->>'noteMarker' in coalesce(c.source_reference,''))=0
    or position((note->>'paymentDate')||'已收部分押金人民币'||
      (case when (note->>'amount')::numeric=trunc((note->>'amount')::numeric) then trunc((note->>'amount')::numeric)::text
        else trim(trailing '0' from ((note->>'amount')::numeric)::text) end)||'元' in note->>'noteMarker')=0
    or not exists(select 1 from public.customers x where x.id=c.customer_id and x.name=op->>'customerName')
    or exists(select 1 from public.payments p where p.source_id in
      (select id from public.lease_contracts where customer_id=c.customer_id and coalesce(agreement_group_no,id::text)=coalesce(c.agreement_group_no,c.id::text))
      and p.source_type='lease_deposit') then raise exception 'cimacMaintenanceNoteReceiptConflict'; end if;
  return private.cimac_post_payment(batch,part,c.id,'lease_deposit',note,null);
end; $$;

create function private.cimac_refund(batch uuid,part text,op jsonb,note_payment uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare ids uuid[]:=private.cimac_uuids(op->'refund','originalPaymentIds',true); contracts uuid[]:=private.cimac_uuids(op,'contractIds');
  r jsonb:=op->'refund'; p public.payments%rowtype; total numeric:=0; fx numeric; native boolean; anchor uuid; first boolean:=true;
begin
  if note_payment is not null then
    if cardinality(ids)<>0 then raise exception 'cimacMaintenanceRefundConflict'; end if;
    ids:=array[note_payment];
  end if;
  if cardinality(ids)=0 then raise exception 'cimacMaintenanceRefundConflict'; end if;
  for p in select * from public.payments where id=any(ids) order by id loop
    if not(p.source_id=any(contracts)) or p.source_type<>'lease_deposit' or p.currency::text<>r->>'currency'
      or p.payment_date>(r->>'paymentDate')::date then raise exception 'cimacMaintenanceRefundConflict'; end if;
    if first then fx:=p.exchange_rate_to_xof; native:=p.native_settlement; anchor:=p.source_id; first:=false;
    elsif fx is distinct from p.exchange_rate_to_xof or native<>p.native_settlement then raise exception 'cimacMaintenanceRefundConflict'; end if;
    if (select count(*) from public.ledger_entries where payment_id=p.id)<>1 or not exists(
      select 1 from public.ledger_entries l where l.payment_id=p.id and l.unit_id=p.unit_id and l.entry_date=p.payment_date
        and l.direction='liability_in' and l.category='lease_deposit'
        and l.amount_xof=case when p.native_settlement then 0 else round(p.amount*p.exchange_rate_to_xof,2) end
        and ((p.native_settlement and l.currency=p.currency and l.amount_native=p.amount)
          or (not p.native_settlement and l.currency='XOF' and l.amount_native is null))) then
      raise exception 'cimacMaintenanceRefundLedgerConflict'; end if;
    total:=total+p.amount;
  end loop;
  if total<>(r->>'amount')::numeric or (select count(*) from public.payments where id=any(ids))<>cardinality(ids)
    or exists(select 1 from public.payments where source_id=any(contracts) and source_type in ('lease_deposit_refund','lease_deposit_deduction'))
    or exists(select 1 from public.payments where source_id=any(contracts) and source_type='lease_deposit' and not(id=any(ids)))
    or (select coalesce(sum(amount),0) from public.payments where source_id=any(contracts) and source_type='lease_deposit' and currency::text=r->>'currency')<>total then
    raise exception 'cimacMaintenanceRefundConflict'; end if;
  -- Reverse a previously valued receipt using its immutable historical FX.
  -- A note-only receipt instead produces a native CNY liability-out, not XOF.
  return private.cimac_post_payment(batch,part,anchor,'lease_deposit_refund',r,fx,ids);
end; $$;

create function private.cimac_validate_scope(p jsonb) returns void
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op jsonb; ids uuid[]; c record; u record; n text; expected integer; used_units uuid[]:='{}';
begin
  for op in select value from jsonb_array_elements(p->'operations') loop
    if op?'contractIds' then
      ids:=private.cimac_uuids(op,'contractIds'); expected:=0;
      for c in select lc.*,u.unit_no,u.status unit_status,u.asset_subtype,p.code project_code,x.name customer_name
        from public.lease_contracts lc join public.units u on u.id=lc.unit_id
        join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id
        join public.customers x on x.id=lc.customer_id where lc.id=any(ids) order by lc.id loop
        expected:=expected+1;
        if c.unit_id=any(used_units) then raise exception 'cimacMaintenanceDuplicateTarget'; end if;
        used_units:=array_append(used_units,c.unit_id);
        if c.project_code<>'CIMAC' or c.asset_subtype<>'commercial_shop' or c.unit_no='231'
          or c.customer_name<>op->>'customerName' or c.status<>'draft' or c.commencement_state<>'pending_project_opening'
          or c.start_date is not null or c.expected_end_date is not null or c.actual_end_date is not null
          or c.unit_status<>'reserved' or not public.can_access_unit(c.unit_id)
          or exists(select 1 from public.lease_contracts z where z.unit_id=c.unit_id and z.id<>c.id and z.status in ('draft','active'))
          or exists(select 1 from public.receivables r where r.unit_id=c.unit_id and r.status<>'cancelled') then
          raise exception 'cimacMaintenanceScopeConflict'; end if;
      end loop;
      if expected<>cardinality(ids) or (select count(distinct customer_id) from public.lease_contracts where id=any(ids))<>1 then
        raise exception 'cimacMaintenanceScopeConflict'; end if;
      -- Refund closure covers this CIMAC agreement, not the person's unrelated
      -- SACSI apartment. Global customer identity is changed only if this is
      -- the customer's complete contract history; otherwise rename needs review.
      if op->>'type' in ('close','replace') then
        if (select count(distinct coalesce(agreement_group_no,id::text)) from public.lease_contracts where id=any(ids))<>1
          or exists(select 1 from public.lease_contracts x join public.units xu on xu.id=x.unit_id
            join public.buildings xb on xb.id=xu.building_id join public.projects xp on xp.id=xb.project_id
            where xp.code='CIMAC' and x.customer_id=(select customer_id from public.lease_contracts where id=ids[1])
              and coalesce(x.agreement_group_no,x.id::text)=(select coalesce(agreement_group_no,id::text) from public.lease_contracts where id=ids[1])
              and x.status in ('draft','active') and not(x.id=any(ids)))
          or (op?'correctedCustomerName' and exists(select 1 from public.lease_contracts x
            where x.customer_id=(select customer_id from public.lease_contracts where id=ids[1]) and not(x.id=any(ids)))) then
          raise exception 'cimacMaintenanceScopeConflict'; end if;
      end if;
    else
      if op->>'type'='create_reservation' then
        if op->>'buildingCode'<>'CIMAC-B'||lpad(left(op->>'unitNo',length(op->>'unitNo')-2),2,'0')
          or not exists(select 1 from public.buildings b join public.projects p on p.id=b.project_id
          where p.code='CIMAC' and b.code=op->>'buildingCode' and b.is_active and public.can_access_project(p.id))
          or exists(select 1 from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id
            where p.code='CIMAC' and u.unit_no=op->>'unitNo') then raise exception 'cimacMaintenanceScopeConflict'; end if;
      else
        for n in select value#>>'{}' from jsonb_array_elements(case when op->>'type'='reserve' then op->'unitNos' else jsonb_build_array(op->>'unitNo') end) loop
          if n='231' or (select count(*) from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id
            where p.code='CIMAC' and u.unit_no=n)<>1 then raise exception 'cimacMaintenanceScopeConflict'; end if;
          select us.* into strict u from public.units us join public.buildings b on b.id=us.building_id join public.projects p on p.id=b.project_id
            where p.code='CIMAC' and us.unit_no=n;
          if u.id=any(used_units) then raise exception 'cimacMaintenanceDuplicateTarget'; end if;
          used_units:=array_append(used_units,u.id);
          if u.asset_subtype<>'commercial_shop' or u.status not in ('available','reserved') or not public.can_access_unit(u.id)
            or (u.reservation_holder_name is not null and u.reservation_holder_name<>op->>'customerName')
            or exists(select 1 from public.lease_contracts lc join public.customers x on x.id=lc.customer_id
              where lc.unit_id=u.id and lc.status in ('draft','active') and (lc.status<>'draft' or lc.commencement_state<>'pending_project_opening' or x.name<>op->>'customerName'))
            or exists(select 1 from public.receivables r where r.unit_id=u.id and r.status<>'cancelled') then raise exception 'cimacMaintenanceScopeConflict'; end if;
        end loop;
      end if;
    end if;
  end loop;
end; $$;

-- Pre-opening imports can have a stale false deposit_received flag. Reconcile
-- actual valued payment/ledger evidence, not that flag, and never value native
-- CNY merely to decide whether an XOF contractual deposit is fully funded.
create function private.cimac_known_deposit_balance(contract uuid) returns numeric
language plpgsql security definer set search_path='' as $$
declare available numeric; ledger_balance numeric;
begin
  if exists(select 1 from public.payments where source_id=contract and source_type in ('lease_deposit','lease_deposit_refund','lease_deposit_deduction')
    and (amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or (not native_settlement and
      (exchange_rate_to_xof is null or exchange_rate_to_xof<=0 or exchange_rate_to_xof::text in ('NaN','Infinity','-Infinity'))))) then
    raise exception 'cimacMaintenanceDepositEvidenceConflict'; end if;
  select coalesce(sum(case when source_type='lease_deposit' then round(amount*exchange_rate_to_xof,2)
    when source_type in ('lease_deposit_refund','lease_deposit_deduction') then -round(amount*exchange_rate_to_xof,2) else 0 end),0)
    into available from public.payments where source_id=contract and not native_settlement;
  select coalesce(sum(case when l.direction='liability_in' then l.amount_xof when l.direction='liability_out' then -l.amount_xof else 0 end),0)
    into ledger_balance from public.ledger_entries l join public.payments p on p.id=l.payment_id where p.source_id=contract and l.category='lease_deposit';
  if available<0 or available<>ledger_balance or exists(select 1 from public.ledger_entries where category='lease_deposit' and payment_id is null
    and unit_id=(select unit_id from public.lease_contracts where id=contract)) then raise exception 'cimacMaintenanceDepositEvidenceConflict'; end if;
  return available;
end; $$;

create function private.cimac_verify_operation(op jsonb,result_ids uuid[],unit_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare t text:=op->>'type'; original_ids uuid[]; count_units integer:=cardinality(unit_ids);
begin
  if t in ('terms','close','replace','note_receipt') then original_ids:=private.cimac_uuids(op,'contractIds'); end if;
  if (select count(*) from public.units where id=any(unit_ids))<>count_units
    or (select count(*) from public.lease_contracts where id=any(result_ids))<>cardinality(result_ids) then
    raise exception 'cimacMaintenanceVerificationFailed'; end if;
  if t='terms' then
    if exists(select 1 from public.lease_contracts where id=any(original_ids) and (monthly_rent_xof<>(op->>'monthlyRentXof')::numeric
      or deposit_amount_xof<>(op->>'depositXof')::numeric or free_months<>(op->>'freeMonths')::integer
      or deposit_received is distinct from (private.cimac_known_deposit_balance(id)>=(op->>'depositXof')::numeric)
      or status<>'draft' or start_date is not null or expected_end_date is not null))
      or (select count(*) from public.property_fee_rules f join public.units u on u.id=f.unit_id
        where u.id=any(unit_ids) and f.is_active and f.start_date='2027-04-01' and f.end_date='2028-03-31'
          and f.monthly_amount_xof=u.area_sqm*900)<>count_units then raise exception 'cimacMaintenanceVerificationFailed'; end if;
  elsif t in ('close','replace') then
    if exists(select 1 from public.lease_contracts where id=any(original_ids) and (status<>'terminated'
      or commencement_state<>'cancelled_before_start' or start_date is not null or expected_end_date is not null or actual_end_date is not null)) then
      raise exception 'cimacMaintenanceVerificationFailed'; end if;
    if t='close' then
      if exists(select 1 from public.units where id=any(unit_ids) and (status<>'available' or reservation_holder_name is not null))
        or exists(select 1 from public.property_fee_rules where unit_id=any(unit_ids) and is_active) then raise exception 'cimacMaintenanceVerificationFailed'; end if;
      if op?'correctedCustomerName' and not exists(select 1 from public.customers x join public.lease_contracts c on c.customer_id=x.id
        where c.id=original_ids[1] and x.name=op->>'correctedCustomerName') then raise exception 'cimacMaintenanceVerificationFailed'; end if;
    else
      if not exists(select 1 from public.lease_contracts c join public.customers x on x.id=c.customer_id
        join public.units u on u.id=c.unit_id where c.id=result_ids[2] and x.name=op->>'newCustomerName'
          and c.customer_id<>(select customer_id from public.lease_contracts where id=original_ids[1])
          and c.status='draft' and c.commencement_state='pending_project_opening' and c.start_date is null
          and c.expected_end_date is null and c.signing_state='pending_confirmation' and c.deposit_received
          and c.monthly_rent_xof=(op->>'monthlyRentXof')::numeric and c.deposit_amount_xof=(op->>'depositXof')::numeric
          and u.status='reserved' and u.reservation_holder_name=x.name) then raise exception 'cimacMaintenanceVerificationFailed'; end if;
    end if;
  elsif t='reserve' then
    if exists(select 1 from public.units where id=any(unit_ids) and (status<>'reserved' or reservation_holder_name<>op->>'customerName'
      or position(op->>'groupMonthlyRentXof' in coalesce(notes,''))=0 or position(op->>'groupDepositXof' in coalesce(notes,''))=0)) then
      raise exception 'cimacMaintenanceVerificationFailed'; end if;
    if (select count(*) from public.property_fee_rules f join public.units u on u.id=f.unit_id where u.id=any(unit_ids)
      and f.is_active and f.start_date='2027-04-01' and f.end_date='2028-03-31' and f.monthly_amount_xof=u.area_sqm*900)<>count_units then
      raise exception 'cimacMaintenanceVerificationFailed'; end if;
  elsif t in ('area','create_reservation') then
    if cardinality(result_ids)<>1 or exists(select 1 from public.units where id=any(unit_ids) and area_sqm<>(op->>'areaSqm')::numeric)
      or not exists(select 1 from public.property_fee_rules where unit_id=unit_ids[1] and is_active and start_date='2027-04-01'
        and end_date='2028-03-31' and monthly_amount_xof=(op->>'areaSqm')::numeric*900) then raise exception 'cimacMaintenanceVerificationFailed'; end if;
    if t='create_reservation' and not exists(select 1 from public.lease_contracts c join public.customers x on x.id=c.customer_id
      join public.units u on u.id=c.unit_id where c.id=result_ids[1] and c.unit_id=unit_ids[1] and x.name=op->>'customerName'
        and c.status='draft' and c.commencement_state='pending_project_opening' and c.signing_state='pending_confirmation'
        and c.start_date is null and c.expected_end_date is null and not c.deposit_received
        and c.monthly_rent_xof=(op->>'monthlyRentXof')::numeric and c.deposit_amount_xof=(op->>'depositXof')::numeric
        and u.status='reserved' and u.reservation_holder_name=x.name and u.area_sqm=(op->>'areaSqm')::numeric) then raise exception 'cimacMaintenanceVerificationFailed'; end if;
  elsif t='note_receipt' then
    if not exists(select 1 from public.lease_contracts where id=original_ids[1] and status='draft'
      and commencement_state='pending_project_opening' and start_date is null and expected_end_date is null) then raise exception 'cimacMaintenanceVerificationFailed'; end if;
  end if;
end; $$;

create function private.preview_cimac_maintenance(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; state jsonb;
begin
  if not coalesce(public.can_execute_cimac_maintenance(),false) then raise exception 'cimacMaintenanceForbidden' using errcode='42501'; end if;
  r:=private.cimac_maintenance_request(p_request); perform private.cimac_validate_scope(r);
  if exists(select 1 from jsonb_array_elements(r->'operations') o, lateral jsonb_each(o) e
    where e.key in ('receipt','refund','noteReceipt') and (e.value->>'paymentDate')::date>current_date) then raise exception 'cimacMaintenanceFuturePayment'; end if;
  state:=private.cimac_scope_state();
  return jsonb_build_object('status','previewed','requestId',r->>'requestId','operationCount',jsonb_array_length(r->'operations'),
    'snapshot',jsonb_build_object('fingerprint',md5(state::text),'requestHash',md5(r::text)));
end; $$;

create function private.execute_cimac_maintenance(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r jsonb; batch uuid; saved private.cimac_maintenance_requests%rowtype; before_doc jsonb; after_doc jsonb;
  op jsonb; idx integer:=0; ids uuid[]; unit_ids uuid[]; result_ids uuid[]; customer uuid; corrected text; new_customer uuid;
  c public.lease_contracts%rowtype; u public.units%rowtype; b public.buildings%rowtype;
  note_pid uuid; pid uuid; payment_ids uuid[]:='{}'; op_payments uuid[]; op_results jsonb:='[]'; audit uuid:=gen_random_uuid();
  n text; new_contract uuid; new_unit uuid; expected_payments integer:=0; evidence jsonb; result_doc jsonb; old_payments jsonb; old_ledger jsonb;
begin
  if not coalesce(public.can_execute_cimac_maintenance(),false) then raise exception 'cimacMaintenanceForbidden' using errcode='42501'; end if;
  r:=private.cimac_maintenance_request(p_request); batch:=(r->>'requestId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(batch::text,0));
  select * into saved from private.cimac_maintenance_requests where request_id=batch;
  if saved.request_id is not null then
    if saved.actor_id<>auth.uid() or saved.request_data<>r then raise exception 'cimacMaintenanceRequestIdConflict'; end if;
    if saved.status<>'completed' then raise exception 'cimacMaintenanceIncomplete'; end if;
    return saved.result||jsonb_build_object('idempotent',true,'status','completed_previously','verified',false);
  end if;
  if exists(select 1 from public.payments where request_id=batch or id=batch) then raise exception 'cimacMaintenanceRequestIdConflict'; end if;
  if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp()
    or p_expires_at>clock_timestamp()+interval '10 minutes' or p_deployment is null or length(btrim(p_deployment)) not between 1 and 500 then
    raise exception 'cimacMaintenanceExpired'; end if;
  perform private.cimac_keys(p_snapshot,array['fingerprint','requestHash'],array['fingerprint','requestHash']);
  -- One scoped serial order; FK key-share locks prevent insertion of new child
  -- units/contracts/payments while the state is verified and then mutated.
  perform pg_advisory_xact_lock(hashtextextended('cimac-maintenance-project',0));
  perform 1 from public.projects where code='CIMAC' order by id for update;
  perform 1 from public.buildings where project_id in(select id from public.projects where code='CIMAC') order by id for update;
  perform 1 from public.units where building_id in(select b.id from public.buildings b join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.lease_contracts where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.customers where id in(select c.customer_id from public.lease_contracts c join public.units u on u.id=c.unit_id join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.payments where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.ledger_entries where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.receivables where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  perform 1 from public.property_fee_rules where unit_id in(select u.id from public.units u join public.buildings b on b.id=u.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC') order by id for update;
  before_doc:=private.cimac_scope_state();
  if p_snapshot<>jsonb_build_object('fingerprint',md5(before_doc::text),'requestHash',md5(r::text)) then raise exception 'cimacMaintenanceSnapshotChanged'; end if;
  perform private.cimac_validate_scope(r);
  if exists(select 1 from jsonb_array_elements(r->'operations') o,lateral jsonb_each(o) e
    where e.key in ('receipt','refund','noteReceipt') and (e.value->>'paymentDate')::date>current_date) then raise exception 'cimacMaintenanceFuturePayment'; end if;
  insert into private.cimac_maintenance_requests(request_id,actor_id,request_data,before_state,deployment,status)
  values(batch,auth.uid(),r,before_doc,p_deployment,'executing');
  for op in select value from jsonb_array_elements(r->'operations') loop
    idx:=idx+1; op_payments:='{}'; unit_ids:='{}'; ids:='{}'; note_pid:=null;
    if op?'contractIds' then
      ids:=private.cimac_uuids(op,'contractIds');
      select array_agg(unit_id order by id) into unit_ids from public.lease_contracts where id=any(ids);
      select * into strict c from public.lease_contracts where id=ids[1]; customer:=c.customer_id;
    end if;
    result_ids:=ids;
    if op->>'type'='terms' then
      update public.lease_contracts set monthly_rent_xof=(op->>'monthlyRentXof')::numeric,deposit_amount_xof=(op->>'depositXof')::numeric,
        deposit_received=private.cimac_known_deposit_balance(id)>=(op->>'depositXof')::numeric,
        free_months=(op->>'freeMonths')::integer,deposit_months=3,
        source_reference=concat_ws(E'\n',source_reference,'【本批次取代此前冲突计算】'||(op->>'annotation')||'；批次'||batch),updated_at=clock_timestamp() where id=any(ids);
      update public.property_fee_rules f set monthly_amount_xof=u.area_sqm*(op->>'propertyRateXofPerSqm')::numeric,
        notes=concat_ws(E'\n',f.notes,'【最新核对】'||(op->>'annotation')||'；批次'||batch),updated_at=clock_timestamp()
        from public.units u where f.unit_id=u.id and u.id=any(unit_ids) and f.is_active
          and f.start_date='2027-04-01' and f.end_date='2028-03-31';
      update public.units us set notes=left(
        '最新核对：'||(op->>'customerName')||'；本铺月租'||lc.monthly_rent_xof||' XOF，押金'||lc.deposit_amount_xof||' XOF；尚需补押金'||
        greatest(0,lc.deposit_amount_xof-private.cimac_known_deposit_balance(lc.id))||' XOF（以原收款及原历史汇率核对，不新增收款）；计费面积'||us.area_sqm||
        '㎡×900 XOF/㎡/月，物业费'||(us.area_sqm*900)||' XOF/月、'||(us.area_sqm*900*12)||' XOF/年；2027-04-01至2028-03-31免租，物业费另计且未在本批次收取；批次'||batch||
        E'\n历史原注（冲突金额以最新核对为准）：'||coalesce(us.notes,''),500),updated_at=clock_timestamp()
        from public.lease_contracts lc where lc.id=any(ids) and us.id=lc.unit_id;
    elsif op->>'type' in ('close','replace') then
      if op?'noteReceipt' then
        note_pid:=private.cimac_note_receipt(batch,idx||':note',op,op->'noteReceipt');
        op_payments:=array_append(op_payments,note_pid); expected_payments:=expected_payments+1;
      end if;
      pid:=private.cimac_refund(batch,idx||':refund',op,note_pid); op_payments:=array_append(op_payments,pid); expected_payments:=expected_payments+1;
      corrected:=coalesce(op->>'correctedCustomerName',op->>'customerName');
      if op?'correctedCustomerName' then
        if exists(select 1 from public.customers where name=corrected and id<>customer) then raise exception 'cimacMaintenanceCustomerAmbiguous'; end if;
        update public.customers set name=corrected,notes=concat_ws(E'\n',notes,'姓名更正：'||(op->>'customerName')||' → '||corrected||'；批次'||batch),updated_at=clock_timestamp() where id=customer;
      end if;
      -- Refund/payment date is NOT a checkout or legal lease-end date.
      update public.lease_contracts set status='terminated',commencement_state='cancelled_before_start',signer_name=case when signer_name=op->>'customerName' then corrected else signer_name end,
        source_reference=concat_ws(E'\n',source_reference,'【已退租；旧留存/待退计算作废】'||(op->>'annotation')||'；批次'||batch),updated_at=clock_timestamp() where id=any(ids);
      update public.units set status='available',reservation_holder_name=null,reservation_main_business=null,
        notes=left('最新核对：'||corrected||'已退租，本铺恢复空闲；押金'||(op->'refund'->>'amount')||' '||(op->'refund'->>'currency')||
          '已于'||(op->'refund'->>'paymentDate')||'转账退还。此为退款日期，不推定合同实际终止日；未来物业费规则已停用；批次'||batch||
          E'\n历史原注（留存/待退以最新流水为准）：'||coalesce(notes,''),500),updated_at=clock_timestamp() where id=any(unit_ids);
      update public.property_fee_rules set is_active=false,notes=concat_ws(E'\n',notes,'已退租停止未来计费；批次'||batch),updated_at=clock_timestamp() where unit_id=any(unit_ids) and is_active;
      if op->>'type'='replace' then
        if exists(select 1 from public.customers where name=op->>'newCustomerName') then raise exception 'cimacMaintenanceCustomerAmbiguous'; end if;
        new_customer:=private.cimac_child_uuid(batch,idx||':customer'); new_contract:=private.cimac_child_uuid(batch,idx||':contract');
        insert into public.customers(id,name,notes) values(new_customer,op->>'newCustomerName','独立新客户；不承接原客户收款；批次'||batch);
        insert into public.lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,deposit_months,
          status,commencement_state,signing_state,expected_end_confirmed,source_reference)
        values(new_contract,c.unit_id,new_customer,'CIMAC-MAINT-'||batch||'-'||idx,'annual',5,(op->>'monthlyRentXof')::numeric,(op->>'depositXof')::numeric,3,
          'draft','pending_project_opening','pending_confirmation',false,op->>'annotation'||'；租金2028-04-01起计；物业费2027-04-01至2028-03-31按900XOF/㎡/月；批次'||batch);
        update public.units set status='reserved',reservation_holder_name=op->>'newCustomerName',
          notes=left('最新预留：'||(op->>'newCustomerName')||'；月租'||(op->>'monthlyRentXof')||' XOF；押金'||(op->>'depositXof')||' XOF，已于'||
            (op->'receipt'->>'paymentDate')||'现金收取；原客户已全额退款，两个客户账务独立。起租及签约日期待确认；物业费仅配置规则，不代表已收；批次'||batch||
            E'\n历史原注（已退旧客户，不代表当前预留）：'||coalesce(notes,''),500),updated_at=clock_timestamp() where id=c.unit_id;
        pid:=private.cimac_post_payment(batch,idx||':new-deposit',new_contract,'lease_deposit',op->'receipt',1);
        if (op->'receipt'->>'amount')::numeric<>(op->>'depositXof')::numeric then raise exception 'cimacMaintenanceReceiptMismatch'; end if;
        update public.lease_contracts set deposit_received=true where id=new_contract;
        op_payments:=array_append(op_payments,pid); result_ids:=array_append(ids,new_contract); expected_payments:=expected_payments+1;
        insert into public.property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,notes)
        select c.unit_id,area_sqm*900,'2027-04-01','2028-03-31','新客户独立计费；未收款；批次'||batch from public.units where id=c.unit_id
        on conflict(unit_id) do update set monthly_amount_xof=excluded.monthly_amount_xof,start_date=excluded.start_date,end_date=excluded.end_date,
          is_active=true,notes=concat_ws(E'\n',public.property_fee_rules.notes,excluded.notes),updated_at=clock_timestamp();
      end if;
    elsif op->>'type'='reserve' then
      for n in select value#>>'{}' from jsonb_array_elements(op->'unitNos') loop
        select us.* into strict u from public.units us join public.buildings b on b.id=us.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC' and us.unit_no=n;
        update public.units set status='reserved',reservation_holder_name=op->>'customerName',
          notes=left(concat_ws(E'\n','【最新预留】本组月租'||(op->>'groupMonthlyRentXof')||'XOF/押金'||(op->>'groupDepositXof')||'XOF；未收款；批次'||batch||'；'||(op->>'annotation'),notes),500),updated_at=clock_timestamp() where id=u.id;
        insert into public.property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,notes)
        values(u.id,u.area_sqm*900,'2027-04-01','2028-03-31','本次预留按确认面积×900XOF/㎡/月配置；不代表已收；批次'||batch)
        on conflict(unit_id) do update set monthly_amount_xof=excluded.monthly_amount_xof,start_date=excluded.start_date,end_date=excluded.end_date,
          is_active=true,notes=concat_ws(E'\n',public.property_fee_rules.notes,excluded.notes),updated_at=clock_timestamp();
        unit_ids:=array_append(unit_ids,u.id);
      end loop;
    elsif op->>'type'='area' then
      select us.* into strict u from public.units us join public.buildings b on b.id=us.building_id join public.projects p on p.id=b.project_id where p.code='CIMAC' and us.unit_no=op->>'unitNo';
      unit_ids:=array[u.id];
      select coalesce(array_agg(id order by id),'{}'::uuid[]) into result_ids from public.lease_contracts where unit_id=u.id and status='draft';
      update public.units set area_sqm=(op->>'areaSqm')::numeric,
        notes=left('最新核对：'||(op->>'customerName')||'；计费面积'||(op->>'areaSqm')||'㎡；物业费按900 XOF/㎡/月，为'||
          ((op->>'areaSqm')::numeric*900)||' XOF/月、'||((op->>'areaSqm')::numeric*900*12)||' XOF/年，覆盖2027-04-01至2028-03-31；本批次未收款，原收退款记录不变；批次'||batch||
          E'\n历史原注（面积和计费以最新核对为准）：'||coalesce(notes,''),500),updated_at=clock_timestamp() where id=u.id;
      update public.property_fee_rules set monthly_amount_xof=(op->>'areaSqm')::numeric*(op->>'propertyRateXofPerSqm')::numeric,
        notes=concat_ws(E'\n',notes,'面积更正；'||(op->>'annotation')||'；批次'||batch),updated_at=clock_timestamp() where unit_id=u.id and is_active
          and start_date='2027-04-01' and end_date='2028-03-31';
    elsif op->>'type'='create_reservation' then
      select bs.* into strict b from public.buildings bs join public.projects p on p.id=bs.project_id where p.code='CIMAC' and bs.code=op->>'buildingCode';
      new_unit:=private.cimac_child_uuid(batch,idx||':unit'); new_customer:=private.cimac_child_uuid(batch,idx||':customer'); new_contract:=private.cimac_child_uuid(batch,idx||':contract');
      if exists(select 1 from public.customers where name=op->>'customerName') then raise exception 'cimacMaintenanceCustomerAmbiguous'; end if;
      insert into public.customers(id,name,notes) values(new_customer,op->>'customerName','用户确认真实预留；未收款；批次'||batch);
      insert into public.units(id,building_id,code,unit_no,floor_label,kind,asset_subtype,status,area_sqm,reservation_holder_name,construction_status,occupancy_verified,notes)
      values(new_unit,b.id,b.code||'-'||(op->>'unitNo'),op->>'unitNo','商业区','storefront','commercial_shop','reserved',(op->>'areaSqm')::numeric,op->>'customerName','unverified',false,left((op->>'annotation')||'；未收款；批次'||batch,500));
      insert into public.unit_business_flags(unit_id,business_type,is_enabled) values(new_unit,'long_lease',true);
      insert into public.lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,deposit_months,status,commencement_state,signing_state,expected_end_confirmed,source_reference)
      values(new_contract,new_unit,new_customer,'CIMAC-MAINT-'||batch||'-'||idx,'annual',5,(op->>'monthlyRentXof')::numeric,(op->>'depositXof')::numeric,3,
        'draft','pending_project_opening','pending_confirmation',false,op->>'annotation'||'；未签未付；租金2028-04-01起计；批次'||batch);
      insert into public.property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,notes)
      values(new_unit,(op->>'areaSqm')::numeric*(op->>'propertyRateXofPerSqm')::numeric,'2027-04-01','2028-03-31','规则配置不代表已收；批次'||batch);
      result_ids:=array[new_contract]; unit_ids:=array[new_unit];
    elsif op->>'type'='note_receipt' then
      pid:=private.cimac_note_receipt(batch,idx||':note',op,op->'receipt'); op_payments:=array[pid]; expected_payments:=expected_payments+1;
      update public.lease_contracts set source_reference=concat_ws(E'\n',source_reference,'【原币待核登记已关联正式流水；不是新增收款】'||(op->>'annotation')||'；批次'||batch),updated_at=clock_timestamp() where id=any(ids);
    end if;
    perform private.cimac_verify_operation(op,result_ids,unit_ids);
    payment_ids:=payment_ids||op_payments;
    op_results:=op_results||jsonb_build_array(jsonb_build_object('type',op->>'type','contractIds',result_ids,'unitIds',unit_ids,'paymentIds',op_payments));
  end loop;
  after_doc:=private.cimac_scope_state();
  old_payments:=coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where p.id in(select (v->>'id')::uuid from jsonb_array_elements(before_doc->'payments') v)),'[]');
  old_ledger:=coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.ledger_entries l where l.id in(select (v->>'id')::uuid from jsonb_array_elements(before_doc->'ledger') v)),'[]');
  if old_payments<>before_doc->'payments' or old_ledger<>before_doc->'ledger' or after_doc->'receivables'<>before_doc->'receivables'
    or jsonb_array_length(after_doc->'payments')-jsonb_array_length(before_doc->'payments')<>expected_payments
    or jsonb_array_length(after_doc->'ledger')-jsonb_array_length(before_doc->'ledger')<>expected_payments
    or (select count(*) from public.payments where id=any(payment_ids))<>expected_payments
    or (select count(*) from public.ledger_entries where payment_id=any(payment_ids))<>expected_payments
    or exists(select 1 from public.payments p join public.ledger_entries l on l.payment_id=p.id where p.id=any(payment_ids)
      and (l.unit_id<>p.unit_id or l.entry_date<>p.payment_date or l.category<>'lease_deposit'
        or l.direction<>case when p.source_type='lease_deposit' then 'liability_in' else 'liability_out' end
        or l.amount_xof<>case when p.native_settlement then 0 else round(p.amount*p.exchange_rate_to_xof,2) end
        or (p.native_settlement and (l.currency<>p.currency or l.amount_native<>p.amount))
        or (not p.native_settlement and (l.currency<>'XOF' or l.amount_native is not null)))) then raise exception 'cimacMaintenanceVerificationFailed'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'sourceId',p.source_id,'paymentType',p.source_type,'currency',p.currency,
    'amount',case when p.currency='XOF' then trunc(p.amount)::text else p.amount::text end,'paymentDate',p.payment_date,'paymentMethod',p.payment_method,
    'recordedBy',p.recorded_by,'nativeSettlement',p.native_settlement,'exchangeRateToXof',p.exchange_rate_to_xof::text,
    'ledgerId',l.id,'ledgerAmountXof',l.amount_xof::text,'ledgerCurrency',l.currency,'ledgerAmountNative',l.amount_native::text,'ledgerDirection',l.direction,
    'originalPayments',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'currency',o.currency,'amount',o.amount::text,
      'exchangeRateToXof',o.exchange_rate_to_xof::text,'nativeSettlement',o.native_settlement) order by o.id)
      from public.payments o where o.id=any(a.original_payment_ids)),'[]')) order by p.id),'[]') into evidence
    from public.payments p join public.ledger_entries l on l.payment_id=p.id
    join private.cimac_maintenance_payment_authorizations a on a.payment_id=p.id where p.id=any(payment_ids);
  insert into public.audit_logs(id,actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
  values(audit,auth.uid(),'cimac_preopening_maintenance','cimac_maintenance',batch,before_doc,after_doc,
    jsonb_build_object('request_id',batch,'original_instruction',r->>'originalInstruction','input_source',r->>'inputSource',
      'connector_version',r->>'connectorVersion','protocol_version',r->>'protocolVersion','deployment',p_deployment,
      'no_receivables_created',true,'refund_date_not_lease_end_date',true));
  if not exists(select 1 from public.audit_logs a where a.id=audit and a.entity_id=batch and a.actor_id=auth.uid()
    and a.entity_type='cimac_maintenance' and a.before_data=before_doc and a.after_data=after_doc and a.metadata->>'request_id'=batch::text) then
    raise exception 'cimacMaintenanceVerificationFailed'; end if;
  result_doc:=jsonb_build_object('status','completed','verified',true,'request',r,'requestId',batch,'actorId',auth.uid(),'idempotent',false,'auditId',audit,
    'operationCount',idx,'operationResults',op_results,'paymentIds',payment_ids,'payments',evidence,
    'reconciliation',jsonb_build_object('paymentCount',expected_payments,'ledgerCount',expected_payments,'receivablesCreated',0,
      'originalPaymentsPreserved',true,'contractsMatch',true,'unitsMatch',true,'paymentsMatch',true,'ledgerMatch',true,'auditMatch',true));
  update private.cimac_maintenance_requests set status='completed',after_state=after_doc,result=result_doc where request_id=batch;
  return result_doc;
end; $$;

create function private.find_cimac_maintenance(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r private.cimac_maintenance_requests%rowtype;
begin
  if not coalesce(public.can_execute_cimac_maintenance(),false) then raise exception 'cimacMaintenanceForbidden' using errcode='42501'; end if;
  select * into r from private.cimac_maintenance_requests where request_id=p_request_id and actor_id=auth.uid();
  if r.request_id is null then return jsonb_build_object('status','not_found','requestId',p_request_id); end if;
  return r.result||jsonb_build_object('idempotent',true,'status','completed_previously','verified',false);
end; $$;

-- Exposed signatures are invokers. Privileged implementations remain in the
-- non-exposed private schema and independently authenticate/authorize the actor.
create function public.preview_cimac_maintenance(p_request jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.preview_cimac_maintenance($1); $$;
create function public.execute_cimac_maintenance(p_request jsonb,p_snapshot jsonb,p_expires_at timestamptz,p_deployment text) returns jsonb
language sql security invoker set search_path='' as $$ select private.execute_cimac_maintenance($1,$2,$3,$4); $$;
create function public.find_cimac_maintenance(p_request_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.find_cimac_maintenance($1); $$;

-- No table grants or broad action-catalog changes. Only the authenticated
-- named RPC surface is callable; every mutation rechecks admin/project scope.
revoke all on function private.cimac_keys(jsonb,text[],text[]),private.cimac_text(jsonb,text,integer),
  private.cimac_money(jsonb,text,boolean),private.cimac_uuids(jsonb,text,boolean),private.cimac_date(jsonb,text),
  private.cimac_payment_input(jsonb,text),private.cimac_maintenance_request(jsonb),private.cimac_scope_state(),
  private.cimac_child_uuid(uuid,text),private.guard_cimac_maintenance_payment(),private.guard_cimac_maintenance_ledger(),
  private.cimac_post_payment(uuid,text,uuid,text,jsonb,numeric,uuid[]),private.cimac_note_receipt(uuid,text,jsonb,jsonb),
  private.cimac_refund(uuid,text,jsonb,uuid),private.cimac_validate_scope(jsonb),private.cimac_known_deposit_balance(uuid),private.cimac_verify_operation(jsonb,uuid[],uuid[])
  from public,anon,authenticated,service_role;
revoke all on function public.cimac_maintenance_protocol_version(),public.can_execute_cimac_maintenance(),
  public.preview_cimac_maintenance(jsonb),public.execute_cimac_maintenance(jsonb,jsonb,timestamptz,text),public.find_cimac_maintenance(uuid)
  from public,anon,service_role;
grant execute on function public.cimac_maintenance_protocol_version(),public.can_execute_cimac_maintenance(),
  public.preview_cimac_maintenance(jsonb),public.execute_cimac_maintenance(jsonb,jsonb,timestamptz,text),public.find_cimac_maintenance(uuid) to authenticated;
revoke all on function private.preview_cimac_maintenance(jsonb),private.execute_cimac_maintenance(jsonb,jsonb,timestamptz,text),private.find_cimac_maintenance(uuid)
  from public,anon,service_role;
grant execute on function private.preview_cimac_maintenance(jsonb),private.execute_cimac_maintenance(jsonb,jsonb,timestamptz,text),private.find_cimac_maintenance(uuid) to authenticated;

-- Native settlement previously meant rent only. The new deposit exception must
-- appear as a native liability, never disappear or inflate native rent income.
-- Keep the existing authorized project scope, security mode and all other
-- financial classifications verbatim. Fail closed on upstream definition drift.
do $projection$
declare definition text; original_groups text := $groups$    select rent_currency currency from leases where rent_currency<>'XOF'
    union
    select c.currency from classified c where c.native_settlement
    union
    select r.currency from managed r where r.amount_native is not null$groups$;
  original_totals text := $totals$      coalesce((select sum(c.amount) from classified c where c.native_settlement and c.currency=g.currency and c.payment_date>=month_start and c.payment_method is distinct from 'offset'),0) income,
      0 expense,0 liability_in,0 liability_out,$totals$;
  replacement_totals text := $totals$      coalesce((select sum(c.amount) from classified c where c.native_settlement and c.source_type='lease_rent' and c.currency=g.currency and c.payment_date>=month_start and c.payment_method is distinct from 'offset'),0) income,
      0 expense,
      coalesce((select sum(c.amount) from classified c where c.native_settlement and c.source_type='lease_deposit' and c.currency=g.currency and c.payment_date>=month_start and c.payment_method is distinct from 'offset'),0) liability_in,
      coalesce((select sum(c.amount) from classified c where c.native_settlement and c.source_type='lease_deposit_refund' and c.currency=g.currency and c.payment_date>=month_start and c.payment_method is distinct from 'offset'),0) liability_out,$totals$;
begin
  if (select prosecdef from pg_proc where oid='public.management_operating_snapshot_rpc(uuid)'::regprocedure) then
    raise exception 'cimacMaintenanceManagementProjectionDrift'; end if;
  definition:=replace(pg_get_functiondef('public.management_operating_snapshot_rpc(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  if (length(definition)-length(replace(definition,original_groups,'')))/length(original_groups)<>1
    or (length(definition)-length(replace(definition,original_totals,'')))/length(original_totals)<>1 then
    raise exception 'cimacMaintenanceManagementProjectionDrift'; end if;
  definition:=replace(definition,original_totals,replacement_totals);
  execute definition;
end; $projection$;

commit;
