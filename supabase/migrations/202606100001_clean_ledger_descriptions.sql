-- Clean ledger_entries.description: replace booking UUIDs with room numbers.
-- Does NOT modify amounts, dates, directions, or payment relationships.

do $$
declare
  r record;
  v_unit_no text;
  v_new_desc text;
  v_count integer := 0;
begin
  raise notice '=== Cleaning ledger descriptions ===';

  -- 1. Fix "日租预付 booking=<uuid>" → query unit_no
  for r in
    select le.id, le.description, p.unit_id
    from ledger_entries le
    join payments p on p.id = le.payment_id
    where le.description ~ '日租预付 booking='
  loop
    select unit_no into v_unit_no from units where id = r.unit_id;
    v_new_desc := '日租预付 房间' || coalesce(v_unit_no, '?');
    update ledger_entries set description = v_new_desc where id = r.id;
    v_count := v_count + 1;
  end loop;
  raise notice 'Fixed 日租预付: % rows', v_count;

  -- 2. Fix "日租补缴 booking=<uuid>"
  v_count := 0;
  for r in
    select le.id, le.description, p.unit_id
    from ledger_entries le
    join payments p on p.id = le.payment_id
    where le.description ~ '日租补缴 booking='
  loop
    select unit_no into v_unit_no from units where id = r.unit_id;
    v_new_desc := '日租补缴 房间' || coalesce(v_unit_no, '?');
    update ledger_entries set description = v_new_desc where id = r.id;
    v_count := v_count + 1;
  end loop;
  raise notice 'Fixed 日租补缴: % rows', v_count;

  -- 3. Fix "日租历史补录 booking=<uuid>"
  v_count := 0;
  for r in
    select le.id, le.description, p.unit_id
    from ledger_entries le
    join payments p on p.id = le.payment_id
    where le.description ~ '日租历史补录 booking='
  loop
    select unit_no into v_unit_no from units where id = r.unit_id;
    v_new_desc := '日租历史补录 房间' || coalesce(v_unit_no, '?');
    update ledger_entries set description = v_new_desc where id = r.id;
    v_count := v_count + 1;
  end loop;
  raise notice 'Fixed 日租历史补录: % rows', v_count;

  -- 4. Fix English "Room XXX managed lease rent received, YYYY-MM-DD to YYYY-MM-DD"
  v_count := 0;
  for r in
    select le.id, le.description, p.unit_id
    from ledger_entries le
    join payments p on p.id = le.payment_id
    where le.description ~ 'managed lease rent received'
  loop
    select unit_no into v_unit_no from units where id = r.unit_id;
    v_new_desc := regexp_replace(r.description,
      'Room \d+ managed lease rent received, (.*) to (.*)',
      coalesce(v_unit_no, '?') || '房 代管长租租金 \1 至 \2');
    update ledger_entries set description = v_new_desc where id = r.id;
    v_count := v_count + 1;
  end loop;
  raise notice 'Fixed managed lease rent: % rows', v_count;

  -- 5. Fix English "Room XXX managed lease deposit received (N months)"
  v_count := 0;
  for r in
    select le.id, le.description, p.unit_id
    from ledger_entries le
    join payments p on p.id = le.payment_id
    where le.description ~ 'managed lease deposit received'
  loop
    select unit_no into v_unit_no from units where id = r.unit_id;
    v_new_desc := regexp_replace(r.description,
      'Room \d+ managed lease deposit received \((.*)\)',
      coalesce(v_unit_no, '?') || '房 代管长租押金 \1');
    update ledger_entries set description = v_new_desc where id = r.id;
    v_count := v_count + 1;
  end loop;
  raise notice 'Fixed managed lease deposit: % rows', v_count;

  -- 6. Strip any remaining bare booking= UUID fragments (defense-in-depth)
  v_count := 0;
  for r in
    select le.id, le.description
    from ledger_entries le
    where le.description ~ 'booking=[0-9a-f]{8}-'
  loop
    v_new_desc := regexp_replace(r.description, '\s*booking=[0-9a-f-]{36}', '', 'g');
    update ledger_entries set description = v_new_desc where id = r.id;
    v_count := v_count + 1;
  end loop;
  raise notice 'Stripped remaining booking= UUIDs: % rows', v_count;

  raise notice '=== Ledger description cleanup complete ===';
end $$;
