-- Promote Ying to a full administrator at both the profile and RLS boundaries.

update public.user_profiles
set role = 'admin'::public.user_role,
    display_name = 'Ying',
    updated_at = now()
where id = (
  select id from auth.users where lower(email) = 'ying@sacsi.com' limit 1
);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case lower(coalesce(auth.jwt() ->> 'email', ''))
    when 'admin@sacsi.com' then 'admin'
    when 'boss@sacsi.com' then 'boss'
    when 'finance@sacsi.com' then 'finance'
    when 'front@sacsi.com' then 'front_desk'
    when 'ying@sacsi.com' then 'admin'
    else (
      select role::text
      from public.user_profiles
      where id = auth.uid()
    )
  end;
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated, service_role;
