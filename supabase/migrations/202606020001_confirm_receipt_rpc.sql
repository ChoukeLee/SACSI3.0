-- confirm_receipt_payment RPC
-- Single PostgreSQL function that handles the full receipt confirmation
-- inside a transaction. All writes succeed or all fail.
-- Called from /api/receipt/confirm/route.ts via supabase.rpc()

create or replace function confirm_receipt_payment(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_room_no text := payload->>'room_no';
  v_receipt_no text := nullif(payload->>'receipt_no', '');
  v_receipt_date date := (payload->>'receipt_date')::date;
  v_amount_xof integer := (payload->>'amount_xof')::integer;
  v_currency text := coalesce(nullif(payload->>'currency', ''), 'XOF');
  v_period_start text := nullif(payload->>'period_start', '');
  v_period_end text := nullif(payload->>'period_end', '');
  v_business_type text := nullif(payload->>'business_type', '');
  v_payer_name text := nullif(payload->>'payer_name', '');
  v_notes text := nullif(payload->>'notes', '');
  v_image_path text := nullif(payload->>'image_path', '');
  v_ocr_text text := nullif(payload->>'ocr_text', '');
  v_ocr_provider text := coalesce(nullif(payload->>'ocr_provider', ''), 'manual');
  v_override_duplicate boolean := coalesce((payload->>'overrideDuplicate')::boolean, false);
  v_actor_id uuid := (payload->>'actor_id')::uuid;
  v_actor_email text := payload->>'actor_email';
  v_actor_role text := payload->>'actor_role';
  v_actor_display_name text := payload->>'actor_display_name';
  v_receipt_year text := left(v_receipt_date::text, 4);

  v_unit_id uuid;
  v_building_id uuid;
  v_source_type text;
  v_matched_receivable_id uuid;
  v_unmatched_receivable boolean := false;
  v_payment_id uuid;
  v_attachment_id uuid;
  v_payment_source_type text;
  v_payment_source_id uuid;
  v_payment_customer_id uuid;

  v_matched_source_type text;
  v_matched_source_id uuid;
  v_matched_customer_id uuid;
  v_matched_amount_xof integer;
  v_matched_paid_xof integer;
  v_existing record;
  v_building_unit_ids uuid[];
  r record;
begin
  -- A. Find the room
  select id, building_id into v_unit_id, v_building_id
  from units where unit_no = v_room_no;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found: ' || v_room_no);
  end if;

  -- Derive source_type
  v_source_type := case v_business_type
    when 'daily_rental' then 'daily_booking'
    when 'lease_rent' then 'lease_contract'
    when 'managed_lease_rent' then 'lease_contract'
    when 'sale' then 'sale_contract'
    else 'manual'
  end;

  -- B. Duplicate check (receipt_no + year + building_id)
  if v_receipt_no is not null then
    select array_agg(id) into v_building_unit_ids
    from units where building_id = v_building_id;

    select id, payment_date, amount into v_existing
    from payments
    where receipt_no = v_receipt_no
      and payment_date >= (v_receipt_year || '-01-01')::date
      and payment_date <= (v_receipt_year || '-12-31')::date
      and unit_id = any(v_building_unit_ids)
    limit 1;

    if found and not v_override_duplicate then
      return jsonb_build_object(
        'success', false,
        'requiresOverride', true,
        'duplicateWarning', format('Duplicate receipt %s in %s (amount %s, date %s)',
          v_receipt_no, v_receipt_year, v_existing.amount, v_existing.payment_date)
      );
    end if;
  end if;

  -- D. Match receivable (explicit scalars — no record-field access)
  v_matched_receivable_id := null;
  if v_source_type != 'manual' then
    -- Period match first
    if v_period_start is not null and v_period_end is not null then
      select id, source_id, source_type, customer_id, amount_xof, paid_amount_xof
      into v_matched_receivable_id, v_matched_source_id, v_matched_source_type, v_matched_customer_id, v_matched_amount_xof, v_matched_paid_xof
      from receivables
      where unit_id = v_unit_id
        and source_type = v_source_type
        and status not in ('paid', 'cancelled')
        and due_date >= v_period_start::date
        and due_date <= v_period_end::date
      limit 1;
    end if;

    -- Amount match fallback
    if v_matched_receivable_id is null then
      select id, source_id, source_type, customer_id, amount_xof, paid_amount_xof
      into v_matched_receivable_id, v_matched_source_id, v_matched_source_type, v_matched_customer_id, v_matched_amount_xof, v_matched_paid_xof
      from receivables
      where unit_id = v_unit_id
        and source_type = v_source_type
        and status not in ('paid', 'cancelled')
      order by abs((amount_xof - paid_amount_xof) - v_amount_xof)
      limit 1;

      if v_matched_receivable_id is not null then
        if abs((v_matched_amount_xof - v_matched_paid_xof) - v_amount_xof) > v_amount_xof * 0.5 then
          v_matched_receivable_id := null;
        end if;
      end if;
    end if;

    if v_matched_receivable_id is not null then
      v_payment_source_type := v_matched_source_type;
      v_payment_source_id := v_matched_source_id;
      v_payment_customer_id := v_matched_customer_id;

      update receivables
      set paid_amount_xof = paid_amount_xof + v_amount_xof,
          status = case
            when paid_amount_xof + v_amount_xof >= amount_xof then 'paid'
            when paid_amount_xof + v_amount_xof > 0 then 'partial'
            else status
          end
      where id = v_matched_receivable_id;
    else
      v_unmatched_receivable := true;
    end if;
  else
    v_unmatched_receivable := true;
  end if;

  if v_payment_source_type is null then v_payment_source_type := v_source_type; end if;

  -- E. Insert payment
  insert into payments (unit_id, customer_id, source_type, source_id, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes)
  values (v_unit_id, v_payment_customer_id, v_payment_source_type, v_payment_source_id, v_receipt_date, v_amount_xof, v_currency, 1, v_receipt_no, v_notes)
  returning id into v_payment_id;

  -- F. Insert ledger entry
  insert into ledger_entries (building_id, unit_id, payment_id, entry_date, direction, category, amount_xof, description)
  values (v_building_id, v_unit_id, v_payment_id, v_receipt_date, 'income', coalesce(v_business_type, 'manual'), v_amount_xof,
    trim('Receipt scan: ' || coalesce(v_receipt_no, 'no receipt no') || ' | ' ||
         coalesce(v_payer_name, '') || ' ' ||
         case when v_period_start is not null then '| ' || v_period_start || '→' || coalesce(v_period_end, '?') else '' end));

  -- G. Insert attachment
  if v_image_path is not null then
    insert into attachments (storage_path, bucket, file_type, linked_type, linked_id, unit_id, customer_id, uploaded_by, ocr_text, ocr_provider, paper_archive_status, metadata)
    values (v_image_path, 'receipts', 'receipt_image', 'payment', v_payment_id, v_unit_id, v_payment_customer_id,
      v_actor_id, v_ocr_text, v_ocr_provider, 'pending',
      jsonb_build_object(
        'receipt_no', v_receipt_no,
        'period_start', v_period_start,
        'period_end', v_period_end,
        'business_type', v_business_type,
        'receipt_date', v_receipt_date,
        'amount_xof', v_amount_xof
      ))
    returning id into v_attachment_id;
  end if;

  -- H. Insert audit log
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor_id, 'receipt_scan_confirm', 'payment', v_payment_id,
    jsonb_build_object(
      'actor_email', v_actor_email,
      'actor_role', v_actor_role,
      'actor_display_name', v_actor_display_name,
      'entity_label', trim('Room ' || v_room_no || ' receipt ' || coalesce(v_receipt_no, '')),
      'room_no', v_room_no,
      'unit_id', v_unit_id,
      'amount_xof', v_amount_xof,
      'receipt_no', v_receipt_no,
      'receipt_date', v_receipt_date,
      'currency', v_currency,
      'business_type', v_business_type,
      'payer_name', v_payer_name,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'image_path', v_image_path,
      'attachment_id', v_attachment_id,
      'ocr_provider', v_ocr_provider,
      'duplicate_override', v_override_duplicate,
      'matched_receivable_id', v_matched_receivable_id,
      'unmatched_receivable', v_unmatched_receivable
    ));

  -- I. Return success
  return jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'attachmentId', v_attachment_id,
    'matchedReceivableId', v_matched_receivable_id,
    'unmatchedReceivable', v_unmatched_receivable,
    'duplicateOverridden', v_override_duplicate,
    'message', case
      when v_unmatched_receivable then 'Payment recorded but no matching receivable found.'
      else 'Receipt confirmed.'
    end
  );
end;
$$;
