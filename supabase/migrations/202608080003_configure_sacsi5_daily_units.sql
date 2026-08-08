-- Configure the seven confirmed SACSI5 daily-rental apartments.

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.units u
  join public.buildings b on b.id = u.building_id
  where b.code = 'SACSI5'
    and u.unit_no in ('1101', '1103', '1302', '1303', '1401', '804', '805');

  if v_count <> 7 then
    raise exception 'Expected 7 SACSI5 daily-rental units, found %', v_count;
  end if;
end;
$$;

update public.units u
set layout = case
  when u.unit_no in ('804', '805') then '两室'
  else '三室'
end
from public.buildings b
where b.id = u.building_id
  and b.code = 'SACSI5'
  and u.unit_no in ('1101', '1103', '1302', '1303', '1401', '804', '805');

insert into public.unit_business_flags(unit_id, business_type, is_enabled, default_price_xof)
select
  u.id,
  'daily_rental'::public.business_type,
  true,
  case when u.unit_no in ('804', '805') then 80000 else 100000 end
from public.units u
join public.buildings b on b.id = u.building_id
where b.code = 'SACSI5'
  and u.unit_no in ('1101', '1103', '1302', '1303', '1401', '804', '805')
on conflict (unit_id, business_type) do update
set is_enabled = excluded.is_enabled,
    default_price_xof = excluded.default_price_xof;

insert into public.audit_logs(action, entity_type, entity_id, after_data, metadata)
select
  'enable_daily_rental',
  'unit',
  u.id,
  jsonb_build_object(
    'building_code', b.code,
    'unit_no', u.unit_no,
    'layout', u.layout,
    'default_price_xof', f.default_price_xof
  ),
  jsonb_build_object('source', 'confirmed SACSI5 daily-rental rollout 2026-08-08')
from public.units u
join public.buildings b on b.id = u.building_id
join public.unit_business_flags f on f.unit_id = u.id
  and f.business_type = 'daily_rental'
where b.code = 'SACSI5'
  and u.unit_no in ('1101', '1103', '1302', '1303', '1401', '804', '805');
