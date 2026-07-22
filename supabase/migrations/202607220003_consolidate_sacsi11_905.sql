-- Reclassify SACSI11 room 905 from an incorrect legacy daily stay to the
-- active long lease recorded in 11号公寓.xlsx. The user confirmed that the
-- old daily record was a handover error and should be deleted.
-- Source record:
--   85万/月；2025-11-14 押2租2中1；租期自 2025-11-15；
--   2026-02-06 付255万止04-14；2026-05-12 付255万止07-14。

do $$
declare
  v_unit_id uuid;
  v_building_id uuid;
  v_customer_id uuid;
  v_contract_id uuid;
  v_payment_id uuid;
  v_deleted_daily jsonb := '[]'::jsonb;
begin
  select u.id, u.building_id
    into v_unit_id, v_building_id
  from public.units u
  join public.buildings b on b.id = u.building_id
  where b.code = 'SACSI11' and u.unit_no = '905';

  if v_unit_id is null then
    raise exception 'SACSI11-905 unit not found';
  end if;

  select id into v_customer_id
  from public.customers
  where name = '法国公司人'
  order by created_at
  limit 1;

  if v_customer_id is null then
    insert into public.customers (name, notes)
    values ('法国公司人', '来源：11号公寓.xlsx；905长租客户名称按原表登记。')
    returning id into v_customer_id;
  end if;

  -- Capture the bad row in the audit event, then remove the daily-rental
  -- record and any records whose only source was that mistaken booking.
  select coalesce(jsonb_agg(to_jsonb(db)), '[]'::jsonb)
    into v_deleted_daily
  from public.daily_bookings db
  where db.unit_id = v_unit_id;

  delete from public.ledger_entries le
  where le.payment_id in (
    select p.id from public.payments p
    where p.source_type = 'daily_booking'
      and p.source_id in (select db.id from public.daily_bookings db where db.unit_id = v_unit_id)
  );

  delete from public.payments p
  where p.source_type = 'daily_booking'
    and p.source_id in (select db.id from public.daily_bookings db where db.unit_id = v_unit_id);

  delete from public.receivables r
  where r.source_type = 'daily_booking'
    and r.source_id in (select db.id from public.daily_bookings db where db.unit_id = v_unit_id);

  delete from public.cleaning_tasks ct
  where ct.daily_booking_id in (select db.id from public.daily_bookings db where db.unit_id = v_unit_id);

  delete from public.daily_bookings where unit_id = v_unit_id;

  select id into v_contract_id
  from public.lease_contracts
  where unit_id = v_unit_id and status = 'active'
  order by created_at
  limit 1;

  if v_contract_id is null then
    insert into public.lease_contracts (
      unit_id, customer_id, contract_no, start_date, expected_end_date,
      expected_end_confirmed, paid_through_date, payment_cycle, payment_day,
      monthly_rent_xof, deposit_amount_xof, deposit_received, signer_name, status
    ) values (
      v_unit_id, v_customer_id, 'SACSI11-LEASE-905-20251115', date '2025-11-15', date '2026-07-14',
      false, date '2026-07-14', 'quarterly', 15,
      850000, 1700000, true, null, 'active'
    ) returning id into v_contract_id;
  else
    update public.lease_contracts
    set customer_id = v_customer_id,
        start_date = date '2025-11-15',
        expected_end_date = date '2026-07-14',
        expected_end_confirmed = false,
        paid_through_date = date '2026-07-14',
        payment_cycle = 'quarterly',
        payment_day = 15,
        monthly_rent_xof = 850000,
        deposit_amount_xof = 1700000,
        deposit_received = true,
        status = 'active',
        updated_at = now()
    where id = v_contract_id;
  end if;

  update public.units set status = 'leased', updated_at = now() where id = v_unit_id;

  insert into public.unit_business_flags (unit_id, business_type, is_enabled, default_price_xof)
  values (v_unit_id, 'long_lease', true, 850000)
  on conflict (unit_id, business_type) do update
    set is_enabled = excluded.is_enabled, default_price_xof = excluded.default_price_xof;

  insert into public.unit_business_flags (unit_id, business_type, is_enabled, default_price_xof)
  values (v_unit_id, 'daily_rental', false, 40000)
  on conflict (unit_id, business_type) do update set is_enabled = false;

  if not exists (select 1 from public.payments where receipt_no = 'WB11-L-905-20251114-DEP') then
    insert into public.payments (
      customer_id, unit_id, source_type, source_id, payment_date, amount,
      currency, exchange_rate_to_xof, receipt_no, notes
    ) values (
      v_customer_id, v_unit_id, 'lease_deposit', v_contract_id, date '2025-11-14', 1700000,
      'XOF', 1, 'WB11-L-905-20251114-DEP',
      'import_ref=WB11-L-905-20251114-DEP；来源：11号公寓.xlsx；押金2个月170万'
    ) returning id into v_payment_id;

    insert into public.ledger_entries (
      building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
    ) values (
      v_building_id, v_unit_id, v_payment_id, date '2025-11-14',
      'liability_in', 'lease_deposit', 1700000, '长租押金 房间905；押金2个月170万'
    );
  end if;

  if not exists (select 1 from public.payments where receipt_no = 'WB11-L-905-20251114-RENT') then
    insert into public.payments (
      customer_id, unit_id, source_type, source_id, payment_date, amount,
      currency, exchange_rate_to_xof, receipt_no, notes
    ) values (
      v_customer_id, v_unit_id, 'lease_contract', v_contract_id, date '2025-11-14', 1700000,
      'XOF', 1, 'WB11-L-905-20251114-RENT',
      'import_ref=WB11-L-905-20251114-RENT；来源：11号公寓.xlsx；租2个月；已缴至2026-01-14'
    ) returning id into v_payment_id;

    insert into public.ledger_entries (
      building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
    ) values (
      v_building_id, v_unit_id, v_payment_id, date '2025-11-14',
      'income', 'lease_rent', 1700000, '长租租金 房间905；2025-11-15至2026-01-14'
    );
  end if;

  if not exists (select 1 from public.payments where receipt_no = 'WB11-L-905-20260206-RENT') then
    insert into public.payments (
      customer_id, unit_id, source_type, source_id, payment_date, amount,
      currency, exchange_rate_to_xof, receipt_no, notes
    ) values (
      v_customer_id, v_unit_id, 'lease_contract', v_contract_id, date '2026-02-06', 2550000,
      'XOF', 1, 'WB11-L-905-20260206-RENT',
      'import_ref=WB11-L-905-20260206-RENT；来源：11号公寓.xlsx；租3个月；已缴至2026-04-14'
    ) returning id into v_payment_id;

    insert into public.ledger_entries (
      building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
    ) values (
      v_building_id, v_unit_id, v_payment_id, date '2026-02-06',
      'income', 'lease_rent', 2550000, '长租租金 房间905；2026-01-15至2026-04-14'
    );
  end if;

  if not exists (select 1 from public.payments where receipt_no = 'WB11-L-905-20260512-RENT') then
    insert into public.payments (
      customer_id, unit_id, source_type, source_id, payment_date, amount,
      currency, exchange_rate_to_xof, receipt_no, notes
    ) values (
      v_customer_id, v_unit_id, 'lease_contract', v_contract_id, date '2026-05-12', 2550000,
      'XOF', 1, 'WB11-L-905-20260512-RENT',
      'import_ref=WB11-L-905-20260512-RENT；来源：11号公寓.xlsx；租3个月；已缴至2026-07-14'
    ) returning id into v_payment_id;

    insert into public.ledger_entries (
      building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
    ) values (
      v_building_id, v_unit_id, v_payment_id, date '2026-05-12',
      'income', 'lease_rent', 2550000, '长租租金 房间905；2026-04-15至2026-07-14'
    );
  end if;

  if not exists (
    select 1 from public.receivables
    where source_type = 'lease_contract' and source_id = v_contract_id
      and category = 'lease_rent' and due_date = date '2026-07-15'
  ) then
    insert into public.receivables (
      building_id, unit_id, customer_id, source_type, source_id, category,
      title, due_date, amount_xof, paid_amount_xof, status, currency, notes
    ) values (
      v_building_id, v_unit_id, v_customer_id, 'lease_contract', v_contract_id, 'lease_rent',
      '905长租租金 2026-07-15至2026-08-14', date '2026-07-15',
      850000, 0, 'overdue', 'XOF', '按Excel已缴至2026-07-14；截至2026-07-22下一期未缴。'
    );
  end if;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'consolidate_sacsi11_905', 'lease_contract', v_contract_id,
    jsonb_build_object(
      'unit_no', '905', 'source', '11号公寓.xlsx',
      'monthly_rent_xof', 850000, 'deposit_xof', 1700000,
      'paid_through_date', '2026-07-14',
      'daily_record_action', 'deleted_as_handover_error',
      'deleted_daily_records', v_deleted_daily
    )
  );
end $$;
