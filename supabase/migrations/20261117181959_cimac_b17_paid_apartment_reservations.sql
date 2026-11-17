begin;

-- Paid reservations preserve the agreement and cash facts without asserting a
-- signed/started lease or actual occupation. No business rows are seeded.
create table public.cimac_apartment_paid_receipts (
  id uuid primary key, request_id uuid not null unique, project_id uuid not null references public.projects(id),
  building_id uuid not null references public.buildings(id), customer_id uuid not null references public.customers(id),
  customer_name text not null, payment_date date not null, payment_method text not null check(payment_method in ('cash','bank_transfer','check','other')),
  currency public.currency_code not null check(currency='XOF'), total_amount_xof numeric(14,2) not null check(total_amount_xof>0 and total_amount_xof=trunc(total_amount_xof)),
  source_ref text not null unique check(length(btrim(source_ref)) between 1 and 500), external_receipt_no text,
  reason text not null, notes text, recorded_by uuid not null references auth.users(id), recorded_at timestamptz not null default clock_timestamp()
);
create unique index cimac_apartment_paid_external_receipt_once on public.cimac_apartment_paid_receipts(project_id,external_receipt_no) where external_receipt_no is not null;
create index cimac_apartment_paid_receipt_building on public.cimac_apartment_paid_receipts(building_id);
create index cimac_apartment_paid_receipt_customer on public.cimac_apartment_paid_receipts(customer_id);
create index cimac_apartment_paid_receipt_actor on public.cimac_apartment_paid_receipts(recorded_by);
create table public.cimac_apartment_paid_reservations (
  id uuid primary key, receipt_id uuid not null references public.cimac_apartment_paid_receipts(id),
  unit_id uuid not null unique references public.units(id), building_id uuid not null references public.buildings(id),
  customer_id uuid not null references public.customers(id), status text not null default 'paid_reserved' check(status='paid_reserved'),
  agreement_start_date date not null, agreement_end_date date not null, paid_period_start date not null, paid_period_end date not null,
  monthly_rent_xof numeric(14,2) not null check(monthly_rent_xof>0), deposit_months smallint not null check(deposit_months=2),
  rent_prepay_months smallint not null check(rent_prepay_months=3), deposit_amount_xof numeric(14,2) not null,
  rent_amount_xof numeric(14,2) not null, deposit_payment_id uuid not null unique references public.payments(id),
  rent_payment_id uuid not null unique references public.payments(id), recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  check(deposit_amount_xof=monthly_rent_xof*2 and rent_amount_xof=monthly_rent_xof*3),
  check(agreement_start_date=paid_period_start and agreement_end_date>=paid_period_end and paid_period_end>=paid_period_start)
);
create index cimac_apartment_paid_reservation_receipt on public.cimac_apartment_paid_reservations(receipt_id);
create index cimac_apartment_paid_reservation_building on public.cimac_apartment_paid_reservations(building_id);
create index cimac_apartment_paid_reservation_customer on public.cimac_apartment_paid_reservations(customer_id);
create index cimac_apartment_paid_reservation_actor on public.cimac_apartment_paid_reservations(recorded_by);
create table private.cimac_apartment_paid_requests (
  request_id uuid primary key, actor_id uuid not null references auth.users(id), request_data jsonb not null,
  status text not null check(status in ('executing','completed')), before_data jsonb not null, result jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create table private.cimac_apartment_paid_rows (
  request_id uuid not null references private.cimac_apartment_paid_requests(request_id), entity text not null check(entity in ('payment','ledger')),
  entity_id uuid not null, expected jsonb not null, primary key(entity,entity_id)
);
create index cimac_apartment_paid_request_actor on private.cimac_apartment_paid_requests(actor_id);
create index cimac_apartment_paid_rows_request on private.cimac_apartment_paid_rows(request_id);
alter table private.cimac_apartment_paid_requests enable row level security;
alter table private.cimac_apartment_paid_rows enable row level security;
revoke all on private.cimac_apartment_paid_requests,private.cimac_apartment_paid_rows from public,anon,authenticated,service_role;
create function private.guard_cimac_paid_request_namespace() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,0));
  if exists(select 1 from private.cimac_apartment_paid_requests where request_id=new.request_id)
    or exists(select 1 from public.payments where request_id=new.request_id and request_kind='cimac_apartment_paid') then
    raise exception 'CimacApartmentPaidRequestConflict'; end if;
  return new;
