-- Add the confirmed daily-booking agent, then reassign only the current
-- 11# 1005 and 1202 bookings. Historical and cancelled stays remain unchanged.

with inserted as (
  insert into public.customers(name, notes, is_blacklisted)
  select '振咏', '日租经办人', false
  where not exists (
    select 1 from public.customers where name = '振咏'
  )
  returning id, name
)
insert into public.audit_logs(action, entity_type, entity_id, after_data, metadata)
select
  'create_daily_booking_agent',
  'customer',
  inserted.id,
  jsonb_build_object('name', inserted.name, 'is_daily_booking_agent', true),
  jsonb_build_object('source', 'confirmed daily booking agent 2026-09-09')
from inserted;

with agent as (
  select id
  from public.customers
  where name = '振咏'
  order by created_at
  limit 1
), targets as (
  select
    booking.id,
    booking.customer_id as previous_customer_id,
    booking.booking_agent_id as previous_booking_agent_id,
    unit.unit_no
  from public.daily_bookings booking
  join public.units unit on unit.id = booking.unit_id
  join public.buildings building on building.id = unit.building_id
  where building.code = 'SACSI11'
    and unit.unit_no in ('1005', '1202')
    and booking.status in ('pending_review', 'confirmed', 'checked_in')
), updated as (
  update public.daily_bookings booking
  set customer_id = agent.id,
      booking_agent_id = agent.id,
      updated_at = now()
  from agent, targets
  where booking.id = targets.id
    and (
      booking.customer_id is distinct from agent.id
      or booking.booking_agent_id is distinct from agent.id
    )
  returning
    booking.id,
    targets.unit_no,
    targets.previous_customer_id,
    targets.previous_booking_agent_id,
    agent.id as new_booking_agent_id
)
insert into public.audit_logs(action, entity_type, entity_id, before_data, after_data, metadata)
select
  'reassign_daily_booking_agent',
  'daily_booking',
  updated.id,
  jsonb_build_object(
    'customer_id', updated.previous_customer_id,
    'booking_agent_id', updated.previous_booking_agent_id
  ),
  jsonb_build_object(
    'customer_id', updated.new_booking_agent_id,
    'booking_agent_id', updated.new_booking_agent_id,
    'booking_agent_name', '振咏'
  ),
  jsonb_build_object(
    'source', 'confirmed room reassignment 2026-09-09',
    'building_code', 'SACSI11',
    'unit_no', updated.unit_no
  )
from updated;
