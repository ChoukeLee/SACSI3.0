-- Login rate limiting (Stage 1 hardening).
-- The login server action records attempts and checks recent failures to
-- throttle credential stuffing before it reaches Supabase Auth. Uses
-- SECURITY DEFINER RPCs so the anonymous pre-login client can call them
-- without granting broad table access.

create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  attempt_key text not null,
  success boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists login_attempts_key_time_idx
  on public.login_attempts (attempt_key, attempted_at desc);

create or replace function public.record_login_attempt(p_key text, p_success boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.login_attempts (attempt_key, success)
  values (p_key, p_success);
  -- Keep the table bounded: drop anything older than a day.
  delete from public.login_attempts where attempted_at < now() - interval '24 hours';
$$;

create or replace function public.login_failure_count(p_key text, p_window_minutes integer default 15)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.login_attempts
  where attempt_key = p_key
    and success = false
    and attempted_at > now() - make_interval(mins => p_window_minutes);
$$;

revoke all on function public.record_login_attempt(text, boolean) from public, anon, authenticated;
revoke all on function public.login_failure_count(text, integer) from public, anon, authenticated;
grant execute on function public.record_login_attempt(text, boolean) to anon, authenticated, service_role;
grant execute on function public.login_failure_count(text, integer) to anon, authenticated, service_role;

alter table public.login_attempts enable row level security;
