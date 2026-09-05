begin;

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  actor_role text not null default public.current_user_role()
    check (actor_role in ('admin', 'boss', 'finance', 'front_desk', 'rental_sales')),
  project_id uuid references public.projects(id) on delete restrict,
  request_id uuid not null default gen_random_uuid(),
  input_mode text not null default 'text'
    check (input_mode in ('text', 'image', 'file', 'mixed')),
  locale text not null default 'zh' check (locale in ('zh', 'fr')),
  timezone text not null default 'Africa/Abidjan',
  status text not null default 'input_received'
    check (status in ('input_received', 'analyzing', 'awaiting_confirmation', 'executing', 'completed', 'failed', 'cancelled')),
  failure_code text,
  failure_message text,
  retention_until timestamptz not null default (now() + interval '365 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (actor_id, request_id),
  check (retention_until between created_at and created_at + interval '366 days')
);

create table public.ai_inputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  input_type text not null check (input_type in ('text', 'image', 'pdf', 'spreadsheet', 'csv')),
  raw_text text,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes between 0 and 20971520),
  extracted_text text,
  extraction_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extraction_result) = 'object'),
  contains_sensitive_data boolean not null default false,
  retention_until timestamptz not null default (now() + interval '30 days'),
  redacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, sequence_no),
  check (retention_until between created_at and created_at + interval '31 days'),
  check (
    redacted_at is not null
    or (
      (input_type = 'text' and raw_text is not null and storage_path is null)
      or
      (input_type <> 'text' and storage_bucket = 'ai-inputs' and storage_path is not null)
    )
  )
);

create table public.ai_proposed_actions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  action_name text not null,
  risk_level text not null check (risk_level in ('L1', 'L2', 'L3')),
  status text not null default 'proposed'
    check (status in ('awaiting_clarification', 'proposed', 'confirmed', 'executing', 'executed', 'rejected', 'expired', 'failed')),
  target jsonb not null default '{}'::jsonb check (jsonb_typeof(target) = 'object'),
  action_input jsonb not null default '{}'::jsonb check (jsonb_typeof(action_input) = 'object'),
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot) = 'object'),
  before_versions jsonb not null default '{}'::jsonb check (jsonb_typeof(before_versions) = 'object'),
  expected_effects jsonb not null default '[]'::jsonb check (jsonb_typeof(expected_effects) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  requires_clarification boolean not null default false,
  version integer not null default 1 check (version > 0),
  expires_at timestamptz not null,
  confirmation_request_id uuid unique,
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  rejected_by uuid references auth.users(id) on delete restrict,
  rejected_at timestamptz,
  rejection_reason text,
  execution_request_id uuid unique,
  execution_result jsonb,
  execution_error text,
  executed_at timestamptz,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, sequence_no),
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour'),
  check (execution_result is null or jsonb_typeof(execution_result) = 'object')
);

create table public.ai_action_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  proposed_action_id uuid references public.ai_proposed_actions(id) on delete cascade,
  actor_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  event_type text not null
    check (event_type in ('job_created', 'input_added', 'proposal_created', 'proposal_edited', 'confirmed', 'rejected', 'execution_started', 'executed', 'failed', 'expired', 'input_redacted')),
  event_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(event_payload) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.ai_jobs is 'User-owned AI work items. AI is a channel; actor_id is always the authenticated business actor.';
comment on table public.ai_inputs is 'Minimum necessary AI input evidence. Raw file content lives only in the private ai-inputs bucket.';
comment on table public.ai_proposed_actions is 'Human-confirmed business action proposals with optimistic version and idempotency keys.';
comment on table public.ai_action_events is 'Append-only AI proposal lifecycle evidence. Sensitive source content must not be copied into event_payload.';

create index ai_jobs_actor_status_updated_idx
  on public.ai_jobs (actor_id, status, updated_at desc);
create index ai_jobs_project_updated_idx
  on public.ai_jobs (project_id, updated_at desc)
  where project_id is not null;
create index ai_jobs_retention_idx
  on public.ai_jobs (retention_until);
