begin;

-- Unpaid, undated holds are independent of leases, physical occupancy and cash.
-- No business records are seeded by this migration.
create table public.cimac_apartment_reservations (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  building_id uuid not null references public.buildings(id),
  reserver_name text not null check(length(btrim(reserver_name)) between 1 and 200 and reserver_name=btrim(reserver_name) and reserver_name !~ '[[:cntrl:]]'),
  status text not null check(status in ('reserved','cancelled')),
  payment_status text not null default 'unpaid' check(payment_status='unpaid'),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  last_reason text not null check(length(btrim(last_reason)) between 1 and 2000),
  check((status='reserved' and cancelled_at is null) or (status='cancelled' and cancelled_at is not null))
);
create unique index cimac_apartment_one_current_hold on public.cimac_apartment_reservations(unit_id) where status='reserved';
create index cimac_apartment_reservation_unit_history on public.cimac_apartment_reservations(unit_id,created_at);
create index cimac_apartment_reservation_building on public.cimac_apartment_reservations(building_id);
create index cimac_apartment_reservation_created_by on public.cimac_apartment_reservations(created_by);
create index cimac_apartment_reservation_updated_by on public.cimac_apartment_reservations(updated_by);
comment on table public.cimac_apartment_reservations is 'Unpaid apartment holds, with dates and actual occupancy unconfirmed. No contract, receivable, receipt or financial allocation is implied.';

create function private.guard_cimac_apartment_reservation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target uuid; operation text;
begin
  target:=private.cimac_apartment_building_scope();
  operation:=current_setting('app.cimac_apartment_reservation_operation',true);
  if tg_op='DELETE' or nullif(current_setting('app.cimac_apartment_reservation_request',true),'') is null
    or new.building_id is distinct from target
    or new.unit_id::text is distinct from current_setting('app.cimac_apartment_reservation_unit',true)
    or new.updated_by is distinct from auth.uid()
    or not exists(select 1 from public.cimac_apartment_profiles a join public.units u on u.id=a.unit_id
      where a.unit_id=new.unit_id and a.building_id=target and u.building_id=target and u.kind='apartment'
      and u.asset_subtype='apartment' and u.code='CIMAC-B17-'||u.unit_no
      and u.unit_no=(a.floor_number*100+a.room_suffix)::text) then
    raise exception 'CimacApartmentReservationsDenied' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    if operation is distinct from 'reserve' or new.status<>'reserved' or new.created_by is distinct from auth.uid() then
      raise exception 'CimacApartmentReservationsDenied' using errcode='42501';
    end if;
    new.created_at:=clock_timestamp(); new.updated_at:=new.created_at;
  else
    if old.status<>'reserved' or (new.id,new.unit_id,new.building_id,new.created_by,new.created_at,new.payment_status)
      is distinct from (old.id,old.unit_id,old.building_id,old.created_by,old.created_at,old.payment_status)
      or (operation='cancel' and (new.status<>'cancelled' or new.reserver_name<>old.reserver_name))
      or (operation='correct_name' and new.status<>'reserved')
      or operation not in ('cancel','correct_name') or operation is null then
      raise exception 'CimacApartmentReservationsDenied' using errcode='42501';
    end if;
    new.updated_at:=clock_timestamp();
  end if;
  return new;
end; $$;
create trigger cimac_apartment_reservation_guard before insert or update or delete on public.cimac_apartment_reservations
for each row execute function private.guard_cimac_apartment_reservation();

alter table public.cimac_apartment_reservations enable row level security;
revoke all on public.cimac_apartment_reservations from public,anon,authenticated,service_role;
grant select,insert,update on public.cimac_apartment_reservations to authenticated;
create policy "CIMAC scoped apartment reservation reads" on public.cimac_apartment_reservations for select to authenticated
using(public.has_app_role('admin','boss','finance','rental_sales') and exists(
  select 1 from public.cimac_apartment_profiles a join public.buildings b on b.id=a.building_id join public.projects p on p.id=b.project_id
  where a.unit_id=cimac_apartment_reservations.unit_id and a.building_id=cimac_apartment_reservations.building_id
    and p.code='CIMAC' and b.code='CIMAC-B17' and public.can_access_building(b.id)));
