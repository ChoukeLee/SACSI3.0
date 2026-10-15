begin;
-- Windowed calendar data, plus explicitly complete operational/financial context.
-- No LIMIT, no business writes, no privilege bypass and no changes to exports.
create function public.daily_calendar_window_rpc(p_building_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security invoker
set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare
  unit_ids uuid[]; booking_ids uuid[]; month_booking_ids uuid[]; cleaning_booking_ids uuid[];
  selected_ids uuid[]; booking_result jsonb; payment_result jsonb; task_result jsonb;
  unit_result jsonb; daily_unit_result jsonb; counts jsonb;
  today date:=current_date; month_start date:=date_trunc('month',current_date)::date;
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','boss','finance','front_desk','rental_sales'),false) then
    raise exception 'calendarPermissionDenied' using errcode='42501'; end if;
  if p_building_id is null or p_from is null or p_to is null or p_to<=p_from or p_to-p_from>62 then
    raise exception 'invalidCalendarWindow' using errcode='22023'; end if;
  if not coalesce(public.can_access_building(p_building_id),false) or not exists(
    select 1 from public.buildings b where b.id=p_building_id and b.is_active and b.code in ('SACSI11','SACSI5')
  ) then raise exception 'calendarPermissionDenied' using errcode='42501'; end if;

  select coalesce(array_agg(u.id),'{}'::uuid[]) into unit_ids from public.units u where u.building_id=p_building_id;
  select coalesce(array_agg(b.id),'{}'::uuid[]) into booking_ids from public.daily_bookings b where b.unit_id=any(unit_ids);
  select coalesce(array_agg(p.source_id) filter(where p.source_id is not null),'{}'::uuid[]) into month_booking_ids
    from public.payments p where p.source_type='daily_booking' and p.payment_date>=month_start and p.payment_date<=today
      and (p.unit_id=any(unit_ids) or p.source_id=any(booking_ids));
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb),
    coalesce(array_agg(t.daily_booking_id) filter(where t.daily_booking_id is not null),'{}'::uuid[])
    into task_result,cleaning_booking_ids from public.cleaning_tasks t where t.unit_id=any(unit_ids) and not t.is_completed;

  with source as materialized (
    select b.* from public.daily_bookings b where b.unit_id=any(unit_ids)
  ), priced as materialized (
    select b.*,greatest(1,(case
      when b.status='checked_out' and b.actual_check_out is not null then b.actual_check_out
      when coalesce(b.checkout_mode,'fixed')='fixed' and b.check_out is not null then b.check_out
      when b.checkout_mode='open' and b.actual_check_out is not null then b.actual_check_out
      else today end)-b.check_in)::double precision*b.nightly_price_xof::double precision gross_value
    from source b
  ), billed as materialized (
    select b.*,
      case when coalesce(b.checkout_mode,'fixed')='open' and b.status='checked_in' and b.actual_check_out is null
      then greatest(0::double precision,floor(b.gross_value)+case when b.gross_value-floor(b.gross_value)>=0.5 then 1 else 0 end-coalesce(b.manual_discount_amount_xof,0)::double precision)
      else coalesce(b.final_amount_xof::double precision,greatest(0::double precision,
        floor(b.gross_value)+case when b.gross_value-floor(b.gross_value)>=0.5 then 1 else 0 end-coalesce(b.manual_discount_amount_xof,0)::double precision)) end final_due,
      case when b.status='checked_out' and b.actual_check_out is not null then greatest(b.actual_check_out,b.check_in+1)
        when coalesce(b.checkout_mode,'fixed')='fixed' then coalesce(b.check_out,b.check_in)+case when b.checkout_mode='fixed' and b.status<>'checked_out' then 1 else 0 end
        when b.status='checked_in' then coalesce(b.actual_check_out,greatest(today+1,b.check_in+1))
        else b.check_in+1 end display_end
    from priced b
  ), selected as materialized (
    select b.* from billed b where
      b.status in ('pending_review','confirmed','checked_in')
      or (b.status<>'cancelled' and b.check_in<p_to and b.display_end>p_from)
      or (b.status in ('checked_in','checked_out') and b.final_due>coalesce(b.prepaid_amount_xof,0)::double precision)
      or (b.status='checked_out' and b.actual_check_out>=month_start and b.actual_check_out<month_start+interval '1 month')
      or b.id=any(month_booking_ids) or b.id=any(cleaning_booking_ids)
  ) select jsonb_build_object(
      'rows',coalesce((select jsonb_agg(to_jsonb(s)-'gross_value'-'final_due'-'display_end' order by s.check_in desc,s.id desc) from selected s),'[]'::jsonb),
      'total',(select count(*) from selected),
      'currentOutstanding',coalesce(sum(greatest(0::double precision,final_due-coalesce(prepaid_amount_xof,0)::double precision) order by check_in desc,id desc) filter(where status in ('checked_in','checked_out')),0),
      'monthSettled',coalesce(sum(final_due order by check_in desc,id desc) filter(where status='checked_out' and actual_check_out>=month_start and actual_check_out<month_start+interval '1 month'),0)
    ) into booking_result from billed;
  select coalesce(array_agg((b->>'id')::uuid),'{}'::uuid[]) into selected_ids from jsonb_array_elements(booking_result->'rows') b;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.payment_date desc,p.id desc),'[]'::jsonb) into payment_result
    from (select p.id,p.source_type,p.source_id,p.unit_id,p.amount,p.currency,p.exchange_rate_to_xof,
      p.payment_date,p.reversal_of_payment_id,p.request_kind from public.payments p where p.source_type='daily_booking' and (
      p.source_id=any(selected_ids) or (p.payment_date>=month_start and p.payment_date<=today
        and (p.unit_id=any(unit_ids) or p.source_id=any(booking_ids))))) p;
  with raw_units as materialized (
    select u.*,exists(select 1 from public.unit_business_flags f where f.unit_id=u.id and f.business_type='daily_rental' and f.is_enabled) daily_enabled,
      (select f.default_price_xof from public.unit_business_flags f where f.unit_id=u.id and f.business_type='daily_rental' and f.is_enabled) daily_price
    from public.units u where u.id=any(unit_ids)
  ), selected_units as materialized (
    select u.*,u.daily_enabled and u.status in ('available','reserved','daily_occupied','cleaning_pending','maintenance','locked','sold')
      or exists(select 1 from jsonb_array_elements(booking_result->'rows') b where (b->>'unit_id')::uuid=u.id and b->>'status' not in ('checked_out','cancelled')) is_daily
    from raw_units u
  ) select coalesce(jsonb_agg(to_jsonb(u)-'daily_enabled'-'daily_price'-'is_daily'
      ||jsonb_build_object('daily_rental_enabled',u.daily_enabled,'daily_rental_price_xof',u.daily_price)) filter(where u.is_daily),'[]'::jsonb),
      coalesce(jsonb_agg(to_jsonb(u)-'daily_enabled'-'daily_price'-'is_daily'),'[]'::jsonb)
    into daily_unit_result,unit_result from selected_units u;

  -- Small navigation inventory only; never download another building's history.
  with visible_buildings as materialized (
    select b.id from public.buildings b where b.is_active and b.code in ('SACSI11','SACSI5')
  ), visible_units as materialized (
    select u.id,u.building_id,u.status from public.units u where u.building_id in(select id from visible_buildings)
  ), active_units as materialized (
    select distinct b.unit_id from public.daily_bookings b where b.status not in ('checked_out','cancelled')
  ), enabled_units as materialized (
    select f.unit_id from public.unit_business_flags f where f.business_type='daily_rental' and f.is_enabled
  ) select coalesce(jsonb_object_agg(b.id,(
    select count(*) from visible_units u where u.building_id=b.id and (
      (u.status in ('available','reserved','daily_occupied','cleaning_pending','maintenance','locked','sold') and u.id in(select unit_id from enabled_units))
      or u.id in(select unit_id from active_units)))),'{}'::jsonb) into counts from visible_buildings b;

  return jsonb_build_object('buildingId',p_building_id,'from',p_from,'to',p_to,'today',today,
    'bookings',booking_result->'rows','bookingCount',booking_result->'total',
    'currentOutstanding',booking_result->'currentOutstanding','monthSettled',booking_result->'monthSettled',
    'payments',payment_result,'paymentCount',jsonb_array_length(payment_result),'cleaningTasks',task_result,
    'dailyUnits',daily_unit_result,'unitLookupUnits',unit_result,'buildingCounts',counts);
end; $$;
revoke all on function public.daily_calendar_window_rpc(uuid,date,date) from public,anon,service_role;
grant execute on function public.daily_calendar_window_rpc(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
