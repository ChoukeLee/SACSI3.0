begin;

create or replace function private.revise_ai_proposed_action_v2(
  p_proposal_id uuid,
  p_expected_version integer,
  p_action_name text,
  p_risk_level text,
  p_target jsonb,
  p_action_input jsonb,
  p_before_snapshot jsonb,
  p_before_versions jsonb,
  p_expected_effects jsonb,
  p_warnings jsonb,
  p_confidence numeric,
  p_requires_clarification boolean,
  p_expires_at timestamptz,
  p_revision_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.ai_proposed_actions%rowtype;
  v_previous_action text;
  v_previous_target jsonb;
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then raise exception 'authenticationRequired' using errcode = '42501'; end if;
  if jsonb_typeof(p_target) <> 'object'
    or jsonb_typeof(p_action_input) <> 'object'
    or jsonb_typeof(p_before_snapshot) <> 'object'
    or jsonb_typeof(p_before_versions) <> 'object'
    or jsonb_typeof(p_expected_effects) <> 'array'
    or jsonb_typeof(p_warnings) <> 'array'
    or jsonb_typeof(p_revision_summary) <> 'object' then
    raise exception 'invalidProposalRevision';
  end if;
  if p_confidence < 0 or p_confidence > 1 then raise exception 'invalidProposalConfidence'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '1 hour' then
    raise exception 'invalidProposalExpiry';
  end if;
  if not private.is_ai_action_authorized(p_action_name, p_risk_level) then
    raise exception 'businessActionPermissionDenied' using errcode = '42501';
  end if;

  select proposal.* into v_proposal
  from public.ai_proposed_actions proposal
  join public.ai_jobs job on job.id = proposal.job_id
  where proposal.id = p_proposal_id
    and job.actor_id = v_actor_id
    and (job.project_id is null or public.can_access_project(job.project_id))
  for update of proposal;
  if v_proposal.id is null then raise exception 'proposalNotFound' using errcode = 'P0002'; end if;
  if v_proposal.status not in ('awaiting_clarification', 'proposed') then raise exception 'proposalNotEditable'; end if;
  if v_proposal.version <> p_expected_version then raise exception 'proposalVersionChanged'; end if;

  v_previous_action := v_proposal.action_name;
  v_previous_target := v_proposal.target;
  update public.ai_proposed_actions
  set action_name = p_action_name,
      risk_level = p_risk_level,
      target = p_target,
      action_input = p_action_input,
      before_snapshot = p_before_snapshot,
      before_versions = p_before_versions,
      expected_effects = p_expected_effects,
      warnings = p_warnings,
      confidence = p_confidence,
      requires_clarification = p_requires_clarification,
      status = case when p_requires_clarification then 'awaiting_clarification' else 'proposed' end,
      expires_at = p_expires_at,
      version = version + 1
  where id = v_proposal.id
  returning * into v_proposal;

  insert into public.ai_action_events(job_id, proposed_action_id, actor_id, event_type, event_payload)
  values (
    v_proposal.job_id,
    v_proposal.id,
    v_actor_id,
    'proposal_edited',
    jsonb_build_object(
      'version', v_proposal.version,
      'previous_version', p_expected_version,
      'changed_fields', coalesce(p_revision_summary->'changed_fields', '[]'::jsonb),
      'action_from', v_previous_action,
      'action_to', v_proposal.action_name,
      'target_changed', v_previous_target is distinct from v_proposal.target,
      'requires_clarification', p_requires_clarification
    )
  );
  return jsonb_build_object(
    'success', true,
    'version', v_proposal.version,
    'status', v_proposal.status,
    'action_name', v_proposal.action_name,
    'expires_at', v_proposal.expires_at
  );
end;
$$;

create or replace function public.revise_ai_proposed_action_v2(
  p_proposal_id uuid,
  p_expected_version integer,
  p_action_name text,
  p_risk_level text,
  p_target jsonb,
  p_action_input jsonb,
  p_before_snapshot jsonb,
  p_before_versions jsonb,
  p_expected_effects jsonb,
  p_warnings jsonb,
  p_confidence numeric,
  p_requires_clarification boolean,
  p_expires_at timestamptz,
  p_revision_summary jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as 'select private.revise_ai_proposed_action_v2($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)';

revoke all on function private.revise_ai_proposed_action_v2(uuid, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, numeric, boolean, timestamptz, jsonb) from public, anon;
grant execute on function private.revise_ai_proposed_action_v2(uuid, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, numeric, boolean, timestamptz, jsonb) to authenticated;
revoke all on function public.revise_ai_proposed_action_v2(uuid, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, numeric, boolean, timestamptz, jsonb) from public, anon;
grant execute on function public.revise_ai_proposed_action_v2(uuid, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, numeric, boolean, timestamptz, jsonb) to authenticated;

commit;
