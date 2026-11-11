-- Record actual refunds and cancel the matching reservations atomically.
begin;

create table private.daily_cancel_refund_requests (
  id uuid primary key,
  actor_id uuid not null,
  payload jsonb not null,
  result jsonb not null
);
revoke all on private.daily_cancel_refund_requests from public, anon, authenticated, service_role;

create function public.operator_cancel_refunded_reservations(
  p_request_id uuid,
  p_booking_ids uuid[],
  p_amount_each numeric,
  p_refund_date date,
  p_method text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payload jsonb;
  v_prior private.daily_cancel_refund_requests%rowtype;
  v_booking public.daily_bookings%rowtype;
  v_booking_id uuid;
  v_building_id uuid;
  v_payment_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_actor is null or not public.has_app_role('admin')
    or not coalesce(private.current_operator_action_allowed('refund_daily_payment', 'L3'), false)
    or not coalesce(private.current_operator_action_allowed('cancel_no_show_booking', 'L3'), false)
  then raise exception 'operationForbidden' using errcode = '42501'; end if;

  if p_request_id is null or coalesce(cardinality(p_booking_ids), 0) not between 1 and 20
    or cardinality(p_booking_ids) <> (select count(distinct id) from unnest(p_booking_ids) as ids(id))
    or p_amount_each is null or p_amount_each not between 1 and 999999999999
    or trunc(p_amount_each) <> p_amount_each
    or p_refund_date is null or not isfinite(p_refund_date) or p_refund_date > current_date
    or p_method is null or p_method not in ('cash', 'check', 'bank_transfer', 'other')
  then raise exception 'operationInvalidRequest'; end if;

  if exists (
    select 1 from unnest(p_booking_ids) as ids(id)
    where not exists (
      select 1 from public.daily_bookings b
      where b.id = ids.id and public.can_access_unit(b.unit_id)
    )
  ) then raise exception 'operationForbidden' using errcode = '42501'; end if;

  v_payload := jsonb_build_object(
    'bookingIds', (select jsonb_agg(id order by id) from unnest(p_booking_ids) as ids(id)),
    'amountEach', p_amount_each, 'refundDate', p_refund_date, 'method', p_method
  );
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_prior from private.daily_cancel_refund_requests where id = p_request_id;
  if found then
    if v_prior.actor_id <> v_actor or v_prior.payload <> v_payload then
      raise exception 'operationRequestConflict';
    end if;
    return v_prior.result || jsonb_build_object('status', 'completed_previously', 'verified', false);
  end if;

  for v_booking_id in select id from unnest(p_booking_ids) as ids(id) order by id loop
    select * into v_booking from public.daily_bookings
    where id = v_booking_id and public.can_access_unit(unit_id) for update;
    if not found or v_booking.status not in ('pending_review', 'confirmed')
      or v_booking.actual_check_out is not null
      or p_refund_date < v_booking.created_at::date
      or v_booking.prepaid_amount_xof is distinct from p_amount_each
    then raise exception 'operationRefundReviewRequired'; end if;

    select building_id into strict v_building_id from public.units where id = v_booking.unit_id;
    if (select sum(p.amount) from public.payments p
        where p.source_type = 'daily_booking' and p.source_id = v_booking_id)
       is distinct from p_amount_each
      or exists (
        select 1 from public.payments p
        where p.source_type = 'daily_booking' and p.source_id = v_booking_id
          and (p.amount is null or p.amount <= 0 or p.currency is distinct from 'XOF'
            or p.unit_id is distinct from v_booking.unit_id
            or p.customer_id is distinct from v_booking.customer_id
            or p.payment_date > p_refund_date
            or (select count(*) from public.ledger_entries l where l.payment_id = p.id) <> 1
            or not exists (
              select 1 from public.ledger_entries l
              where l.payment_id = p.id and l.unit_id = v_booking.unit_id
                and l.building_id = v_building_id and l.direction = 'income' and l.amount_xof = p.amount
            ))
      )
    then raise exception 'operationFinanceMismatch'; end if;

    insert into public.payments (
      unit_id, customer_id, source_type, source_id, payment_date, amount, currency,
      exchange_rate_to_xof, payment_method, request_id, request_kind, notes
    ) values (
      v_booking.unit_id, v_booking.customer_id, 'daily_booking', v_booking_id, p_refund_date,
      -p_amount_each, 'XOF', 1, p_method, gen_random_uuid(), 'daily_refund', '预订取消，登记已全额退款'
    ) returning id into v_payment_id;
    insert into public.ledger_entries (
      building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
    ) values (
      v_building_id, v_booking.unit_id, v_payment_id, p_refund_date,
      'expense', 'daily_rental', p_amount_each, '预订取消退款'
    );
    perform public.daily_sync_booking_finance_tx(v_booking_id);
    perform public.daily_cancel_booking_rpc(v_booking_id, jsonb_build_object(
      'request_id', p_request_id, 'refund_payment_id', v_payment_id, 'refund_amount_xof', p_amount_each
    ));

    if not exists (select 1 from public.daily_bookings where id = v_booking_id
                   and status = 'cancelled' and prepaid_amount_xof = 0)
      or exists (select 1 from public.receivables where source_type = 'daily_booking'
                 and source_id = v_booking_id and status is distinct from 'cancelled')
    then raise exception 'operationFinanceMismatch'; end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'bookingId', v_booking_id, 'paymentId', v_payment_id, 'refundXof', p_amount_each
    ));
  end loop;

  v_result := jsonb_build_object('requestId', p_request_id, 'status', 'completed', 'verified', true, 'items', v_results);
  insert into private.daily_cancel_refund_requests values (p_request_id, v_actor, v_payload, v_result);
  return v_result;
end;
$$;
revoke all on function public.operator_cancel_refunded_reservations(uuid, uuid[], numeric, date, text)
from public, anon, authenticated, service_role;
grant execute on function public.operator_cancel_refunded_reservations(uuid, uuid[], numeric, date, text)
to authenticated;

create function public.operator_cancel_refunded_reservations_status(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select result || jsonb_build_object('status', 'completed_previously', 'verified', false)
    from private.daily_cancel_refund_requests r
    where r.id = p_request_id and r.actor_id = auth.uid()
      and public.has_app_role('admin')
      and private.current_operator_action_allowed('refund_daily_payment', 'L3')
      and private.current_operator_action_allowed('cancel_no_show_booking', 'L3')
      and not exists (
        select 1 from jsonb_array_elements_text(r.payload->'bookingIds') as ids(id)
        where not exists (
          select 1 from public.daily_bookings b
          where b.id = ids.id::uuid and public.can_access_unit(b.unit_id)
        )
      )
  ), jsonb_build_object('status', 'not_found', 'requestId', p_request_id, 'verified', false));
$$;
revoke all on function public.operator_cancel_refunded_reservations_status(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.operator_cancel_refunded_reservations_status(uuid) to authenticated;
commit;
