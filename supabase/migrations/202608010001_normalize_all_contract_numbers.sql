-- Normalize all lease and sale contract number prefixes and enforce the same
-- structure for future direct inserts.

begin;

create temporary table contract_number_changes (
  entity_type text not null,
  entity_id uuid not null,
  old_contract_no text not null,
  new_contract_no text not null,
  primary key (entity_type, entity_id)
) on commit drop;

insert into contract_number_changes(entity_type, entity_id, old_contract_no, new_contract_no)
select
  'lease_contract',
  lc.id,
  lc.contract_no,
  'WB-LEASE-' || upper(trim(b.code)) || '-' ||
    regexp_replace(upper(trim(u.unit_no)), '\s+', '-', 'g') || '-' ||
    to_char(lc.start_date, 'YYYYMMDD')
from public.lease_contracts lc
join public.units u on u.id = lc.unit_id
join public.buildings b on b.id = u.building_id
where lc.contract_no not like 'WB-LEASE-%';

insert into contract_number_changes(entity_type, entity_id, old_contract_no, new_contract_no)
select
  'sale_contract',
  sc.id,
  sc.contract_no,
  'WB-SALE-' || upper(trim(b.code)) || '-' ||
    regexp_replace(upper(trim(u.unit_no)), '\s+', '-', 'g') || '-' ||
    to_char(sc.signed_date, 'YYYYMMDD')
from public.sale_contracts sc
join public.units u on u.id = sc.unit_id
join public.buildings b on b.id = u.building_id
where sc.contract_no not like 'WB-SALE-%';

do $$
begin
  if exists (
    select entity_type, new_contract_no
    from contract_number_changes
    group by entity_type, new_contract_no
    having count(*) > 1
  ) then
    raise exception 'duplicate normalized contract numbers in change set';
  end if;

  if exists (
    select 1
    from contract_number_changes c
    join public.lease_contracts lc
      on c.entity_type = 'lease_contract'
     and lc.contract_no = c.new_contract_no
     and lc.id <> c.entity_id
  ) or exists (
    select 1
    from contract_number_changes c
    join public.sale_contracts sc
      on c.entity_type = 'sale_contract'
     and sc.contract_no = c.new_contract_no
     and sc.id <> c.entity_id
  ) then
    raise exception 'normalized contract number already exists';
  end if;
end;
$$;

update public.receivables r
set title = replace(r.title, c.old_contract_no, c.new_contract_no)
from contract_number_changes c
where r.source_id = c.entity_id
  and r.source_type = c.entity_type
  and position(c.old_contract_no in r.title) > 0;

update public.lease_contracts lc
set contract_no = c.new_contract_no,
    updated_at = now()
from contract_number_changes c
where c.entity_type = 'lease_contract'
  and lc.id = c.entity_id
  and lc.contract_no = c.old_contract_no;

update public.sale_contracts sc
set contract_no = c.new_contract_no,
    updated_at = now()
from contract_number_changes c
where c.entity_type = 'sale_contract'
  and sc.id = c.entity_id
  and sc.contract_no = c.old_contract_no;

insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
select
  null,
  'normalize_contract_number',
  c.entity_type,
  c.entity_id,
  jsonb_build_object(
    'old_contract_no', c.old_contract_no,
    'new_contract_no', c.new_contract_no,
    'migration', '202608010001_normalize_all_contract_numbers'
  )
from contract_number_changes c;

create or replace function public.enforce_contract_number_prefix()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_building_code text;
  v_unit_no text;
  v_prefix text;
  v_base text;
  v_candidate text;
  v_sequence integer := 1;
begin
  select b.code, u.unit_no
  into v_building_code, v_unit_no
  from public.units u
  join public.buildings b on b.id = u.building_id
  where u.id = new.unit_id;

  if tg_table_name = 'lease_contracts' then
    v_prefix := 'WB-LEASE-';
    v_base := v_prefix || upper(trim(v_building_code)) || '-' ||
      regexp_replace(upper(trim(v_unit_no)), '\s+', '-', 'g') || '-' ||
      to_char(new.start_date, 'YYYYMMDD');
  else
    v_prefix := 'WB-SALE-';
    v_base := v_prefix || upper(trim(v_building_code)) || '-' ||
      regexp_replace(upper(trim(v_unit_no)), '\s+', '-', 'g') || '-' ||
      to_char(new.signed_date, 'YYYYMMDD');
  end if;

  if coalesce(new.contract_no, '') like v_prefix || '%' then
    return new;
  end if;

  v_candidate := v_base;
  loop
    exit when not exists (
      select 1 from public.lease_contracts lc
      where tg_table_name = 'lease_contracts' and lc.contract_no = v_candidate and lc.id <> new.id
    ) and not exists (
      select 1 from public.sale_contracts sc
      where tg_table_name = 'sale_contracts' and sc.contract_no = v_candidate and sc.id <> new.id
    );
    v_sequence := v_sequence + 1;
    v_candidate := v_base || '-' || lpad(v_sequence::text, 2, '0');
  end loop;

  new.contract_no := v_candidate;
  return new;
end;
$$;

drop trigger if exists lease_contract_number_prefix on public.lease_contracts;
create trigger lease_contract_number_prefix
before insert or update of contract_no, unit_id, start_date on public.lease_contracts
for each row execute function public.enforce_contract_number_prefix();

drop trigger if exists sale_contract_number_prefix on public.sale_contracts;
create trigger sale_contract_number_prefix
before insert or update of contract_no, unit_id, signed_date on public.sale_contracts
for each row execute function public.enforce_contract_number_prefix();

commit;
