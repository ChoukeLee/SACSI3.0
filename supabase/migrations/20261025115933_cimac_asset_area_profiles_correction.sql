begin;

-- Area metadata only. Does not revise contracts, issued charges, fee rules,
-- receivables, payments, ledger entries, or tenant identity/occupancy.
create unique index cimac_asset_area_request_once on public.audit_logs(entity_id)
where entity_type='cimac_asset_area_sync';

create function private.guard_cimac_area_audit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare project uuid;
begin
  if new.entity_type='cimac_asset_area_sync' then
    project:=private.cimac_profile_scope(true);
    if tg_op<>'INSERT' or new.action<>'sync'
      or new.entity_id::text is distinct from nullif(current_setting('app.cimac_area_request_id',true),'')
      or new.metadata->>'project_id' is distinct from project::text or new.actor_id is distinct from auth.uid() then
      raise exception 'CimacAreaSyncDenied' using errcode='42501'; end if;
    new.actor_role:=public.current_user_role();
  end if;
  return new;
end; $$;
create trigger cimac_area_audit_guard before insert or update on public.audit_logs
for each row execute function private.guard_cimac_area_audit();
create policy "CIMAC area audit restriction" on public.audit_logs as restrictive for all to authenticated
using(entity_type<>'cimac_asset_area_sync' or exists(select 1 from public.projects p
  where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id)))
with check(entity_type<>'cimac_asset_area_sync' or (public.current_user_role()='admin' and exists(select 1 from public.projects p
  where p.code='CIMAC' and metadata->>'project_id'=p.id::text and public.can_access_project(p.id))));

create function public.cimac_asset_areas_sync_rpc(p_request_id uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  project uuid; actor uuid:=auth.uid(); prior public.audit_logs%rowtype;
  item jsonb; target uuid; expected timestamptz; area numeric(10,2); old public.units%rowtype; saved public.units%rowtype;
  before_rows jsonb:='[]'; after_rows jsonb:='[]'; results jsonb:='[]'; result jsonb; context_before text;
begin
  project:=private.cimac_profile_scope(true);
  perform private.cimac_profile_keys(p_input,array['rows']);
  if p_request_id is null or jsonb_typeof(p_input->'rows') is distinct from 'array'
    or jsonb_array_length(p_input->'rows') not between 1 and 250 or octet_length(p_input::text)>524288 then
    raise exception 'CimacAreaSyncInvalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cimac_asset_area_request:'||p_request_id::text,0));
  select * into prior from public.audit_logs where entity_type='cimac_asset_area_sync' and entity_id=p_request_id;
  if found then
    if prior.actor_id is distinct from actor or prior.metadata->'input' is distinct from p_input
      or prior.metadata->>'project_id' is distinct from project::text then
      raise exception 'CimacAreaSyncRequestConflict' using errcode='22023'; end if;
    return (prior.metadata->'result')||jsonb_build_object('idempotent',true);
  end if;
  for item in select value from jsonb_array_elements(p_input->'rows') loop
    perform private.cimac_profile_keys(item,array['unitId','expectedUpdatedAt','areaSqm','sourceReference']);
    if jsonb_typeof(item->'unitId') is distinct from 'string'
      or jsonb_typeof(item->'expectedUpdatedAt') is distinct from 'string'
      or jsonb_typeof(item->'areaSqm') is distinct from 'string'
      or (item->>'areaSqm') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$'
      or jsonb_typeof(item->'sourceReference') is distinct from 'string'
      or length(btrim(item->>'sourceReference')) not between 1 and 2000 then
      raise exception 'CimacAreaSyncInvalid' using errcode='22023'; end if;
    target:=(item->>'unitId')::uuid; expected:=(item->>'expectedUpdatedAt')::timestamptz; area:=(item->>'areaSqm')::numeric;
    if not isfinite(expected) or area<=0 then raise exception 'CimacAreaSyncInvalid' using errcode='22023'; end if;
    if not exists(select 1 from public.units u join public.buildings b on b.id=u.building_id where u.id=target and b.project_id=project) then
      raise exception 'CimacAreaSyncDenied' using errcode='42501'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_input->'rows'))<>(select count(distinct value->>'unitId') from jsonb_array_elements(p_input->'rows')) then
    raise exception 'CimacAreaSyncInvalid' using errcode='22023'; end if;
  perform 1 from public.units u where u.id in(select (value->>'unitId')::uuid from jsonb_array_elements(p_input->'rows')) order by u.id for update;
  for item in select value from jsonb_array_elements(p_input->'rows') loop
    target:=(item->>'unitId')::uuid;
    select * into old from public.units where id=target;
    if not found or old.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz then
      raise exception 'CimacAreaSyncConflict' using errcode='40001'; end if;
    before_rows:=before_rows||jsonb_build_array(to_jsonb(old));
    update public.units set area_sqm=(item->>'areaSqm')::numeric,updated_at=clock_timestamp() where id=target returning * into saved;
    after_rows:=after_rows||jsonb_build_array(to_jsonb(saved));
    results:=results||jsonb_build_array(jsonb_build_object('unitId',saved.id,'areaSqm',saved.area_sqm,'updatedAt',saved.updated_at));
  end loop;
  result:=jsonb_build_object('success',true,'requestId',p_request_id,'actorId',actor,'projectId',project,'idempotent',false,'rows',results);
  context_before:=current_setting('app.cimac_area_request_id',true);
  perform set_config('app.cimac_area_request_id',p_request_id::text,true);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
    values(actor,public.current_user_role(),'sync','cimac_asset_area_sync',p_request_id,before_rows,after_rows,
      jsonb_build_object('project_id',project,'request_id',p_request_id,'input',p_input,'result',result));
  perform set_config('app.cimac_area_request_id',coalesce(context_before,''),true);
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'CimacAreaSyncInvalid' using errcode='22023';
end; $$;
revoke all on function private.guard_cimac_area_audit() from public,anon,authenticated,service_role;
revoke all on function public.cimac_asset_areas_sync_rpc(uuid,jsonb) from public,anon,service_role;
grant execute on function public.cimac_asset_areas_sync_rpc(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
