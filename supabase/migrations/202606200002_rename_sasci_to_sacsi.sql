-- Rename building codes from SASCI* to SACSI* to match brand
-- This migration assumes only SASCI11 is populated; extend for 3/4/5/6/7 when they exist

-- 1. Update building code
UPDATE buildings SET code = 'SACSI11' WHERE code = 'SASCI11';

-- 2. Update unit codes (the building prefix is stored in the 'code' field, not 'unit_no')
UPDATE units
SET code = 'SACSI-' || substring(code from position('-' in code) + 1)
WHERE code LIKE 'SASCI11-%';

-- 3. Update any hardcoded references in system_settings (if any)
UPDATE system_settings
SET value = 'SACSI11'
WHERE key = 'default_building_code' AND value = 'SASCI11';

-- 4. Update business_targets building references (if any)
UPDATE business_targets
SET building_id = (SELECT id FROM buildings WHERE code = 'SACSI11')
WHERE building_id IN (SELECT id FROM buildings WHERE code = 'SASCI11');

-- Note: Old migration files retain original SASCI spelling as historical records.
-- This migration handles ONLY live data.