create policy "CIMAC controlled apartment reservation inserts" on public.cimac_apartment_reservations for insert to authenticated
with check(building_id=private.cimac_apartment_building_scope() and created_by=auth.uid() and updated_by=auth.uid()
  and nullif(current_setting('app.cimac_apartment_reservation_request',true),'') is not null);
create policy "CIMAC controlled apartment reservation updates" on public.cimac_apartment_reservations for update to authenticated
using(building_id=private.cimac_apartment_building_scope() and nullif(current_setting('app.cimac_apartment_reservation_request',true),'') is not null)
with check(building_id=private.cimac_apartment_building_scope() and updated_by=auth.uid()
  and nullif(current_setting('app.cimac_apartment_reservation_request',true),'') is not null);

create unique index cimac_apartment_reservation_request_once on public.audit_logs(entity_id)
where entity_type='cimac_apartment_reservations';
create function private.guard_cimac_apartment_reservation_audit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
  if tg_op<>'INSERT' and old.entity_type='cimac_apartment_reservations' then
    raise exception 'CimacApartmentReservationsAuditImmutable' using errcode='42501';
  end if;
  if tg_op<>'DELETE' and new.entity_type='cimac_apartment_reservations' then
    target:=private.cimac_apartment_building_scope();
    if tg_op<>'INSERT' or new.action<>'apartment_reservation_batch' or new.actor_id is distinct from auth.uid()
      or new.entity_id::text is distinct from nullif(current_setting('app.cimac_apartment_reservation_request',true),'')
      or new.metadata->>'building_id' is distinct from target::text
      or not exists(select 1 from public.buildings b where b.id=target and new.metadata->>'project_id'=b.project_id::text) then
      raise exception 'CimacApartmentReservationsAuditDenied' using errcode='42501';
    end if;
    new.actor_role:=public.current_user_role();
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger cimac_apartment_reservation_audit_guard before insert or update or delete on public.audit_logs
for each row execute function private.guard_cimac_apartment_reservation_audit();
create policy "CIMAC apartment reservation audit scope" on public.audit_logs as restrictive for all to authenticated
using(entity_type<>'cimac_apartment_reservations' or exists(select 1 from public.buildings b join public.projects p on p.id=b.project_id
  where p.code='CIMAC' and b.code='CIMAC-B17' and metadata->>'building_id'=b.id::text
    and metadata->>'project_id'=p.id::text and public.can_access_building(b.id)))
with check(entity_type<>'cimac_apartment_reservations' or (public.current_user_role()='admin' and exists(
  select 1 from public.buildings b join public.projects p on p.id=b.project_id where p.code='CIMAC' and b.code='CIMAC-B17'
  and metadata->>'building_id'=b.id::text and metadata->>'project_id'=p.id::text and public.can_access_building(b.id))));

create function public.cimac_apartment_reservations_protocol_version() returns integer
language sql immutable security invoker set search_path='' as $$select 1$$;
create function public.can_execute_cimac_apartment_reservations() returns boolean
language plpgsql stable security invoker set search_path='' as $$
begin
  perform private.cimac_apartment_building_scope(); return true;
exception when insufficient_privilege then return false;
end; $$;

