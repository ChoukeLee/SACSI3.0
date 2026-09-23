begin;

create or replace function private.payment_reference_prefix(
  p_unit_id uuid,
  p_source_type text,
  p_payment_date date,
  p_source_id uuid
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_prefix text;
begin
  v_prefix := private.lease_payment_reference_prefix(p_unit_id,p_source_type,p_payment_date);
  if v_prefix is null then return null; end if;

  -- Property fees may belong to an owner after a sale. Keep the financial
  -- category as property_fee but use the SALE domain in the visible reference.
  if p_source_type='property_fee'
     and exists(select 1 from public.sale_contracts where id=p_source_id) then
    return replace(v_prefix,'-L-','-SALE-');
  end if;
  return v_prefix;
end;
$$;

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
  v_prefix := private.payment_reference_prefix(new.unit_id,new.source_type,new.payment_date,new.source_id);
  if v_prefix is null then return new; end if;

  if new.receipt_no is not null
     and new.receipt_no !~ ('^'||v_prefix||'-[0-9]{2,}$') then
    new.external_receipt_no:=coalesce(new.external_receipt_no,new.receipt_no);
    new.receipt_no:=null;
  end if;

  if new.receipt_no is null then
    perform pg_advisory_xact_lock(hashtextextended(v_prefix,0));
    select coalesce(max((regexp_match(p.receipt_no,'-([0-9]+)$'))[1]::integer),0)+1
      into v_sequence
    from public.payments p
    where p.receipt_no like v_prefix||'-%'
      and (tg_op='INSERT' or p.id<>new.id);
    new.receipt_no:=v_prefix||'-'||lpad(v_sequence::text,2,'0');
  end if;
  return new;
end;
$$;

commit;
