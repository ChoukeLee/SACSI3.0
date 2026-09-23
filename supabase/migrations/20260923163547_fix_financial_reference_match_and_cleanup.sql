begin;

create or replace function private.assign_lease_payment_reference()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prefix text;
  v_sequence integer;
begin
  v_prefix := private.lease_payment_reference_prefix(new.unit_id, new.source_type, new.payment_date);
  if v_prefix is null then return new; end if;

  -- Prefixes contain normalized alphanumeric tokens and hyphens only. Hyphens
  -- are literal outside a regex character class, so no escaping is required.
  if new.receipt_no is not null
     and new.receipt_no !~ ('^' || v_prefix || '-[0-9]{2,}$') then
    new.external_receipt_no := coalesce(new.external_receipt_no, new.receipt_no);
    new.receipt_no := null;
  end if;

  if new.receipt_no is null then
    perform pg_advisory_xact_lock(hashtextextended(v_prefix, 0));
    select coalesce(max((regexp_match(p.receipt_no, '-([0-9]+)$'))[1]::integer), 0) + 1
      into v_sequence
    from public.payments p
    where p.receipt_no like v_prefix || '-%'
      and (tg_op = 'INSERT' or p.id <> new.id);
    new.receipt_no := v_prefix || '-' || lpad(v_sequence::text, 2, '0');
  end if;

  return new;
end;
$$;

-- References beginning with WB were already system identifiers, not physical
-- receipt evidence.  The first normalization pass copied them defensively;
-- remove that redundant copy while retaining true receipt/import references.
update public.payments
set external_receipt_no = null
where external_receipt_no ~ '^WB(?:-|[A-Z0-9])';

commit;
