-- Correct the confirmed CIMAC site-plan assignment:
-- building 2 owns shops 201-232; building 3 owns shops 301-328.
do $$
declare
  b02_id uuid;
  b03_id uuid;
begin
  select id into b02_id from public.buildings where code = 'CIMAC-B02';
  select id into b03_id from public.buildings where code = 'CIMAC-B03';

  if b02_id is null or b03_id is null then
    raise exception 'CIMAC buildings B02/B03 must exist before correcting shop assignments';
  end if;

  update public.units
  set
    building_id = b02_id,
    code = format('CIMAC-B02-%s', unit_no),
    updated_at = now()
  where building_id in (b02_id, b03_id)
    and asset_subtype = 'commercial_shop'
    and unit_no::integer between 201 and 232;

  update public.units
  set
    building_id = b03_id,
    code = format('CIMAC-B03-%s', unit_no),
    updated_at = now()
  where building_id in (b02_id, b03_id)
    and asset_subtype = 'commercial_shop'
    and unit_no::integer between 301 and 328;
end;
$$;
