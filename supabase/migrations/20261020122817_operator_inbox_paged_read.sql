begin;
-- Additive own-account read. Keep the no-argument legacy inbox for old clients.
-- No source record, authorization policy or financial action is modified.
create function private.operator_inbox_page(p_filters jsonb,p_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); state_filter text; kind_filter text; search_filter text; from_day date; to_day date; answer jsonb;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated' or public.current_user_role() is null then raise exception 'inboxForbidden' using errcode='42501'; end if;
  if p_filters is null or jsonb_typeof(p_filters)<>'object' or p_page is null or p_page<1 or p_page>2000000
    or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('state','kind','search','dateFrom','dateTo'))
    or exists(select 1 from jsonb_each(p_filters) f where jsonb_typeof(f.value)<>'string') then raise exception 'invalidInboxQuery'; end if;
  state_filter:=coalesce(nullif(p_filters->>'state',''),'all'); kind_filter:=coalesce(nullif(p_filters->>'kind',''),'all'); search_filter:=lower(coalesce(p_filters->>'search',''));
  if state_filter not in ('all','pending','completed','expired','superseded','unknown') or kind_filter not in ('all','confirmations','collections','daily-workflows','booking-operations')
    or (search_filter<>'' and search_filter!~'^[a-f0-9-]{1,36}$') then raise exception 'invalidInboxQuery'; end if;
  if coalesce(p_filters->>'dateFrom','')<>'' then
    if p_filters->>'dateFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalidInboxQuery'; end if;
    from_day:=(p_filters->>'dateFrom')::date;
    if not isfinite(from_day) or to_char(from_day,'YYYY-MM-DD')<>p_filters->>'dateFrom' then raise exception 'invalidInboxQuery'; end if;
  end if;
  if coalesce(p_filters->>'dateTo','')<>'' then
    if p_filters->>'dateTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalidInboxQuery'; end if;
    to_day:=(p_filters->>'dateTo')::date;
    if not isfinite(to_day) or to_char(to_day,'YYYY-MM-DD')<>p_filters->>'dateTo' then raise exception 'invalidInboxQuery'; end if;
  end if;
  if from_day>to_day then raise exception 'invalidInboxQuery'; end if;
  with own_items as materialized (
    select p.id,p.request_id,p.status,p.created_at,p.expires_at,'confirmations'::text kind,u.unit_no,bd.display_name building_label,null::text operation,null::integer item_count
    from private.operator_payment_confirmations p join public.daily_bookings b on b.id=p.booking_id join public.units u on u.id=b.unit_id join public.buildings bd on bd.id=u.building_id
    where p.actor_id=actor and public.can_access_unit(b.unit_id) and private.current_operator_action_allowed('record_daily_payment','L2')
    union all
    select w.id,w.request_id,w.status,w.created_at,w.expires_at,'daily-workflows',u.unit_no,bd.display_name,w.request_data->>'operation',null::integer
    from private.operator_daily_workflows w join public.daily_bookings b on b.id=w.booking_id join public.units u on u.id=b.unit_id join public.buildings bd on bd.id=u.building_id
    where w.actor_id=actor and private.daily_workflow_allowed(w.booking_id)
    union all
    select o.id,o.request_id,o.status,o.created_at,o.expires_at,'booking-operations',u.unit_no,bd.display_name,o.request_data->>'operation',null::integer
    from private.operator_booking_operations o join public.units u on u.id=o.unit_id join public.buildings bd on bd.id=u.building_id
    where o.actor_id=actor and private.booking_operation_allowed(o.request_data)
    union all
    select c.id,c.request_id,c.status,c.created_at,c.expires_at,'collections',null::text,null::text,null::text,jsonb_array_length(c.expected_snapshot)
    from private.operator_collection_batches c where c.actor_id=actor and public.has_app_role('admin','finance')
      and not exists(select 1 from jsonb_array_elements(c.expected_snapshot) x where not coalesce(public.can_access_unit((x->'unit'->>'id')::uuid),false))
  ), scoped as materialized (
    select *,case when status='completed' then 'completed' when status='superseded' then 'superseded' when status='pending' and expires_at<=statement_timestamp() then 'expired' when status='pending' then 'pending' else 'unknown' end state
    from own_items where (kind_filter='all' or kind=kind_filter) and (search_filter='' or position(search_filter in lower(request_id::text))>0)
      and (from_day is null or created_at>=from_day::timestamp at time zone 'UTC')
      and (to_day is null or created_at<(to_day+1)::timestamp at time zone 'UTC')
  ), counts as (
    select count(*) all_count,count(*) filter(where state='pending') pending_count,count(*) filter(where state='completed') completed_count,count(*) filter(where state='expired') expired_count,count(*) filter(where state='superseded') superseded_count,count(*) filter(where state='unknown') unknown_count from scoped
  ), filtered as materialized (select * from scoped where state_filter='all' or state=state_filter), paged as (
    select * from filtered order by (state='pending') desc,created_at desc,kind,id offset (p_page-1)*30 limit 30
  ) select jsonb_build_object('page',p_page,'pageSize',30,'total',(select count(*) from filtered),'counts',(select jsonb_build_object('all',all_count,'pending',pending_count,'completed',completed_count,'expired',expired_count,'superseded',superseded_count,'unknown',unknown_count) from counts),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'requestId',request_id,'kind',kind,'sourceStatus',status,'state',state,'createdAt',created_at,'expiresAt',expires_at,'unitNo',unit_no,'buildingLabel',building_label,'operation',operation,'itemCount',item_count) order by (state='pending') desc,created_at desc,kind,id) from paged),'[]'::jsonb)) into answer;
  return answer;
end; $$;
create function public.operator_task_inbox_page_rpc(p_filters jsonb default '{}'::jsonb,p_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.operator_inbox_page($1,$2); $$;
revoke all on function private.operator_inbox_page(jsonb,integer),public.operator_task_inbox_page_rpc(jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function private.operator_inbox_page(jsonb,integer),public.operator_task_inbox_page_rpc(jsonb,integer) to authenticated;
comment on function public.operator_task_inbox_page_rpc(jsonb,integer) is 'Own-account, currently authorized operator confirmation inbox; exact filtered counts and 30-row pagination; no execution or financial writes.';
notify pgrst,'reload schema';
commit;
