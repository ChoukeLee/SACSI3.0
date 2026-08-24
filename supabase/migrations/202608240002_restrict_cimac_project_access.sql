-- Restrict CIMAC to the two explicitly approved accounts without changing SACSI access.

begin;

create table if not exists public.project_account_access (
  project_id uuid not null references public.projects(id) on delete cascade,
  account_email text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, account_email),
  constraint project_account_access_email_normalized
    check (account_email = lower(trim(account_email)))
);

insert into public.project_account_access (project_id, account_email)
select p.id, allowed.account_email
from public.projects p
cross join (
  values
    ('admin@sacsi.com'::text),
    ('boss@sacsi.com'::text)
) as allowed(account_email)
where p.code = 'CIMAC'
on conflict (project_id, account_email) do nothing;

create or replace function public.is_project_account(project_code text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when upper(project_code) <> 'CIMAC' then true
    else lower(coalesce(auth.jwt() ->> 'email', '')) in ('admin@sacsi.com', 'boss@sacsi.com')
  end;
$$;

create or replace function public.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and (
        p.code <> 'CIMAC'
        or exists (
          select 1
          from public.project_account_access access
          where access.project_id = p.id
            and access.account_email = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
  );
$$;

create or replace function public.can_access_building(target_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.buildings b
    where b.id = target_building_id
      and public.can_access_project(b.project_id)
  );
$$;

create or replace function public.can_access_unit(target_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.units u
    where u.id = target_unit_id
      and public.can_access_building(u.building_id)
  );
$$;

revoke all on function public.is_project_account(text) from public;
revoke all on function public.can_access_project(uuid) from public;
revoke all on function public.can_access_building(uuid) from public;
revoke all on function public.can_access_unit(uuid) from public;
grant execute on function public.is_project_account(text) to authenticated, service_role;
grant execute on function public.can_access_project(uuid) to authenticated, service_role;
grant execute on function public.can_access_building(uuid) to authenticated, service_role;
grant execute on function public.can_access_unit(uuid) to authenticated, service_role;

alter table public.project_account_access enable row level security;
drop policy if exists "members read their project access" on public.project_account_access;
create policy "members read their project access"
  on public.project_account_access for select to authenticated
  using (account_email = lower(coalesce(auth.jwt() ->> 'email', '')));
grant select on public.project_account_access to authenticated;
grant all on public.project_account_access to service_role;

-- Restrictive policies combine with the existing role policies using AND.
drop policy if exists "project account restricts project reads" on public.projects;
create policy "project account restricts project reads"
  on public.projects as restrictive for select to authenticated
  using (public.can_access_project(id));

drop policy if exists "project account restricts project inserts" on public.projects;
create policy "project account restricts project inserts"
  on public.projects as restrictive for insert to authenticated
  with check (public.is_project_account(code));

drop policy if exists "project account restricts project updates" on public.projects;
create policy "project account restricts project updates"
  on public.projects as restrictive for update to authenticated
  using (public.can_access_project(id))
  with check (public.is_project_account(code));

drop policy if exists "project account restricts project deletes" on public.projects;
create policy "project account restricts project deletes"
  on public.projects as restrictive for delete to authenticated
  using (public.can_access_project(id));

drop policy if exists "project account restricts buildings" on public.buildings;
create policy "project account restricts buildings"
  on public.buildings as restrictive for all to authenticated
  using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));

drop policy if exists "project account restricts units" on public.units;
create policy "project account restricts units"
  on public.units as restrictive for all to authenticated
  using (public.can_access_building(building_id))
  with check (public.can_access_building(building_id));

drop policy if exists "project account restricts unit flags" on public.unit_business_flags;
create policy "project account restricts unit flags"
  on public.unit_business_flags as restrictive for all to authenticated
  using (public.can_access_unit(unit_id))
  with check (public.can_access_unit(unit_id));

drop policy if exists "project account restricts daily bookings" on public.daily_bookings;
create policy "project account restricts daily bookings"
  on public.daily_bookings as restrictive for all to authenticated
  using (public.can_access_unit(unit_id))
  with check (public.can_access_unit(unit_id));

drop policy if exists "project account restricts leases" on public.lease_contracts;
create policy "project account restricts leases"
  on public.lease_contracts as restrictive for all to authenticated
  using (public.can_access_unit(unit_id))
  with check (public.can_access_unit(unit_id));

drop policy if exists "project account restricts sales" on public.sale_contracts;
create policy "project account restricts sales"
  on public.sale_contracts as restrictive for all to authenticated
  using (public.can_access_unit(unit_id))
  with check (public.can_access_unit(unit_id));

drop policy if exists "project account restricts sale schedules" on public.sale_payment_schedule;
create policy "project account restricts sale schedules"
  on public.sale_payment_schedule as restrictive for all to authenticated
  using (exists (
    select 1 from public.sale_contracts contract
    where contract.id = sale_contract_id and public.can_access_unit(contract.unit_id)
  ))
  with check (exists (
    select 1 from public.sale_contracts contract
    where contract.id = sale_contract_id and public.can_access_unit(contract.unit_id)
  ));

drop policy if exists "project account restricts payments" on public.payments;
create policy "project account restricts payments"
  on public.payments as restrictive for all to authenticated
  using (unit_id is null or public.can_access_unit(unit_id))
  with check (unit_id is null or public.can_access_unit(unit_id));

drop policy if exists "project account restricts ledger entries" on public.ledger_entries;
create policy "project account restricts ledger entries"
  on public.ledger_entries as restrictive for all to authenticated
  using (
    (building_id is null or public.can_access_building(building_id))
    and (unit_id is null or public.can_access_unit(unit_id))
  )
  with check (
    (building_id is null or public.can_access_building(building_id))
    and (unit_id is null or public.can_access_unit(unit_id))
  );

drop policy if exists "project account restricts receivables" on public.receivables;
create policy "project account restricts receivables"
  on public.receivables as restrictive for all to authenticated
  using (
    (building_id is null or public.can_access_building(building_id))
    and (unit_id is null or public.can_access_unit(unit_id))
  )
  with check (
    (building_id is null or public.can_access_building(building_id))
    and (unit_id is null or public.can_access_unit(unit_id))
  );

drop policy if exists "project account restricts cleaning tasks" on public.cleaning_tasks;
create policy "project account restricts cleaning tasks"
  on public.cleaning_tasks as restrictive for all to authenticated
  using (public.can_access_unit(unit_id))
  with check (public.can_access_unit(unit_id));

drop policy if exists "project account restricts notifications" on public.notifications;
create policy "project account restricts notifications"
  on public.notifications as restrictive for all to authenticated
  using (building_id is null or public.can_access_building(building_id))
  with check (building_id is null or public.can_access_building(building_id));

commit;
