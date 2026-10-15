begin;
set local search_path='';

-- Authorization remains authoritative in RLS. There is no privileged financial
-- reader, new definer, session cache, JWT-derived app role, or changed helper API.
-- The parent tables already permit exactly the five application roles; verify
-- that precondition before replacing row-at-a-time helper lookups with their
-- RLS-visible parent sets. Each uncorrelated set is evaluated per SQL statement.
do $migration$
declare item record; expr text; part text; new_expr text; check_expr text; parent_signature text; rewritten integer:=0;
begin
  -- The full parent-policy boundary, not merely one permissive read rule, must
  -- match the audited baseline. Additional restrictive rules would change the
  -- meaning of inherited parent visibility relative to the legacy helpers.
  -- Names (not OIDs) make this fingerprint portable across fresh native rebuilds.
  if exists(select 1 from pg_class c where c.oid in ('public.projects'::regclass,
    'public.buildings'::regclass,'public.units'::regclass,'public.sale_contracts'::regclass)
    and not c.relrowsecurity) then raise exception 'authorizationParentRlsMigrationDrift'; end if;
  select md5(jsonb_agg(jsonb_build_object('table',c.relname,'name',p.polname,
    'command',p.polcmd,'permissive',p.polpermissive,
    'roles',(select jsonb_agg(case when role_id=0 then 'public' else pg_catalog.pg_get_userbyid(role_id) end
      order by case when role_id=0 then 'public' else pg_catalog.pg_get_userbyid(role_id) end)
      from unnest(p.polroles) role_id),
    'qual',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
    order by c.relname,p.polname)::text) into parent_signature
  from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in (
    'public.projects'::regclass,'public.buildings'::regclass,'public.units'::regclass,'public.sale_contracts'::regclass);
  if parent_signature is distinct from '218f0acfb9302adba855976bae66344d' then
    raise exception 'authorizationParentPolicyMigrationDrift' using detail=parent_signature;
  end if;
  if (select array_agg(e.enumlabel::text order by e.enumlabel) from pg_enum e
      where e.enumtypid='public.user_role'::regtype)
      is distinct from array['admin','boss','finance','front_desk','rental_sales']::text[] then
    raise exception 'authorizationRoleSetMigrationDrift';
  end if;
  for item in select unnest(array['projects','buildings','units','sale_contracts']) relation loop
    if not exists(select 1 from pg_policy p where p.polrelid=('public.'||item.relation)::regclass
      and p.polcmd='r' and p.polpermissive and pg_get_expr(p.polqual,p.polrelid) like
      '%has_app_role(VARIADIC ARRAY[''admin''::text, ''boss''::text, ''finance''::text, ''front_desk''::text, ''rental_sales''::text])%') then
      raise exception 'authorizationParentReadMigrationDrift';
    end if;
  end loop;

  -- Keep the root project policies untouched: their existing STABLE helper
  -- reads the stored project row even when UPDATE WITH CHECK sees a new row.
  -- Inlining access_mode would change open -> restricted UPDATE semantics.
  -- Only the small root set retains a helper lookup; children reuse that set.
  for item in select p.*,c.relname from pg_policy p join pg_class c on c.oid=p.polrelid
    where p.polrelid='public.projects'::regclass and p.polname in (
      'project account restricts project reads','project account restricts project updates',
      'project account restricts project deletes') loop
    if item.polpermissive or pg_get_expr(item.polqual,item.polrelid)<>'public.can_access_project(id)' then
      raise exception 'authorizationProjectPolicyMigrationDrift';
    end if;
    rewritten:=rewritten+1;
  end loop;
  if rewritten<>3 then raise exception 'authorizationProjectPolicyMigrationDrift'; end if;

  -- All outer NULL guards and boolean groupings are retained verbatim. COALESCE
  -- preserves each helper's false result for NULL/missing references, including
  -- direct INSERT/UPDATE WITH CHECK and conflicting building/unit project links.
  for item in select p.*,c.relname from pg_policy p join pg_class c on c.oid=p.polrelid
    where p.polrelid in ('public.buildings'::regclass,'public.units'::regclass,
      'public.unit_business_flags'::regclass,'public.daily_bookings'::regclass,
      'public.lease_contracts'::regclass,'public.sale_contracts'::regclass,
      'public.payments'::regclass,'public.ledger_entries'::regclass,'public.receivables'::regclass,
      'public.cleaning_tasks'::regclass,'public.notifications'::regclass,'public.property_fee_rules'::regclass)
      and (pg_get_expr(p.polqual,p.polrelid) ~ 'public\.can_access_(project|building|unit)\('
        or pg_get_expr(p.polwithcheck,p.polrelid) ~ 'public\.can_access_(project|building|unit)\(') loop
    expr:=pg_get_expr(item.polqual,item.polrelid); check_expr:=pg_get_expr(item.polwithcheck,item.polrelid);
    for part in select unnest(array['qual','check']) loop
      if part='qual' then new_expr:=expr; else new_expr:=check_expr; end if;
      new_expr:=replace(new_expr,'public.can_access_project(project_id)',
        'coalesce(project_id in (select p.id from public.projects p),false)');
      new_expr:=replace(new_expr,'public.can_access_building(building_id)',
        'coalesce(building_id in (select b.id from public.buildings b),false)');
      new_expr:=replace(new_expr,'public.can_access_unit(unit_id)',
        'coalesce(unit_id in (select u.id from public.units u),false)');
      if new_expr ~ 'public\.can_access_(project|building|unit)\(' then
        raise exception 'authorizationReferencePolicyMigrationDrift';
      end if;
      -- Save the first/second expression without changing NULL clause absence.
      if part='qual' then expr:=new_expr; else check_expr:=new_expr; end if;
    end loop;
    execute format('alter policy %I on public.%I%s%s',item.polname,item.relname,
      case when expr is null then '' else format(' using (%s)',expr) end,
      case when check_expr is null then '' else format(' with check (%s)',check_expr) end);
  end loop;
  if not exists(select 1 from pg_policy where polrelid='public.sale_payment_schedule'::regclass
    and polname='project account restricts sale schedules' and not polpermissive) then
    raise exception 'authorizationSchedulePolicyMigrationDrift';
  end if;
  alter policy "project account restricts sale schedules" on public.sale_payment_schedule
    using(coalesce(sale_contract_id in (select s.id from public.sale_contracts s),false))
    with check(coalesce(sale_contract_id in (select s.id from public.sale_contracts s),false));

  -- Only literal role-array calls are wrapped. ALTER POLICY leaves the command,
  -- target roles and permissive/restrictive combination unchanged, including
  -- all write USING/WITH CHECK clauses. This is an InitPlan, not a role cache.
  for item in select p.*,c.relname from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' loop
    expr:=pg_get_expr(item.polqual,item.polrelid); check_expr:=pg_get_expr(item.polwithcheck,item.polrelid);
    expr:=regexp_replace(expr,'public\.has_app_role\(VARIADIC (ARRAY\[(?:''[a-z_]+''::text(?:, )?)+\])\)',
      '(SELECT public.has_app_role(VARIADIC \1))','g');
    check_expr:=regexp_replace(check_expr,'public\.has_app_role\(VARIADIC (ARRAY\[(?:''[a-z_]+''::text(?:, )?)+\])\)',
      '(SELECT public.has_app_role(VARIADIC \1))','g');
    if expr is distinct from pg_get_expr(item.polqual,item.polrelid)
      or check_expr is distinct from pg_get_expr(item.polwithcheck,item.polrelid) then
      execute format('alter policy %I on public.%I%s%s',item.polname,item.relname,
        case when expr is null then '' else format(' using (%s)',expr) end,
        case when check_expr is null then '' else format(' with check (%s)',check_expr) end);
    end if;
  end loop;
end; $migration$;
notify pgrst,'reload schema';
commit;