end; $$;
do $namespace$
declare t text;
begin
  foreach t in array array['cimac_maintenance_requests','cimac_finance_requests','cimac_billing_requests','operator_native_collection_requests','lease_collection_requests','finance_operation_requests','payment_context_requests','lease_rent_period_requests','lease_lifecycle_requests','operator_payment_confirmations','operator_collection_batches','operator_daily_workflows','operator_booking_operations','asset_operation_requests'] loop
    execute format('create trigger cimac_apartment_paid_request_namespace before insert on private.%I for each row execute function private.guard_cimac_paid_request_namespace()',t);
  end loop;
end; $namespace$;

create function private.cimac_paid_scope(write_access boolean default false) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance','boss','rental_sales'),false)
    or (write_access and not coalesce(public.has_app_role('admin','finance'),false)) then
    raise exception 'CimacApartmentPaidDenied' using errcode='42501'; end if;
  select b.id into target from public.buildings b join public.projects p on p.id=b.project_id
    where p.code='CIMAC' and b.code='CIMAC-B17' and b.is_active and p.is_active
      and public.can_access_project(p.id) and public.can_access_building(b.id);
  if target is null then raise exception 'CimacApartmentPaidDenied' using errcode='42501'; end if;
  return target;
end; $$;

alter table public.cimac_apartment_paid_receipts enable row level security;
alter table public.cimac_apartment_paid_reservations enable row level security;
revoke all on public.cimac_apartment_paid_receipts,public.cimac_apartment_paid_reservations from public,anon,authenticated,service_role;
grant select on public.cimac_apartment_paid_receipts,public.cimac_apartment_paid_reservations to authenticated;
create policy cimac_apartment_paid_receipt_read on public.cimac_apartment_paid_receipts for select to authenticated
using(building_id=private.cimac_paid_scope(false));
create policy cimac_apartment_paid_reservation_read on public.cimac_apartment_paid_reservations for select to authenticated
using(building_id=private.cimac_paid_scope(false));
create function private.guard_cimac_paid_immutable() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'CimacApartmentPaidImmutable' using errcode='42501'; end; $$;
create trigger cimac_apartment_paid_receipt_immutable before update or delete on public.cimac_apartment_paid_receipts for each row execute function private.guard_cimac_paid_immutable();
create trigger cimac_apartment_paid_reservation_immutable before update or delete on public.cimac_apartment_paid_reservations for each row execute function private.guard_cimac_paid_immutable();

-- Retain the existing allocator and ACL. Add only the two new typed sources.
do $references$
declare definition text; old_rent text:='when ''lease_rent'' then ''RENT'''; old_deposit text:='when ''lease_deposit'' then ''DEP''';
begin
  definition:=pg_get_functiondef('private.lease_payment_business_code(text)'::regprocedure);
  if (length(definition)-length(replace(definition,old_rent,'')))<>length(old_rent)
    or (length(definition)-length(replace(definition,old_deposit,'')))<>length(old_deposit) then raise exception 'CimacApartmentPaidReferenceDrift'; end if;
  definition:=replace(definition,old_rent,old_rent||' when ''cimac_apartment_rent'' then ''RENT''');
  definition:=replace(definition,old_deposit,old_deposit||' when ''cimac_apartment_deposit'' then ''DEP''');
  execute definition;
end; $references$;

