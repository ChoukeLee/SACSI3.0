begin;

-- Additive project membership and explicit documentary links. These are not
-- leases, reservations in the lease lifecycle, receivables, or payment facts.
create table private.cimac_customer_memberships (
  project_id uuid not null references public.projects(id),
  customer_id uuid not null references public.customers(id),
  status text not null check (status in ('current','archived')),
  source_reference text not null check (length(btrim(source_reference)) between 1 and 2000),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(project_id,customer_id)
);
create index cimac_customer_memberships_customer on private.cimac_customer_memberships(customer_id);
create index cimac_customer_memberships_actor on private.cimac_customer_memberships(recorded_by);

create table private.cimac_customer_unit_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  customer_id uuid not null,
  unit_id uuid not null references public.units(id),
  brand text check (brand is null or length(brand)<=250),
  relationship_kind text not null check (relationship_kind in ('signed_contract','reservation')),
  signing_state text not null check (signing_state in ('signed_effective','unconfirmed')),
  signed_date date check (signed_date is null or isfinite(signed_date)),
  source_reference text not null check (length(btrim(source_reference)) between 1 and 2000),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(project_id,customer_id) references private.cimac_customer_memberships(project_id,customer_id),
  unique(project_id,customer_id,unit_id)
);
create index cimac_customer_unit_links_customer on private.cimac_customer_unit_links(customer_id);
create index cimac_customer_unit_links_unit on private.cimac_customer_unit_links(unit_id);
create index cimac_customer_unit_links_actor on private.cimac_customer_unit_links(recorded_by);
alter table private.cimac_customer_memberships enable row level security;
alter table private.cimac_customer_unit_links enable row level security;
revoke all on private.cimac_customer_memberships,private.cimac_customer_unit_links from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant select,insert,update on private.cimac_customer_memberships,private.cimac_customer_unit_links to authenticated;

create function private.cimac_profile_scope(p_write boolean default false) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare target uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','boss','finance','rental_sales'),false)
    or (p_write and public.current_user_role() is distinct from 'admin') then
    raise exception 'CimacCustomerSyncDenied' using errcode='42501'; end if;
  select p.id into target from public.projects p where p.code='CIMAC';
  if target is null or not coalesce(public.can_access_project(target),false) then
    raise exception 'CimacCustomerSyncDenied' using errcode='42501'; end if;
  return target;
end; $$;

create function private.cimac_customer_has_current_business(p_customer uuid,p_project uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.lease_contracts c join public.units u on u.id=c.unit_id
    join public.buildings b on b.id=u.building_id where c.customer_id=p_customer and b.project_id=p_project and c.status in ('draft','active'))
  or exists(select 1 from public.sale_contracts c join public.units u on u.id=c.unit_id
    join public.buildings b on b.id=u.building_id where c.customer_id=p_customer and b.project_id=p_project and c.status in ('draft','active'))
  or exists(select 1 from public.daily_bookings c join public.units u on u.id=c.unit_id
    join public.buildings b on b.id=u.building_id where p_customer in (c.customer_id,c.guest_customer_id,c.booking_agent_id)
    and b.project_id=p_project and c.status in ('confirmed','checked_in'));
$$;

create function private.cimac_profile_keys(p_doc jsonb,p_keys text[]) returns void
language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_doc is null or jsonb_typeof(p_doc)<>'object'
    or exists(select 1 from jsonb_object_keys(p_doc) k where not(k=any(p_keys)))
    or exists(select 1 from unnest(p_keys) k where not(p_doc?k)) then
    raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
end; $$;

-- Private relations are not REST resources. Invoker writes still require a
-- validated RPC transaction context; all effects have one atomic batch audit.
create function private.guard_cimac_profile_relation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare project uuid;
begin
  project:=private.cimac_profile_scope(true);
  if nullif(current_setting('app.cimac_profile_request_id',true),'') is null or tg_op='DELETE'
    or new.project_id<>project then raise exception 'CimacCustomerSyncDenied' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.project_id<>old.project_id or new.customer_id<>old.customer_id) then
    raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
  if tg_table_name='cimac_customer_unit_links' then
    if not exists(select 1 from public.units u join public.buildings b on b.id=u.building_id
      where u.id=new.unit_id and b.project_id=project)
      or (tg_op='UPDATE' and new.unit_id<>old.unit_id) then
      raise exception 'CimacCustomerSyncDenied' using errcode='42501'; end if;
  elsif new.status='archived' and private.cimac_customer_has_current_business(new.customer_id,project) then
    raise exception 'CimacCustomerSyncArchiveActive' using errcode='22023';
  end if;
  new.recorded_by:=auth.uid();
  new.updated_at:=clock_timestamp();
  return new;
