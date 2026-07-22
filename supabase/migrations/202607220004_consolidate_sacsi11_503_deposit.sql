-- Complete the paid first period for SACSI11 room 503.
-- Source: 11号公寓.xlsx records 2026-06-03 押2租1买家具1共260万，
-- covering 2026-06-03 through 2026-07-02. The subsequent renewal remains
-- unpaid and is already represented by the overdue receivable.

do $$
declare
  v_unit_id uuid;
  v_building_id uuid;
  v_customer_id uuid;
  v_contract_id uuid;
  v_payment_id uuid;
begin
  select u.id, u.building_id, lc.id, lc.customer_id
    into v_unit_id, v_building_id, v_contract_id, v_customer_id
  from public.units u
  join public.buildings b on b.id = u.building_id
  join public.lease_contracts lc on lc.unit_id = u.id and lc.status = 'active'
  where b.code = 'SACSI11' and u.unit_no = '503';

  if v_contract_id is null then
    raise exception 'SACSI11-503 active lease not found';
  end if;

  update public.lease_contracts
  set deposit_amount_xof = 1400000,
      deposit_received = true,
      paid_through_date = date '2026-07-02',
      updated_at = now()
  where id = v_contract_id;

  if not exists (select 1 from public.payments where receipt_no = 'WB11-L-503-20260603-DEP') then
    insert into public.payments (
      customer_id, unit_id, source_type, source_id, payment_date, amount,
      currency, exchange_rate_to_xof, receipt_no, notes
    ) values (
      v_customer_id, v_unit_id, 'lease_deposit', v_contract_id, date '2026-06-03', 1400000,
      'XOF', 1, 'WB11-L-503-20260603-DEP',
      'import_ref=WB11-L-503-20260603-DEP；来源：11号公寓.xlsx；押金2个月140万；原总付260万另含租金70万及家具50万'
    ) returning id into v_payment_id;

    insert into public.ledger_entries (
      building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
    ) values (
      v_building_id, v_unit_id, v_payment_id, date '2026-06-03',
      'liability_in', 'lease_deposit', 1400000, '长租押金 房间503；押金2个月140万'
    );
  end if;

  if not exists (select 1 from public.payments where receipt_no = 'WB11-L-503-20260603-RENT') then
    insert into public.payments (
      customer_id, unit_id, source_type, source_id, payment_date, amount,
      currency, exchange_rate_to_xof, receipt_no, notes
    ) values (
      v_customer_id, v_unit_id, 'lease_contract', v_contract_id, date '2026-06-03', 700000,
      'XOF', 1, 'WB11-L-503-20260603-RENT',
      'import_ref=WB11-L-503-20260603-RENT；来源：11号公寓.xlsx；租1个月70万；已缴至2026-07-02；家具50万未计入长租流水'
    ) returning id into v_payment_id;

    insert into public.ledger_entries (
      building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description
    ) values (
      v_building_id, v_unit_id, v_payment_id, date '2026-06-03',
      'income', 'lease_rent', 700000, '长租租金 房间503；2026-06-03至2026-07-02'
    );
  end if;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'consolidate_sacsi11_503_deposit', 'lease_contract', v_contract_id,
    jsonb_build_object(
      'unit_no', '503', 'source', '11号公寓.xlsx',
      'deposit_xof', 1400000, 'rent_xof', 700000,
      'furniture_xof_excluded', 500000,
      'paid_through_date', '2026-07-02'
    )
  );
end $$;
