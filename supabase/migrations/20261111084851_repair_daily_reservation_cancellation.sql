begin;

-- Permit front desk and rental/sales cancellations through the existing RPC.
-- Keep its transactional status, payment and audit checks mandatory for these roles.
create or replace function public.enforce_daily_cancel_role()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'cancelled'
    and not public.has_app_role('admin')
  then
    if auth.uid() is not null
      and old.status in ('pending_review', 'confirmed')
      and public.has_app_role('front_desk', 'rental_sales')
      and current_user = (
        select pg_catalog.pg_get_userbyid(proowner)
        from pg_catalog.pg_proc
        where oid = 'public.daily_cancel_booking_rpc(uuid,jsonb)'::regprocedure
      )
      and public.can_access_unit(old.unit_id)
    then
      return new;
    end if;

    raise exception 'dailyCancelPermissionDenied' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_daily_cancel_role()
is 'Permits front desk and rental/sales to cancel pre-arrival bookings through the daily cancellation RPC.';

create or replace function public.daily_cancel_booking_rpc(
  p_booking_id uuid,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_booking public.daily_bookings%rowtype;
  v_next_status public.unit_status;
  v_paid numeric;
begin
  if auth.uid() is null or not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyCancelPermissionDenied' using errcode = '42501';
  end if;

  select b.* into v_booking
  from public.daily_bookings b
  where b.id = p_booking_id and public.can_access_unit(b.unit_id)
  for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status not in ('pending_review', 'confirmed') then
    raise exception 'bookingCannotBeCancelled';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where source_type = 'daily_booking' and source_id = p_booking_id;
  if v_paid <> 0 or coalesce(v_booking.prepaid_amount_xof, 0) <> 0 then
    raise exception 'bookingHasPayments';
  end if;

  update public.daily_bookings
  set status = 'cancelled',
      prepaid_amount_xof = 0,
      billing_status = 'need_top_up',
      updated_at = now()
  where id = p_booking_id;

  update public.receivables
  set status = 'cancelled', updated_at = now()
  where source_type = 'daily_booking' and source_id = p_booking_id;

  v_next_status := public.daily_resolve_unit_status(v_booking.unit_id, p_booking_id);
  update public.units
  set status = v_next_status, updated_at = now()
  where id = v_booking.unit_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'cancel', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object('next_status', v_next_status)
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

commit;
