begin;

-- Additive facts only. No historical actor, collector, period or allocation is inferred.
alter table public.payments
  add column actual_collector text,
  add column collector_basis text,
  add column recorded_by uuid references auth.users(id),
  add column context_version bigint not null default 0,
  add column context_confirmed_by uuid references auth.users(id),
  add column context_confirmed_at timestamptz,
  add constraint payment_collector_facts_valid check (
    (actual_collector is null and collector_basis is null)
    or (actual_collector is not null and collector_basis is not null
      and length(btrim(actual_collector)) between 1 and 100 and length(btrim(collector_basis)) between 1 and 1000)
  ),
  add constraint payment_context_version_valid check(context_version>=0);

alter table public.receivables
  add column service_period_start date,
  add column service_period_end date,
  add column service_period_source text,
  add column service_period_confirmed_by uuid references auth.users(id),
  add constraint receivable_service_period_valid check (
    (service_period_start is null and service_period_end is null and service_period_source is null)
    or (service_period_start is not null and service_period_end is not null
      and isfinite(service_period_start) and isfinite(service_period_end)
      and service_period_end>=service_period_start and service_period_source is not null and length(btrim(service_period_source)) between 1 and 1000)
  );

create function private.capture_payment_recording_actor() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  -- Transport-supplied actor IDs never override the authenticated recording account.
  new.recorded_by := auth.uid();
  return new;
end; $$;
revoke all on function private.capture_payment_recording_actor() from public,anon,authenticated,service_role;
create trigger capture_payment_recording_actor before insert on public.payments
  for each row execute function private.capture_payment_recording_actor();

-- Legacy financial table DML remains a separate compatibility risk. Its grants
-- and permissive policies are NOT proof that new confirmation facts are safe.
-- Invoker guards reject direct Data API fact writes, while the authenticated,
-- project-checked private definer confirmation remains the audited write path.
create function private.guard_payment_context_facts() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and new.recorded_by is distinct from old.recorded_by then
    raise exception 'recordingActorImmutable' using errcode='42501';
  end if;
  if current_user in ('authenticated','anon') then
    if tg_op='INSERT' then
      if new.actual_collector is not null or new.collector_basis is not null
        or new.context_version is distinct from 0 or new.context_confirmed_by is not null
        or new.context_confirmed_at is not null then
        raise exception 'paymentFactsConfirmationRequired' using errcode='42501';
      end if;
    elsif (new.actual_collector,new.collector_basis,new.context_version,new.context_confirmed_by,new.context_confirmed_at)
      is distinct from (old.actual_collector,old.collector_basis,old.context_version,old.context_confirmed_by,old.context_confirmed_at) then
      raise exception 'paymentFactsConfirmationRequired' using errcode='42501';
    end if;
  end if;
  return new;
end; $$;
revoke all on function private.guard_payment_context_facts() from public,anon,authenticated,service_role;
create trigger guard_payment_context_facts before insert or update on public.payments
  for each row execute function private.guard_payment_context_facts();

create function private.guard_receivable_period_facts() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op='INSERT' then
      if new.service_period_start is not null or new.service_period_end is not null
        or new.service_period_source is not null or new.service_period_confirmed_by is not null then
        raise exception 'paymentFactsConfirmationRequired' using errcode='42501';
      end if;
    elsif (new.service_period_start,new.service_period_end,new.service_period_source,new.service_period_confirmed_by)
      is distinct from (old.service_period_start,old.service_period_end,old.service_period_source,old.service_period_confirmed_by) then
      raise exception 'paymentFactsConfirmationRequired' using errcode='42501';
    end if;
  end if;
  return new;
end; $$;
revoke all on function private.guard_receivable_period_facts() from public,anon,authenticated,service_role;
create trigger guard_receivable_period_facts before insert or update on public.receivables
  for each row execute function private.guard_receivable_period_facts();

