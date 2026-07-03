-- Daily rental operation RPCs.
-- These functions run inside PostgreSQL transactions and return the canonical
-- booking/unit/finance/cleaning snapshot expected by the Next.js action layer.

create or replace function public.daily_booking_operation_snapshot(
  p_booking_id uuid,
  p_unit_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking daily_bookings%rowtype;
  v_unit_id uuid;
  v_unit jsonb;
begin
  select * into v_booking from public.daily_bookings where id = p_booking_id;
  v_unit_id := coalesce(v_booking.unit_id, p_unit_id);

  if v_unit_id is not null then
    select to_jsonb(u) into v_unit from public.units u where u.id = v_unit_id;
  end if;

  return jsonb_build_object(
    'booking', case when v_booking.id is null then null else to_jsonb(v_booking) end,
    'unit', coalesce(v_unit, 'null'::jsonb),
    'receivables', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.due_date desc, r.created_at desc)
      from public.receivables r
      where r.source_type = 'daily_booking' and r.source_id = p_booking_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.payment_date desc, p.created_at desc)
      from public.payments p
      where p.source_type = 'daily_booking' and p.source_id = p_booking_id
    ), '[]'::jsonb),
    'cleaningTasks', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from public.cleaning_tasks c
      where c.unit_id = v_unit_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.daily_resolve_unit_status(p_unit_id uuid, p_exclude_booking_id uuid default null)
returns public.unit_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.unit_status;
begin
  select status into v_current from public.units where id = p_unit_id;
  if v_current in ('maintenance', 'locked') then
    return v_current;
  end if;

  if exists (select 1 from public.sale_contracts where unit_id = p_unit_id and status = 'active') then
    return 'sold';
  end if;
  if exists (select 1 from public.lease_contracts where unit_id = p_unit_id and status = 'active') then
    return 'leased';
  end if;
  if exists (
    select 1 from public.daily_bookings
    where unit_id = p_unit_id and status = 'checked_in'
      and (p_exclude_booking_id is null or id <> p_exclude_booking_id)
  ) then
    return 'daily_occupied';
  end if;
  if exists (select 1 from public.cleaning_tasks where unit_id = p_unit_id and is_completed = false) then
    return 'cleaning_pending';
  end if;
  if exists (
    select 1 from public.daily_bookings
    where unit_id = p_unit_id and status in ('pending_review', 'confirmed')
      and (p_exclude_booking_id is null or id <> p_exclude_booking_id)
  ) then
    return 'reserved';
  end if;
  return 'available';
end;
$$;

