begin;

-- Materialize an explicitly documented, existing commercial-shop reservation.
-- This endpoint never signs/starts a lease and never writes financial facts.
create table private.cimac_reserved_contract_requests (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  project_id uuid not null references public.projects(id),
  customer_id uuid not null references public.customers(id),
  input jsonb not null,
  before_state jsonb not null,
  after_state jsonb,
  result jsonb,
  audit_id uuid not null unique,
  status text not null check (status in ('executing','completed')),
  created_at timestamptz not null default clock_timestamp(),
  check (status <> 'completed' or (after_state is not null and result is not null))
);
create index cimac_reserved_contract_actor_idx on private.cimac_reserved_contract_requests(actor_id);
create index cimac_reserved_contract_project_idx on private.cimac_reserved_contract_requests(project_id);
create index cimac_reserved_contract_customer_idx on private.cimac_reserved_contract_requests(customer_id);
alter table private.cimac_reserved_contract_requests enable row level security;
revoke all on private.cimac_reserved_contract_requests from public,anon,authenticated,service_role;

create unique index cimac_reserved_contract_audit_once on public.audit_logs(entity_id)
  where entity_type='cimac_reserved_contracts';
create function private.guard_cimac_reserved_contract_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare journal private.cimac_reserved_contract_requests%rowtype;
begin
  if tg_op<>'INSERT' then
    if old.entity_type='cimac_reserved_contracts' or (tg_op='UPDATE' and new.entity_type='cimac_reserved_contracts') then
      raise exception 'cimacReservedAuditProtected' using errcode='42501';
    end if;
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if new.entity_type<>'cimac_reserved_contracts' then return new; end if;
  select * into journal from private.cimac_reserved_contract_requests r where r.request_id=new.entity_id;
  if journal.request_id is null or journal.status<>'executing' or journal.actor_id is distinct from auth.uid()
    or current_setting('app.cimac_reserved_contract_request_id',true) is distinct from journal.request_id::text
    or new.id is distinct from journal.audit_id or new.actor_id is distinct from journal.actor_id
    or new.actor_role is distinct from 'admin' or new.action is distinct from 'materialize_reservations'
    or new.before_data is distinct from journal.before_state or new.after_data is distinct from journal.after_state
    or new.metadata is distinct from jsonb_build_object('request_id',journal.request_id,'input',journal.input,
      'result',journal.result,'channel','cimac_reserved_contracts_rpc','non_financial',true) then
    raise exception 'cimacReservedAuditProtected' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function private.guard_cimac_reserved_contract_audit() from public,anon,authenticated,service_role;
create trigger guard_cimac_reserved_contract_audit before insert or update or delete on public.audit_logs
  for each row execute function private.guard_cimac_reserved_contract_audit();

