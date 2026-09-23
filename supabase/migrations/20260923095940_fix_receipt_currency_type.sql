-- Legacy RPC only; no historical data rewrite and no new privileges.
create or replace function public.confirm_receipt_payment(payload jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_room_no text := payload->>'room_no';
  v_receipt_no text := nullif(payload->>'receipt_no', '');
  v_receipt_date date := (payload->>'receipt_date')::date;
  v_amount_xof numeric := (payload->>'amount_xof')::numeric;
  v_currency public.currency_code := coalesce(nullif(payload->>'currency', ''), 'XOF');
  v_period_start date := nullif(payload->>'period_start', '')::date;
  v_period_end date := nullif(payload->>'period_end', '')::date;
  v_business_type text := nullif(payload->>'business_type', '');
  v_payer_name text := nullif(payload->>'payer_name', '');
  v_notes text := nullif(payload->>'notes', '');
  v_image_path text := nullif(payload->>'image_path', '');
  v_ocr_text text := nullif(payload->>'ocr_text', '');
  v_ocr_provider text := coalesce(nullif(payload->>'ocr_provider', ''), 'manual');
  v_override_duplicate boolean := coalesce((payload->>'overrideDuplicate')::boolean, false);
  v_unit_id uuid;
  v_building_id uuid;
  v_source_type text;
  v_matched_receivable_id uuid;
  v_payment_id uuid;
  v_attachment_id uuid;
  v_payment_source_type text;
  v_payment_source_id uuid;
  v_payment_customer_id uuid;
  v_matched_source_type text;
  v_matched_source_id uuid;
  v_matched_customer_id uuid;
  v_matched_amount_xof numeric;
  v_matched_paid_xof numeric;
  v_existing record;
begin
  if auth.uid() is null or coalesce(public.current_user_role() not in ('admin', 'finance'), true) then
    raise exception 'financeWritePermissionDenied' using errcode = '42501';
  end if;
  -- This legacy contract accepts amount_xof only and has no original-currency
  -- amount or exchange rate. Never label XOF values as a foreign currency.
  if v_currency <> 'XOF'::public.currency_code then
    raise exception 'receiptCurrencyMustBeXof' using errcode = '22023';
  end if;
  if v_room_no is null or v_receipt_date is null or coalesce(v_amount_xof, 0) <= 0 then
    raise exception 'invalidReceiptPayload';
  end if;

  select u.id, u.building_id
  into v_unit_id, v_building_id
  from public.units u
  where u.unit_no = v_room_no
    and (
      nullif(payload->>'building_id', '') is null
      or u.building_id = (payload->>'building_id')::uuid
    );
  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found: ' || v_room_no);
  end if;

  v_source_type := case v_business_type
    when 'daily_rental' then 'daily_booking'
    when 'lease_rent' then 'lease_contract'
    when 'managed_lease_rent' then 'lease_contract'
    when 'sale' then 'sale_contract'
    else 'manual'
  end;

  if v_receipt_no is not null then
    select p.id, p.payment_date, p.amount
    into v_existing
    from public.payments p
    join public.units u on u.id = p.unit_id
    where p.receipt_no = v_receipt_no
      and extract(year from p.payment_date) = extract(year from v_receipt_date)
      and u.building_id = v_building_id
    limit 1;
    if found and not v_override_duplicate then
      return jsonb_build_object(
        'success', false,
        'requiresOverride', true,
        'duplicateWarning', format(
          'Duplicate receipt %s (amount %s, date %s)',
          v_receipt_no, v_existing.amount, v_existing.payment_date
        )
      );
    end if;
  end if;

  if v_source_type <> 'manual' then
    if v_period_start is not null and v_period_end is not null then
      select id, source_id, source_type, customer_id, amount_xof, paid_amount_xof
      into v_matched_receivable_id, v_matched_source_id, v_matched_source_type,
           v_matched_customer_id, v_matched_amount_xof, v_matched_paid_xof
      from public.receivables
      where unit_id = v_unit_id
        and source_type = v_source_type
        and status not in ('paid', 'cancelled')
        and due_date between v_period_start and v_period_end
      order by due_date, created_at
      limit 1
      for update;
    end if;

    if v_matched_receivable_id is null then
      select id, source_id, source_type, customer_id, amount_xof, paid_amount_xof
      into v_matched_receivable_id, v_matched_source_id, v_matched_source_type,
           v_matched_customer_id, v_matched_amount_xof, v_matched_paid_xof
      from public.receivables
      where unit_id = v_unit_id
        and source_type = v_source_type
        and status not in ('paid', 'cancelled')
      order by abs((amount_xof - paid_amount_xof) - v_amount_xof), due_date
      limit 1
      for update;
      if v_matched_receivable_id is not null
        and abs((v_matched_amount_xof - v_matched_paid_xof) - v_amount_xof) > v_amount_xof * 0.5
      then
        v_matched_receivable_id := null;
      end if;
    end if;
  end if;

  if v_matched_receivable_id is not null then
    v_payment_source_type := v_matched_source_type;
    v_payment_source_id := v_matched_source_id;
    v_payment_customer_id := v_matched_customer_id;
    update public.receivables
    set paid_amount_xof = paid_amount_xof + v_amount_xof,
        status = case
          when paid_amount_xof + v_amount_xof >= amount_xof then 'paid'
          else 'partial'
        end,
        updated_at = now()
    where id = v_matched_receivable_id;
  else
    v_payment_source_type := v_source_type;
  end if;

  insert into public.payments (
    unit_id, customer_id, source_type, source_id, payment_date,
    amount, currency, exchange_rate_to_xof, receipt_no, notes
  )
  values (
    v_unit_id, v_payment_customer_id, v_payment_source_type, v_payment_source_id,
    v_receipt_date, v_amount_xof, v_currency, 1, v_receipt_no, v_notes
  )
  returning id into v_payment_id;

  insert into public.ledger_entries (
    building_id, unit_id, payment_id, entry_date, direction,
    category, amount_xof, description
  )
  values (
    v_building_id, v_unit_id, v_payment_id, v_receipt_date, 'income',
    coalesce(v_business_type, 'manual'), v_amount_xof,
    trim('Receipt scan: ' || coalesce(v_receipt_no, 'no receipt no') ||
      ' | ' || coalesce(v_payer_name, ''))
  );

  if v_image_path is not null then
    insert into public.attachments (
      storage_path, bucket, file_type, linked_type, linked_id, unit_id,
      customer_id, uploaded_by, ocr_text, ocr_provider, metadata
    )
    values (
      v_image_path, 'receipts', 'receipt_image', 'payment', v_payment_id,
      v_unit_id, v_payment_customer_id, auth.uid(), v_ocr_text, v_ocr_provider,
      jsonb_build_object(
        'receipt_no', v_receipt_no,
        'period_start', v_period_start,
        'period_end', v_period_end,
        'business_type', v_business_type,
        'receipt_date', v_receipt_date,
        'amount_xof', v_amount_xof
      )
    )
    returning id into v_attachment_id;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'receipt_scan_confirm', 'payment', v_payment_id,
    jsonb_build_object(
      'room_no', v_room_no,
      'unit_id', v_unit_id,
      'amount_xof', v_amount_xof,
      'receipt_no', v_receipt_no,
      'receipt_date', v_receipt_date,
      'business_type', v_business_type,
      'attachment_id', v_attachment_id,
      'matched_receivable_id', v_matched_receivable_id,
      'unmatched_receivable', v_matched_receivable_id is null
    )
  );

  return jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'attachmentId', v_attachment_id,
    'matchedReceivableId', v_matched_receivable_id,
    'unmatchedReceivable', v_matched_receivable_id is null,
    'duplicateOverridden', v_override_duplicate
  );
end;
$$;

revoke all on function public.confirm_receipt_payment(jsonb) from public, anon;
grant execute on function public.confirm_receipt_payment(jsonb) to authenticated, service_role;
