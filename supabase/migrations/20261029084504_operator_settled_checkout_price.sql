begin;

-- The nightly rate and actual occupancy remain factual. An explicitly agreed
-- settled price is represented separately, never as a negative discount.
alter table public.daily_bookings
  add column settlement_adjustment_amount_xof numeric not null default 0,
  add column settlement_adjustment_reason text,
  add constraint daily_booking_settlement_adjustment_valid check (
    settlement_adjustment_amount_xof>=0 and settlement_adjustment_amount_xof<=999999999999
    and trunc(settlement_adjustment_amount_xof)=settlement_adjustment_amount_xof
    and (settlement_adjustment_amount_xof=0 or (
      status='checked_out' and checkout_mode='fixed' and actual_check_out is not null
      and check_out is not null and check_out=actual_check_out and actual_check_out>check_in
      and total_amount_xof=(actual_check_out-check_in)*nightly_price_xof
      and manual_discount_amount_xof=0 and final_amount_xof is not null
      and final_amount_xof=total_amount_xof+settlement_adjustment_amount_xof
      and length(btrim(settlement_adjustment_reason)) between 5 and 1000
      and settlement_adjustment_reason is not null
    ))
  );

-- Table UPDATE grants must not expose the new controlled settlement fields.
-- SECURITY INVOKER observes the caller's role; the existing checked and audited
-- SECURITY DEFINER operation writes as its owner. No user-settable GUC is used.
create function private.guard_daily_settlement_adjustment() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('anon','authenticated','service_role') and
    ((tg_op='INSERT' and (new.settlement_adjustment_amount_xof<>0 or new.settlement_adjustment_reason is not null))
     or (tg_op='UPDATE' and (new.settlement_adjustment_amount_xof is distinct from old.settlement_adjustment_amount_xof
       or new.settlement_adjustment_reason is distinct from old.settlement_adjustment_reason)))
  then raise exception 'operationForbidden' using errcode='42501'; end if;
  return new;
end; $$;
create trigger guard_daily_settlement_adjustment before insert or update on public.daily_bookings
for each row execute function private.guard_daily_settlement_adjustment();
revoke all on function private.guard_daily_settlement_adjustment() from public,anon,authenticated,service_role;

create function public.booking_checkout_settled_price_protocol_version() returns integer
language sql security invoker set search_path='' as $$ select 1; $$;
revoke all on function public.booking_checkout_settled_price_protocol_version() from public,anon,authenticated,service_role;
grant execute on function public.booking_checkout_settled_price_protocol_version() to authenticated;