create function public.cimac_apartment_reservations_execute_rpc(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  target uuid; project uuid; actor uuid:=auth.uid(); request_id uuid;
  canonical jsonb; operations jsonb:='[]'; item jsonb; ids uuid[]:='{}'; key text;
  operation text; unit_id uuid; expected_unit timestamptz; expected_id uuid; expected_stamp timestamptz; name text; reason text;
  record_unit public.units%rowtype; current_hold public.cimac_apartment_reservations%rowtype; written public.cimac_apartment_reservations%rowtype;
  prior public.audit_logs%rowtype; hash text; result jsonb; rooms jsonb:='[]'; before_rows jsonb:='[]'; after_rows jsonb:='[]'; actual jsonb;
  old_request text; old_operation text; old_unit text;
begin
  target:=private.cimac_apartment_building_scope();
  select project_id into project from public.buildings where id=target;
  if p_request is null or jsonb_typeof(p_request)<>'object'
    or not (p_request ?& array['requestId','originalInstruction','operations'])
    or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('requestId','originalInstruction','operations'))
    or jsonb_typeof(p_request->'requestId')<>'string' or jsonb_typeof(p_request->'originalInstruction')<>'string'
    or length(btrim(p_request->>'originalInstruction')) not between 1 and 4000
    or jsonb_typeof(p_request->'operations')<>'array' then
    raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023';
  end if;
  request_id:=(p_request->>'requestId')::uuid;
  if request_id is null or jsonb_array_length(p_request->'operations') not between 1 and 64 then
    raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_request->'operations') loop
    if jsonb_typeof(item)<>'object'
      or not (item ?& array['type','unitId','expectedUnitUpdatedAt','expectedReservationId','expectedReservationUpdatedAt','reserverName','reason'])
      or exists(select 1 from jsonb_object_keys(item) k where k not in ('type','unitId','expectedUnitUpdatedAt','expectedReservationId','expectedReservationUpdatedAt','reserverName','reason'))
      or jsonb_typeof(item->'type')<>'string' or item->>'type' not in ('reserve','cancel','correct_name')
      or jsonb_typeof(item->'unitId')<>'string' or jsonb_typeof(item->'expectedUnitUpdatedAt')<>'string'
      or coalesce(item->>'expectedUnitUpdatedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or jsonb_typeof(item->'reason')<>'string' or length(btrim(item->>'reason')) not between 1 and 2000 then
      raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023';
    end if;
    operation:=item->>'type'; unit_id:=(item->>'unitId')::uuid; expected_unit:=(item->>'expectedUnitUpdatedAt')::timestamptz;
    expected_id:=null; expected_stamp:=null; name:=null; reason:=btrim(item->>'reason');
    if unit_id is null or unit_id=any(ids) then raise exception 'CimacApartmentReservationsDuplicateUnit' using errcode='22023'; end if;
    ids:=array_append(ids,unit_id);
    if operation='reserve' then
      if item->'expectedReservationId'<>'null'::jsonb or item->'expectedReservationUpdatedAt'<>'null'::jsonb then
        raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023';
      end if;
    else
      if jsonb_typeof(item->'expectedReservationId')<>'string' or jsonb_typeof(item->'expectedReservationUpdatedAt')<>'string'
        or coalesce(item->>'expectedReservationUpdatedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023';
      end if;
      expected_id:=(item->>'expectedReservationId')::uuid; expected_stamp:=(item->>'expectedReservationUpdatedAt')::timestamptz;
    end if;
    if operation='cancel' then
      if item->'reserverName'<>'null'::jsonb then raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023'; end if;
    else
      if jsonb_typeof(item->'reserverName')<>'string' then raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023'; end if;
      name:=btrim(item->>'reserverName');
      if length(name) not between 1 and 200 or name ~ '[[:cntrl:]]' then raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023'; end if;
    end if;
    operations:=operations||jsonb_build_array(jsonb_build_object('type',operation,'unitId',unit_id,
      'expectedUnitUpdatedAt',to_char(expected_unit at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'expectedReservationId',expected_id,'expectedReservationUpdatedAt',case when expected_stamp is null then null else to_char(expected_stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'reserverName',name,'reason',reason));
  end loop;
  canonical:=jsonb_build_object('requestId',request_id,'originalInstruction',btrim(p_request->>'originalInstruction'),'operations',operations);
  hash:=encode(sha256(convert_to(canonical::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('cimac_apartment_reservation:'||request_id::text,0));
  perform 1 from public.units u where u.id=any(ids) order by u.id for update;
  if (select count(*) from public.cimac_apartment_profiles a join public.units u on u.id=a.unit_id
      where a.unit_id=any(ids) and a.building_id=target and u.building_id=target and u.kind='apartment'
      and u.asset_subtype='apartment' and u.code='CIMAC-B17-'||u.unit_no
      and u.unit_no=(a.floor_number*100+a.room_suffix)::text)<>cardinality(ids) then
    raise exception 'CimacApartmentReservationsScopeDenied' using errcode='42501';
  end if;
  select * into prior from public.audit_logs where entity_type='cimac_apartment_reservations' and entity_id=request_id;
  if found then
    if prior.actor_id is distinct from actor or prior.metadata->>'payload_hash' is distinct from hash
      or prior.metadata->>'project_id' is distinct from project::text or prior.metadata->>'building_id' is distinct from target::text then
      raise exception 'CimacApartmentReservationsRequestConflict' using errcode='22023';
    end if;
    for item in select value from jsonb_array_elements(prior.after_data) loop
      select to_jsonb(r) into actual from public.cimac_apartment_reservations r where r.id=(item->>'id')::uuid;
      if actual is distinct from item or exists(select 1 from public.cimac_apartment_reservations r
          where r.unit_id=(item->>'unit_id')::uuid and r.status='reserved' and r.id<>(item->>'id')::uuid)
        or (item->>'status'='reserved' and (exists(select 1 from public.lease_contracts l where l.unit_id=(item->>'unit_id')::uuid and l.status='active')
          or exists(select 1 from public.daily_bookings b where b.unit_id=(item->>'unit_id')::uuid and b.status in ('confirmed','checked_in')))) then
        raise exception 'CimacApartmentReservationsDrift' using errcode='40001';
      end if;
    end loop;
    return (prior.metadata->'result')||jsonb_build_object('idempotent',true);
  end if;
  old_request:=current_setting('app.cimac_apartment_reservation_request',true);
  old_operation:=current_setting('app.cimac_apartment_reservation_operation',true);
  old_unit:=current_setting('app.cimac_apartment_reservation_unit',true);
  perform set_config('app.cimac_apartment_reservation_request',request_id::text,true);
  for item in select value from jsonb_array_elements(operations) loop
    operation:=item->>'type'; unit_id:=(item->>'unitId')::uuid; name:=item->>'reserverName'; reason:=item->>'reason';
    select * into strict record_unit from public.units where id=unit_id;
    if record_unit.updated_at is distinct from (item->>'expectedUnitUpdatedAt')::timestamptz then
      raise exception 'CimacApartmentReservationsUnitChanged' using errcode='40001';
    end if;
    select * into current_hold from public.cimac_apartment_reservations where cimac_apartment_reservations.unit_id=record_unit.id and status='reserved' for update;
    if operation='reserve' then
      if current_hold.id is not null then raise exception 'CimacApartmentReservationsAlreadyHeld' using errcode='40001'; end if;
      if record_unit.operational_condition='locked' or record_unit.status::text in ('leased','daily_occupied','locked')
        or exists(select 1 from public.lease_contracts l where l.unit_id=record_unit.id and l.status='active')
        or exists(select 1 from public.daily_bookings b where b.unit_id=record_unit.id and b.status in ('confirmed','checked_in')) then
        raise exception 'CimacApartmentReservationsBusinessConflict' using errcode='40001';
      end if;
      before_rows:=before_rows||jsonb_build_array(jsonb_build_object('unitId',unit_id,'reservation',null));
    else
      if current_hold.id is distinct from (item->>'expectedReservationId')::uuid
        or current_hold.updated_at is distinct from (item->>'expectedReservationUpdatedAt')::timestamptz then
        raise exception 'CimacApartmentReservationsChanged' using errcode='40001';
      end if;
      before_rows:=before_rows||jsonb_build_array(to_jsonb(current_hold));
    end if;
    perform set_config('app.cimac_apartment_reservation_operation',operation,true);
    perform set_config('app.cimac_apartment_reservation_unit',unit_id::text,true);
    if operation='reserve' then
      insert into public.cimac_apartment_reservations(unit_id,building_id,reserver_name,status,payment_status,created_by,updated_by,last_reason)
      values(unit_id,target,name,'reserved','unpaid',actor,actor,reason) returning * into written;
    elsif operation='cancel' then
      update public.cimac_apartment_reservations set status='cancelled',cancelled_at=clock_timestamp(),updated_by=actor,last_reason=reason
        where id=current_hold.id returning * into written;
    else
      update public.cimac_apartment_reservations set reserver_name=name,updated_by=actor,last_reason=reason
        where id=current_hold.id returning * into written;
    end if;
    after_rows:=after_rows||jsonb_build_array(to_jsonb(written));
    rooms:=rooms||jsonb_build_array(jsonb_build_object('unitId',unit_id,'unitNo',record_unit.unit_no,'reservationId',written.id,
      'status',written.status,'reserverName',written.reserver_name,'paymentStatus',written.payment_status,'updatedAt',written.updated_at));
  end loop;
  result:=jsonb_build_object('success',true,'requestId',request_id,'actorId',actor,'projectId',project,'buildingId',target,'idempotent',false,'rooms',rooms);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(actor,public.current_user_role(),'apartment_reservation_batch','cimac_apartment_reservations',request_id,before_rows,after_rows,
      jsonb_build_object('project_id',project,'building_id',target,'payload_hash',hash,'request',p_request,'result',result,
        'source','apartment_reservation','authorization','explicit_instruction','financial_effect',false,'dates_confirmed',false));
  perform set_config('app.cimac_apartment_reservation_request',coalesce(old_request,''),true);
  perform set_config('app.cimac_apartment_reservation_operation',coalesce(old_operation,''),true);
  perform set_config('app.cimac_apartment_reservation_unit',coalesce(old_unit,''),true);
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
  raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023';
end; $$;

create function public.cimac_apartment_reservations_status_rpc(p_request_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare target uuid; prior public.audit_logs%rowtype;
begin
  target:=private.cimac_apartment_building_scope();
  if p_request_id is null then raise exception 'CimacApartmentReservationsInvalidRequest' using errcode='22023'; end if;
  select * into prior from public.audit_logs where entity_type='cimac_apartment_reservations' and entity_id=p_request_id;
  if not found then return jsonb_build_object('status','not_found','verified',false,'requestId',p_request_id); end if;
  if prior.actor_id is distinct from auth.uid() or prior.metadata->>'building_id' is distinct from target::text then
    raise exception 'CimacApartmentReservationsRequestConflict' using errcode='42501';
  end if;
  return jsonb_build_object('status','completed_previously','verified',false,'requestId',p_request_id,'actorId',prior.actor_id,
    'request',prior.metadata->'request','result',prior.metadata->'result');
end; $$;

revoke all on function private.guard_cimac_apartment_reservation(),private.guard_cimac_apartment_reservation_audit() from public,anon,authenticated,service_role;
revoke all on function public.cimac_apartment_reservations_protocol_version(),public.can_execute_cimac_apartment_reservations(),public.cimac_apartment_reservations_execute_rpc(jsonb),public.cimac_apartment_reservations_status_rpc(uuid) from public,anon,service_role;
grant execute on function public.cimac_apartment_reservations_protocol_version(),public.can_execute_cimac_apartment_reservations(),public.cimac_apartment_reservations_execute_rpc(jsonb),public.cimac_apartment_reservations_status_rpc(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
