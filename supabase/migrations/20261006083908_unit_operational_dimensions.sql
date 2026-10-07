begin;
alter table public.units add column operational_condition text not null default 'normal'
  check(operational_condition in ('normal','maintenance','locked'));
update public.units set operational_condition=status::text where status in ('maintenance','locked');

-- Compatibility projection: ownership is not inferred from an idle occupancy state.
create view public.unit_operational_position with(security_invoker=true) as
select u.id,u.building_id,u.unit_no,u.status legacy_status,
  case when u.status='sold' or exists(select 1 from public.sale_contracts s where s.unit_id=u.id and s.status='active')
    then 'sold' else 'unspecified' end ownership,
  u.operational_condition,u.construction_status,u.occupancy_verified,
  exists(select 1 from public.unit_business_flags f where f.unit_id=u.id and f.business_type='daily_rental' and f.is_enabled) daily_enabled,
  exists(select 1 from public.unit_business_flags f where f.unit_id=u.id and f.business_type='long_lease' and f.is_enabled) lease_enabled,
  exists(select 1 from public.daily_bookings b where b.unit_id=u.id and b.status='checked_in') daily_occupied,
  exists(select 1 from public.lease_contracts l where l.unit_id=u.id and l.status='active') lease_occupied,
  exists(select 1 from public.cleaning_tasks c where c.unit_id=u.id and not c.is_completed) cleaning_pending,
  u.updated_at
from public.units u;
revoke all on public.unit_operational_position from public,anon;
grant select on public.unit_operational_position to authenticated,service_role;

-- Legacy business modules remain compatible while the new condition is independent.
create function private.sync_unit_operational_condition() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status in ('maintenance','locked') then new.operational_condition:=new.status::text;
  elsif old.status in ('maintenance','locked') and new.status<>old.status then new.operational_condition:='normal';
  end if;
  return new;
end; $$;
revoke all on function private.sync_unit_operational_condition() from public,anon,authenticated;
create trigger sync_unit_operational_condition before update of status on public.units
  for each row execute function private.sync_unit_operational_condition();

create function public.set_unit_condition_rpc(p_unit_id uuid,p_condition text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.units%rowtype; next_status public.unit_status;
begin
  if auth.uid() is null or not public.has_app_role('admin') or not public.can_access_unit(p_unit_id) then
    raise exception 'unitPermissionDenied' using errcode='42501'; end if;
  if p_condition is null or p_condition not in ('normal','maintenance','locked') or p_expected_updated_at is null then raise exception 'invalidUnitCondition'; end if;
  select * into strict u from public.units where id=p_unit_id for update;
  if u.updated_at is distinct from p_expected_updated_at then raise exception 'unitRecordChanged'; end if;
  if exists(select 1 from public.daily_bookings where unit_id=u.id and status='checked_in')
    or exists(select 1 from public.lease_contracts where unit_id=u.id and status='active') then
    raise exception 'occupiedUnitRequiresBusinessWorkflow'; end if;
  -- Clearing maintenance is not proof of construction/occupancy readiness.
  if p_condition='normal' and (not u.occupancy_verified or u.construction_status<>'operational') then
    raise exception 'unitReadinessRequiresVerification'; end if;
  next_status:=case when u.status='sold' or exists(select 1 from public.sale_contracts where unit_id=u.id and status='active') then 'sold'::public.unit_status
    when p_condition='normal' then
      case when exists(select 1 from public.cleaning_tasks where unit_id=u.id and not is_completed) then 'cleaning_pending'::public.unit_status
        when exists(select 1 from public.daily_bookings where unit_id=u.id and status='confirmed' and check_in<=current_date and (check_out is null or check_out>current_date)) then 'reserved'::public.unit_status
        else 'available'::public.unit_status end
    else p_condition::public.unit_status end;
  update public.units set status=next_status,operational_condition=p_condition,updated_at=clock_timestamp() where id=u.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'status_change','unit',u.id,jsonb_build_object('previous_status',u.status,
      'new_status',next_status,'previous_condition',u.operational_condition,'new_condition',p_condition,'changed_manually',true));
  return jsonb_build_object('success',true);
end; $$;
revoke all on function public.set_unit_condition_rpc(uuid,text,timestamptz) from public,anon,service_role;
grant execute on function public.set_unit_condition_rpc(uuid,text,timestamptz) to authenticated;

-- A sold unit can be daily-enabled and separately unavailable for maintenance.
do $migration$
declare signature text; definition text; old_text text;
begin
  foreach signature in array array[
    'public.daily_create_booking_rpc(uuid,uuid,date,date,text,numeric,text,text,uuid,jsonb)',
    'public.daily_create_booking_core_rpc(uuid,uuid,date,date,text,numeric,text,text,uuid,jsonb)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    old_text:='if v_unit.status = ''maintenance'' then';
    if strpos(definition,old_text)=0 then raise exception 'unitConditionMigrationDrift'; end if;
    definition:=replace(definition,old_text,'if v_unit.status = ''maintenance'' or v_unit.operational_condition=''maintenance'' then');
    definition:=replace(definition,'if v_unit.status = ''locked'' then','if v_unit.status = ''locked'' or v_unit.operational_condition=''locked'' then');
    execute definition;
  end loop;
  signature:='public.daily_check_in_booking_rpc(uuid,numeric,uuid,jsonb)';
  definition:=pg_get_functiondef(signature::regprocedure);
  old_text:='if v_unit.status in (''maintenance'', ''locked'', ''leased'')';
  if strpos(definition,old_text)=0 then raise exception 'unitConditionMigrationDrift'; end if;
  execute replace(definition,old_text,old_text||' or v_unit.operational_condition<>''normal''');
  signature:='private.lease_lifecycle(text,jsonb,uuid)';
  definition:=pg_get_functiondef(signature::regprocedure);
  old_text:='or u.status=''locked'' then raise exception ''leaseUnitNotOperational'';';
  if strpos(definition,old_text)=0 then raise exception 'leaseUnitConditionMigrationDrift'; end if;
  execute replace(definition,old_text,'or u.status in (''locked'',''maintenance'') or u.operational_condition<>''normal'' then raise exception ''leaseUnitNotOperational'';');
  signature:='private.preview_booking_operation(jsonb)';
  definition:=pg_get_functiondef(signature::regprocedure);
  old_text:='if target.status in (''locked'',''maintenance'',''leased'')';
  if strpos(definition,old_text)=0 then raise exception 'bookingOperationConditionMigrationDrift'; end if;
  execute replace(definition,old_text,old_text||' or target.operational_condition<>''normal''');
end; $migration$;
commit;