end; $$;
create trigger cimac_customer_memberships_guard before insert or update or delete on private.cimac_customer_memberships
for each row execute function private.guard_cimac_profile_relation();
create trigger cimac_customer_unit_links_guard before insert or update or delete on private.cimac_customer_unit_links
for each row execute function private.guard_cimac_profile_relation();

create policy "CIMAC directory reads memberships" on private.cimac_customer_memberships for select to authenticated
using(project_id=private.cimac_profile_scope(false));
create policy "CIMAC admin inserts memberships" on private.cimac_customer_memberships for insert to authenticated
with check(project_id=private.cimac_profile_scope(true) and recorded_by=auth.uid());
create policy "CIMAC admin updates memberships" on private.cimac_customer_memberships for update to authenticated
using(project_id=private.cimac_profile_scope(true)) with check(project_id=private.cimac_profile_scope(true) and recorded_by=auth.uid());
create policy "CIMAC directory reads links" on private.cimac_customer_unit_links for select to authenticated
using(project_id=private.cimac_profile_scope(false));
create policy "CIMAC admin inserts links" on private.cimac_customer_unit_links for insert to authenticated
with check(project_id=private.cimac_profile_scope(true) and recorded_by=auth.uid());
create policy "CIMAC admin updates links" on private.cimac_customer_unit_links for update to authenticated
using(project_id=private.cimac_profile_scope(true)) with check(project_id=private.cimac_profile_scope(true) and recorded_by=auth.uid());

create unique index cimac_customer_profile_request_once on public.audit_logs(entity_id)
where entity_type='cimac_customer_profile_sync';
create function private.guard_cimac_profile_audit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare project uuid;
begin
  if new.entity_type='cimac_customer_profile_sync' then
    project:=private.cimac_profile_scope(true);
    if tg_op<>'INSERT' or new.action<>'sync' or new.entity_id::text is distinct from nullif(current_setting('app.cimac_profile_request_id',true),'')
      or new.metadata->>'project_id' is distinct from project::text or new.actor_id is distinct from auth.uid() then
      raise exception 'CimacCustomerSyncDenied' using errcode='42501'; end if;
    new.actor_role:=public.current_user_role();
  end if;
  return new;
end; $$;
create trigger cimac_customer_profile_audit_guard before insert or update on public.audit_logs
for each row execute function private.guard_cimac_profile_audit();
create policy "CIMAC customer audit restriction" on public.audit_logs as restrictive for all to authenticated
using(entity_type<>'cimac_customer_profile_sync' or exists(select 1 from public.projects p
  where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id)))
with check(entity_type<>'cimac_customer_profile_sync' or (public.current_user_role()='admin' and exists(select 1 from public.projects p
  where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id))));

