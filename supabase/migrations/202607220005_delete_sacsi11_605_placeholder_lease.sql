-- Delete the single stale SACSI11 placeholder lease confirmed by the user.
-- Room 605 / LETAIEF has zero rent, zero deposit, a 2099 placeholder end date,
-- and no payment, receivable, or ledger references.

do $$
declare
  v_contract_id uuid := 'b0f9961f-1503-4918-a119-ce67a3096cee';
  v_snapshot jsonb;
begin
  select to_jsonb(lc) || jsonb_build_object(
      'unit_no', u.unit_no,
      'building_code', b.code,
      'customer_name', c.name
    )
    into v_snapshot
  from public.lease_contracts lc
  join public.units u on u.id = lc.unit_id
  join public.buildings b on b.id = u.building_id
  join public.customers c on c.id = lc.customer_id
  where lc.id = v_contract_id
    and b.code = 'SACSI11'
    and u.unit_no = '605'
    and lc.contract_no = 'LEGACY-LEASE-SACSI11-605'
    and lc.monthly_rent_xof = 0
    and lc.deposit_amount_xof = 0;

  if v_snapshot is null then
    raise exception 'Expected SACSI11-605 placeholder lease not found or no longer matches safeguards';
  end if;

  if exists (select 1 from public.payments where source_id = v_contract_id)
    or exists (select 1 from public.receivables where source_id = v_contract_id) then
    raise exception 'SACSI11-605 placeholder now has financial references; deletion aborted';
  end if;

  delete from public.lease_contracts where id = v_contract_id;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'delete_sacsi11_legacy_placeholder_lease',
    'lease_contract',
    v_contract_id,
    jsonb_build_object(
      'reason', 'user_confirmed_stale_handover_record',
      'deleted_record', v_snapshot
    )
  );
end $$;
