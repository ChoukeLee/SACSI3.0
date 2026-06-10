-- One-time fix: correct room 103 receipt 0016411
-- Identifies the payment precisely by receipt_no + unit 103, then fixes
-- amount, date, ledger entries, attachment metadata, and receivable paid_amount.

do $$
declare
  v_unit_id uuid;
  v_payment_id uuid;
  v_old_amount integer;
  v_old_date date;
  v_correct_amount integer := 1950000;
  v_correct_date date := '2026-06-08';
  v_period_start date := '2026-05-07';
  v_period_end date := '2026-08-06';
  v_ledger_id uuid;
  v_att_id uuid;
  v_rec_id uuid;
  v_rec_paid_before integer;
  v_amount_diff integer;
  r record;
begin
  -- Get unit 103
  select id into v_unit_id from units where unit_no = '103';
  if v_unit_id is null then
    raise notice 'Room 103 not found — skipping fix.';
    return;
  end if;

  -- Find payment: receipt_no + unit 103 + within 2026
  select id, amount, payment_date
  into v_payment_id, v_old_amount, v_old_date
  from payments
  where receipt_no = '0016411'
    and unit_id = v_unit_id
    and payment_date >= '2026-01-01'
    and payment_date <= '2026-12-31'
  order by payment_date desc
  limit 1;

  if v_payment_id is null then
    raise notice 'No payment 0016411 found for room 103 — skipping fix.';
    return;
  end if;

  raise notice 'Found payment % with amount % date %', v_payment_id, v_old_amount, v_old_date;

  -- Fix payment
  update payments set
    amount = v_correct_amount,
    payment_date = v_correct_date,
    source_type = 'lease_contract',
    notes = coalesce(notes || ' ', '') || '[CORRECTED: amount ' || v_old_amount || '→' || v_correct_amount || ', date ' || v_old_date || '→' || v_correct_date || ']'
  where id = v_payment_id;
  raise notice 'Payment fixed.';

  -- Fix ledger entries linked to this payment
  for r in select id, amount_xof from ledger_entries where payment_id = v_payment_id loop
    update ledger_entries set
      amount_xof = v_correct_amount,
      entry_date = v_correct_date,
      description = 'Receipt scan: 0016411 | ' || v_period_start || '→' || v_period_end || ' [CORRECTED]'
    where id = r.id;
    raise notice 'Ledger % fixed: amount %→%', r.id, r.amount_xof, v_correct_amount;
  end loop;

  -- Fix attachments metadata (merge, don't replace)
  for r in select id from attachments where linked_type = 'payment' and linked_id = v_payment_id loop
    update attachments set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'receipt_no', '0016411',
      'receipt_date', v_correct_date,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'amount_xof', v_correct_amount,
      'business_type', 'lease_rent'
    ) where id = r.id;
    raise notice 'Attachment % metadata fixed.', r.id;
  end loop;

  -- Fix receivable: match by unit_id + source_type + period range first.
  -- Only auto-fix if exactly ONE receivable matches — never guess among multiple.
  v_amount_diff := v_correct_amount - v_old_amount;
  if v_amount_diff != 0 then
    -- Primary match: unit 103 + lease_contract + period 2026-05-07 to 2026-08-06
    -- Check count first: if >1, skip with manual review notice
    if (select count(*) from receivables
        where unit_id = v_unit_id
          and source_type = 'lease_contract'
          and status not in ('paid', 'cancelled')
          and due_date >= v_period_start
          and due_date <= v_period_end) = 1 then

      select id, paid_amount_xof
      into v_rec_id, v_rec_paid_before
      from receivables
      where unit_id = v_unit_id
        and source_type = 'lease_contract'
        and status not in ('paid', 'cancelled')
        and due_date >= v_period_start
        and due_date <= v_period_end;

    elsif (select count(*) from receivables
           where unit_id = v_unit_id
             and source_type = 'lease_contract'
             and status not in ('paid', 'cancelled')
             and due_date >= v_period_start
             and due_date <= v_period_end) > 1 then

      raise notice 'Multiple receivables match the period — manual review needed. Skipping receivable auto-fix.';
      v_rec_id := null;
    end if;

    -- Fallback: match by unit + type, closest amount (if no period match and still null)
    if v_rec_id is null and v_amount_diff != 0 then
      select id, paid_amount_xof
      into v_rec_id, v_rec_paid_before
      from receivables
      where unit_id = v_unit_id
        and source_type = 'lease_contract'
        and status not in ('paid', 'cancelled')
      order by abs(amount_xof - v_correct_amount)
      limit 1;
    end if;

    if v_rec_id is not null then
      update receivables set
        paid_amount_xof = paid_amount_xof + v_amount_diff,
        status = case when paid_amount_xof + v_amount_diff >= amount_xof then 'paid'
                      when paid_amount_xof + v_amount_diff > 0 then 'partial'
                      else status end
      where id = v_rec_id;
      raise notice 'Receivable % paid adjusted by % (was %)', v_rec_id, v_amount_diff, v_rec_paid_before;
    else
      raise notice 'No unique matching receivable found for amount correction — manual review needed.';
    end if;
  end if;

  -- Audit log
  insert into audit_logs (action, entity_type, entity_id, metadata)
  values ('receipt_corrected', 'payment', v_payment_id,
    jsonb_build_object(
      'reason', '修正103收据0016411金额和周期识别错误',
      'room_no', '103',
      'unit_id', v_unit_id,
      'correct_amount', v_correct_amount,
      'correct_date', v_correct_date,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'old_amount', v_old_amount,
      'old_date', v_old_date,
      'corrected_at', now()
    ));

  raise notice 'Fix complete for receipt 0016411.';
end $$;
