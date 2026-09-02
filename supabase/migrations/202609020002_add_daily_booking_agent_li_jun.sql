-- Add Li Jun to the confirmed fixed daily-booking agent list.

with inserted as (
  insert into public.customers(name, notes, is_blacklisted)
  select '李军', '日租经办人', false
  where not exists (
    select 1 from public.customers where name = '李军'
  )
  returning id, name
)
insert into public.audit_logs(action, entity_type, entity_id, after_data, metadata)
select
  'create_daily_booking_agent',
  'customer',
  inserted.id,
  jsonb_build_object('name', inserted.name, 'is_daily_booking_agent', true),
  jsonb_build_object('source', 'confirmed daily booking agent 2026-09-02')
from inserted;
