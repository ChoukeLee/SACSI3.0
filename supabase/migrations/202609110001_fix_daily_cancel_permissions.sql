-- Keep reservation cancellation aligned with the roles allowed to operate
-- daily rentals. This replaces older deployments where the trigger still
-- required the admin role exclusively.

create or replace function public.enforce_daily_cancel_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'cancelled'
    and not public.has_app_role('admin', 'front_desk', 'rental_sales')
  then
    raise exception 'dailyCancelPermissionDenied' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.enforce_daily_cancel_role()
is 'Allows unpaid reservation cancellation for daily-rental operator roles.';
