-- Add Zhenyong to the fixed daily-booking agent roster.

with inserted as (
  insert into public.customers(name, notes, is_blacklisted)
  select '振勇', '日租经办人', false
  where not exists (
    select 1 from public.customers where name = '振勇'
  )
  returning id, name
)
insert into public.audit_logs(action, entity_type, entity_id, after_data, metadata)
select
  'create_daily_booking_agent',
  'customer',
  inserted.id,
  jsonb_build_object('name', inserted.name, 'is_daily_booking_agent', true),
  jsonb_build_object('source', 'fixed daily booking agent roster 2026-09-08')
from inserted;