create function public.cimac_customer_profiles_sync_rpc(p_request_id uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  project uuid; actor uuid:=auth.uid(); item jsonb; link jsonb; customer uuid; target_unit uuid;
  old public.customers%rowtype; saved public.customers%rowtype; prior public.audit_logs%rowtype;
  before_rows jsonb:='[]'; after_rows jsonb:='[]'; results jsonb:='[]'; result jsonb;
  old_membership jsonb; old_links jsonb; row_status text; signing_date date;
  context_before text; customer_ids uuid[];
begin
  project:=private.cimac_profile_scope(true);
  perform private.cimac_profile_keys(p_input,array['rows']);
  if p_request_id is null or jsonb_typeof(p_input->'rows') is distinct from 'array'
    or jsonb_array_length(p_input->'rows') not between 1 and 250 or octet_length(p_input::text)>2097152 then
    raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
  -- Serialize this bounded CIMAC-only maintenance stream and each request. The
  -- customer locks below also conflict with the existing profile CAS writers.
  perform pg_advisory_xact_lock(hashtextextended('cimac_customer_profiles_sync:'||project::text,0));
  perform pg_advisory_xact_lock(hashtextextended('cimac_customer_profiles_request:'||p_request_id::text,0));
  select * into prior from public.audit_logs where entity_type='cimac_customer_profile_sync' and entity_id=p_request_id;
  if found then
    if prior.actor_id is distinct from actor or prior.metadata->'input' is distinct from p_input
      or prior.metadata->>'project_id' is distinct from project::text then
      raise exception 'CimacCustomerSyncRequestConflict' using errcode='22023'; end if;
    return (prior.metadata->'result')||jsonb_build_object('idempotent',true);
  end if;
  -- Validate every row and link before any mutation. No identity lookup by name.
  for item in select value from jsonb_array_elements(p_input->'rows') loop
    perform private.cimac_profile_keys(item,array['rowKey','customerId','expectedUpdatedAt','name','phone','notes','membershipStatus','sourceReference','links']);
    if jsonb_typeof(item->'rowKey') is distinct from 'string' or length(btrim(item->>'rowKey')) not between 1 and 200
      or jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 250
      or jsonb_typeof(item->'phone') not in ('string','null') or length(coalesce(item->>'phone',''))>500
      or jsonb_typeof(item->'notes') not in ('string','null') or length(coalesce(item->>'notes',''))>20000
      or jsonb_typeof(item->'membershipStatus') is distinct from 'string' or item->>'membershipStatus' not in ('current','archived')
      or jsonb_typeof(item->'sourceReference') is distinct from 'string' or length(btrim(item->>'sourceReference')) not between 1 and 2000
      or jsonb_typeof(item->'customerId') not in ('string','null') or jsonb_typeof(item->'expectedUpdatedAt') not in ('string','null')
      or jsonb_typeof(item->'links') is distinct from 'array' or jsonb_array_length(item->'links')>50 then
      raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
    if item->'customerId'='null'::jsonb then
      if item->'expectedUpdatedAt'<>'null'::jsonb or item->>'membershipStatus'<>'current' then
        raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
    else
      customer:=(item->>'customerId')::uuid;
      if item->'expectedUpdatedAt'='null'::jsonb or not isfinite((item->>'expectedUpdatedAt')::timestamptz) then
        raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
      if not exists(select 1 from private.cimac_customer_memberships m where m.project_id=project and m.customer_id=customer)
        and not exists(select 1 from public.lease_contracts c join public.units u on u.id=c.unit_id join public.buildings b on b.id=u.building_id
          where c.customer_id=customer and b.project_id=project)
        and not exists(select 1 from public.sale_contracts c join public.units u on u.id=c.unit_id join public.buildings b on b.id=u.building_id
          where c.customer_id=customer and b.project_id=project)
        and not exists(select 1 from public.daily_bookings c join public.units u on u.id=c.unit_id join public.buildings b on b.id=u.building_id
          where customer in (c.customer_id,c.guest_customer_id,c.booking_agent_id) and b.project_id=project)
        and not (item->>'membershipStatus'='current' and jsonb_array_length(item->'links')>0) then
        raise exception 'CimacCustomerSyncDenied' using errcode='42501'; end if;
    end if;
    if (select count(*) from jsonb_array_elements(item->'links'))<>(select count(distinct value->>'unitId') from jsonb_array_elements(item->'links')) then
      raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
    for link in select value from jsonb_array_elements(item->'links') loop
      perform private.cimac_profile_keys(link,array['unitId','brand','relationshipKind','signingState','signedDate','sourceReference']);
      if jsonb_typeof(link->'unitId') is distinct from 'string' or jsonb_typeof(link->'brand') not in ('string','null')
        or length(coalesce(link->>'brand',''))>250 or jsonb_typeof(link->'relationshipKind') is distinct from 'string'
        or link->>'relationshipKind' not in ('signed_contract','reservation') or jsonb_typeof(link->'signingState') is distinct from 'string'
        or link->>'signingState' not in ('signed_effective','unconfirmed') or jsonb_typeof(link->'signedDate') not in ('string','null')
        or jsonb_typeof(link->'sourceReference') is distinct from 'string' or length(btrim(link->>'sourceReference')) not between 1 and 2000 then
        raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
      target_unit:=(link->>'unitId')::uuid;
      if not exists(select 1 from public.units u join public.buildings b on b.id=u.building_id where u.id=target_unit and b.project_id=project) then
        raise exception 'CimacCustomerSyncDenied' using errcode='42501'; end if;
      if link->'signedDate'<>'null'::jsonb then
        signing_date:=(link->>'signedDate')::date;
        if (link->>'signedDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not isfinite(signing_date)
          or to_char(signing_date,'YYYY-MM-DD')<>link->>'signedDate' then
          raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
      end if;
    end loop;
  end loop;
  if (select count(*) from jsonb_array_elements(p_input->'rows'))<>(select count(distinct value->>'rowKey') from jsonb_array_elements(p_input->'rows'))
    or (select count(*) from jsonb_array_elements(p_input->'rows') where value->'customerId'<>'null'::jsonb)<>
      (select count(distinct value->>'customerId') from jsonb_array_elements(p_input->'rows') where value->'customerId'<>'null'::jsonb) then
    raise exception 'CimacCustomerSyncInvalid' using errcode='22023'; end if;
  -- Match the lease lifecycle's unit-first ordering. Unit FK writers and other
  -- profile batches cannot change the association while this RPC validates it.
  perform 1 from public.units u where u.id in(select (l.value->>'unitId')::uuid
    from jsonb_array_elements(p_input->'rows') r cross join lateral jsonb_array_elements(r.value->'links') l)
    order by u.id for update;
  select array_agg((value->>'customerId')::uuid order by value->>'customerId') into customer_ids
    from jsonb_array_elements(p_input->'rows') where value->'customerId'<>'null'::jsonb;
  perform 1 from public.customers c where c.id=any(customer_ids) order by c.id for update;
  for item in select value from jsonb_array_elements(p_input->'rows') where value->>'membershipStatus'='current' loop
    customer:=(item->>'customerId')::uuid;
    for link in select value from jsonb_array_elements(item->'links') loop
      target_unit:=(link->>'unitId')::uuid;
      if exists(select 1 from public.lease_contracts c where c.unit_id=target_unit and c.customer_id is distinct from customer and c.status in ('draft','active'))
        or exists(select 1 from public.sale_contracts c where c.unit_id=target_unit and c.customer_id is distinct from customer and c.status in ('draft','active'))
        or exists(select 1 from private.cimac_customer_unit_links l join private.cimac_customer_memberships m
          on m.project_id=l.project_id and m.customer_id=l.customer_id where l.project_id=project and l.unit_id=target_unit
          and l.customer_id is distinct from customer and m.status='current' and l.relationship_kind='signed_contract' and l.signing_state='signed_effective'
          and not exists(select 1 from jsonb_array_elements(p_input->'rows') r where r->>'customerId'=l.customer_id::text and r->>'membershipStatus'='archived'))
        or exists(select 1 from jsonb_array_elements(p_input->'rows') r cross join lateral jsonb_array_elements(r->'links') l
          where r->>'rowKey'<>item->>'rowKey' and r->>'membershipStatus'='current' and l->>'unitId'=target_unit::text
          and l->>'relationshipKind'='signed_contract' and l->>'signingState'='signed_effective') then
        raise exception 'CimacCustomerSyncUnitConflict' using errcode='22023'; end if;
    end loop;
  end loop;
  context_before:=current_setting('app.cimac_profile_request_id',true);
  perform set_config('app.cimac_profile_request_id',p_request_id::text,true);
  for item in select value from jsonb_array_elements(p_input->'rows') loop
    customer:=(item->>'customerId')::uuid;
    row_status:=item->>'membershipStatus';
    old:=null; old_membership:=null; old_links:='[]'::jsonb;
    if customer is not null then
      select * into old from public.customers c where c.id=customer;
      if not found or old.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz then
        raise exception 'CimacCustomerSyncConflict' using errcode='40001'; end if;
      select to_jsonb(m) into old_membership from private.cimac_customer_memberships m where m.project_id=project and m.customer_id=customer;
      select coalesce(jsonb_agg(to_jsonb(l) order by l.unit_id),'[]') into old_links from private.cimac_customer_unit_links l where l.project_id=project and l.customer_id=customer;
      before_rows:=before_rows||jsonb_build_array(jsonb_build_object('rowKey',item->>'rowKey','customerId',customer,'name',old.name,'phone',old.phone,'notes',old.notes,'updatedAt',old.updated_at,'membership',old_membership,'links',old_links));
      if row_status='archived' and private.cimac_customer_has_current_business(customer,project) then
        raise exception 'CimacCustomerSyncArchiveActive' using errcode='22023'; end if;
      update public.customers set name=item->>'name',phone=item->>'phone',notes=item->>'notes',updated_at=clock_timestamp()
        where id=customer returning * into saved;
    else
      before_rows:=before_rows||jsonb_build_array(jsonb_build_object('rowKey',item->>'rowKey','customerId',null,'profile',null,'membership',null,'links','[]'::jsonb));
      insert into public.customers(name,phone,notes) values(item->>'name',item->>'phone',item->>'notes') returning * into saved;
      customer:=saved.id;
    end if;
    insert into private.cimac_customer_memberships(project_id,customer_id,status,source_reference,recorded_by)
      values(project,customer,row_status,item->>'sourceReference',actor)
      on conflict(project_id,customer_id) do update set status=excluded.status,source_reference=excluded.source_reference;
    -- Upsert only explicitly supplied links. Omitted historic links are kept.
    for link in select value from jsonb_array_elements(item->'links') loop
      insert into private.cimac_customer_unit_links(project_id,customer_id,unit_id,brand,relationship_kind,signing_state,signed_date,source_reference,recorded_by)
        values(project,customer,(link->>'unitId')::uuid,link->>'brand',link->>'relationshipKind',link->>'signingState',(link->>'signedDate')::date,link->>'sourceReference',actor)
        on conflict(project_id,customer_id,unit_id) do update set brand=excluded.brand,relationship_kind=excluded.relationship_kind,
          signing_state=excluded.signing_state,signed_date=excluded.signed_date,source_reference=excluded.source_reference;
    end loop;
    after_rows:=after_rows||jsonb_build_array(jsonb_build_object('rowKey',item->>'rowKey','customerId',customer,'name',saved.name,'phone',saved.phone,'notes',saved.notes,'updatedAt',saved.updated_at,
      'membership',(select to_jsonb(m) from private.cimac_customer_memberships m where m.project_id=project and m.customer_id=customer),
      'links',(select coalesce(jsonb_agg(to_jsonb(l) order by l.unit_id),'[]') from private.cimac_customer_unit_links l where l.project_id=project and l.customer_id=customer)));
    results:=results||jsonb_build_array(jsonb_build_object('rowKey',item->>'rowKey','customerId',customer,'updatedAt',saved.updated_at,'membershipStatus',row_status));
  end loop;
  result:=jsonb_build_object('success',true,'requestId',p_request_id,'actorId',actor,'projectId',project,'idempotent',false,'rows',results);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(actor,public.current_user_role(),'sync','cimac_customer_profile_sync',p_request_id,before_rows,after_rows,
      jsonb_build_object('project_id',project,'request_id',p_request_id,'input',p_input,'result',result));
  perform set_config('app.cimac_profile_request_id',coalesce(context_before,''),true);
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'CimacCustomerSyncInvalid' using errcode='22023';
end; $$;

create function public.cimac_customer_directory_read_rpc(
  p_input jsonb,p_mode text default 'list',p_customer_id uuid default null,p_relation_page integer default 1
) returns jsonb language plpgsql stable security invoker set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare project uuid; building uuid; search text; filter text; membership text; page integer; result jsonb;
begin
  project:=private.cimac_profile_scope(false);
  if p_input is null or jsonb_typeof(p_input)<>'object'
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('projectId','buildingId','search','filter','page','membershipStatus'))
    or p_mode is null or p_mode not in ('list','detail') or (p_mode='detail' and p_customer_id is null)
    or (p_mode='list' and p_customer_id is not null) or p_relation_page is null or p_relation_page not between 1 and 100000 then
    raise exception 'CustomerDirectoryInvalid' using errcode='22023'; end if;
  if coalesce(p_input->>'projectId','')<>'' and p_input->>'projectId'<>project::text then
    raise exception 'CustomerDirectoryDenied' using errcode='42501'; end if;
  building:=nullif(p_input->>'buildingId','')::uuid; search:=coalesce(p_input->>'search','');
  filter:=coalesce(p_input->>'filter','all'); page:=coalesce(p_input->>'page','1')::integer;
  membership:=coalesce(p_input->>'membershipStatus','current');
  if length(search)>200 or filter not in ('all','contract','guest','contact','unknown','blacklisted') or membership not in ('current','archived') or page not between 1 and 100000 then
    raise exception 'CustomerDirectoryInvalid' using errcode='22023'; end if;
  if building is not null and not exists(select 1 from public.buildings b where b.id=building and b.project_id=project) then
    raise exception 'CustomerDirectoryDenied' using errcode='42501'; end if;
  with
  b as materialized (select b.id,b.code,b.display_name,b.project_id,jsonb_build_object('id',p.id,'code',p.code,'label',p.display_name) project
    from public.buildings b join public.projects p on p.id=b.project_id where p.id=project),
  u as materialized (select u.id,u.unit_no,u.building_id,b.display_name building_name,b.project_id from public.units u join b on b.id=u.building_id),
  real_rel as materialized (
    select c.customer_id,c.id,'lease'::text role,c.unit_id,c.contract_no code,c.start_date start_date,
      coalesce(c.actual_end_date,case when c.expected_end_confirmed is distinct from false and c.expected_end_date<date '2099-01-01' then c.expected_end_date end) end_date,
      case when c.actual_end_date is not null then 'actual' when c.expected_end_confirmed is distinct from false and c.expected_end_date<date '2099-01-01' then 'expected' else null end end_date_kind,c.status::text status from public.lease_contracts c join u on u.id=c.unit_id
    union all select c.customer_id,c.id,'sale',c.unit_id,c.contract_no,c.signed_date,null::date,null::text,c.status::text from public.sale_contracts c join u on u.id=c.unit_id
    union all select c.guest_customer_id,c.id,'daily_guest',c.unit_id,null::text,c.check_in,coalesce(c.actual_check_out,case when c.checkout_mode='fixed' then c.check_out end),
      case when c.actual_check_out is not null then 'actual' when c.checkout_mode='fixed' and c.check_out is not null then 'expected' else null end,c.status::text from public.daily_bookings c join u on u.id=c.unit_id where c.guest_customer_id is not null
    union all select c.booking_agent_id,c.id,'daily_agent',c.unit_id,null::text,c.check_in,coalesce(c.actual_check_out,case when c.checkout_mode='fixed' then c.check_out end),
      case when c.actual_check_out is not null then 'actual' when c.checkout_mode='fixed' and c.check_out is not null then 'expected' else null end,c.status::text from public.daily_bookings c join u on u.id=c.unit_id where c.booking_agent_id is not null
    union all select c.customer_id,c.id,'daily_unknown',c.unit_id,null::text,c.check_in,coalesce(c.actual_check_out,case when c.checkout_mode='fixed' then c.check_out end),
      case when c.actual_check_out is not null then 'actual' when c.checkout_mode='fixed' and c.check_out is not null then 'expected' else null end,c.status::text from public.daily_bookings c join u on u.id=c.unit_id
      where c.customer_id is not null and c.customer_id is distinct from c.guest_customer_id and c.customer_id is distinct from c.booking_agent_id
  ),
  raw_rel as materialized (
    select r.*,l.brand,l.relationship_kind,l.signing_state,l.source_reference,l.signed_date from real_rel r left join private.cimac_customer_unit_links l
      on l.project_id=project and l.customer_id=r.customer_id and l.unit_id=r.unit_id
    union all select l.customer_id,l.id,'park_link',l.unit_id,l.source_reference,l.signed_date,null::date,null::text,l.signing_state,l.brand,l.relationship_kind,l.signing_state,l.source_reference,l.signed_date
      from private.cimac_customer_unit_links l where l.project_id=project
        and not exists(select 1 from real_rel r where r.customer_id=l.customer_id and r.unit_id=l.unit_id)
  ),
  rel as materialized (select r.*,u.unit_no,u.building_id,u.building_name,u.project_id from raw_rel r join u on u.id=r.unit_id),
  scoped_rel as materialized (select * from rel r where building is null or r.building_id=building),
  scoped as materialized (
    select c.*,coalesce(m.status,'current') membership_status from public.customers c
    left join private.cimac_customer_memberships m on m.project_id=project and m.customer_id=c.id
    where (exists(select 1 from scoped_rel r where r.customer_id=c.id) or (building is null and m.customer_id is not null))
      and (p_mode='detail' or coalesce(m.status,'current')=membership)
  ),
  metrics as materialized (select r.customer_id,array_agg(distinct r.role order by r.role) roles,
    to_jsonb((array_agg(distinct r.building_name||' · '||r.unit_no order by r.building_name||' · '||r.unit_no))[1:3]) rooms,
    count(distinct r.unit_id) room_count,count(*) relationship_count,max(r.start_date) last_business_date,string_agg(distinct r.unit_no,' ') searchable_rooms
    from scoped_rel r group by r.customer_id),
  enriched as materialized (select c.id,c.name,c.phone,c.is_blacklisted,c.membership_status,
    nullif(btrim(c.encrypted_document_no),'') is not null has_document,coalesce(m.roles,'{}'::text[]) roles,
    coalesce(m.rooms,'[]'::jsonb) rooms,coalesce(m.room_count,0) room_count,coalesce(m.relationship_count,0) relationship_count,m.last_business_date,
    lower(regexp_replace(normalize(concat_ws(' ',c.name,c.phone,m.searchable_rooms),NFD),U&'[\0300-\036f]','','g')) searchable
    from scoped c left join metrics m on m.customer_id=c.id),
  filtered as materialized (select * from enriched e where
    (filter='all' or (filter='contract' and roles&&array['lease','sale','park_link']) or (filter='guest' and 'daily_guest'=any(roles))
      or (filter='contact' and 'daily_agent'=any(roles)) or (filter='unknown' and 'daily_unknown'=any(roles)) or (filter='blacklisted' and is_blacklisted))
    and not exists(select 1 from regexp_split_to_table(lower(regexp_replace(normalize(btrim(search),NFD),U&'[\0300-\036f]','','g')),'\s+') word where word<>'' and strpos(e.searchable,word)=0)),
  ordered as materialized (select *,row_number() over(order by name collate public.contract_workspace_order,id) ordinal from filtered),
  selected as materialized (select * from ordered where p_mode='list' and ordinal between (page-1)*40+1 and page*40
    union all select e.*,0::bigint from enriched e where p_mode='detail' and e.id=p_customer_id),
  detail_rel as materialized (select r.*,row_number() over(order by r.start_date desc nulls last,r.role,r.id) ordinal from scoped_rel r where p_mode='detail' and r.customer_id=p_customer_id)
  select jsonb_build_object('mode',p_mode,'query',p_input,'pageSize',40,'total',(select count(*) from filtered),'scopeCount',(select count(*) from scoped),
    'buildings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'code',b.code,'label',b.display_name,'project',b.project) order by b.code,b.id) from b),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone,'isBlacklisted',s.is_blacklisted,'hasDocument',s.has_document,
      'roles',s.roles,'rooms',s.rooms,'roomCount',s.room_count,'relationshipCount',s.relationship_count,'lastBusinessDate',s.last_business_date,'membershipStatus',s.membership_status) order by s.ordinal) from selected s),'[]'::jsonb),
    'profile',(select (to_jsonb(c)-'encrypted_document_no'-'membership_status')||jsonb_build_object('hasDocument',nullif(btrim(c.encrypted_document_no),'') is not null,'membershipStatus',c.membership_status) from scoped c where p_mode='detail' and c.id=p_customer_id),
    'relationships',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'role',r.role,'unitId',r.unit_id,'unitNo',r.unit_no,'buildingId',r.building_id,
      'buildingLabel',r.building_name,'projectId',r.project_id,'code',r.code,'startDate',r.start_date,'endDate',r.end_date,'endDateKind',r.end_date_kind,'status',r.status,
      'brand',r.brand,'relationshipKind',r.relationship_kind,'signingState',r.signing_state,'sourceReference',r.source_reference,'signedDate',r.signed_date) order by r.ordinal) from detail_rel r where ordinal between (p_relation_page-1)*25+1 and p_relation_page*25),'[]'::jsonb),
    'relationshipPage',p_relation_page,'relationshipTotal',(select count(*) from detail_rel)) into result;
  if p_mode='detail' and jsonb_array_length(result->'rows')<>1 then raise exception 'CustomerDirectoryNotFound' using errcode='P0002'; end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'CustomerDirectoryInvalid' using errcode='22023';