create function private.guard_cimac_paid_money() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_doc jsonb; new_doc jsonb; protected boolean:=false; row_kind text; allowed jsonb;
begin
  row_kind:=case when tg_table_name='payments' then 'payment' else 'ledger' end;
  if tg_op<>'INSERT' then old_doc:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_doc:=to_jsonb(new); end if;
  protected:=exists(select 1 from private.cimac_apartment_paid_rows where entity_id=coalesce(new_doc->>'id',old_doc->>'id')::uuid and cimac_apartment_paid_rows.entity=row_kind);
  if row_kind='payment' then protected:=protected or coalesce(new_doc->>'source_type','') in ('cimac_apartment_rent','cimac_apartment_deposit')
    or coalesce(old_doc->>'source_type','') in ('cimac_apartment_rent','cimac_apartment_deposit')
    or coalesce(new_doc->>'request_kind','')='cimac_apartment_paid' or coalesce(old_doc->>'request_kind','')='cimac_apartment_paid';
  else protected:=protected or exists(select 1 from public.payments p where p.id in ((new_doc->>'payment_id')::uuid,(old_doc->>'payment_id')::uuid) and p.request_kind='cimac_apartment_paid'); end if;
  if protected then
    if tg_op<>'INSERT' then raise exception 'CimacApartmentPaidImmutable' using errcode='42501'; end if;
    select a.expected into allowed from private.cimac_apartment_paid_rows a join private.cimac_apartment_paid_requests r on r.request_id=a.request_id
      where a.entity=row_kind and a.entity_id=(new_doc->>'id')::uuid and r.status='executing' and r.actor_id=auth.uid();
    if allowed is null or not(new_doc @> allowed) then raise exception 'CimacApartmentPaidMoneyDenied' using errcode='42501'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger guard_cimac_paid_money before insert or update or delete on public.payments for each row execute function private.guard_cimac_paid_money();
create trigger guard_cimac_paid_money before insert or update or delete on public.ledger_entries for each row execute function private.guard_cimac_paid_money();
create function private.guard_cimac_paid_double_booking() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='reserved' and exists(select 1 from public.cimac_apartment_paid_reservations where unit_id=new.unit_id) then
    raise exception 'CimacApartmentPaidAlreadyReserved' using errcode='40001'; end if;
  return new;
end; $$;
create trigger cimac_apartment_paid_double_booking before insert or update on public.cimac_apartment_reservations
for each row execute function private.guard_cimac_paid_double_booking();

