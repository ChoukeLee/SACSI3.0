-- Ensure every confirmed daily-booking agent has a customer identity.
-- The application restricts new daily bookings to the canonical seven names;
-- historical booking customers remain untouched for display compatibility.

with configured(name) as (
  values
    ('Chouke'),
    ('Niamke'),
    ('Esai'),
    ('黄姐'),
    ('小颖'),
    ('镇淮'),
    ('悦凯')
), inserted as (
  insert into public.customers(name, notes, is_blacklisted)
  select c.name, '日租经办人', false
  from configured c
  where not exists (
    select 1 from public.customers existing where existing.name = c.name
  )
  returning id, name
)
insert into public.audit_logs(action, entity_type, entity_id, after_data, metadata)
select
  'create_daily_booking_agent',
  'customer',
  inserted.id,
  jsonb_build_object('name', inserted.name, 'is_daily_booking_agent', true),
  jsonb_build_object('source', 'confirmed daily booking agent list 2026-08-08')
from inserted;
