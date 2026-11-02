begin;

-- Reference apartment catalogue only. No migration seed, occupancy assertion,
-- contract, billing schedule, receivable, receipt, or business flag is created.
create table public.cimac_apartment_profiles (
  unit_id uuid primary key references public.units(id),
  building_id uuid not null references public.buildings(id),
  floor_number smallint not null check (floor_number between 2 and 5),
  room_suffix smallint not null check (room_suffix between 1 and 16),
  bedrooms smallint not null check (bedrooms = case when room_suffix in (11,15,16) then 2 else 1 end),
  facing text not null check (facing = case when room_suffix in (1,3,5,7,9,10,12,13,15) then 'east' else 'west' end),
  monthly_rent_xof numeric(14,2) not null check (monthly_rent_xof = case when bedrooms=1 then 350000 else 600000 end),
  monthly_property_fee_xof numeric(14,2) not null check (monthly_property_fee_xof = case when bedrooms=1 then 30000 else 40000 end),
  deposit_months smallint not null check (deposit_months=2),
  rent_prepay_months smallint not null check (rent_prepay_months=6),
  property_prepay_months smallint not null check (property_prepay_months=12),
  source_reference text not null check (length(btrim(source_reference)) between 1 and 2000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (building_id,floor_number,room_suffix)
);
create index cimac_apartment_profiles_building on public.cimac_apartment_profiles(building_id);
create index cimac_apartment_profiles_actor on public.cimac_apartment_profiles(created_by);
comment on table public.cimac_apartment_profiles is
  'Confirmed B17 apartment layout and XOF reference terms. Not a lease, occupancy record, payment, or issued charge; no annual boundary is implied.';

create function private.cimac_apartment_building_scope() returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare target uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or public.current_user_role() is distinct from 'admin' then
    raise exception 'CimacApartmentsDenied' using errcode='42501';
  end if;
  select b.id into target from public.buildings b join public.projects p on p.id=b.project_id
    where p.code='CIMAC' and b.code='CIMAC-B17' and b.is_active
    and public.can_access_project(p.id) and public.can_access_building(b.id);
  if target is null then raise exception 'CimacApartmentsDenied' using errcode='42501'; end if;
  return target;
end; $$;

create function private.guard_cimac_apartment_profile() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
  target:=private.cimac_apartment_building_scope();
  if tg_op<>'INSERT' or new.building_id is distinct from target
    or nullif(current_setting('app.cimac_apartment_request_id',true),'') is null
    or new.created_by is distinct from auth.uid()
    or new.source_reference is distinct from 'User-confirmed B17 floors 2-5 room plan and XOF reference terms; 2026-11-02'
    or not exists(select 1 from public.units u where u.id=new.unit_id and u.building_id=target
      and u.unit_no=(new.floor_number*100+new.room_suffix)::text
      and u.code='CIMAC-B17-'||u.unit_no and u.floor_label=new.floor_number::text||'F'
      and u.kind='apartment' and u.asset_subtype='apartment'
      and u.layout=case when new.bedrooms=1 then '一室一厅' else '两室' end
      and u.construction_status='unverified' and not u.occupancy_verified and u.area_sqm is null
      and not exists(select 1 from public.unit_business_flags f where f.unit_id=u.id)) then
    raise exception 'CimacApartmentsProfileDenied' using errcode='42501';
  end if;
  return new;
end; $$;
create trigger cimac_apartment_profile_guard before insert or update or delete on public.cimac_apartment_profiles
for each row execute function private.guard_cimac_apartment_profile();

alter table public.cimac_apartment_profiles enable row level security;
revoke all on public.cimac_apartment_profiles from public,anon,authenticated,service_role;
grant select,insert on public.cimac_apartment_profiles to authenticated;
create policy "CIMAC apartment scoped reads" on public.cimac_apartment_profiles for select to authenticated
using (
  public.has_app_role('admin','boss','finance','rental_sales') and exists(
    select 1 from public.units u join public.buildings b on b.id=u.building_id
    join public.projects p on p.id=b.project_id
    where u.id=unit_id and b.id=cimac_apartment_profiles.building_id
      and p.code='CIMAC' and b.code='CIMAC-B17' and public.can_access_building(b.id))
);
create policy "CIMAC apartment controlled inserts" on public.cimac_apartment_profiles for insert to authenticated
with check (building_id=private.cimac_apartment_building_scope() and created_by=auth.uid()
  and nullif(current_setting('app.cimac_apartment_request_id',true),'') is not null);

create unique index cimac_apartment_initialization_request_once on public.audit_logs(entity_id)
where entity_type='cimac_apartment_initialization';
create function private.guard_cimac_apartment_audit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target uuid; project uuid;
begin
  if tg_op<>'INSERT' and old.entity_type='cimac_apartment_initialization' then
    raise exception 'CimacApartmentsAuditImmutable' using errcode='42501';
  end if;
  if tg_op<>'DELETE' and new.entity_type='cimac_apartment_initialization' then
    target:=private.cimac_apartment_building_scope();
    select b.project_id into project from public.buildings b where b.id=target;
    if tg_op<>'INSERT' or new.action<>'initialize'
      or new.entity_id::text is distinct from nullif(current_setting('app.cimac_apartment_request_id',true),'')
      or new.metadata->>'project_id' is distinct from project::text
      or new.metadata->>'building_id' is distinct from target::text
      or new.actor_id is distinct from auth.uid() then
      raise exception 'CimacApartmentsAuditDenied' using errcode='42501';
    end if;
    new.actor_role:=public.current_user_role();
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger cimac_apartment_audit_guard before insert or update or delete on public.audit_logs
for each row execute function private.guard_cimac_apartment_audit();
create policy "CIMAC apartment audit restriction" on public.audit_logs as restrictive for all to authenticated
using (entity_type<>'cimac_apartment_initialization' or exists(
  select 1 from public.buildings b join public.projects p on p.id=b.project_id
  where p.code='CIMAC' and b.code='CIMAC-B17' and metadata->>'building_id'=b.id::text
    and metadata->>'project_id'=p.id::text and public.can_access_building(b.id)))
with check (entity_type<>'cimac_apartment_initialization' or (public.current_user_role()='admin' and exists(
  select 1 from public.buildings b join public.projects p on p.id=b.project_id
  where p.code='CIMAC' and b.code='CIMAC-B17' and metadata->>'building_id'=b.id::text
    and metadata->>'project_id'=p.id::text and public.can_access_building(b.id))));

create function public.cimac_apartments_initialize_rpc(p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  target uuid; project uuid; actor uuid:=auth.uid(); prior public.audit_logs%rowtype;
  floor_no integer; suffix integer; beds integer; room_no text; unit uuid;
  unit_ids jsonb:='[]'; result jsonb; catalog jsonb; context_before text;
begin
  target:=private.cimac_apartment_building_scope();
  if p_request_id is null then raise exception 'CimacApartmentsInvalidRequest' using errcode='22023'; end if;
  -- Requests serialize at the building, including two different request IDs.
  perform pg_advisory_xact_lock(hashtextextended('cimac_apartment_request:'||p_request_id::text,0));
  perform 1 from public.buildings b where b.id=target for update;
  select b.project_id into project from public.buildings b where b.id=target;
  select * into prior from public.audit_logs
    where entity_type='cimac_apartment_initialization' and entity_id=p_request_id;
  if found then
    if prior.actor_id is distinct from actor or prior.metadata->>'project_id' is distinct from project::text
      or prior.metadata->>'building_id' is distinct from target::text then
      raise exception 'CimacApartmentsRequestConflict' using errcode='22023';
    end if;
    -- Recover the result, never replay. Later real occupancy/construction/area
    -- changes are allowed; catalogue identity and reference terms must survive.
    select jsonb_agg(to_jsonb(a)||jsonb_build_object('unit_code',u.code,'unit_no',u.unit_no,
      'floor_label',u.floor_label,'kind',u.kind,'asset_subtype',u.asset_subtype,'layout',u.layout)
      order by a.floor_number,a.room_suffix),
      jsonb_agg(a.unit_id order by a.floor_number,a.room_suffix)
      into catalog,unit_ids
      from public.cimac_apartment_profiles a join public.units u on u.id=a.unit_id
      where a.building_id=target and u.building_id=target;
    if jsonb_array_length(coalesce(unit_ids,'[]'))<>64
      or catalog is distinct from prior.after_data
      or unit_ids is distinct from prior.metadata->'result'->'unitIds' then
      raise exception 'CimacApartmentsInitializationDrift' using errcode='40001';
    end if;
    return (prior.metadata->'result')||jsonb_build_object('idempotent',true);
  end if;
  if exists(select 1 from public.cimac_apartment_profiles a where a.building_id=target) then
    raise exception 'CimacApartmentsAlreadyInitialized' using errcode='22023';
  end if;
  if exists(select 1 from public.units u cross join generate_series(2,5) f cross join generate_series(1,16) s
      where (u.building_id=target and u.unit_no=(f*100+s)::text)
         or u.code='CIMAC-B17-'||(f*100+s)::text) then
    raise exception 'CimacApartmentsRoomConflict' using errcode='23505';
  end if;
  context_before:=current_setting('app.cimac_apartment_request_id',true);
  perform set_config('app.cimac_apartment_request_id',p_request_id::text,true);
  for floor_no in 2..5 loop
    for suffix in 1..16 loop
      room_no:=(floor_no*100+suffix)::text;
      beds:=case when suffix in (11,15,16) then 2 else 1 end;
      insert into public.units(building_id,code,unit_no,floor_label,kind,asset_subtype,status,
        layout,construction_status,occupancy_verified,area_sqm)
      values(target,'CIMAC-B17-'||room_no,room_no,floor_no::text||'F','apartment','apartment','available',
        case when beds=1 then '一室一厅' else '两室' end,'unverified',false,null)
      returning id into unit;
      insert into public.cimac_apartment_profiles(unit_id,building_id,floor_number,room_suffix,bedrooms,facing,
        monthly_rent_xof,monthly_property_fee_xof,deposit_months,rent_prepay_months,property_prepay_months,source_reference,created_by)
      values(unit,target,floor_no,suffix,beds,
        case when suffix in (1,3,5,7,9,10,12,13,15) then 'east' else 'west' end,
        case when beds=1 then 350000 else 600000 end,case when beds=1 then 30000 else 40000 end,2,6,12,
        'User-confirmed B17 floors 2-5 room plan and XOF reference terms; 2026-11-02',actor);
      unit_ids:=unit_ids||jsonb_build_array(unit);
    end loop;
  end loop;
  select jsonb_agg(to_jsonb(a)||jsonb_build_object('unit_code',u.code,'unit_no',u.unit_no,
    'floor_label',u.floor_label,'kind',u.kind,'asset_subtype',u.asset_subtype,'layout',u.layout)
    order by a.floor_number,a.room_suffix) into catalog
    from public.cimac_apartment_profiles a join public.units u on u.id=a.unit_id where a.building_id=target;
  result:=jsonb_build_object('success',true,'requestId',p_request_id,'projectId',project,'buildingId',target,
    'actorId',actor,'roomCount',64,'unitIds',unit_ids,'idempotent',false);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(actor,public.current_user_role(),'initialize','cimac_apartment_initialization',p_request_id,'[]',catalog,
      jsonb_build_object('project_id',project,'building_id',target,'request_id',p_request_id,'result',result));
  perform set_config('app.cimac_apartment_request_id',coalesce(context_before,''),true);
  return result;
exception when unique_violation then
  raise exception 'CimacApartmentsRoomConflict' using errcode='23505';
end; $$;

revoke all on function private.cimac_apartment_building_scope() from public,anon,service_role;
grant execute on function private.cimac_apartment_building_scope() to authenticated;
revoke all on function private.guard_cimac_apartment_profile(),private.guard_cimac_apartment_audit() from public,anon,authenticated,service_role;
revoke all on function public.cimac_apartments_initialize_rpc(uuid) from public,anon,service_role;
grant execute on function public.cimac_apartments_initialize_rpc(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
