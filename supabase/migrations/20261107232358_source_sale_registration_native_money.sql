begin;

-- Historical source registration is distinct from a signed paper contract.
-- This migration creates no registrations, bills, schedules or cash records.
alter table public.sale_contracts
  add column registration_basis text not null default 'contract',
  add column source_reference text,
  add column sale_currency public.currency_code not null default 'XOF',
  add column total_amount_native numeric(14,2),
  add column source_balance_native numeric(14,2),
  add column source_balance_reference text,
  alter column signed_date drop not null,
  add constraint sale_registration_basis_valid check (registration_basis in ('contract','source_record')),
  add constraint sale_registration_signed_date_valid check (
    signed_date is not null or
    (registration_basis='source_record' and nullif(btrim(source_reference),'') is not null)
  ),
  add constraint sale_unconfirmed_registration_facts_valid check (
    (payment_plan_type<>'unconfirmed' and transfer_status<>'unconfirmed') or
    (registration_basis='source_record' and nullif(btrim(source_reference),'') is not null)
  ),
  add constraint sale_source_balance_valid check (
    (source_balance_native is null and source_balance_reference is null) or
    (registration_basis='source_record' and nullif(btrim(source_reference),'') is not null and
      source_balance_native is not null and source_balance_native>=0 and
      source_balance_native::text not in ('NaN','Infinity','-Infinity') and
      nullif(btrim(source_balance_reference),'') is not null)
  ),
  add constraint sale_native_price_valid check (
    (sale_currency='XOF' and total_amount_native is null) or
    (sale_currency in ('USD','CNY') and total_amount_xof is not null and total_amount_xof=0 and
      total_amount_native is not null and total_amount_native>0 and
      total_amount_native::text not in ('NaN','Infinity','-Infinity'))
  );
comment on column public.sale_contracts.registration_basis is
  'contract: signed contract registration; source_record: independent source-based registration, not proof of signing.';
comment on column public.sale_contracts.source_reference is
  'Original source evidence (file SHA256, filename, sheet and cells); never substitute a payment date for signing.';
comment on column public.sale_contracts.total_amount_native is
  'Confirmed original-currency sale price. For USD/CNY the zero XOF slot means no valuation, not a zero price.';
comment on column public.sale_contracts.source_balance_native is
  'Explicit source-record balance in sale_currency, with its own evidence; not a managed receivable, settlement allocation or agreed due date.';
-- Legacy plan prose is deliberately preserved. Only the new unknown sentinel is
-- source-restricted; normal sale RPC allowlists are unchanged.

-- Preserve both existing lease and restricted CIMAC native deposit branches.
alter table public.payments drop constraint payment_native_settlement_check;
alter table public.payments add constraint payment_native_settlement_check check (
  (native_settlement and currency in ('USD','CNY') and
    (source_type in ('lease_rent','sale_contract') or
      (currency='CNY' and source_type in ('lease_deposit','lease_deposit_refund') and request_kind='cimac_maintenance'))
    and amount>0 and amount::text not in ('NaN','Infinity','-Infinity') and exchange_rate_to_xof is null)
  or (not native_settlement and exchange_rate_to_xof is not null)
);

-- Integrity guards only: existing RLS/grants and authenticated RPC checks remain.
-- They also stop existing XOF-only sale writers from posting to a native sale.
create function private.guard_native_sale_money() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c public.sale_contracts%rowtype;
begin
  if tg_table_name='payments' then
    if tg_op='UPDATE' and old.native_settlement and old.source_type='sale_contract' and
      (new.native_settlement,new.source_type,new.source_id,new.unit_id,new.customer_id,new.currency)
      is distinct from
      (old.native_settlement,old.source_type,old.source_id,old.unit_id,old.customer_id,old.currency) then
      raise exception 'nativeSalePaymentIdentityImmutable';
    end if;
    if new.source_type not in ('sale','sale_contract') then return new; end if;
    select * into c from public.sale_contracts where id=new.source_id for share;
    if new.native_settlement then
      if c.id is null or new.source_type<>'sale_contract' or c.sale_currency not in ('USD','CNY') or
        new.currency is distinct from c.sale_currency or new.exchange_rate_to_xof is not null or
        new.unit_id is distinct from c.unit_id or new.customer_id is distinct from c.customer_id then
        raise exception 'nativeSalePaymentMismatch';
      end if;
    elsif c.sale_currency<>'XOF' then
      raise exception 'nativeSaleCurrencyRequired';
    end if;
  elsif tg_table_name='sale_contracts' then
    if new.sale_currency<>'XOF' and (
      exists(select 1 from public.sale_payment_schedule s where s.sale_contract_id=new.id) or
      exists(select 1 from public.receivables r where r.source_type='sale_contract' and r.source_id=new.id
        and r.category in ('sale_lump_sum','sale_installment')) or
      exists(select 1 from public.payments p where p.source_id=new.id and p.source_type in ('sale','sale_contract')
        and (not p.native_settlement or p.currency is distinct from new.sale_currency or
          p.unit_id is distinct from new.unit_id or p.customer_id is distinct from new.customer_id))
    ) then raise exception 'nativeSaleExistingXofFacts'; end if;
    if tg_op='UPDATE' and exists(select 1 from public.payments p
      where p.source_id=old.id and p.source_type='sale_contract' and p.native_settlement
        and (new.sale_currency is distinct from p.currency or new.unit_id is distinct from p.unit_id or
          new.customer_id is distinct from p.customer_id)) then
      raise exception 'nativeSalePaymentMismatch';
    end if;
  elsif tg_table_name='sale_payment_schedule' then
    select * into c from public.sale_contracts where id=new.sale_contract_id for share;
    if c.sale_currency<>'XOF' then raise exception 'nativeSaleScheduleNotSupported'; end if;
  elsif tg_table_name='receivables' then
    if new.source_type='sale_contract' and new.category in ('sale_lump_sum','sale_installment') then
      select * into c from public.sale_contracts where id=new.source_id for share;
      if c.sale_currency<>'XOF' then raise exception 'nativeSaleReceivableNotSupported'; end if;
    end if;
  end if;
  return new;
