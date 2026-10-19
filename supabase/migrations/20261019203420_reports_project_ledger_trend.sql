begin;

-- Registered ledger totals only: neither verified cash nor accounting profit.
-- Deposits/passif are absent from net. Trend ignores detail search/pagination.
create function public.reports_trend_rpc(p_project_id uuid, p_end_month date)
returns jsonb language plpgsql stable security invoker
set search_path = '' set plan_cache_mode = 'force_custom_plan' as $$
declare
  scope_buildings uuid[];
  scope_units uuid[];
  result jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','finance','boss'), false) then
    raise exception 'reportPermissionDenied' using errcode = '42501';
  end if;
  if p_project_id is null or not coalesce(public.can_access_project(p_project_id), false)
    or not exists(select 1 from public.projects p where p.id = p_project_id and p.is_active) then
    raise exception 'reportPermissionDenied' using errcode = '42501';
  end if;
  if p_end_month is null or p_end_month <> date_trunc('month', p_end_month)::date
    or p_end_month < date '1900-01-01' or p_end_month > date '9999-12-01' then
    raise exception 'invalidReportMonth';
  end if;

  select coalesce(array_agg(b.id), '{}'::uuid[]) into scope_buildings
  from public.buildings b where b.project_id = p_project_id;
  select coalesce(array_agg(u.id), '{}'::uuid[]) into scope_units
  from public.units u where u.building_id = any(scope_buildings);

  with months as (
    select generate_series(
      p_end_month::timestamp - interval '11 months',
      p_end_month::timestamp, interval '1 month'
    )::date as month
  ), totals as (
    select date_trunc('month', l.entry_date)::date as month,
      coalesce(sum(l.amount_xof) filter (where l.direction = 'income'), 0) income,
      coalesce(sum(l.amount_xof) filter (where l.direction = 'expense'), 0) expense
    from public.ledger_entries l
    where l.entry_date >= (p_end_month - interval '11 months')::date
      and l.entry_date < (p_end_month + interval '1 month')::date
      and (l.building_id = any(scope_buildings)
        or (l.building_id is null and l.unit_id = any(scope_units)))
      and l.direction in ('income', 'expense')
    group by date_trunc('month', l.entry_date)::date
  )
  select jsonb_agg(jsonb_build_object(
    'month', to_char(m.month, 'YYYY-MM'),
    'income', coalesce(t.income, 0), 'expense', coalesce(t.expense, 0),
    'net', coalesce(t.income, 0) - coalesce(t.expense, 0)
  ) order by m.month) into result
  from months m left join totals t on t.month = m.month;
  return result;
end; $$;

revoke all on function public.reports_trend_rpc(uuid, date) from public, anon;
grant execute on function public.reports_trend_rpc(uuid, date) to authenticated;
notify pgrst, 'reload schema';
commit;