end; $$;

-- Documentary links extend the asset scope only. The existing financial detail
-- predicates still require the selected customer identity (or its exact source
-- contracts for legacy customer_id-null receipts), never unit identity alone.
create or replace function private.cimac_billing_customer_units(p_customer uuid,p_project uuid) returns setof uuid
language sql stable security invoker set search_path='' as $$
  with links as materialized (
    select c.unit_id,null::uuid expected_building from public.lease_contracts c where c.customer_id=p_customer
    union select c.unit_id,null::uuid from public.sale_contracts c where c.customer_id=p_customer
    union select l.unit_id,null::uuid from private.cimac_customer_unit_links l where l.customer_id=p_customer and l.project_id=p_project
    union select r.unit_id,r.building_id from public.receivables r where r.customer_id=p_customer and r.unit_id is not null
    union select p.unit_id,null::uuid from public.payments p where p.customer_id=p_customer and p.unit_id is not null
    union select l.unit_id,l.building_id from public.payments p join public.ledger_entries l on l.payment_id=p.id where p.customer_id=p_customer and l.unit_id is not null
  ) select distinct u.id from links link join public.units u on u.id=link.unit_id join public.buildings b on b.id=u.building_id
    where b.project_id=p_project and public.can_access_unit(u.id) and (link.expected_building is null or link.expected_building=b.id);
