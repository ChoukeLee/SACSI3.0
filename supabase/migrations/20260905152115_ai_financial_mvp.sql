begin;

-- One customer transfer may cover rent and property fee. Both entries must
-- commit together and reuse stable child request ids on retries.
create or replace function public.record_combined_lease_payment_rpc(
  p_contract_id uuid,
  p_payment_date date,
  p_rent_amount_xof numeric,
  p_property_amount_xof numeric,
  p_paid_through_date date,
  p_payment_method text,
  p_notes text,
  p_rent_reference_prefix text,
  p_property_reference_prefix text,
  p_rent_request_id uuid,
  p_property_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rent jsonb;
  v_property jsonb;
begin
  if coalesce(p_rent_amount_xof, 0) <= 0
    or coalesce(p_property_amount_xof, 0) <= 0 then
    raise exception 'combinedAmountsRequired';
  end if;
  if p_paid_through_date is null then raise exception 'paidThroughDateRequired'; end if;
  if p_rent_request_id is null or p_property_request_id is null
    or p_rent_request_id = p_property_request_id then
    raise exception 'distinctRequestIdsRequired';
  end if;

  v_rent := public.record_lease_financial_entry_rpc(
    p_contract_id, 'rent_income', p_payment_date, p_rent_amount_xof,
    p_paid_through_date, p_payment_method, p_notes,
    p_rent_reference_prefix, p_rent_request_id
  );
  v_property := public.record_lease_financial_entry_rpc(
    p_contract_id, 'property_fee_income', p_payment_date, p_property_amount_xof,
    null, p_payment_method, p_notes,
    p_property_reference_prefix, p_property_request_id
  );

  return jsonb_build_object(
    'success', true,
    'rent', v_rent,
    'property_fee', v_property,
    'total_amount_xof', p_rent_amount_xof + p_property_amount_xof
  );
end;
$$;

revoke all on function public.record_combined_lease_payment_rpc(
  uuid, date, numeric, numeric, date, text, text, text, text, uuid, uuid
) from public, anon;
grant execute on function public.record_combined_lease_payment_rpc(
  uuid, date, numeric, numeric, date, text, text, text, text, uuid, uuid
) to authenticated, service_role;

comment on function public.record_combined_lease_payment_rpc(
  uuid, date, numeric, numeric, date, text, text, text, text, uuid, uuid
) is 'Atomically records one combined lease rent and property-fee transfer using stable idempotency ids.';

commit;