-- A paid customer is eligible for this scoped directory without inventing a
-- commercial shop relationship or a signed lease relationship.
do $directory$
declare definition text; anchor text:='where (exists(select 1 from scoped_rel r where r.customer_id=c.id) or (building is null and m.customer_id is not null))';
begin
  definition:=pg_get_functiondef('public.cimac_customer_directory_read_rpc(jsonb,text,uuid,integer)'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then raise exception 'CimacApartmentPaidDirectoryDrift'; end if;
  definition:=replace(definition,anchor,$new$where (exists(select 1 from scoped_rel r where r.customer_id=c.id) or (building is null and m.customer_id is not null)
    or exists(select 1 from public.cimac_apartment_paid_reservations paid join u on u.id=paid.unit_id and u.building_id=paid.building_id
      where paid.customer_id=c.id and paid.status='paid_reserved' and (building is null or paid.building_id=building)))$new$);
  execute definition;
end; $directory$;

create function private.guard_cimac_paid_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op<>'INSERT' and old.entity_type='cimac_apartment_paid_receipt' then raise exception 'CimacApartmentPaidImmutable' using errcode='42501'; end if;
  if tg_op<>'DELETE' and new.entity_type='cimac_apartment_paid_receipt' then
    if tg_op<>'INSERT' or new.action is distinct from 'paid_receipt' or new.actor_id is distinct from auth.uid()
      or not exists(select 1 from private.cimac_apartment_paid_requests r where r.request_id=new.entity_id and r.status='completed'
        and r.actor_id=auth.uid() and new.metadata->'request' is not distinct from r.request_data)
      or exists(select 1 from public.audit_logs a where a.entity_type=new.entity_type and a.entity_id=new.entity_id) then raise exception 'CimacApartmentPaidAuditDenied' using errcode='42501'; end if;
  elsif tg_op='INSERT' and exists(select 1 from private.cimac_apartment_paid_requests where request_id=new.entity_id) then
    raise exception 'CimacApartmentPaidRequestConflict';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger guard_cimac_paid_audit before insert or update or delete on public.audit_logs for each row execute function private.guard_cimac_paid_audit();
create unique index cimac_apartment_paid_audit_once on public.audit_logs(entity_id) where entity_type='cimac_apartment_paid_receipt';

create function private.cimac_paid_money(v jsonb,k text) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
  if jsonb_typeof(v->k) is distinct from 'number' then raise exception 'CimacApartmentPaidInvalid'; end if;
  n:=(v->>k)::numeric; if n<=0 or n>999999999999 or n<>trunc(n) then raise exception 'CimacApartmentPaidInvalid'; end if;
  return n;
end; $$;
create function private.cimac_paid_request(p jsonb) returns void language plpgsql stable set search_path='' as $$
declare keys text[]:=array['requestId','originalInstruction','customerName','agreementStartDate','agreementEndDate','paidPeriodStart','paidPeriodEnd','paymentDate','paymentMethod','currency','totalAmountXof','sourceRef','externalReceiptNo','reason','rooms'];
  room jsonb; ids uuid[]:='{}'; id uuid; total numeric:=0; starts date; ends date; paid_end date; day date;
begin
  if p is null or octet_length(p::text)>262144 then raise exception 'CimacApartmentPaidInvalid'; end if;
  perform private.cimac_finance_keys(p,keys,array['requestId','originalInstruction','customerName','agreementStartDate','agreementEndDate','paidPeriodStart','paidPeriodEnd','paymentDate','paymentMethod','currency','totalAmountXof','sourceRef','reason','rooms']);
  perform private.cimac_finance_uuid(p,'requestId'); perform private.cimac_finance_text(p,'originalInstruction',4000);
  perform private.cimac_finance_text(p,'customerName',200); perform private.cimac_finance_text(p,'sourceRef',500); perform private.cimac_finance_text(p,'reason',2000);
  if p?'externalReceiptNo' then perform private.cimac_finance_text(p,'externalReceiptNo',100); end if;
  starts:=private.cimac_finance_date(p,'agreementStartDate'); ends:=private.cimac_finance_date(p,'agreementEndDate');
  paid_end:=private.cimac_finance_date(p,'paidPeriodEnd'); day:=private.cimac_finance_date(p,'paymentDate');
  if p->>'currency' is distinct from 'XOF' or coalesce(p->>'paymentMethod','') not in ('cash','bank_transfer','check','other')
    or day>current_date or day>starts or extract(day from starts)<>1 or starts<>private.cimac_finance_date(p,'paidPeriodStart')
    or paid_end<>(starts+interval '3 months'-interval '1 day')::date or ends<paid_end
    or ends<>(date_trunc('month',ends)+interval '1 month'-interval '1 day')::date
    or jsonb_typeof(p->'rooms') is distinct from 'array' or jsonb_array_length(p->'rooms') not between 1 and 64 then raise exception 'CimacApartmentPaidInvalid'; end if;
  for room in select value from jsonb_array_elements(p->'rooms') loop
    keys:=array['unitId','expectedUnitUpdatedAt','expectedHoldId','expectedHoldUpdatedAt','monthlyRentXof','depositMonths','rentPrepayMonths','depositAmountXof','rentAmountXof'];
    perform private.cimac_finance_keys(room,keys,array['unitId','expectedUnitUpdatedAt','monthlyRentXof','depositMonths','rentPrepayMonths','depositAmountXof','rentAmountXof']);
    if not(room?'expectedHoldId') or not(room?'expectedHoldUpdatedAt') or room->'expectedHoldId' is distinct from 'null'::jsonb or room->'expectedHoldUpdatedAt' is distinct from 'null'::jsonb
      or room->'depositMonths' is distinct from '2'::jsonb or room->'rentPrepayMonths' is distinct from '3'::jsonb then raise exception 'CimacApartmentPaidInvalid'; end if;
    id:=private.cimac_finance_uuid(room,'unitId'); if id=any(ids) then raise exception 'CimacApartmentPaidDuplicateTarget'; end if; ids:=array_append(ids,id);
    perform private.cimac_finance_text(room,'expectedUnitUpdatedAt',40);
    if room->>'expectedUnitUpdatedAt' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'CimacApartmentPaidInvalid'; end if;
    if private.cimac_paid_money(room,'depositAmountXof')<>2*private.cimac_paid_money(room,'monthlyRentXof')
      or private.cimac_paid_money(room,'rentAmountXof')<>3*private.cimac_paid_money(room,'monthlyRentXof') then raise exception 'CimacApartmentPaidAmountMismatch'; end if;
    total:=total+(room->>'depositAmountXof')::numeric+(room->>'rentAmountXof')::numeric;
  end loop;
  if total<>private.cimac_paid_money(p,'totalAmountXof') then raise exception 'CimacApartmentPaidAmountMismatch'; end if;
end; $$;

create function private.cimac_paid_result(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.cimac_apartment_paid_requests%rowtype; data jsonb; verification jsonb; ps jsonb; ls jsonb; units uuid[]; parent public.cimac_apartment_paid_receipts%rowtype;
begin
  perform private.cimac_paid_scope(false);
  select * into j from private.cimac_apartment_paid_requests where request_id=p_id;
  if not found then return jsonb_build_object('success',false,'status','not_found','requestId',p_id); end if;
  if j.status<>'completed' or j.result is null then raise exception 'CimacApartmentPaidVerificationFailed'; end if;
  data:=j.result->'data';
  select * into parent from public.cimac_apartment_paid_receipts where id=(data->>'receiptId')::uuid;
  if parent.id is null or parent.request_id is distinct from p_id or parent.recorded_by is distinct from j.actor_id or parent.building_id is distinct from private.cimac_paid_scope(false) then raise exception 'CimacApartmentPaidVerificationFailed'; end if;
  select array_agg(unit_id order by unit_id) into units from public.cimac_apartment_paid_reservations where receipt_id=parent.id;
  select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') into ps from public.payments p where p.source_id in(select id from public.cimac_apartment_paid_reservations where receipt_id=parent.id);
  select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') into ls from public.ledger_entries l where l.payment_id in(select (value->>'id')::uuid from jsonb_array_elements(ps));
  if jsonb_array_length(ps)<>2*jsonb_array_length(j.request_data->'rooms') or jsonb_array_length(ls)<>jsonb_array_length(ps)
    or exists(select 1 from private.cimac_apartment_paid_rows a where a.request_id=p_id and not exists(
      select 1 from jsonb_array_elements(case when a.entity='payment' then ps else ls end) x where (x->>'id')::uuid=a.entity_id and x @> a.expected)) then raise exception 'CimacApartmentPaidVerificationFailed'; end if;
  verification:=jsonb_build_object('receipt',to_jsonb(parent),'reservations',(select jsonb_agg(to_jsonb(r) order by unit_id) from public.cimac_apartment_paid_reservations r where receipt_id=parent.id),
    'payments',ps,'ledger',ls,'customer',(select jsonb_build_object('id',id,'name',name) from public.customers where id=parent.customer_id),
    'units',(select jsonb_agg(to_jsonb(u) order by id) from public.units u where id=any(units)),
    'profiles',(select jsonb_agg(to_jsonb(a) order by unit_id) from public.cimac_apartment_profiles a where unit_id=any(units)),
    'unpaidReservations',coalesce((select jsonb_agg(to_jsonb(r) order by id) from public.cimac_apartment_reservations r where unit_id=any(units)),'[]'),
    'leases',coalesce((select jsonb_agg(to_jsonb(l) order by id) from public.lease_contracts l where unit_id=any(units)),'[]'),
    'dailyBookings',coalesce((select jsonb_agg(to_jsonb(d) order by id) from public.daily_bookings d where unit_id=any(units)),'[]'),
    'sales',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.sale_contracts s where unit_id=any(units)),'[]'),
    'businessFlags',coalesce((select jsonb_agg(to_jsonb(f) order by unit_id) from public.unit_business_flags f where unit_id=any(units)),'[]'));
  return jsonb_build_object('success',true,'idempotent',true,'data',data||jsonb_build_object('verification',verification));
