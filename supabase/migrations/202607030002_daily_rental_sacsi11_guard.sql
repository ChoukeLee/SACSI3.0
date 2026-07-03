-- Daily rentals are only operated in SACSI11 / 11# apartment.
-- Keep the rule in the database as a final guard for app actions, AI tools,
-- imports, and future RPC calls.

create or replace function public.enforce_daily_booking_sacsi11_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_building_code text;
begin
  select b.code
    into v_building_code
  from public.units u
  join public.buildings b on b.id = u.building_id
  where u.id = new.unit_id;

  if v_building_code is distinct from 'SACSI11' then
    raise exception 'dailyRentalOnlyAllowedInSacsi11'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_daily_bookings_sacsi11_unit on public.daily_bookings;
create trigger trg_daily_bookings_sacsi11_unit
  before insert or update of unit_id on public.daily_bookings
  for each row
  execute function public.enforce_daily_booking_sacsi11_unit();
