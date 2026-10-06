begin;

-- Profiles are authoritative. Never infer a privileged role from an email/JWT.
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path='' as $$
  select role::text from public.user_profiles where id=auth.uid();
$$;
revoke all on function public.current_user_role() from public,anon;
grant execute on function public.current_user_role() to authenticated,service_role;

alter table public.projects add column access_mode text not null default 'open'
  check (access_mode in ('open','restricted'));
update public.projects set access_mode='restricted' where code='CIMAC';
alter table public.project_account_access add column account_id uuid references auth.users(id);
-- Match only a unique existing identity; unconfigured invitations cannot grant access.
update public.project_account_access a set account_id=u.id from auth.users u
where lower(u.email)=a.account_email
  and (select count(*) from auth.users x where lower(x.email)=a.account_email)=1;
create unique index project_account_identity on public.project_account_access(project_id,account_id);
drop policy if exists "members read their project access" on public.project_account_access;
create policy "members read their project access" on public.project_account_access
  for select to authenticated using(account_id=auth.uid());

create or replace function public.can_access_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_user_role() is not null and exists (
    select 1 from public.projects p where p.id=target_project_id and
      (p.access_mode='open' or exists(select 1 from public.project_account_access a
        where a.project_id=p.id and a.account_id=auth.uid()))
  );
$$;
create or replace function public.is_project_account(project_code text)
returns boolean language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from public.projects p where upper(p.code)=upper(project_code))
    then exists(select 1 from public.projects p where upper(p.code)=upper(project_code) and public.can_access_project(p.id))
    else coalesce(public.has_app_role('admin'),false) end;
$$;
revoke all on function public.can_access_project(uuid),public.is_project_account(text) from public,anon;
grant execute on function public.can_access_project(uuid),public.is_project_account(text) to authenticated,service_role;

-- Detail, summary and export use one filtered relation under one SQL snapshot.
create function public.finance_read_rpc(p_kind text,p_filters jsonb default '{}',
  p_page integer default 1,p_export boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_app_role('admin','finance','boss') then
    raise exception 'financePermissionDenied' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('ledger','receivables') or p_page is null or p_page<1 or p_page>2000000 or p_export is null
    or p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'invalidFinanceFilter'; end if;
  if nullif(p_filters->>'dateFrom','')::date> nullif(p_filters->>'dateTo','')::date then
    raise exception 'invalidFinanceDateRange'; end if;
  with source as (
    select l.id,l.entry_date dt,l.building_id,l.unit_id,to_jsonb(l) doc
    from public.ledger_entries l where p_kind='ledger'
    union all
    select r.id,r.due_date,r.building_id,r.unit_id,to_jsonb(r)
    from public.receivables r where p_kind='receivables'
  ), filtered as materialized (
    select s.id,s.dt,s.doc||jsonb_build_object('unit_label',u.unit_no,
      'building_label',b.display_name) doc from source s
    left join public.units u on u.id=s.unit_id
    left join public.buildings b on b.id=coalesce(s.building_id,u.building_id)
    where (nullif(p_filters->>'dateFrom','') is null or s.dt>=(p_filters->>'dateFrom')::date)
    and (nullif(p_filters->>'dateTo','') is null or s.dt<=(p_filters->>'dateTo')::date)
    and (nullif(p_filters->>'buildingId','') is null or coalesce(s.building_id,u.building_id)=(p_filters->>'buildingId')::uuid)
    and (nullif(p_filters->>'direction','') is null or s.doc->>'direction'=p_filters->>'direction')
    and (nullif(p_filters->>'category','') is null or s.doc->>'category'=p_filters->>'category')
    and (nullif(p_filters->>'status','') is null or s.doc->>'status'=p_filters->>'status')
    and (p_kind<>'receivables' or coalesce(nullif(p_filters->>'management',''),'managed')='all'
      or s.doc->>'management_status'=coalesce(nullif(p_filters->>'management',''),'managed'))
    and (nullif(p_filters->>'search','') is null or
      position(lower(p_filters->>'search') in lower(coalesce(s.doc->>'description',s.doc->>'title','')||' '||coalesce(u.unit_no,'')))>0)
  ), totals as (
    select count(*) n,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='income'),0) income,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='expense'),0) expense,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='liability_in'),0) liability_in,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='liability_out'),0) liability_out,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) receivable,
      coalesce(sum((doc->>'paid_amount_xof')::numeric) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) paid,
      coalesce(sum(greatest(0,(doc->>'amount_xof')::numeric-(doc->>'paid_amount_xof')::numeric)) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) outstanding,
      coalesce(sum(greatest(0,(doc->>'amount_xof')::numeric-(doc->>'paid_amount_xof')::numeric)) filter(where doc->>'status' not in ('cancelled','paid') and doc->>'management_status'='managed' and dt<current_date),0) overdue
    from filtered
  ), detail as (
    select doc,dt,id from filtered order by dt desc,id
    limit case when p_export then 100001 else 50 end
    offset case when p_export then 0 else (p_page-1)*50 end
  ) select jsonb_build_object('kind',p_kind,'page',p_page,'pageSize',50,
    'total',n,'summary',to_jsonb(totals)-'n',
    'rows',coalesce((select jsonb_agg(doc order by dt desc,id) from detail),'[]'::jsonb))
  into result from totals;
  if p_export and (result->>'total')::bigint>100000 then raise exception 'exportTooLarge'; end if;
  return result;
end; $$;
revoke all on function public.finance_read_rpc(text,jsonb,integer,boolean) from public,anon;
grant execute on function public.finance_read_rpc(text,jsonb,integer,boolean) to authenticated;

create function public.account_access_summary_rpc() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.has_app_role('admin') then raise exception 'accountPermissionDenied' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('email',u.email,'displayName',p.display_name,'role',p.role,
    'projectScope',case when exists(select 1 from public.projects project where project.access_mode='restricted'
      and not exists(select 1 from public.project_account_access a where a.project_id=project.id and a.account_id=p.id)) then 'restricted' else 'all' end,
    'projectNames',coalesce((select string_agg(project.display_name,', ' order by project.code) from public.projects project
      where project.access_mode='open' or exists(select 1 from public.project_account_access a where a.project_id=project.id and a.account_id=p.id)),'')) order by u.email)
    from public.user_profiles p join auth.users u on u.id=p.id),'[]'::jsonb);
end; $$;
revoke all on function public.account_access_summary_rpc() from public,anon,service_role;
grant execute on function public.account_access_summary_rpc() to authenticated;

commit;