end; $$;

create function private.cimac_apartment_paid_execute(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare target uuid; project uuid; request uuid; receipt uuid; customer uuid; previous private.cimac_apartment_paid_requests%rowtype;
  room jsonb; u public.units%rowtype; profile public.cimac_apartment_profiles%rowtype; before_rows jsonb:='[]'; old_holds jsonb;
  row_id uuid; pay_id uuid; ledger_id uuid; child_id uuid; amount numeric; source text; category text; direction text; idx integer:=0; kind text;
  row_ids jsonb:='[]'; pay_ids jsonb:='[]'; ledger_ids jsonb:='[]'; doc jsonb; result_doc jsonb; expected jsonb; description text;
begin
  target:=private.cimac_paid_scope(true); perform private.cimac_paid_request(p_request);
  request:=(p_request->>'requestId')::uuid; receipt:=private.cimac_child_uuid(request,'receipt');
  select project_id into project from public.buildings where id=target;
  perform pg_advisory_xact_lock(hashtextextended(request::text,0));
  select * into previous from private.cimac_apartment_paid_requests where request_id=request;
  if found then
    if previous.actor_id is distinct from auth.uid() or previous.request_data is distinct from p_request then raise exception 'CimacApartmentPaidRequestConflict'; end if;
    return private.cimac_paid_result(request);
  end if;
  if private.cimac_finance_request_conflict(request) or exists(select 1 from public.audit_logs where entity_id=request)
    or exists(select 1 from private.cimac_finance_requests where request_id=request)
    or exists(select 1 from private.asset_operation_requests where request_id=request)
    or exists(select 1 from public.payments where request_id=request) then raise exception 'CimacApartmentPaidRequestConflict'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cimac-apartment-paid-source:'||(p_request->>'sourceRef'),0));
  if p_request?'externalReceiptNo' then perform pg_advisory_xact_lock(hashtextextended('cimac-apartment-paid-external:'||(p_request->>'externalReceiptNo'),0)); end if;
  if exists(select 1 from public.cimac_apartment_paid_receipts where source_ref=p_request->>'sourceRef' or
    (external_receipt_no is not null and external_receipt_no=p_request->>'externalReceiptNo'))
    or exists(select 1 from public.payments where external_receipt_no=p_request->>'externalReceiptNo') then raise exception 'CimacApartmentPaidDuplicateReceipt'; end if;
  perform 1 from public.units where id in(select (value->>'unitId')::uuid from jsonb_array_elements(p_request->'rooms')) order by id for update;
  for room in select value from jsonb_array_elements(p_request->'rooms') loop
    select * into u from public.units where id=(room->>'unitId')::uuid;
    select * into profile from public.cimac_apartment_profiles where unit_id=u.id;
    if u.id is null or u.building_id is distinct from target or profile.building_id is distinct from target
      or u.kind<>'apartment' or u.asset_subtype<>'apartment' or u.code<>'CIMAC-B17-'||u.unit_no
      or u.unit_no<>(profile.floor_number*100+profile.room_suffix)::text or not public.can_access_unit(u.id)
      or u.updated_at is distinct from (room->>'expectedUnitUpdatedAt')::timestamptz
      or u.construction_status<>'operational' or u.operational_condition<>'normal' or u.status<>'available'
      or profile.monthly_rent_xof<>(room->>'monthlyRentXof')::numeric then raise exception 'CimacApartmentPaidScopeChanged'; end if;
    if exists(select 1 from public.cimac_apartment_reservations where unit_id=u.id and status='reserved')
      or exists(select 1 from public.cimac_apartment_paid_reservations where unit_id=u.id)
      or exists(select 1 from public.lease_contracts where unit_id=u.id and status in ('draft','active'))
      or exists(select 1 from public.daily_bookings where unit_id=u.id and status in ('confirmed','checked_in'))
      or exists(select 1 from public.sale_contracts where unit_id=u.id)
      or exists(select 1 from public.unit_operational_position where id=u.id and (lease_occupied or daily_occupied)) then raise exception 'CimacApartmentPaidBusinessConflict'; end if;
    before_rows:=before_rows||jsonb_build_array(to_jsonb(u));
  end loop;
  -- Serialize only the exact name, then reject ambiguity or unrelated-project identity reuse.
  perform pg_advisory_xact_lock(hashtextextended('customer-name:'||lower(p_request->>'customerName'),0));
  if (select count(*) from public.customers where lower(btrim(name))=lower(p_request->>'customerName'))>1 then raise exception 'CimacApartmentPaidCustomerConflict'; end if;
  select id into customer from public.customers where lower(btrim(name))=lower(p_request->>'customerName');
  if customer is not null then
    perform 1 from public.customers where id=customer for update;
    if (select name from public.customers where id=customer) is distinct from p_request->>'customerName' then raise exception 'CimacApartmentPaidCustomerConflict'; end if;
    if exists(select 1 from private.cimac_customer_memberships where customer_id=customer and project_id=project and status='archived') then raise exception 'CimacApartmentPaidCustomerConflict'; end if;
    if not exists(select 1 from public.cimac_apartment_paid_receipts where customer_id=customer and project_id=project)
      and not exists(select 1 from private.cimac_customer_memberships where customer_id=customer and project_id=project)
      and not exists(select 1 from public.lease_contracts l join public.units u on u.id=l.unit_id join public.buildings b on b.id=u.building_id where l.customer_id=customer and b.project_id=project)
      and not exists(select 1 from private.cimac_customer_unit_links where customer_id=customer and project_id=project) then raise exception 'CimacApartmentPaidCustomerConflict'; end if;
  else
    customer:=private.cimac_child_uuid(request,'customer');
    insert into public.customers(id,name) values(customer,p_request->>'customerName');
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') into old_holds from public.cimac_apartment_reservations r where unit_id in(select (value->>'unitId')::uuid from jsonb_array_elements(p_request->'rooms'));
  insert into private.cimac_apartment_paid_requests values(request,auth.uid(),p_request,'executing',jsonb_build_object('units',before_rows,'unpaidReservations',old_holds),null,clock_timestamp());
  insert into public.cimac_apartment_paid_receipts(id,request_id,project_id,building_id,customer_id,customer_name,payment_date,payment_method,currency,total_amount_xof,source_ref,external_receipt_no,reason,notes,recorded_by)
    values(receipt,request,project,target,customer,p_request->>'customerName',(p_request->>'paymentDate')::date,p_request->>'paymentMethod','XOF',(p_request->>'totalAmountXof')::numeric,p_request->>'sourceRef',p_request->>'externalReceiptNo',p_request->>'reason',p_request->>'notes',auth.uid());
  for room in select value from jsonb_array_elements(p_request->'rooms') loop
    idx:=idx+1; row_id:=private.cimac_child_uuid(request,'room:'||idx); row_ids:=row_ids||jsonb_build_array(row_id);
    select * into strict u from public.units where id=(room->>'unitId')::uuid;
    foreach kind in array array['deposit','rent'] loop
      pay_id:=private.cimac_child_uuid(request,'room:'||idx||':'||kind||':payment');
      ledger_id:=private.cimac_child_uuid(request,'room:'||idx||':'||kind||':ledger');
      child_id:=case when idx=1 and kind='deposit' then request else private.cimac_child_uuid(request,'room:'||idx||':'||kind||':request') end;
      if private.cimac_finance_request_conflict(child_id) or exists(select 1 from public.payments where request_id=child_id) then raise exception 'CimacApartmentPaidRequestConflict'; end if;
      source:=case when kind='deposit' then 'cimac_apartment_deposit' else 'cimac_apartment_rent' end;
      category:=case when kind='deposit' then 'lease_deposit' else 'lease_rent' end;
      direction:=case when kind='deposit' then 'liability_in' else 'income' end;
      amount:=(room->>case when kind='deposit' then 'depositAmountXof' else 'rentAmountXof' end)::numeric;
      description:='已付款公寓预订；同一实际收款批次'||request||'；房间'||u.unit_no||'；'||category||'；'||(p_request->>'sourceRef')||'；'||(p_request->>'reason');
      expected:=jsonb_build_object('id',pay_id,'customer_id',customer,'unit_id',u.id,'source_type',source,'source_id',row_id,'payment_date',p_request->>'paymentDate',
        'amount',amount,'currency','XOF','exchange_rate_to_xof',1,'native_settlement',false,'payment_method',p_request->>'paymentMethod','request_id',child_id,'request_kind','cimac_apartment_paid','recorded_by',auth.uid());
      insert into private.cimac_apartment_paid_rows values(request,'payment',pay_id,expected);
      insert into public.payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,native_settlement,payment_method,request_id,request_kind,external_receipt_no,notes)
        values(pay_id,customer,u.id,source,row_id,(p_request->>'paymentDate')::date,amount,'XOF',1,false,p_request->>'paymentMethod',child_id,'cimac_apartment_paid',p_request->>'externalReceiptNo',description);
      expected:=jsonb_build_object('id',ledger_id,'building_id',target,'unit_id',u.id,'payment_id',pay_id,'entry_date',p_request->>'paymentDate','direction',direction,'category',category,'amount_xof',amount,'currency','XOF');
      insert into private.cimac_apartment_paid_rows values(request,'ledger',ledger_id,expected);
      insert into public.ledger_entries(id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,description)
        values(ledger_id,target,u.id,pay_id,(p_request->>'paymentDate')::date,direction,category,amount,'XOF',description);
      pay_ids:=pay_ids||jsonb_build_array(pay_id); ledger_ids:=ledger_ids||jsonb_build_array(ledger_id);
    end loop;
    insert into public.cimac_apartment_paid_reservations(id,receipt_id,unit_id,building_id,customer_id,agreement_start_date,agreement_end_date,paid_period_start,paid_period_end,monthly_rent_xof,deposit_months,rent_prepay_months,deposit_amount_xof,rent_amount_xof,deposit_payment_id,rent_payment_id,recorded_by)
      values(row_id,receipt,u.id,target,customer,(p_request->>'agreementStartDate')::date,(p_request->>'agreementEndDate')::date,(p_request->>'paidPeriodStart')::date,(p_request->>'paidPeriodEnd')::date,
        (room->>'monthlyRentXof')::numeric,2,3,(room->>'depositAmountXof')::numeric,(room->>'rentAmountXof')::numeric,private.cimac_child_uuid(request,'room:'||idx||':deposit:payment'),private.cimac_child_uuid(request,'room:'||idx||':rent:payment'),auth.uid());
  end loop;
  if (select jsonb_agg(to_jsonb(u) order by u.id) from public.units u where id in(select (value->>'id')::uuid from jsonb_array_elements(before_rows))) is distinct from
    (select jsonb_agg(value order by value->>'id') from jsonb_array_elements(before_rows))
    or (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.cimac_apartment_reservations r where unit_id in(select (value->>'unitId')::uuid from jsonb_array_elements(p_request->'rooms'))) is distinct from old_holds then raise exception 'CimacApartmentPaidVerificationFailed'; end if;
  result_doc:=jsonb_build_object('success',true,'data',jsonb_build_object('requestId',request,'actorId',auth.uid(),'projectId',project,'buildingId',target,'customerId',customer,'receiptId',receipt,
    'reservationIds',row_ids,'paymentIds',pay_ids,'ledgerIds',ledger_ids,'request',p_request));
  update private.cimac_apartment_paid_requests set status='completed',result=result_doc where request_id=request;
  result_doc:=private.cimac_paid_result(request)||jsonb_build_object('idempotent',false);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(auth.uid(),public.current_user_role(),'paid_receipt','cimac_apartment_paid_receipt',request,jsonb_build_object('units',before_rows,'unpaidReservations',old_holds),result_doc->'data'->'verification',
      jsonb_build_object('request',p_request,'request_id',request,'one_physical_receipt',true,'lease_created',false,'occupancy_asserted',false,'dates_are_agreement_not_actual',true));
  return result_doc;
