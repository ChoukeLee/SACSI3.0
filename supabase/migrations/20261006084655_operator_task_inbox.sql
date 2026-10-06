begin;
-- The inbox shows only the creator's minimal confirmation identities, not raw evidence.
create function private.operator_task_inbox() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or public.current_user_role() is null then raise exception 'inboxForbidden' using errcode='42501'; end if;
  with items as (
    select p.id,p.request_id,p.status,p.created_at,p.expires_at,'confirmations'::text kind
    from private.operator_payment_confirmations p join public.daily_bookings b on b.id=p.booking_id
    where p.actor_id=auth.uid() and public.can_access_unit(b.unit_id)
      and private.current_operator_action_allowed('record_daily_payment','L2')
    union all
    select w.id,w.request_id,w.status,w.created_at,w.expires_at,'daily-workflows'
    from private.operator_daily_workflows w where w.actor_id=auth.uid() and private.daily_workflow_allowed(w.booking_id)
    union all
    select o.id,o.request_id,o.status,o.created_at,o.expires_at,'booking-operations'
    from private.operator_booking_operations o where o.actor_id=auth.uid() and private.booking_operation_allowed(o.request_data)
    union all
    select c.id,c.request_id,c.status,c.created_at,c.expires_at,'collections'
    from private.operator_collection_batches c where c.actor_id=auth.uid() and public.has_app_role('admin','finance')
      and not exists(select 1 from jsonb_array_elements(c.expected_snapshot) x
        where not coalesce(public.can_access_unit((x->'unit'->>'id')::uuid),false))
  ), visible as (
    select *,status='pending' and expires_at<=now() expired from items where status<>'superseded'
  ) select jsonb_build_object('pending',(select count(*) from visible where status='pending' and not expired),
    'items',coalesce((select jsonb_agg(to_jsonb(d)) from (
      select * from visible order by (status='pending') desc,created_at desc,id limit 100
    ) d),'[]'::jsonb)) into result;
  return result;
end; $$;
create function public.operator_task_inbox() returns jsonb language sql stable security invoker set search_path='' as $$
  select private.operator_task_inbox();
$$;
revoke all on function private.operator_task_inbox(),public.operator_task_inbox() from public,anon,authenticated,service_role;
grant execute on function private.operator_task_inbox(),public.operator_task_inbox() to authenticated;
commit;