create function private.cimac_materialize_reserved_contracts(p_request_id uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); project uuid; customer uuid; customer_row public.customers%rowtype;
  membership private.cimac_customer_memberships%rowtype; item jsonb; u public.units%rowtype;
  unit_ids uuid[]:='{}'; unit_id uuid; monthly numeric; deposit numeric; customer_stamp timestamptz;
  unit_stamp timestamptz; prior private.cimac_reserved_contract_requests%rowtype;
  before_doc jsonb; after_doc jsonb; result_doc jsonb; contracts_doc jsonb:='[]';
  audit uuid:=gen_random_uuid(); contract uuid; old_context text; n integer:=0;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin'),false) then
    raise exception 'cimacReservedPermissionDenied' using errcode='42501';
  end if;
  if p_request_id is null or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>131072
    or not p_input ?& array['customerId','customerName','expectedCustomerUpdatedAt','reason','units']
    or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(array['customerId','customerName','expectedCustomerUpdatedAt','reason','units']))
    or jsonb_typeof(p_input->'customerId') is distinct from 'string'
    or p_input->>'customerId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'customerName') is distinct from 'string'
    or length(coalesce(p_input->>'customerName','')) not between 1 and 200
    or p_input->>'customerName' is distinct from btrim(p_input->>'customerName')
    or jsonb_typeof(p_input->'reason') is distinct from 'string' or length(coalesce(p_input->>'reason','')) not between 1 and 4000
    or p_input->>'reason' is distinct from btrim(p_input->>'reason')
    or jsonb_typeof(p_input->'expectedCustomerUpdatedAt') is distinct from 'string'
    or p_input->>'expectedCustomerUpdatedAt' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    or jsonb_typeof(p_input->'units') is distinct from 'array' or jsonb_array_length(p_input->'units') not between 1 and 30 then
    raise exception 'cimacReservedInvalidRequest' using errcode='22023';
  end if;
  customer:=(p_input->>'customerId')::uuid;
  customer_stamp:=(p_input->>'expectedCustomerUpdatedAt')::timestamptz;
  if not isfinite(customer_stamp) then raise exception 'cimacReservedInvalidRequest' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_input->'units') loop
    if jsonb_typeof(item) is distinct from 'object'
      or not item ?& array['unitId','expectedUnitUpdatedAt','monthlyRentXof','depositXof','sourceReference']
      or exists(select 1 from jsonb_object_keys(item) k where k<>all(array['unitId','expectedUnitUpdatedAt','monthlyRentXof','depositXof','sourceReference']))
      or jsonb_typeof(item->'unitId') is distinct from 'string'
      or item->>'unitId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'expectedUnitUpdatedAt') is distinct from 'string'
      or item->>'expectedUnitUpdatedAt' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or jsonb_typeof(item->'monthlyRentXof') is distinct from 'string' or item->>'monthlyRentXof' !~ '^[1-9][0-9]{0,11}$'
      or jsonb_typeof(item->'depositXof') is distinct from 'string' or item->>'depositXof' !~ '^[1-9][0-9]{0,11}$'
      or jsonb_typeof(item->'sourceReference') is distinct from 'string' or length(coalesce(item->>'sourceReference','')) not between 1 and 2000
      or item->>'sourceReference' is distinct from btrim(item->>'sourceReference') then
      raise exception 'cimacReservedInvalidRequest' using errcode='22023';
    end if;
    unit_id:=(item->>'unitId')::uuid; unit_stamp:=(item->>'expectedUnitUpdatedAt')::timestamptz;
    monthly:=(item->>'monthlyRentXof')::numeric; deposit:=(item->>'depositXof')::numeric;
    if unit_id=any(unit_ids) or not isfinite(unit_stamp) or deposit<>3*monthly then
      raise exception 'cimacReservedInvalidRequest' using errcode='22023';
    end if;
    unit_ids:=array_append(unit_ids,unit_id);
  end loop;
  if (select count(*) from public.projects p where p.code='CIMAC')<>1 then
    raise exception 'cimacReservedScopeConflict';
  end if;
  select p.id into project from public.projects p where p.code='CIMAC';
  if not coalesce(public.can_access_project(project),false)
    or exists(select 1 from unnest(unit_ids) x(id) where not coalesce(public.can_access_unit(x.id),false)
      or not exists(select 1 from public.units z join public.buildings b on b.id=z.building_id where z.id=x.id and b.project_id=project)) then
    raise exception 'cimacReservedPermissionDenied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from private.cimac_reserved_contract_requests r where r.request_id=p_request_id;
  if found then
    if prior.actor_id is distinct from actor or prior.project_id is distinct from project
      or prior.customer_id is distinct from customer or prior.input is distinct from p_input or prior.status<>'completed'
      or not exists(select 1 from public.audit_logs a where a.id=prior.audit_id and a.entity_type='cimac_reserved_contracts'
        and a.entity_id=p_request_id and a.actor_id=actor and a.before_data=prior.before_state and a.after_data=prior.after_state) then
      raise exception 'cimacReservedRequestConflict' using errcode='23505';
    end if;
    return prior.result||jsonb_build_object('idempotent',true);
  end if;
  -- Same project mutex and row order as existing maintenance/finance writers.
  perform pg_advisory_xact_lock(hashtextextended('cimac-maintenance-project',0));
  perform 1 from public.projects p where p.id=project order by p.id for update;
  perform 1 from public.buildings b where b.project_id=project order by b.id for update;
  perform 1 from public.units z where z.building_id in(select b.id from public.buildings b where b.project_id=project) order by z.id for update;
  perform 1 from public.lease_contracts c where c.unit_id in(select z.id from public.units z join public.buildings b on b.id=z.building_id where b.project_id=project) order by c.id for update;
  perform 1 from public.customers c where c.id=customer or c.id in(select lc.customer_id from public.lease_contracts lc join public.units z on z.id=lc.unit_id join public.buildings b on b.id=z.building_id where b.project_id=project) order by c.id for update;
  perform 1 from private.cimac_customer_memberships m where m.project_id=project and m.customer_id=customer for update;
  perform 1 from private.cimac_customer_unit_links l where l.unit_id=any(unit_ids) order by l.id for update;
  perform 1 from public.sale_contracts c where c.unit_id=any(unit_ids) order by c.id for update;
  perform 1 from public.payments p where p.unit_id=any(unit_ids) order by p.id for update;
  perform 1 from public.ledger_entries l where l.unit_id=any(unit_ids) order by l.id for update;
  perform 1 from public.receivables r where r.unit_id=any(unit_ids) order by r.id for update;
  perform 1 from public.property_fee_rules f where f.unit_id=any(unit_ids) order by f.id for update;

  select * into customer_row from public.customers c where c.id=customer;
  select * into membership from private.cimac_customer_memberships m where m.project_id=project and m.customer_id=customer;
  if customer_row.id is null or customer_row.name is distinct from p_input->>'customerName'
    or membership.customer_id is null or membership.status is distinct from 'current' then raise exception 'cimacReservedScopeConflict'; end if;
  if customer_row.updated_at is distinct from customer_stamp then raise exception 'cimacReservedSnapshotChanged' using errcode='40001'; end if;
  for item in select value from jsonb_array_elements(p_input->'units') loop
    select * into u from public.units z where z.id=(item->>'unitId')::uuid;
    if u.updated_at is distinct from (item->>'expectedUnitUpdatedAt')::timestamptz then raise exception 'cimacReservedSnapshotChanged' using errcode='40001'; end if;
    if u.status is distinct from 'reserved' or u.kind is distinct from 'storefront' or u.asset_subtype is distinct from 'commercial_shop'
      or u.unit_no='231' or u.reservation_holder_name is distinct from customer_row.name
      or u.operational_condition is distinct from 'normal'
      or not exists(select 1 from public.buildings b join public.projects p on p.id=b.project_id
        where b.id=u.building_id and b.project_id=project and b.is_active and p.allows_long_lease)
      or (select count(*) from private.cimac_customer_unit_links l where l.project_id=project and l.unit_id=u.id
        and l.customer_id=customer and l.relationship_kind='reservation' and l.signing_state='unconfirmed' and l.signed_date is null)<>1
      or exists(select 1 from private.cimac_customer_unit_links l join private.cimac_customer_memberships m
        on m.project_id=l.project_id and m.customer_id=l.customer_id where l.project_id=project and l.unit_id=u.id
        and l.customer_id<>customer and m.status='current') then raise exception 'cimacReservedScopeConflict'; end if;
    if exists(select 1 from public.lease_contracts c where c.unit_id=u.id and c.status in ('draft','active'))
      or exists(select 1 from public.sale_contracts c where c.unit_id=u.id and c.status in ('draft','active'))
      or exists(select 1 from public.daily_bookings d where d.unit_id=u.id and d.status in ('pending_review','confirmed','checked_in'))
      or exists(select 1 from public.payments p where p.unit_id=u.id or p.source_id in(select c.id from public.lease_contracts c where c.unit_id=u.id))
      or exists(select 1 from public.ledger_entries l where l.unit_id=u.id)
      or exists(select 1 from public.receivables r where r.unit_id=u.id and r.status<>'cancelled') then raise exception 'cimacReservedBusinessConflict'; end if;
  end loop;
  select jsonb_build_object('customer',to_jsonb(customer_row),'membership',to_jsonb(membership),
    'units',(select jsonb_agg(to_jsonb(z) order by z.id) from public.units z where z.id=any(unit_ids)),
    'links',(select jsonb_agg(to_jsonb(l) order by l.id) from private.cimac_customer_unit_links l where l.unit_id=any(unit_ids)),
    'fees',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.property_fee_rules f where f.unit_id=any(unit_ids)),'[]'::jsonb),
    'contracts',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.lease_contracts c where c.unit_id=any(unit_ids)),'[]'::jsonb)) into before_doc;
  insert into private.cimac_reserved_contract_requests(request_id,actor_id,project_id,customer_id,input,before_state,audit_id,status)
    values(p_request_id,actor,project,customer,p_input,before_doc,audit,'executing');
  for item in select value from jsonb_array_elements(p_input->'units') loop
    n:=n+1; unit_id:=(item->>'unitId')::uuid;
    contract:=private.cimac_child_uuid(p_request_id,'reserved-contract:'||unit_id::text);
    if exists(select 1 from public.lease_contracts c where c.id=contract) then raise exception 'cimacReservedRequestConflict' using errcode='23505'; end if;
    insert into public.lease_contracts(id,unit_id,customer_id,contract_no,status,signing_state,commencement_state,
      start_date,expected_end_date,actual_end_date,paid_through_date,expected_end_confirmed,signer_name,
      payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,deposit_received,deposit_months,
      rent_currency,monthly_rent_amount,source_reference)
    values(contract,unit_id,customer,'CIMAC-RESERVED-'||p_request_id::text||'-'||n,'draft','pending_confirmation','pending_project_opening',
      null,null,null,null,false,null,'annual',5,(item->>'monthlyRentXof')::numeric,(item->>'depositXof')::numeric,false,3,
      'XOF',null,(item->>'sourceReference')||E'\n'||(p_input->>'reason')||E'\n仅将已有预留资料建立为待开业合同；签署、起租及实际入住事实待核，签署/起止/入住日期未确认；本操作不登记收款、应收或实际入住；原客户、商铺预留和物业规则保留。请求'||p_request_id);
    contracts_doc:=contracts_doc||jsonb_build_array(jsonb_build_object('unitId',unit_id,'contractId',contract));
  end loop;
  select jsonb_build_object('customer',(select to_jsonb(c) from public.customers c where c.id=customer),
    'membership',(select to_jsonb(m) from private.cimac_customer_memberships m where m.project_id=project and m.customer_id=customer),
    'units',(select jsonb_agg(to_jsonb(z) order by z.id) from public.units z where z.id=any(unit_ids)),
    'links',(select jsonb_agg(to_jsonb(l) order by l.id) from private.cimac_customer_unit_links l where l.unit_id=any(unit_ids)),
    'fees',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.property_fee_rules f where f.unit_id=any(unit_ids)),'[]'::jsonb),
    'contracts',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.lease_contracts c where c.unit_id=any(unit_ids)),'[]'::jsonb)) into after_doc;
  if (before_doc-'contracts') is distinct from (after_doc-'contracts') then raise exception 'cimacReservedScopeConflict'; end if;
  result_doc:=jsonb_build_object('success',true,'requestId',p_request_id,'actorId',actor,'projectId',project,'contracts',contracts_doc,'idempotent',false);
  update private.cimac_reserved_contract_requests set after_state=after_doc,result=result_doc where request_id=p_request_id;
  old_context:=current_setting('app.cimac_reserved_contract_request_id',true);
  perform set_config('app.cimac_reserved_contract_request_id',p_request_id::text,true);
  insert into public.audit_logs(id,actor_id,actor_email,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(audit,actor,auth.jwt()->>'email','admin','materialize_reservations','cimac_reserved_contracts',p_request_id,before_doc,after_doc,
      jsonb_build_object('request_id',p_request_id,'input',p_input,'result',result_doc,'channel','cimac_reserved_contracts_rpc','non_financial',true));
  perform set_config('app.cimac_reserved_contract_request_id',coalesce(old_context,''),true);
  update private.cimac_reserved_contract_requests set status='completed' where request_id=p_request_id;
  return result_doc;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'cimacReservedInvalidRequest' using errcode='22023';
end; $$;
revoke all on function private.cimac_materialize_reserved_contracts(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.cimac_materialize_reserved_contracts(uuid,jsonb) to authenticated;

create function public.cimac_reserved_contracts_rpc(p_request_id uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select private.cimac_materialize_reserved_contracts($1,$2);
$$;
revoke all on function public.cimac_reserved_contracts_rpc(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.cimac_reserved_contracts_rpc(uuid,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