end; $$;

create function public.cimac_apartment_paid_receipt_execute_rpc(p_request jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.cimac_apartment_paid_execute($1); $$;
create function public.cimac_apartment_paid_receipt_status_rpc(p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.cimac_paid_result($1); $$;
create function public.cimac_apartment_paid_receipts_read_rpc(p_building_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if p_building_id is distinct from private.cimac_paid_scope(false) then raise exception 'CimacApartmentPaidDenied' using errcode='42501'; end if;
  return jsonb_build_object('buildingId',p_building_id,'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by recorded_at,id) from public.cimac_apartment_paid_receipts r where building_id=p_building_id),'[]'),
    'reservations',coalesce((select jsonb_agg(to_jsonb(r) order by unit_id) from public.cimac_apartment_paid_reservations r where building_id=p_building_id),'[]'));
end; $$;
revoke all on function private.cimac_paid_scope(boolean),private.guard_cimac_paid_immutable(),private.guard_cimac_paid_request_namespace(),private.guard_cimac_paid_money(),private.guard_cimac_paid_double_booking(),private.guard_cimac_paid_audit(),private.cimac_paid_money(jsonb,text),private.cimac_paid_request(jsonb),private.cimac_paid_result(uuid),private.cimac_apartment_paid_execute(jsonb),
  public.cimac_apartment_paid_receipt_execute_rpc(jsonb),public.cimac_apartment_paid_receipt_status_rpc(uuid),public.cimac_apartment_paid_receipts_read_rpc(uuid) from public,anon,authenticated,service_role;
grant execute on function private.cimac_paid_scope(boolean),private.cimac_paid_result(uuid),private.cimac_apartment_paid_execute(jsonb),public.cimac_apartment_paid_receipt_execute_rpc(jsonb),public.cimac_apartment_paid_receipt_status_rpc(uuid),public.cimac_apartment_paid_receipts_read_rpc(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
