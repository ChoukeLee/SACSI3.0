-- Daily bookings no longer have an approval step. Keep the existing atomic
-- create implementation as a private core, then expose an admin-only wrapper
-- that commits the booking directly in confirmed status.

alter function public.daily_create_booking_rpc(
  uuid, uuid, date, date, text, numeric, text, text, uuid, jsonb
) rename to daily_create_booking_core_rpc;

revoke all on function public.daily_create_booking_core_rpc(
  uuid, uuid, date, date, text, numeric, text, text, uuid, jsonb
) from public, anon, authenticated, service_role;

create function public.daily_create_booking_rpc(
  p_unit_id uuid,
  p_customer_id uuid,
  p_check_in date,
  p_check_out date default null,
  p_checkout_mode text default 'fixed',
  p_nightly_price_xof numeric default 40000,
  p_notes text default null,
  p_ota_source text default null,
  p_request_id uuid default null,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_booking_id uuid;
begin
  if not public.has_app_role('admin') then
    raise exception 'adminRoleRequired';
  end if;

  v_snapshot := public.daily_create_booking_core_rpc(
    p_unit_id,
    p_customer_id,
    p_check_in,
    p_check_out,
    p_checkout_mode,
    p_nightly_price_xof,
    p_notes,
    p_ota_source,
    p_request_id,
    p_actor
  );

  v_booking_id := (v_snapshot -> 'booking' ->> 'id')::uuid;

  update public.daily_bookings
  set status = 'confirmed',
      updated_at = now()
  where id = v_booking_id
    and status = 'pending_review';

  update public.units
  set status = public.daily_resolve_unit_status(p_unit_id),
      updated_at = now()
  where id = p_unit_id;

  return public.daily_booking_operation_snapshot(v_booking_id, p_unit_id);
end;
$$;

revoke all on function public.daily_create_booking_rpc(
  uuid, uuid, date, date, text, numeric, text, text, uuid, jsonb
) from public, anon;
grant execute on function public.daily_create_booking_rpc(
  uuid, uuid, date, date, text, numeric, text, text, uuid, jsonb
) to authenticated, service_role;

-- There are no pending rows in production at the time of this migration.
-- This makes the migration safe for any environment that still has legacy
-- rows and removes the approval state from active operations.
update public.daily_bookings
set status = 'confirmed',
    updated_at = now()
where status = 'pending_review';

comment on function public.daily_create_booking_rpc(
  uuid, uuid, date, date, text, numeric, text, text, uuid, jsonb
) is 'Atomically creates a confirmed daily booking; only the admin role may create bookings.';