create or replace function private.preview_checkout_correction(q jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  b public.daily_bookings%rowtype; u public.units%rowtype;
  co date; discount numeric; gross numeric; total numeric; paid numeric; adjustment numeric:=0; s jsonb;
begin
  if jsonb_typeof(q) is distinct from 'object'
    or q->>'operation' is distinct from 'correct_checkout'
    or not q ?& array['requestId','operation','originalInstruction','bookingId','actualCheckOut','discountAmountXof','reason','inputSource']
    or exists(select 1 from jsonb_object_keys(q) k where k<>all(array['requestId','operation','originalInstruction','bookingId','actualCheckOut','discountAmountXof','reason','inputSource','finalAmountXof']))
    or exists(select 1 from jsonb_each(q) e where e.value='null'::jsonb)
    or jsonb_typeof(q->'originalInstruction') is distinct from 'string'
    or length(btrim(q->>'originalInstruction')) not between 1 and 4000
    or coalesce(q->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(q->>'bookingId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(q->'reason') is distinct from 'string'
    or length(btrim(q->>'reason')) not between 5 and 1000
    or q->>'inputSource' not in ('natural_language','excel_screenshot')
    or jsonb_typeof(q->'actualCheckOut') is distinct from 'string'
    or q->>'actualCheckOut' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(q->'discountAmountXof') is distinct from 'number'
    or (q ? 'finalAmountXof' and jsonb_typeof(q->'finalAmountXof') is distinct from 'number')
  then raise exception 'operationInvalidRequest'; end if;
  if not coalesce(private.booking_operation_allowed(q),false)
  then raise exception 'operationForbidden' using errcode='42501'; end if;
  begin
    co:=(q->>'actualCheckOut')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'operationInvalidDate';
  end;
  select * into b from public.daily_bookings where id=(q->>'bookingId')::uuid;
  select * into u from public.units where id=b.unit_id;
  -- Only shorten an already recorded fixed stay. No new occupancy is introduced.
  if b.status is distinct from 'checked_out' or (b.checkout_mode is distinct from 'fixed' and b.checkout_mode is distinct from 'open')
    or b.actual_check_out is null or b.check_out is null
  then raise exception 'operationAssistanceRequired'; end if;
  if not isfinite(co) or co::text<>q->>'actualCheckOut' or co<=b.check_in
    or co>current_date or co>b.actual_check_out
  then raise exception 'operationInvalidDate'; end if;
  if b.checkout_mode='open' then
    if public.booking_open_checkout_discount_protocol_version()<>1
      or b.check_out is distinct from b.actual_check_out or co is distinct from b.actual_check_out
    then raise exception 'operationAssistanceRequired'; end if;
    if b.total_amount_xof is distinct from (b.actual_check_out-b.check_in)*b.nightly_price_xof
    then raise exception 'operationFinanceMismatch'; end if;
  end if;
  if b.settlement_adjustment_amount_xof<>0 and not q ? 'finalAmountXof'
  then raise exception 'operationAssistanceRequired'; end if;
  discount:=(q->>'discountAmountXof')::numeric;
  if discount<0 or discount>999999999999 or trunc(discount)<>discount
    or b.nightly_price_xof<=0 or b.nightly_price_xof>999999999999 or trunc(b.nightly_price_xof)<>b.nightly_price_xof
  then raise exception 'operationInvalidRequest'; end if;
  gross:=(co-b.check_in)*b.nightly_price_xof;
  if gross>999999999999 or discount>gross then raise exception 'operationInvalidRequest'; end if;
  total:=gross-discount;
  select coalesce(sum(amount),0) into paid from public.payments where source_type='daily_booking' and source_id=b.id;
  if paid<0 or b.prepaid_amount_xof is distinct from paid
    or exists(select 1 from public.payments p where p.source_type='daily_booking' and p.source_id=b.id
      and (p.currency::text<>'XOF' or p.exchange_rate_to_xof is distinct from 1 or p.unit_id is distinct from b.unit_id
        or p.native_settlement or (select count(*) from public.ledger_entries l where l.payment_id=p.id)<>1
        or not exists(select 1 from public.ledger_entries l where l.payment_id=p.id and l.unit_id=b.unit_id and l.building_id=u.building_id
          and l.amount_xof=abs(p.amount) and l.entry_date=p.payment_date
          and l.direction=case when p.amount<0 then 'expense' else 'income' end)))
    or (select count(*) from public.receivables where source_type='daily_booking' and source_id=b.id)<>1
    or not exists(select 1 from public.receivables where source_type='daily_booking' and source_id=b.id and status<>'cancelled'
      and unit_id=b.unit_id and building_id=u.building_id and currency::text='XOF'
      and amount_xof=b.final_amount_xof and paid_amount_xof=least(paid,b.final_amount_xof)
      and management_status='managed')
  then raise exception 'operationFinanceMismatch'; end if;
  if q ? 'finalAmountXof' then
    if public.booking_checkout_settled_price_protocol_version()<>1 or b.checkout_mode<>'fixed'
    then raise exception 'operationAssistanceRequired'; end if;
    total:=(q->>'finalAmountXof')::numeric;
    if discount<>0 or total<=0 or total>999999999999 or trunc(total)<>total or total<gross
    then raise exception 'operationInvalidRequest'; end if;
    if paid<=0 or total<>paid or total>b.final_amount_xof
    then raise exception 'operationFinanceMismatch'; end if;
    adjustment:=total-gross;
  end if;
  if total<paid then raise exception 'operationRefundReviewRequired'; end if;
  s:=jsonb_build_object('booking',to_jsonb(b),'unit',to_jsonb(u),'businessDate',current_date,
    'receivables',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.receivables r where source_type='daily_booking' and source_id=b.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where source_type='daily_booking' and source_id=b.id),'[]'::jsonb),
    'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.ledger_entries l join public.payments p on p.id=l.payment_id where p.source_type='daily_booking' and p.source_id=b.id),'[]'::jsonb),
    'cleaningTasks',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.cleaning_tasks c where daily_booking_id=b.id),'[]'::jsonb));
  return jsonb_build_object('snapshot',s,'plan',jsonb_build_object(
    'operation','correct_checkout','bookingId',b.id,'unitId',u.id,'unitCode',u.code,
    'bookingAgent',(select name from public.customers where id=b.booking_agent_id),'guestName',b.guest_name,
    'checkInBefore',b.check_in,'checkInAfter',b.check_in,'checkOutBefore',b.check_out,'checkOutAfter',co,
    'actualCheckOutBefore',b.actual_check_out,'actualCheckOutAfter',co,
    'priceBefore',b.nightly_price_xof,'priceAfter',b.nightly_price_xof,
    'grossBefore',b.total_amount_xof,'grossAfter',gross,'calculatedGrossAfter',gross,
    'adjustmentBefore',b.settlement_adjustment_amount_xof,'adjustmentAfter',adjustment,
    'discountBefore',b.manual_discount_amount_xof,'discountAfter',discount,
    'totalBefore',b.final_amount_xof,'totalAfter',total,'paidBefore',paid,'paidAfter',paid,
    'outstandingBefore',greatest(b.final_amount_xof-paid,0),'outstandingAfter',total-paid,
    'reason',q->>'reason','inputSource',q->>'inputSource',
    'notice','更正已退房订单的实际退房日和优惠，或按明确约定的已收金额结清；约定结算调整单独记录，保留原收款、账本、房态及保洁，不登记退款。'));