$$;
create or replace function private.cimac_billing_customer_exists(p_customer uuid,p_project uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select public.can_access_project(p_project) and (
    exists(select 1 from private.cimac_customer_memberships m where m.customer_id=p_customer and m.project_id=p_project)
    or exists(select 1 from private.cimac_billing_customer_units(p_customer,p_project))
    or exists(select 1 from public.receivables r join public.buildings b on b.id=r.building_id
      where r.customer_id=p_customer and r.unit_id is null and b.project_id=p_project and public.can_access_building(b.id))
    or exists(select 1 from public.payments p join public.ledger_entries l on l.payment_id=p.id join public.buildings b on b.id=l.building_id
      where p.customer_id=p_customer and p.unit_id is null and b.project_id=p_project and public.can_access_building(b.id)));
$$;

-- Extend only directory eligibility in the set-based account read. Keep every
-- selected-customer balance/history join and its completeness guards intact.
do $account$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.cimac_customer_account(uuid,text,integer)'::regprocedure),chr(13)||chr(10),chr(10));
  anchor:='    select l.customer_id,l.unit_id from public.lease_contracts l where l.unit_id=any(authorized_units)';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'CimacCustomerAccountReadDrift'; end if;
  definition:=replace(definition,anchor,anchor||E'\n    union select l.customer_id,l.unit_id from private.cimac_customer_unit_links l where l.project_id=project and l.unit_id=any(authorized_units)');
  anchor:='    select customer_id from unit_links where customer_id is not null';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'CimacCustomerAccountReadDrift'; end if;
  definition:=replace(definition,anchor,anchor||E'\n    union select m.customer_id from private.cimac_customer_memberships m where m.project_id=project and m.status=''current''');
  anchor:='    where c.id in(select customer_id from eligible) and';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'CimacCustomerAccountReadDrift'; end if;
  definition:=replace(definition,anchor,$new$    where c.id in(select customer_id from eligible)
      and not exists(select 1 from private.cimac_customer_memberships m where m.project_id=project and m.customer_id=c.id and m.status='archived') and$new$);
  anchor:=$old$'canWrite',public.has_app_role('admin','finance'),'complete'$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'CimacCustomerAccountReadDrift'; end if;
  definition:=replace(definition,anchor,$new$'canWrite',public.has_app_role('admin','finance') and not (
      exists(select 1 from private.cimac_customer_memberships m where m.project_id=project and m.customer_id=selected)
      and cardinality(lease_ids)=0 and cardinality(sale_ids)=0 and cardinality(receivable_ids)=0 and cardinality(payment_ids)=0),'complete'$new$);
  execute definition;
end; $account$;

revoke all on function private.cimac_profile_scope(boolean),private.cimac_profile_keys(jsonb,text[]),private.cimac_customer_has_current_business(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.cimac_profile_scope(boolean),private.cimac_profile_keys(jsonb,text[]),private.cimac_customer_has_current_business(uuid,uuid) to authenticated;
revoke all on function private.guard_cimac_profile_relation(),private.guard_cimac_profile_audit() from public,anon,authenticated,service_role;
revoke all on function public.cimac_customer_profiles_sync_rpc(uuid,jsonb),public.cimac_customer_directory_read_rpc(jsonb,text,uuid,integer) from public,anon,service_role;
grant execute on function public.cimac_customer_profiles_sync_rpc(uuid,jsonb),public.cimac_customer_directory_read_rpc(jsonb,text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