create index ai_inputs_job_created_idx
  on public.ai_inputs (job_id, created_at);
create index ai_inputs_pending_redaction_idx
  on public.ai_inputs (retention_until)
  where redacted_at is null;
create index ai_proposals_job_status_idx
  on public.ai_proposed_actions (job_id, status, sequence_no);
create index ai_proposals_pending_expiry_idx
  on public.ai_proposed_actions (expires_at)
  where status in ('awaiting_clarification', 'proposed', 'confirmed');
create index ai_events_job_created_idx
  on public.ai_action_events (job_id, created_at, id);
create index ai_events_proposal_created_idx
  on public.ai_action_events (proposed_action_id, created_at, id)
  where proposed_action_id is not null;

create or replace function public.touch_ai_record_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_touch_ai_jobs
before update on public.ai_jobs
for each row execute function public.touch_ai_record_updated_at();
create trigger trg_touch_ai_inputs
before update on public.ai_inputs
for each row execute function public.touch_ai_record_updated_at();
create trigger trg_touch_ai_proposals
before update on public.ai_proposed_actions
for each row execute function public.touch_ai_record_updated_at();

alter table public.ai_jobs enable row level security;
alter table public.ai_inputs enable row level security;
alter table public.ai_proposed_actions enable row level security;
alter table public.ai_action_events enable row level security;

revoke all on table public.ai_jobs, public.ai_inputs, public.ai_proposed_actions, public.ai_action_events from anon, authenticated;
grant select, insert on table public.ai_jobs, public.ai_inputs, public.ai_proposed_actions to authenticated;
grant select on table public.ai_action_events to authenticated;
grant all on table public.ai_jobs, public.ai_inputs, public.ai_proposed_actions, public.ai_action_events to service_role;
grant all on sequence public.ai_action_events_id_seq to service_role;

create policy "actors read their ai jobs"
on public.ai_jobs for select to authenticated
using (
  actor_id = (select auth.uid())
  and (project_id is null or public.can_access_project(project_id))
);
create policy "actors create their ai jobs"
on public.ai_jobs for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and actor_role = public.current_user_role()
  and public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales')
  and (project_id is null or public.can_access_project(project_id))
  and status = 'input_received'
  and failure_code is null
  and failure_message is null
  and finished_at is null
);
create policy "actors update their ai jobs"
on public.ai_jobs for update to authenticated
using (
  actor_id = (select auth.uid())
  and (project_id is null or public.can_access_project(project_id))
)
with check (
  actor_id = (select auth.uid())
  and (project_id is null or public.can_access_project(project_id))
);

create policy "actors read their ai inputs"
on public.ai_inputs for select to authenticated
using (exists (
  select 1 from public.ai_jobs job
  where job.id = job_id and job.actor_id = (select auth.uid())
));
create policy "actors create their ai inputs"
on public.ai_inputs for insert to authenticated
with check (exists (
  select 1 from public.ai_jobs job
  where job.id = job_id and job.actor_id = (select auth.uid())
));
create policy "actors update their ai inputs"
on public.ai_inputs for update to authenticated
using (exists (
  select 1 from public.ai_jobs job
  where job.id = job_id and job.actor_id = (select auth.uid())
))
with check (exists (
  select 1 from public.ai_jobs job
  where job.id = job_id and job.actor_id = (select auth.uid())
));

create policy "actors read their ai proposals"
on public.ai_proposed_actions for select to authenticated
using (exists (
  select 1 from public.ai_jobs job
  where job.id = job_id and job.actor_id = (select auth.uid())
));
create policy "actors create their ai proposals"
on public.ai_proposed_actions for insert to authenticated
with check (
  status in ('awaiting_clarification', 'proposed')
  and version = 1
  and confirmation_request_id is null
  and confirmed_by is null
  and confirmed_at is null
  and rejected_by is null
  and rejected_at is null
  and rejection_reason is null
  and execution_request_id is null
  and execution_result is null
  and execution_error is null
  and executed_at is null
  and not verified
  and exists (
    select 1 from public.ai_jobs job
    where job.id = job_id and job.actor_id = (select auth.uid())
  )
);
create policy "actors update their ai proposals"
on public.ai_proposed_actions for update to authenticated
using (exists (
  select 1 from public.ai_jobs job
  where job.id = job_id and job.actor_id = (select auth.uid())
))
with check (exists (
  select 1 from public.ai_jobs job
  where job.id = job_id and job.actor_id = (select auth.uid())
));

