begin;

-- The first two AI migrations were already applied before the final review.
-- Keep this forward-only delta so production and fresh databases converge.

alter function public.record_lease_financial_entry_rpc(
  uuid, text, date, numeric, date, text, text, text, uuid
) rename to record_lease_financial_entry_core_rpc;

create or replace function public.record_lease_financial_entry_rpc(
  p_contract_id uuid,
  p_business_type text,
  p_payment_date date,
  p_amount_xof numeric,
  p_paid_through_date date default null,
  p_payment_method text default null,
  p_notes text default null,
  p_reference_prefix text default 'LEASE',
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_contract_id is null or nullif(trim(coalesce(p_reference_prefix, '')), '') is null then
    raise exception 'contractAndReferencePrefixRequired';
  end if;
  -- Serialize visible receipt-number allocation independently from the
  -- idempotency-key lock inside the core implementation.
  perform pg_advisory_xact_lock(
    hashtextextended(p_contract_id::text || ':' || p_reference_prefix, 0)
  );
  return public.record_lease_financial_entry_core_rpc(
    p_contract_id, p_business_type, p_payment_date, p_amount_xof,
    p_paid_through_date, p_payment_method, p_notes,
    p_reference_prefix, p_request_id
  );
end;
$$;

revoke all on function public.record_lease_financial_entry_core_rpc(
  uuid, text, date, numeric, date, text, text, text, uuid
) from public, anon;
grant execute on function public.record_lease_financial_entry_core_rpc(
  uuid, text, date, numeric, date, text, text, text, uuid
) to authenticated, service_role;
revoke all on function public.record_lease_financial_entry_rpc(
  uuid, text, date, numeric, date, text, text, text, uuid
) from public, anon;
grant execute on function public.record_lease_financial_entry_rpc(
  uuid, text, date, numeric, date, text, text, text, uuid
) to authenticated, service_role;

create or replace function private.complete_ai_input_extraction(
  p_input_id uuid,
  p_extracted_text text,
  p_extraction_result jsonb,
  p_contains_sensitive_data boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input public.ai_inputs%rowtype;
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then raise exception 'authenticationRequired' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_extraction_result, '{}'::jsonb)) <> 'object' then
    raise exception 'extractionResultMustBeObject';
  end if;
  select input.* into v_input
  from public.ai_inputs input
  join public.ai_jobs job on job.id = input.job_id
  where input.id = p_input_id
    and job.actor_id = v_actor_id
    and (job.project_id is null or public.can_access_project(job.project_id))
    and input.redacted_at is null
  for update of input;
  if v_input.id is null then raise exception 'aiInputNotFound' using errcode = 'P0002'; end if;
  if v_input.extracted_text is not null or v_input.extraction_result <> '{}'::jsonb then
    raise exception 'aiInputExtractionAlreadyCompleted';
  end if;
  update public.ai_inputs
  set extracted_text = nullif(p_extracted_text, ''),
      extraction_result = coalesce(p_extraction_result, '{}'::jsonb),
      contains_sensitive_data = coalesce(p_contains_sensitive_data, true),
      updated_at = now()
  where id = v_input.id;
  return jsonb_build_object('success', true, 'input_id', v_input.id);
end;
$$;

create or replace function public.complete_ai_input_extraction(
  p_input_id uuid, p_extracted_text text, p_extraction_result jsonb,
  p_contains_sensitive_data boolean
)
returns jsonb language sql security invoker set search_path = ''
as 'select private.complete_ai_input_extraction($1, $2, $3, $4)';

revoke all on function private.complete_ai_input_extraction(uuid, text, jsonb, boolean) from public, anon;
grant execute on function private.complete_ai_input_extraction(uuid, text, jsonb, boolean) to authenticated;
revoke all on function public.complete_ai_input_extraction(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.complete_ai_input_extraction(uuid, text, jsonb, boolean) to authenticated;

commit;