create or replace function public.daily_confirm_booking_rpc(p_booking_id uuid, p_actor jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking daily_bookings%rowtype;
begin
  select * into v_booking from public.daily_bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status <> 'pending_review' then raise exception 'bookingNotPendingReview'; end if;

  update public.daily_bookings set status = 'confirmed', updated_at = now() where id = p_booking_id;
  update public.units set status = 'reserved', updated_at = now() where id = v_booking.unit_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values ((p_actor->>'actor_id')::uuid, 'confirm', 'daily_booking', p_booking_id, p_actor);

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_check_in_booking_rpc(
  p_booking_id uuid,
  p_prepaid_amount numeric default 0,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking daily_bookings%rowtype;
  v_unit units%rowtype;
  v_payment_id uuid;
begin
  select * into v_booking from public.daily_bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status <> 'confirmed' then raise exception 'bookingNotConfirmed'; end if;

  select * into v_unit from public.units where id = v_booking.unit_id for update;
  if v_unit.status in ('maintenance', 'locked', 'sold', 'leased') then raise exception 'unitUnavailable'; end if;
  if exists (select 1 from public.cleaning_tasks where unit_id = v_booking.unit_id and is_completed = false) then
    raise exception 'cleaningPending';
  end if;
  if exists (select 1 from public.daily_bookings where unit_id = v_booking.unit_id and status = 'checked_in' and id <> p_booking_id) then
    raise exception 'unitAlreadyOccupied';
  end if;

  update public.daily_bookings set status = 'checked_in', updated_at = now() where id = p_booking_id;
  update public.units set status = 'daily_occupied', updated_at = now() where id = v_booking.unit_id;

  if coalesce(p_prepaid_amount, 0) > 0 then
    insert into public.payments(customer_id, unit_id, source_type, source_id, payment_date, amount, currency, exchange_rate_to_xof)
    values (v_booking.customer_id, v_booking.unit_id, 'daily_booking', p_booking_id, current_date, p_prepaid_amount, 'XOF', 1)
    returning id into v_payment_id;

    insert into public.ledger_entries(building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description)
    values (v_unit.building_id, v_booking.unit_id, v_payment_id, current_date, 'income', 'daily_rental', p_prepaid_amount, '日租预付 房间' || v_unit.unit_no);
  end if;

  update public.receivables
  set paid_amount_xof = least(amount_xof, paid_amount_xof + coalesce(p_prepaid_amount, 0)),
      status = case
        when least(amount_xof, paid_amount_xof + coalesce(p_prepaid_amount, 0)) >= amount_xof then 'paid'
        when paid_amount_xof + coalesce(p_prepaid_amount, 0) > 0 then 'partial'
        when due_date < current_date then 'overdue'
        else 'pending'
      end,
      updated_at = now()
  where source_type = 'daily_booking' and source_id = p_booking_id;

  update public.daily_bookings
  set prepaid_amount_xof = coalesce((select sum(amount) from public.payments where source_type = 'daily_booking' and source_id = p_booking_id), 0),
      billing_status = case
        when coalesce((select sum(amount) from public.payments where source_type = 'daily_booking' and source_id = p_booking_id), 0) >= coalesce(final_amount_xof, total_amount_xof) then 'settled'
        when coalesce((select sum(amount) from public.payments where source_type = 'daily_booking' and source_id = p_booking_id), 0) > 0 then 'partially_paid'
        else 'need_top_up'
      end,
      updated_at = now()
  where id = p_booking_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values ((p_actor->>'actor_id')::uuid, 'check_in', 'daily_booking', p_booking_id, p_actor || jsonb_build_object('prepaid_amount', coalesce(p_prepaid_amount, 0)));

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_check_out_booking_rpc(
  p_booking_id uuid,
  p_actual_check_out date default current_date,
  p_final_amount numeric default null,
  p_discount_amount numeric default 0,
  p_discount_reason text default null,
  p_checkout_unit_status public.unit_status default 'cleaning_pending',
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking daily_bookings%rowtype;
  v_nights integer;
  v_gross numeric;
  v_final numeric;
begin
  select * into v_booking from public.daily_bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status <> 'checked_in' then raise exception 'bookingNotCheckedIn'; end if;
  if p_actual_check_out < v_booking.check_in then raise exception 'actualCheckOutBeforeCheckIn'; end if;

  v_nights := greatest(1, p_actual_check_out - v_booking.check_in);
  v_gross := v_nights * v_booking.nightly_price_xof;
  v_final := greatest(0, coalesce(p_final_amount, v_gross - coalesce(p_discount_amount, 0)));

  update public.daily_bookings
  set status = 'checked_out',
      actual_check_out = case when checkout_mode = 'open' then p_actual_check_out else actual_check_out end,
      total_amount_xof = v_gross,
      final_amount_xof = v_final,
      prepaid_amount_xof = coalesce((select sum(amount) from public.payments where source_type = 'daily_booking' and source_id = p_booking_id), 0),
      manual_discount_amount_xof = case when coalesce(p_discount_amount, 0) > 0 then p_discount_amount else manual_discount_amount_xof end,
      manual_discount_reason = case when coalesce(p_discount_amount, 0) > 0 then p_discount_reason else manual_discount_reason end,
      billing_status = case
        when coalesce((select sum(amount) from public.payments where source_type = 'daily_booking' and source_id = p_booking_id), 0) >= v_final then 'settled'
        when coalesce((select sum(amount) from public.payments where source_type = 'daily_booking' and source_id = p_booking_id), 0) > 0 then 'partially_paid'
        else 'need_top_up'
      end,
      updated_at = now()
  where id = p_booking_id;

  update public.units set status = p_checkout_unit_status, updated_at = now() where id = v_booking.unit_id;

  update public.receivables
  set amount_xof = v_final,
      paid_amount_xof = least(v_final, paid_amount_xof),
      status = case
        when paid_amount_xof >= v_final then 'paid'
        when paid_amount_xof > 0 then 'partial'
        when due_date < current_date then 'overdue'
        else 'pending'
      end,
      updated_at = now()
  where source_type = 'daily_booking' and source_id = p_booking_id;

  if p_checkout_unit_status = 'cleaning_pending' then
    insert into public.cleaning_tasks(unit_id, daily_booking_id, is_completed)
    values (v_booking.unit_id, p_booking_id, false);
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values ((p_actor->>'actor_id')::uuid, 'check_out', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object('actual_check_out', p_actual_check_out, 'final_amount', v_final));

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

create or replace function public.daily_complete_cleaning_rpc(p_task_id uuid, p_actor jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task cleaning_tasks%rowtype;
  v_next_status public.unit_status;
begin
  select * into v_task from public.cleaning_tasks where id = p_task_id for update;
  if v_task.id is null then raise exception 'cleaningTaskNotFound'; end if;
  if v_task.is_completed then raise exception 'cleaningTaskAlreadyCompleted'; end if;

  update public.cleaning_tasks set is_completed = true, completed_at = now() where id = p_task_id;
  v_next_status := public.daily_resolve_unit_status(v_task.unit_id);
  update public.units set status = v_next_status, updated_at = now() where id = v_task.unit_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values ((p_actor->>'actor_id')::uuid, 'complete_cleaning', 'cleaning_task', p_task_id,
    p_actor || jsonb_build_object('unit_id', v_task.unit_id, 'next_status', v_next_status));

  return public.daily_booking_operation_snapshot(v_task.daily_booking_id, v_task.unit_id);
end;
$$;

create or replace function public.daily_cancel_booking_rpc(p_booking_id uuid, p_actor jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking daily_bookings%rowtype;
  v_next_status public.unit_status;
begin
  select * into v_booking from public.daily_bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status not in ('pending_review', 'confirmed') then raise exception 'bookingCannotBeCancelled'; end if;

  update public.daily_bookings set status = 'cancelled', prepaid_amount_xof = 0, updated_at = now() where id = p_booking_id;
  update public.receivables set status = 'cancelled', updated_at = now()
  where source_type = 'daily_booking' and source_id = p_booking_id;

  v_next_status := public.daily_resolve_unit_status(v_booking.unit_id, p_booking_id);
  update public.units set status = v_next_status, updated_at = now() where id = v_booking.unit_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values ((p_actor->>'actor_id')::uuid, 'cancel', 'daily_booking', p_booking_id,
    p_actor || jsonb_build_object('next_status', v_next_status));

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;

grant execute on function public.daily_booking_operation_snapshot(uuid, uuid) to authenticated, service_role;
grant execute on function public.daily_resolve_unit_status(uuid, uuid) to authenticated, service_role;
grant execute on function public.daily_confirm_booking_rpc(uuid, jsonb) to authenticated, service_role;
grant execute on function public.daily_check_in_booking_rpc(uuid, numeric, jsonb) to authenticated, service_role;
grant execute on function public.daily_check_out_booking_rpc(uuid, date, numeric, numeric, text, public.unit_status, jsonb) to authenticated, service_role;
grant execute on function public.daily_complete_cleaning_rpc(uuid, jsonb) to authenticated, service_role;
grant execute on function public.daily_cancel_booking_rpc(uuid, jsonb) to authenticated, service_role;