create policy "actors read their ai events"
on public.ai_action_events for select to authenticated
using (exists (
  select 1 from public.ai_jobs job
  where job.id = job_id and job.actor_id = (select auth.uid())
));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-inputs',
  'ai-inputs',
  false,
  20971520,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "actors read their ai input files" on storage.objects;
create policy "actors read their ai input files"
on storage.objects for select to authenticated
using (
  bucket_id = 'ai-inputs'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
drop policy if exists "actors upload their ai input files" on storage.objects;
create policy "actors upload their ai input files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ai-inputs'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
drop policy if exists "actors delete their ai input files" on storage.objects;
create policy "actors delete their ai input files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'ai-inputs'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.append_ai_creation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_job_id uuid;
  v_proposal_id uuid;
  v_actor_id uuid;
begin
  if tg_table_name = 'ai_jobs' then
    v_event_type := 'job_created';
    v_job_id := new.id;
    v_actor_id := new.actor_id;
  elsif tg_table_name = 'ai_inputs' then
    v_event_type := 'input_added';
    v_job_id := new.job_id;
    select actor_id into v_actor_id from public.ai_jobs where id = new.job_id;
  else
    v_event_type := 'proposal_created';
    v_job_id := new.job_id;
    v_proposal_id := new.id;
    select actor_id into v_actor_id from public.ai_jobs where id = new.job_id;
    update public.ai_jobs set status = 'awaiting_confirmation' where id = new.job_id;
  end if;
  insert into public.ai_action_events(job_id, proposed_action_id, actor_id, event_type)
  values (v_job_id, v_proposal_id, v_actor_id, v_event_type);
  return new;
end;
$$;

create trigger trg_ai_job_created_event
after insert on public.ai_jobs
for each row execute function private.append_ai_creation_event();
create trigger trg_ai_input_added_event
after insert on public.ai_inputs
for each row execute function private.append_ai_creation_event();
create trigger trg_ai_proposal_created_event
after insert on public.ai_proposed_actions
for each row execute function private.append_ai_creation_event();

create or replace function private.is_ai_action_authorized(p_action_name text, p_risk_level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from (values
      ('create_daily_booking', 'L2', array['admin', 'rental_sales']::text[]),
      ('check_in_daily_booking', 'L2', array['admin', 'front_desk', 'rental_sales']::text[]),
      ('extend_daily_stay', 'L2', array['admin', 'front_desk', 'rental_sales']::text[]),
      ('record_daily_payment', 'L2', array['admin', 'front_desk', 'rental_sales']::text[]),
      ('check_out_daily_booking', 'L2', array['admin', 'front_desk', 'rental_sales']::text[]),
      ('complete_daily_cleaning', 'L1', array['admin', 'front_desk', 'rental_sales']::text[]),
      ('mark_unit_maintenance', 'L1', array['admin', 'front_desk']::text[]),
      ('cancel_no_show_booking', 'L3', array['admin']::text[]),
      ('transfer_daily_booking', 'L3', array['admin']::text[]),
      ('reverse_daily_payment', 'L3', array['admin']::text[]),
      ('correct_daily_booking', 'L3', array['admin']::text[]),
      ('apply_booking_credit', 'L3', array['admin']::text[]),
      ('record_lease_rent', 'L2', array['admin', 'finance']::text[]),
      ('record_property_fee', 'L2', array['admin', 'finance']::text[]),
      ('record_combined_lease_payment', 'L3', array['admin', 'finance']::text[]),
      ('record_lease_deposit', 'L2', array['admin', 'finance']::text[]),
      ('renew_lease', 'L3', array['admin', 'rental_sales']::text[]),
      ('mark_non_renewal', 'L2', array['admin', 'rental_sales']::text[]),
      ('start_lease_move_out', 'L2', array['admin', 'rental_sales']::text[]),
      ('settle_lease_deposit', 'L3', array['admin', 'finance']::text[]),
      ('terminate_lease', 'L3', array['admin']::text[]),
      ('correct_lease_payment', 'L3', array['admin']::text[]),
      ('create_sale_draft', 'L3', array['admin', 'rental_sales']::text[]),
      ('record_sale_payment', 'L2', array['admin', 'finance']::text[]),
      ('add_sale_installment', 'L3', array['admin', 'rental_sales']::text[]),
      ('update_transfer_status', 'L2', array['admin', 'rental_sales']::text[]),
      ('correct_sale_payment', 'L3', array['admin']::text[]),
      ('terminate_sale_contract', 'L3', array['admin']::text[])
    ) as allowed(action_name, risk_level, roles)
    where allowed.action_name = p_action_name
      and allowed.risk_level = p_risk_level
      and public.current_user_role() = any(allowed.roles)
  );
$$;

create or replace function private.confirm_ai_proposed_action(
  p_proposal_id uuid,
  p_expected_version integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.ai_proposed_actions%rowtype;
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then raise exception 'authenticationRequired' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;

  select proposal.* into v_proposal
  from public.ai_proposed_actions proposal
  join public.ai_jobs job on job.id = proposal.job_id
  where proposal.id = p_proposal_id
    and job.actor_id = v_actor_id
    and (job.project_id is null or public.can_access_project(job.project_id))
  for update of proposal;
  if v_proposal.id is null then raise exception 'proposalNotFound' using errcode = 'P0002'; end if;
  if not private.is_ai_action_authorized(v_proposal.action_name, v_proposal.risk_level) then
    raise exception 'businessActionPermissionDenied' using errcode = '42501';
  end if;

  if v_proposal.confirmation_request_id = p_request_id
    and v_proposal.status in ('confirmed', 'executing', 'executed') then
    return jsonb_build_object('success', true, 'idempotent', true, 'version', v_proposal.version);
  end if;
  if v_proposal.status <> 'proposed' then raise exception 'proposalNotConfirmable'; end if;
  if v_proposal.version <> p_expected_version then raise exception 'proposalVersionChanged'; end if;
  if v_proposal.expires_at <= now() then
    update public.ai_proposed_actions set status = 'expired', version = version + 1 where id = v_proposal.id;
    insert into public.ai_action_events(job_id, proposed_action_id, actor_id, event_type)
      values (v_proposal.job_id, v_proposal.id, v_actor_id, 'expired');
    return jsonb_build_object('success', false, 'error', 'proposalExpired', 'version', v_proposal.version + 1);
  end if;
  if v_proposal.requires_clarification then raise exception 'proposalRequiresClarification'; end if;

  update public.ai_proposed_actions
  set status = 'confirmed', confirmation_request_id = p_request_id,
      confirmed_by = v_actor_id, confirmed_at = now(), version = version + 1
  where id = v_proposal.id
  returning * into v_proposal;
  update public.ai_jobs set status = 'awaiting_confirmation' where id = v_proposal.job_id;
  insert into public.ai_action_events(job_id, proposed_action_id, actor_id, event_type, event_payload)
    values (v_proposal.job_id, v_proposal.id, v_actor_id, 'confirmed', jsonb_build_object('version', v_proposal.version));
  return jsonb_build_object('success', true, 'idempotent', false, 'version', v_proposal.version);
end;
$$;

create or replace function private.claim_ai_action_execution(
  p_proposal_id uuid,
  p_expected_version integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.ai_proposed_actions%rowtype;
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then raise exception 'authenticationRequired' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select proposal.* into v_proposal
  from public.ai_proposed_actions proposal
  join public.ai_jobs job on job.id = proposal.job_id
  where proposal.id = p_proposal_id
    and job.actor_id = v_actor_id
    and (job.project_id is null or public.can_access_project(job.project_id))
  for update of proposal;
  if v_proposal.id is null then raise exception 'proposalNotFound' using errcode = 'P0002'; end if;
  if not private.is_ai_action_authorized(v_proposal.action_name, v_proposal.risk_level) then
    raise exception 'businessActionPermissionDenied' using errcode = '42501';
  end if;
  if v_proposal.execution_request_id = p_request_id
    and v_proposal.status in ('executing', 'executed', 'failed') then
    return jsonb_build_object('success', true, 'idempotent', true, 'status', v_proposal.status, 'version', v_proposal.version);
  end if;
  if v_proposal.status <> 'confirmed' then raise exception 'proposalNotExecutable'; end if;
  if v_proposal.version <> p_expected_version then raise exception 'proposalVersionChanged'; end if;
  if v_proposal.expires_at <= now() then
    update public.ai_proposed_actions set status = 'expired', version = version + 1 where id = v_proposal.id;
    insert into public.ai_action_events(job_id, proposed_action_id, actor_id, event_type)
      values (v_proposal.job_id, v_proposal.id, v_actor_id, 'expired');
    return jsonb_build_object('success', false, 'error', 'proposalExpired', 'version', v_proposal.version + 1);
  end if;

  update public.ai_proposed_actions
  set status = 'executing', execution_request_id = p_request_id, version = version + 1
  where id = v_proposal.id
  returning * into v_proposal;
  update public.ai_jobs set status = 'executing' where id = v_proposal.job_id;
  insert into public.ai_action_events(job_id, proposed_action_id, actor_id, event_type, event_payload)
    values (v_proposal.job_id, v_proposal.id, v_actor_id, 'execution_started', jsonb_build_object('request_id', p_request_id));
  return jsonb_build_object('success', true, 'idempotent', false, 'status', v_proposal.status, 'version', v_proposal.version);
end;
$$;

create or replace function private.complete_ai_action_execution(
  p_proposal_id uuid,
  p_request_id uuid,
  p_success boolean,
  p_verified boolean,
  p_result jsonb default '{}'::jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.ai_proposed_actions%rowtype;
  v_actor_id uuid := (select auth.uid());
  v_status text;
begin
  if v_actor_id is null then raise exception 'authenticationRequired' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'requestIdRequired'; end if;
  if jsonb_typeof(coalesce(p_result, '{}'::jsonb)) <> 'object' then raise exception 'executionResultMustBeObject'; end if;

  select proposal.* into v_proposal
  from public.ai_proposed_actions proposal
  join public.ai_jobs job on job.id = proposal.job_id
  where proposal.id = p_proposal_id
    and job.actor_id = v_actor_id
    and (job.project_id is null or public.can_access_project(job.project_id))
  for update of proposal;
  if v_proposal.id is null then raise exception 'proposalNotFound' using errcode = 'P0002'; end if;
  if not private.is_ai_action_authorized(v_proposal.action_name, v_proposal.risk_level) then
    raise exception 'businessActionPermissionDenied' using errcode = '42501';
  end if;
  if v_proposal.execution_request_id <> p_request_id then raise exception 'requestIdConflict'; end if;
  if v_proposal.status in ('executed', 'failed') then
    return jsonb_build_object('success', true, 'idempotent', true, 'status', v_proposal.status, 'version', v_proposal.version);
  end if;
  if v_proposal.status <> 'executing' then raise exception 'proposalNotExecuting'; end if;
  if p_success and not p_verified then raise exception 'successfulExecutionMustBeVerified'; end if;
  if not p_success and nullif(trim(coalesce(p_error, '')), '') is null then raise exception 'failedExecutionRequiresError'; end if;

  v_status := case when p_success then 'executed' else 'failed' end;
  update public.ai_proposed_actions
  set status = v_status, execution_result = coalesce(p_result, '{}'::jsonb),
      execution_error = case when p_success then null else nullif(trim(coalesce(p_error, '')), '') end,
      executed_at = now(), verified = p_verified, version = version + 1
  where id = v_proposal.id
  returning * into v_proposal;
  update public.ai_jobs job
  set status = case
        when exists (
          select 1 from public.ai_proposed_actions proposal
          where proposal.job_id = job.id and proposal.status = 'failed'
        ) then 'failed'
        when exists (
          select 1 from public.ai_proposed_actions proposal
          where proposal.job_id = job.id and proposal.status = 'executing'
        ) then 'executing'
        when exists (
          select 1 from public.ai_proposed_actions proposal
          where proposal.job_id = job.id
            and proposal.status in ('awaiting_clarification', 'proposed', 'confirmed')
        ) then 'awaiting_confirmation'
        else 'completed'
      end,
      finished_at = case when exists (
        select 1 from public.ai_proposed_actions proposal
        where proposal.job_id = job.id
          and proposal.status in ('awaiting_clarification', 'proposed', 'confirmed', 'executing')
      ) then null else now() end,
      failure_message = case when p_success then failure_message else v_proposal.execution_error end
  where job.id = v_proposal.job_id;
  insert into public.ai_action_events(job_id, proposed_action_id, actor_id, event_type, event_payload)
    values (
      v_proposal.job_id, v_proposal.id, v_actor_id,
      case when p_success then 'executed' else 'failed' end,
      jsonb_build_object('verified', p_verified, 'has_error', v_proposal.execution_error is not null)
    );
  return jsonb_build_object('success', true, 'idempotent', false, 'status', v_status, 'version', v_proposal.version);
end;
$$;

create or replace function private.redact_expired_ai_input(
  p_input_id uuid,
  p_expected_storage_path text default null
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
  select input.* into v_input
  from public.ai_inputs input
  join public.ai_jobs job on job.id = input.job_id
  where input.id = p_input_id
    and job.actor_id = v_actor_id
    and (job.project_id is null or public.can_access_project(job.project_id))
  for update of input;
  if v_input.id is null then raise exception 'aiInputNotFound' using errcode = 'P0002'; end if;
  if v_input.redacted_at is not null then
    return jsonb_build_object('success', true, 'idempotent', true);
  end if;
  if v_input.retention_until > now() then raise exception 'aiInputRetentionNotExpired'; end if;
  if v_input.storage_path is distinct from p_expected_storage_path then raise exception 'aiInputStoragePathChanged'; end if;

  update public.ai_inputs
  set raw_text = null,
      storage_bucket = null,
      storage_path = null,
      original_filename = null,
      mime_type = null,
      file_size_bytes = null,
      extracted_text = null,
      extraction_result = jsonb_build_object('redacted', true),
      redacted_at = now()
  where id = v_input.id;
  insert into public.ai_action_events(job_id, actor_id, event_type, event_payload)
    values (v_input.job_id, v_actor_id, 'input_redacted', jsonb_build_object('input_id', v_input.id));
  return jsonb_build_object('success', true, 'idempotent', false);
end;
$$;

create or replace function private.revise_ai_proposed_action(
  p_proposal_id uuid,
  p_expected_version integer,
  p_action_input jsonb,
  p_before_snapshot jsonb,
  p_before_versions jsonb,
  p_expected_effects jsonb,
  p_warnings jsonb,
  p_requires_clarification boolean,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.ai_proposed_actions%rowtype;
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then raise exception 'authenticationRequired' using errcode = '42501'; end if;
  if jsonb_typeof(p_action_input) <> 'object'
    or jsonb_typeof(p_before_snapshot) <> 'object'
    or jsonb_typeof(p_before_versions) <> 'object'
    or jsonb_typeof(p_expected_effects) <> 'array'
    or jsonb_typeof(p_warnings) <> 'array' then
    raise exception 'invalidProposalRevision';
  end if;
  if p_expires_at <= now() then raise exception 'proposalExpiryMustBeFuture'; end if;

  select proposal.* into v_proposal
  from public.ai_proposed_actions proposal
  join public.ai_jobs job on job.id = proposal.job_id
  where proposal.id = p_proposal_id
    and job.actor_id = v_actor_id
    and (job.project_id is null or public.can_access_project(job.project_id))
  for update of proposal;
  if v_proposal.id is null then raise exception 'proposalNotFound' using errcode = 'P0002'; end if;
  if not private.is_ai_action_authorized(v_proposal.action_name, v_proposal.risk_level) then
    raise exception 'businessActionPermissionDenied' using errcode = '42501';
  end if;
  if v_proposal.status not in ('awaiting_clarification', 'proposed') then raise exception 'proposalNotEditable'; end if;
  if v_proposal.version <> p_expected_version then raise exception 'proposalVersionChanged'; end if;

  update public.ai_proposed_actions
  set action_input = p_action_input,
      before_snapshot = p_before_snapshot,
      before_versions = p_before_versions,
      expected_effects = p_expected_effects,
      warnings = p_warnings,
      requires_clarification = p_requires_clarification,
      status = case when p_requires_clarification then 'awaiting_clarification' else 'proposed' end,
      expires_at = p_expires_at,
      version = version + 1
  where id = v_proposal.id
  returning * into v_proposal;
  insert into public.ai_action_events(job_id, proposed_action_id, actor_id, event_type, event_payload)
    values (
      v_proposal.job_id, v_proposal.id, v_actor_id, 'proposal_edited',
      jsonb_build_object('version', v_proposal.version, 'requires_clarification', p_requires_clarification)
    );
  return jsonb_build_object('success', true, 'version', v_proposal.version, 'status', v_proposal.status);
end;
$$;

create or replace function private.reject_ai_proposed_action(
  p_proposal_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.ai_proposed_actions%rowtype;
  v_actor_id uuid := (select auth.uid());
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_actor_id is null then raise exception 'authenticationRequired' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'rejectionReasonRequired'; end if;
  select proposal.* into v_proposal
  from public.ai_proposed_actions proposal
  join public.ai_jobs job on job.id = proposal.job_id
  where proposal.id = p_proposal_id
    and job.actor_id = v_actor_id
    and (job.project_id is null or public.can_access_project(job.project_id))
  for update of proposal;
  if v_proposal.id is null then raise exception 'proposalNotFound' using errcode = 'P0002'; end if;
  if v_proposal.status = 'rejected' then
    return jsonb_build_object('success', true, 'idempotent', true, 'version', v_proposal.version);
  end if;
  if v_proposal.status not in ('awaiting_clarification', 'proposed', 'confirmed') then raise exception 'proposalNotRejectable'; end if;
  if v_proposal.version <> p_expected_version then raise exception 'proposalVersionChanged'; end if;

  update public.ai_proposed_actions
  set status = 'rejected', rejected_by = v_actor_id, rejected_at = now(),
      rejection_reason = v_reason, version = version + 1
  where id = v_proposal.id
  returning * into v_proposal;
  insert into public.ai_action_events(job_id, proposed_action_id, actor_id, event_type, event_payload)
    values (v_proposal.job_id, v_proposal.id, v_actor_id, 'rejected', jsonb_build_object('version', v_proposal.version));
  update public.ai_jobs job
  set status = case when exists (
        select 1 from public.ai_proposed_actions proposal
        where proposal.job_id = job.id
          and proposal.status in ('awaiting_clarification', 'proposed', 'confirmed', 'executing')
      ) then 'awaiting_confirmation' else 'completed' end,
      finished_at = case when exists (
        select 1 from public.ai_proposed_actions proposal
        where proposal.job_id = job.id
          and proposal.status in ('awaiting_clarification', 'proposed', 'confirmed', 'executing')
      ) then null else now() end
  where job.id = v_proposal.job_id;
  return jsonb_build_object('success', true, 'idempotent', false, 'version', v_proposal.version);
end;
$$;

create or replace function public.confirm_ai_proposed_action(p_proposal_id uuid, p_expected_version integer, p_request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as 'select private.confirm_ai_proposed_action($1, $2, $3)';
create or replace function public.claim_ai_action_execution(p_proposal_id uuid, p_expected_version integer, p_request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as 'select private.claim_ai_action_execution($1, $2, $3)';
create or replace function public.complete_ai_action_execution(
  p_proposal_id uuid, p_request_id uuid, p_success boolean, p_verified boolean, p_result jsonb, p_error text
)
returns jsonb language sql security invoker set search_path = ''
as 'select private.complete_ai_action_execution($1, $2, $3, $4, $5, $6)';
create or replace function public.redact_expired_ai_input(p_input_id uuid, p_expected_storage_path text)
returns jsonb language sql security invoker set search_path = ''
as 'select private.redact_expired_ai_input($1, $2)';
create or replace function public.revise_ai_proposed_action(
  p_proposal_id uuid, p_expected_version integer, p_action_input jsonb,
  p_before_snapshot jsonb, p_before_versions jsonb, p_expected_effects jsonb,
  p_warnings jsonb, p_requires_clarification boolean, p_expires_at timestamptz
)
returns jsonb language sql security invoker set search_path = ''
as 'select private.revise_ai_proposed_action($1, $2, $3, $4, $5, $6, $7, $8, $9)';
create or replace function public.reject_ai_proposed_action(p_proposal_id uuid, p_expected_version integer, p_reason text)
returns jsonb language sql security invoker set search_path = ''
as 'select private.reject_ai_proposed_action($1, $2, $3)';

revoke all on function private.append_ai_creation_event() from public, anon, authenticated;
revoke all on function private.is_ai_action_authorized(text, text) from public, anon, authenticated;
revoke all on function private.confirm_ai_proposed_action(uuid, integer, uuid) from public, anon;
revoke all on function private.claim_ai_action_execution(uuid, integer, uuid) from public, anon;
revoke all on function private.complete_ai_action_execution(uuid, uuid, boolean, boolean, jsonb, text) from public, anon;
revoke all on function private.redact_expired_ai_input(uuid, text) from public, anon;
revoke all on function private.revise_ai_proposed_action(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, timestamptz) from public, anon;
revoke all on function private.reject_ai_proposed_action(uuid, integer, text) from public, anon;
grant execute on function private.confirm_ai_proposed_action(uuid, integer, uuid) to authenticated;
grant execute on function private.claim_ai_action_execution(uuid, integer, uuid) to authenticated;
grant execute on function private.complete_ai_action_execution(uuid, uuid, boolean, boolean, jsonb, text) to authenticated;
grant execute on function private.redact_expired_ai_input(uuid, text) to authenticated;
grant execute on function private.revise_ai_proposed_action(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, timestamptz) to authenticated;
grant execute on function private.reject_ai_proposed_action(uuid, integer, text) to authenticated;

revoke all on function public.confirm_ai_proposed_action(uuid, integer, uuid) from public, anon;
revoke all on function public.claim_ai_action_execution(uuid, integer, uuid) from public, anon;
revoke all on function public.complete_ai_action_execution(uuid, uuid, boolean, boolean, jsonb, text) from public, anon;
revoke all on function public.redact_expired_ai_input(uuid, text) from public, anon;
revoke all on function public.revise_ai_proposed_action(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, timestamptz) from public, anon;
revoke all on function public.reject_ai_proposed_action(uuid, integer, text) from public, anon;
grant execute on function public.confirm_ai_proposed_action(uuid, integer, uuid) to authenticated;
grant execute on function public.claim_ai_action_execution(uuid, integer, uuid) to authenticated;
grant execute on function public.complete_ai_action_execution(uuid, uuid, boolean, boolean, jsonb, text) to authenticated;
grant execute on function public.redact_expired_ai_input(uuid, text) to authenticated;
grant execute on function public.revise_ai_proposed_action(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, timestamptz) to authenticated;
grant execute on function public.reject_ai_proposed_action(uuid, integer, text) to authenticated;

commit;