end; $$;
revoke all on function private.guard_native_sale_money() from public,anon,authenticated,service_role;
create trigger guard_native_sale_payment before insert or update on public.payments
  for each row execute function private.guard_native_sale_money();
create trigger guard_native_sale_contract before insert or update on public.sale_contracts
  for each row execute function private.guard_native_sale_money();
create trigger guard_native_sale_schedule before insert or update on public.sale_payment_schedule
  for each row execute function private.guard_native_sale_money();
create trigger guard_native_sale_receivable before insert or update on public.receivables
  for each row execute function private.guard_native_sale_money();

-- Serialise ledger mutations on the payment row, including concurrent inserts.
-- Only the new native-sale branch is inspected; old lease/CIMAC rows are untouched.
create function private.lock_native_sale_ledger_payment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
  for target in select distinct id from unnest(array[
    case when tg_op<>'INSERT' then old.payment_id end,
    case when tg_op<>'DELETE' then new.payment_id end
  ]) id where id is not null order by id loop
    perform 1 from public.payments p where p.id=target and p.native_settlement and p.source_type='sale_contract' for update;
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
revoke all on function private.lock_native_sale_ledger_payment() from public,anon,authenticated,service_role;
create trigger lock_native_sale_ledger_payment before insert or update or delete on public.ledger_entries
  for each row execute function private.lock_native_sale_ledger_payment();

-- A native receipt is one cash fact and exactly one canonical original-currency
-- ledger row. Deferral permits the pair to be inserted in the same transaction.
create function private.validate_native_sale_ledger() returns trigger
language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; target uuid; p public.payments%rowtype; total bigint; valid bigint;
begin
  if tg_table_name='payments' then
    ids:=array[case when tg_op<>'INSERT' then old.id end,case when tg_op<>'DELETE' then new.id end];
  else
    ids:=array[case when tg_op<>'INSERT' then old.payment_id end,case when tg_op<>'DELETE' then new.payment_id end];
  end if;
  for target in select distinct id from unnest(ids) id where id is not null order by id loop
    select * into p from public.payments where id=target and native_settlement and source_type='sale_contract' for update;
    if p.id is null then continue; end if;
    select count(*),count(*) filter(where l.unit_id=p.unit_id and
      l.building_id=(select u.building_id from public.units u where u.id=p.unit_id) and
      l.entry_date=p.payment_date and l.direction='income' and l.category='sale' and
      l.currency=p.currency and l.amount_native=p.amount and l.amount_xof=0 and l.amount_cny is null)
      into total,valid from public.ledger_entries l where l.payment_id=p.id;
    if total<>1 or valid<>1 then raise exception 'nativeSaleLedgerMismatch'; end if;
  end loop;
  return null;
end; $$;
revoke all on function private.validate_native_sale_ledger() from public,anon,authenticated,service_role;
create constraint trigger native_sale_payment_ledger
  after insert or update or delete on public.payments deferrable initially deferred
  for each row execute function private.validate_native_sale_ledger();
create constraint trigger native_sale_ledger_consistency
  after insert or update or delete on public.ledger_entries deferrable initially deferred
  for each row execute function private.validate_native_sale_ledger();

commit;