create table private.payment_context_requests (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  payment_id uuid not null references public.payments(id),
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.payment_context_requests enable row level security;
revoke all on private.payment_context_requests from public,anon,authenticated,service_role;

create function public.payment_context_read_rpc(p_payment_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p public.payments%rowtype; target_unit uuid; lease_unit uuid; sale_unit uuid; target_building uuid; result jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','finance','boss'),false) then
    raise exception 'paymentContextPermissionDenied' using errcode='42501'; end if;
  select * into p from public.payments where id=p_payment_id;
  if not found then raise exception 'paymentContextNotFound'; end if;
  target_unit:=p.unit_id;
  if target_unit is null then
    if p.source_type='daily_booking' then
      select unit_id into target_unit from public.daily_bookings where id=p.source_id;
    elsif p.source_type like 'lease%' then
      select unit_id into target_unit from public.lease_contracts where id=p.source_id;
    elsif p.source_type like 'sale%' then
      select unit_id into target_unit from public.sale_contracts where id=p.source_id;
    elsif p.source_type in ('property_fee','parking_fee') then
      -- These fee kinds are used by both domains. Exact UUID links only; never
      -- choose a contract by its status, customer, amount or convenient project.
      select unit_id into lease_unit from public.lease_contracts where id=p.source_id;
      select unit_id into sale_unit from public.sale_contracts where id=p.source_id;
      if lease_unit is not null and sale_unit is not null and lease_unit<>sale_unit then
        raise exception 'paymentContextPermissionDenied' using errcode='42501'; end if;
      target_unit:=coalesce(lease_unit,sale_unit);
    end if;
  end if;
  if target_unit is not null then
    if not coalesce(public.can_access_unit(target_unit),false) then
      raise exception 'paymentContextPermissionDenied' using errcode='42501'; end if;
    select building_id into target_building from public.units where id=target_unit;
  elsif p.source_type='manual' then
    -- Manual receipts can legitimately be building-level. Only the exact
    -- two-way ledger identity is evidence; date/amount/description are not links.
    select l.building_id into target_building from public.ledger_entries l
      where l.id=p.source_id and l.payment_id=p.id and l.building_id is not null
        and (select count(*) from public.ledger_entries other where other.payment_id=p.id)=1;
  end if;
  if target_building is null or not coalesce(public.can_access_building(target_building),false) then
    raise exception 'paymentContextPermissionDenied' using errcode='42501'; end if;
  select jsonb_build_object(
    'paymentId',p.id,'unitId',target_unit,'buildingId',target_building,'paymentDate',p.payment_date,'amount',p.amount,'currency',p.currency,
    'recordedBy',p.recorded_by,'recordedByName',case when p.recorded_by=auth.uid() then (select display_name from public.user_profiles where id=p.recorded_by) end,
    'actualCollector',p.actual_collector,'collectorBasis',p.collector_basis,
    'version',p.context_version,'token',md5(to_jsonb(p)::text),
    'confirmedBy',p.context_confirmed_by,'confirmedAt',p.context_confirmed_at,
    'allocatedXof',coalesce((select sum(a.amount_xof) from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id
      where a.payment_id=p.id and r.unit_id=target_unit and public.can_access_unit(r.unit_id)),0),
    'allocations',coalesce((select jsonb_agg(jsonb_build_object(
      'receivableId',r.id,'title',r.title,'dueDate',r.due_date,'allocatedXof',a.amount_xof,
      'periodStart',r.service_period_start,'periodEnd',r.service_period_end,
      'periodSource',r.service_period_source,'token',md5(to_jsonb(r)::text)) order by r.due_date,r.id)
      from public.payment_receivable_allocations a join public.receivables r on r.id=a.receivable_id
      where a.payment_id=p.id and r.unit_id=target_unit and public.can_access_unit(r.unit_id)),'[]'::jsonb)) into result;
  return result;
end; $$;

-- Restricted metadata writer: legacy direct financial DML grants are unchanged;
-- invoker guards protect new facts and only this definer supplies audited updates.
-- Every call verifies identity, current role,
-- exact project access and fresh snapshots; no financial amount is updated.
create function private.confirm_payment_context(p_payment_id uuid,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payments%rowtype; r public.receivables%rowtype;
  prior private.payment_context_requests%rowtype; actor uuid:=auth.uid();
  before_facts jsonb; after_facts jsonb; item jsonb; periods jsonb;
  start_date date; end_date date; source text; collector text; basis text;
  target_unit uuid; target_source text; target_contract uuid; source_count integer;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance'),false) then
    raise exception 'paymentContextPermissionDenied' using errcode='42501'; end if;
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object'
    or octet_length(p_input::text)>65536
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('expectedToken','collectorName','collectorBasis','periods'))
    or coalesce(p_input->>'expectedToken','') !~ '^[0-9a-f]{32}$' then
    raise exception 'invalidPaymentContext'; end if;
  periods:=coalesce(p_input->'periods','[]'::jsonb);
  if jsonb_typeof(periods)<>'array' or jsonb_array_length(periods)>100
    or (not (p_input ? 'collectorName') and jsonb_array_length(periods)=0) then
    raise exception 'invalidPaymentContext'; end if;
  if p_input ? 'collectorName' then
    collector:=btrim(p_input->>'collectorName'); basis:=btrim(p_input->>'collectorBasis');
    if jsonb_typeof(p_input->'collectorName')<>'string' or jsonb_typeof(p_input->'collectorBasis') is distinct from 'string'
      or length(coalesce(collector,'')) not between 1 and 100 or length(coalesce(basis,'')) not between 1 and 1000 then
      raise exception 'invalidPaymentContext'; end if;
  elsif p_input ? 'collectorBasis' then raise exception 'invalidPaymentContext'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from private.payment_context_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>actor or prior.payment_id<>p_payment_id or prior.input is distinct from p_input then
      raise exception 'paymentContextRequestConflict'; end if;
    -- Recheck current project access even for an idempotent replay.
    perform public.payment_context_read_rpc(p_payment_id);
    return prior.result;
  end if;
  select * into p from public.payments where id=p_payment_id;
  if not found then raise exception 'paymentContextNotFound'; end if;
  before_facts:=public.payment_context_read_rpc(p_payment_id);
  target_unit:=(before_facts->>'unitId')::uuid;
  if target_unit is null and jsonb_array_length(periods)>0 then raise exception 'paymentContextTargetMismatch'; end if;
  if (select count(*) from jsonb_array_elements(periods))<>(select count(distinct x->>'receivableId') from jsonb_array_elements(periods) x) then
    raise exception 'invalidPaymentContext'; end if;
  -- Serialize lease/sale period metadata with their existing financial parents.
  -- Daily reversals lock payment BEFORE booking: never introduce booking->payment.
  -- Ambiguous cross-contract/domain allocations need review, not a new lock graph.
  if jsonb_array_length(periods)>0 then
    select count(distinct (rr.source_type,rr.source_id)),min(rr.source_type),min(rr.source_id::text)::uuid
      into source_count,target_source,target_contract
      from public.receivables rr join public.payment_receivable_allocations a on a.receivable_id=rr.id
      where a.payment_id=p.id and rr.id in (select (x->>'receivableId')::uuid from jsonb_array_elements(periods) x);
    if source_count>1 then raise exception 'paymentContextTargetMismatch'; end if;
    if target_source='lease_contract' then
      perform 1 from public.lease_contracts where id=target_contract and unit_id=target_unit for update;
      if not found then raise exception 'paymentContextTargetMismatch'; end if;
    elsif target_source='sale_contract' then
      perform 1 from public.sale_contracts where id=target_contract and unit_id=target_unit for update;
      if not found then raise exception 'paymentContextTargetMismatch'; end if;
    elsif target_source='daily_booking' and jsonb_array_length(periods)>1 then
      raise exception 'paymentContextTargetMismatch';
    end if;
  end if;
  select * into p from public.payments where id=p_payment_id for update;
  before_facts:=public.payment_context_read_rpc(p_payment_id);
  target_unit:=(before_facts->>'unitId')::uuid;
  if before_facts->>'token' is distinct from p_input->>'expectedToken' then
    raise exception 'paymentContextSnapshotChanged'; end if;
  -- Match lease collection/settlement due_date,id order, not arbitrary UUID order.
  perform 1 from public.receivables rr join public.payment_receivable_allocations a on a.receivable_id=rr.id
    where a.payment_id=p.id and rr.id in (select (x->>'receivableId')::uuid from jsonb_array_elements(periods) x)
    order by rr.due_date,rr.id for update of rr;
  for item in select value from jsonb_array_elements(periods)
    order by (select due_date from public.receivables where id=(value->>'receivableId')::uuid),value->>'receivableId' loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k
      where k not in ('receivableId','expectedToken','start','end','source'))
      or coalesce(item->>'expectedToken','') !~ '^[0-9a-f]{32}$' then raise exception 'invalidPaymentContext'; end if;
    select rr.* into r from public.receivables rr join public.payment_receivable_allocations a on a.receivable_id=rr.id
      where a.payment_id=p.id and rr.id=(item->>'receivableId')::uuid for update of rr;
    if not found or r.status='cancelled' or r.unit_id is distinct from target_unit
      or not public.can_access_unit(r.unit_id) then raise exception 'paymentContextTargetMismatch'; end if;
    if md5(to_jsonb(r)::text) is distinct from item->>'expectedToken' then raise exception 'paymentContextSnapshotChanged'; end if;
    if jsonb_typeof(item->'start') is distinct from 'string' or jsonb_typeof(item->'end') is distinct from 'string'
      or jsonb_typeof(item->'source') is distinct from 'string'
      or item->>'start' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or item->>'end' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalidPaymentContext'; end if;
    begin start_date:=(item->>'start')::date; end_date:=(item->>'end')::date;
    exception when others then raise exception 'invalidPaymentContext'; end;
    source:=btrim(item->>'source');
    if not isfinite(start_date) or not isfinite(end_date) or end_date<start_date
      or to_char(start_date,'YYYY-MM-DD')<>item->>'start' or to_char(end_date,'YYYY-MM-DD')<>item->>'end'
      or length(coalesce(source,'')) not between 1 and 1000 then raise exception 'invalidPaymentContext'; end if;
    update public.receivables set service_period_start=start_date,service_period_end=end_date,
      service_period_source=source,service_period_confirmed_by=actor where id=r.id;
  end loop;
  update public.payments set actual_collector=case when p_input ? 'collectorName' then collector else actual_collector end,
    collector_basis=case when p_input ? 'collectorName' then basis else collector_basis end,
    context_version=context_version+1,context_confirmed_by=actor,context_confirmed_at=clock_timestamp() where id=p.id;
  after_facts:=public.payment_context_read_rpc(p.id);
  insert into public.audit_logs(actor_id,actor_email,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(actor,auth.jwt()->>'email',public.current_user_role(),'confirm_payment_context','payment_context',p.id,
      before_facts,after_facts,jsonb_build_object('request_id',p_request_id,'channel','sacsi_web','amounts_unchanged',true));
  insert into private.payment_context_requests(request_id,actor_id,payment_id,input,result)
    values(p_request_id,actor,p.id,p_input,after_facts);
  return after_facts;
end; $$;

create function public.confirm_payment_context_rpc(p_payment_id uuid,p_input jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.confirm_payment_context($1,$2,$3);
$$;
revoke all on function public.payment_context_read_rpc(uuid),public.confirm_payment_context_rpc(uuid,jsonb,uuid),
  private.confirm_payment_context(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.payment_context_read_rpc(uuid),public.confirm_payment_context_rpc(uuid,jsonb,uuid),
  private.confirm_payment_context(uuid,jsonb,uuid) to authenticated;

-- New writes only: record the exact receivable IDs already validated and locked
-- by the original transaction. Residual lease prepayments stay unallocated.
create function private.record_verified_payment_allocation(p_payment uuid,p_receivable uuid,p_amount numeric,p_request uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  -- Legacy maintenance calls may have no human identity. Do not invent one or
  -- broaden that existing path; its allocation remains explicitly unknown.
  if auth.uid() is null then return; end if;
  insert into public.payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id)
    values(p_payment,p_receivable,p_amount,auth.uid(),p_request)
    on conflict(payment_id,receivable_id) do nothing;
  if not exists(select 1 from public.payment_receivable_allocations where payment_id=p_payment and receivable_id=p_receivable
    and amount_xof=p_amount and actor_id=auth.uid() and request_id=p_request) then raise exception 'allocationRequestConflict'; end if;
end; $$;
revoke all on function private.record_verified_payment_allocation(uuid,uuid,numeric,uuid) from public,anon,authenticated,service_role;

do $migration$
declare definition text; old_text text;
begin
  definition:=replace(pg_get_functiondef('private.record_lease_financial_entry_atomic(uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  old_text:='v_remaining:=v_remaining-v_applied;';
  if strpos(definition,old_text)=0 then raise exception 'leaseAllocationMigrationDrift'; end if;
  execute replace(definition,old_text,'perform private.record_verified_payment_allocation(v_payment_id,v_receivable.id,v_applied,p_request_id); '||old_text);
  definition:=replace(pg_get_functiondef('private.lease_lifecycle(text,jsonb,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  old_text:='balance:=balance-applied;';
  if strpos(definition,old_text)=0 then raise exception 'leaseSettlementAllocationMigrationDrift'; end if;
  execute replace(definition,old_text,'if applied>0 then perform private.record_verified_payment_allocation(payment_id,r.id,applied,p_request_id); end if; '||old_text);
  definition:=replace(pg_get_functiondef('private.operator_record_daily_payment(uuid,numeric,date,text,uuid,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
  old_text:='perform public.daily_sync_booking_finance_tx(p_booking_id);';
  if strpos(definition,old_text)=0 then raise exception 'dailyAllocationMigrationDrift'; end if;
  execute replace(definition,old_text,old_text||' perform private.record_verified_payment_allocation(v_payment_id,(select id from public.receivables where source_type=''daily_booking'' and source_id=p_booking_id and status<>''cancelled''),p_amount,p_request_id);');
  -- The batch path already records this same allocation after its shared daily
  -- writer; use the checked idempotent helper to avoid double insertion.
  definition:=replace(pg_get_functiondef('private.confirm_operator_collection(uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  old_text:='insert into public.payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id) values(payment_id,r.id,(a->>''amountXof'')::numeric,actor,child);';
  if strpos(definition,old_text)=0 then raise exception 'batchAllocationMigrationDrift'; end if;
  execute replace(definition,old_text,'perform private.record_verified_payment_allocation(payment_id,r.id,(a->>''amountXof'')::numeric,child);');
end; $migration$;

comment on column public.payments.actual_collector is 'Explicitly confirmed actual collector; not guest, booking agent, recording login or confirmer. Unknown historic values stay null.';
comment on column public.payments.recorded_by is 'Authenticated account that inserted a new payment after this migration; no historical inference.';
comment on column public.receivables.service_period_source is 'Explicit receipt/contract/confirmation basis for the service-period dates. Never derived from due_date.';
notify pgrst,'reload schema';
commit;
