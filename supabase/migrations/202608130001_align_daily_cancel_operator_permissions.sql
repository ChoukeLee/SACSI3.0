-- Keep the row-level cancellation guard aligned with the daily operation RPC.
-- Front desk and rental sales users can operate daily bookings, including
-- cancelling unpaid reservations that have not checked in yet.

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
is 'Allows daily booking cancellation for the same operator roles accepted by daily_cancel_booking_rpc.';