end; $$;

create or replace function private.apply_checkout_correction(q jsonb, expected jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare bid uuid:=(q->>'bookingId')::uuid; after_snapshot jsonb;
begin
  -- Caller holds the existing booking/unit/receivable locks. Recheck under those locks.
  if private.preview_checkout_correction(q) is distinct from expected then raise exception 'operationChanged'; end if;
  update public.daily_bookings set check_out=(q->>'actualCheckOut')::date,actual_check_out=(q->>'actualCheckOut')::date,
    total_amount_xof=(expected->'plan'->>'grossAfter')::numeric,
    settlement_adjustment_amount_xof=(expected->'plan'->>'adjustmentAfter')::numeric,
    settlement_adjustment_reason=case when (expected->'plan'->>'adjustmentAfter')::numeric<>0 then q->>'reason' end,
    manual_discount_amount_xof=(q->>'discountAmountXof')::numeric,manual_discount_reason=q->>'reason',
    final_amount_xof=(expected->'plan'->>'totalAfter')::numeric,updated_at=now() where id=bid;
  perform public.daily_sync_booking_finance_tx(bid);
  after_snapshot:=private.preview_checkout_correction(q)->'snapshot';
  if after_snapshot->'payments' is distinct from expected->'snapshot'->'payments'
    or after_snapshot->'ledger' is distinct from expected->'snapshot'->'ledger'
    or after_snapshot->'cleaningTasks' is distinct from expected->'snapshot'->'cleaningTasks'
    or after_snapshot->'unit' is distinct from expected->'snapshot'->'unit'
    or (after_snapshot->'booking'->>'actual_check_out')::date is distinct from (q->>'actualCheckOut')::date
    or (after_snapshot->'booking'->>'check_out')::date is distinct from (q->>'actualCheckOut')::date
    or (after_snapshot->'booking'->>'total_amount_xof')::numeric is distinct from (expected->'plan'->>'grossAfter')::numeric
    or (after_snapshot->'booking'->>'settlement_adjustment_amount_xof')::numeric is distinct from (expected->'plan'->>'adjustmentAfter')::numeric
    or after_snapshot->'booking'->>'settlement_adjustment_reason' is distinct from
      (case when (expected->'plan'->>'adjustmentAfter')::numeric<>0 then q->>'reason' end)
    or (after_snapshot->'booking'->>'final_amount_xof')::numeric is distinct from (expected->'plan'->>'totalAfter')::numeric
    or (after_snapshot->'booking'->>'manual_discount_amount_xof')::numeric is distinct from (q->>'discountAmountXof')::numeric
    or after_snapshot->'booking'->>'manual_discount_reason' is distinct from q->>'reason'
    or (after_snapshot->'booking'->>'billing_status') is distinct from
      (case when (expected->'plan'->>'outstandingAfter')::numeric=0 then 'settled'
        when (expected->'plan'->>'paidAfter')::numeric>0 then 'partially_paid' else 'need_top_up' end)
  then raise exception 'operationVerificationFailed'; end if;
end; $$;


-- Older refund/reversal plans do not understand agreed settlement adjustments.
-- Fail closed instead of deriving a negative discount or silently removing it.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.preview_booking_operation(jsonb)'::regprocedure);
  anchor:=' ci:=b.check_in; co:=b.check_out; price:=b.nightly_price_xof; total:=b.final_amount_xof;';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
  then raise exception 'settledPriceMigrationDrift'; end if;
  execute replace(definition,anchor,$patch$
 if b.settlement_adjustment_amount_xof<>0 and op in ('refund','reverse')
 then raise exception 'operationAssistanceRequired'; end if;
 ci:=b.check_in; co:=b.check_out; price:=b.nightly_price_xof; total:=b.final_amount_xof;$patch$);
end; $$;

-- Protect the older direct reversal RPC too. It locks the same booking before
-- posting; an existing adjusted settlement needs a dedicated reviewed workflow.
create function private.guard_adjusted_daily_payment_reduction() returns trigger
language plpgsql security definer set search_path='' as $$
declare adjustment numeric;
begin
  if new.source_type='daily_booking' and new.amount<0 then
    select settlement_adjustment_amount_xof into adjustment from public.daily_bookings
      where id=new.source_id for update;
    if adjustment<>0 then raise exception 'operationAssistanceRequired'; end if;
  end if;
  return new;
end; $$;
create trigger guard_adjusted_daily_payment_reduction before insert on public.payments
for each row execute function private.guard_adjusted_daily_payment_reduction();
revoke all on function private.guard_adjusted_daily_payment_reduction() from public,anon,authenticated,service_role;

revoke all on function private.preview_checkout_correction(jsonb),private.apply_checkout_correction(jsonb,jsonb)
from public,anon,authenticated,service_role;
commit;
