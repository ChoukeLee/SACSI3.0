-- Rename the daily-booking agent in place so existing bookings keep the same
-- customer identity while displaying the corrected name.

with renamed as (
  update public.customers
  set name = '颖',
      updated_at = now()
  where name = '小颖'
    and not exists (
      select 1
      from public.customers existing
      where existing.name = '颖'
    )
  returning id
)
insert into public.audit_logs(action, entity_type, entity_id, before_data, after_data, metadata)
select
  'rename_daily_booking_agent',
  'customer',
  renamed.id,
  jsonb_build_object('name', '小颖'),
  jsonb_build_object('name', '颖', 'is_daily_booking_agent', true),
  jsonb_build_object('source', 'confirmed operator rename 2026-09-01')
from renamed;
