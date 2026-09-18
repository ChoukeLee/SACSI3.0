-- Add Fulo to the daily-rental agent directory and correct only the current
-- 11#1102 checked-in booking requested on 2026-09-18.

with inserted as (
  insert into public.customers(name, notes, is_blacklisted)
  select 'Fulo', '日租经办人', false
  where not exists (
    select 1 from public.customers where name = 'Fulo'
  )
  returning id, name
)
insert into public.audit_logs(action, entity_type, entity_id, after_data, metadata)
select
  'create_daily_booking_agent',
  'customer',
  inserted.id,
  jsonb_build_object('name', inserted.name, 'is_daily_booking_agent', true),
  jsonb_build_object('source', 'confirmed daily booking agent 2026-09-18')
from inserted;

with agent as (
  select id
  from public.customers
  where name = 'Fulo'
  order by created_at
  limit 1
), target as (
  select
    booking.id,
    booking.customer_id as previous_customer_id,
    booking.booking_agent_id as previous_booking_agent_id,
    booking.notes as previous_notes
  from public.daily_bookings booking
  join public.units unit on unit.id = booking.unit_id
  join public.buildings building on building.id = unit.building_id
  where booking.id = '050ebd85-8582-4907-9d9b-f2d03bdf1acb'
    and building.code = 'SACSI11'
    and unit.unit_no = '1102'
    and booking.status = 'checked_in'
), updated as (
  update public.daily_bookings booking
  set customer_id = agent.id,
      booking_agent_id = agent.id,
      notes = '部长亲戚',
      updated_at = now()
  from agent, target
  where booking.id = target.id
    and (
      booking.customer_id is distinct from agent.id
      or booking.booking_agent_id is distinct from agent.id
      or booking.notes is distinct from '部长亲戚'
    )
  returning
    booking.id,
    target.previous_customer_id,
    target.previous_booking_agent_id,
    target.previous_notes,
    agent.id as new_booking_agent_id
)
insert into public.audit_logs(action, entity_type, entity_id, before_data, after_data, metadata)
select
  'update_daily_booking_agent_and_notes',
  'daily_booking',
  updated.id,
  jsonb_build_object(
    'customer_id', updated.previous_customer_id,
    'booking_agent_id', updated.previous_booking_agent_id,
    'notes', updated.previous_notes
  ),
  jsonb_build_object(
    'customer_id', updated.new_booking_agent_id,
    'booking_agent_id', updated.new_booking_agent_id,
    'booking_agent_name', 'Fulo',
    'notes', '部长亲戚'
  ),
  jsonb_build_object(
    'source', 'confirmed room reassignment 2026-09-18',
    'building_code', 'SACSI11',
    'unit_no', '1102'
  )
from updated;
