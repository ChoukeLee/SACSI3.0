begin;

create or replace function public.renew_lease_rpc(
  p_contract_id uuid,
  p_new_end_date date,
  p_request_id uuid,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_contract public.lease_contracts%rowtype;
  v_old_end_date date;
begin
  if auth.uid() is null then
    raise exception 'leaseRenewalPermissionDenied';
  end if;
  if p_request_id is null then
    raise exception 'requestIdRequired';
  end if;
  if not public.can_execute_operator_action('renew_lease', 'L3') then
    raise exception 'leaseRenewalPermissionDenied';
  end if;
  if p_new_end_date is null then
    raise exception 'invalidEndDate';
  end if;

  select * into v_contract
  from public.lease_contracts
  where id = p_contract_id and status in ('draft', 'active')
  for update;
  if not found then
    raise exception 'leaseContractNotFound';
  end if;
  v_old_end_date := v_contract.expected_end_date;

  if v_contract.paid_through_date is not null and p_new_end_date <> v_contract.paid_through_date then
    raise exception 'renewalMustMatchPaidThroughDate';
  end if;
  if p_new_end_date < v_old_end_date then
    raise exception 'renewalCannotShortenContract';
  end if;

  if exists (
    select 1 from public.audit_logs
    where actor_id = auth.uid()
      and action = 'renew_lease'
      and metadata->>'request_id' = p_request_id::text
  ) then
    return jsonb_build_object('success', true, 'idempotent', true, 'contract_id', p_contract_id,
      'old_end_date', v_old_end_date, 'new_end_date', v_contract.expected_end_date);
  end if;

  update public.lease_contracts
  set expected_end_date = p_new_end_date,
      expected_end_confirmed = true,
      updated_at = now()
  where id = p_contract_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'renew_lease', 'lease_contract', p_contract_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'old_expected_end_date', v_old_end_date,
      'new_expected_end_date', p_new_end_date,
      'paid_through_date', v_contract.paid_through_date,
      'actor', p_actor
    )
  );

  return jsonb_build_object('success', true, 'idempotent', false, 'contract_id', p_contract_id,
    'old_end_date', v_old_end_date, 'new_end_date', p_new_end_date);
end;
$$;

revoke all on function public.renew_lease_rpc(uuid, date, uuid, jsonb) from public, anon;
grant execute on function public.renew_lease_rpc(uuid, date, uuid, jsonb) to authenticated;

commit;
