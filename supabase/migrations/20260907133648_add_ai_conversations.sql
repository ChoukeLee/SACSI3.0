begin;

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  locale text not null default 'zh' check (locale in ('zh', 'fr')),
  title text not null default 'AI Workbench' check (char_length(title) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'archived')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_conversation_turns (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  actor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid references public.ai_jobs(id) on delete set null,
  turn_kind text not null check (turn_kind in ('query', 'action_draft', 'receipt', 'action_result', 'error')),
  user_text text not null check (char_length(user_text) between 1 and 2000),
  assistant_text text not null check (char_length(assistant_text) between 1 and 4000),
  context_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(context_snapshot) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.ai_jobs
  add column conversation_id uuid references public.ai_conversations(id) on delete set null;

comment on table public.ai_conversations is
  'User-owned AI Workbench conversations. Conversation context is never execution authority.';
comment on table public.ai_conversation_turns is
  'Bounded user/assistant turn summaries. Stored context may guide parsing but every business action must be re-authorized and re-verified.';
comment on column public.ai_conversation_turns.context_snapshot is
  'Minimal structured references from the turn; never trusted as authorization or as a business-record snapshot.';

create index ai_conversations_actor_recent_idx
  on public.ai_conversations (actor_id, status, last_message_at desc);
create index ai_conversation_turns_conversation_recent_idx
  on public.ai_conversation_turns (conversation_id, created_at desc, id desc);
create index ai_jobs_conversation_created_idx
  on public.ai_jobs (conversation_id, created_at desc)
  where conversation_id is not null;

create trigger trg_touch_ai_conversations
before update on public.ai_conversations
for each row execute function public.touch_ai_record_updated_at();

alter table public.ai_conversations enable row level security;
alter table public.ai_conversation_turns enable row level security;

revoke all on table public.ai_conversations, public.ai_conversation_turns from anon, authenticated;
grant select, insert, update on table public.ai_conversations to authenticated;
grant select, insert on table public.ai_conversation_turns to authenticated;
grant usage, select on sequence public.ai_conversation_turns_id_seq to authenticated;
grant all on table public.ai_conversations, public.ai_conversation_turns to service_role;
grant all on sequence public.ai_conversation_turns_id_seq to service_role;

create policy "actors read their ai conversations"
on public.ai_conversations for select to authenticated
using (actor_id = (select auth.uid()));

create policy "actors create their ai conversations"
on public.ai_conversations for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and status = 'active'
  and public.has_app_role('admin', 'boss', 'finance', 'rental_sales')
);

create policy "actors update their ai conversations"
on public.ai_conversations for update to authenticated
using (actor_id = (select auth.uid()))
with check (actor_id = (select auth.uid()));

create policy "actors read their ai conversation turns"
on public.ai_conversation_turns for select to authenticated
using (
  actor_id = (select auth.uid())
  and exists (
    select 1
    from public.ai_conversations conversation
    where conversation.id = conversation_id
      and conversation.actor_id = (select auth.uid())
  )
);

create policy "actors create their ai conversation turns"
on public.ai_conversation_turns for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and exists (
    select 1
    from public.ai_conversations conversation
    where conversation.id = conversation_id
      and conversation.actor_id = (select auth.uid())
      and conversation.status = 'active'
  )
  and (
    job_id is null
    or exists (
      select 1
      from public.ai_jobs job
      where job.id = job_id
        and job.actor_id = (select auth.uid())
    )
  )
);

drop policy if exists "actors create their ai jobs" on public.ai_jobs;
create policy "actors create their ai jobs"
on public.ai_jobs for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and actor_role = public.current_user_role()
  and public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales')
  and (project_id is null or public.can_access_project(project_id))
  and (
    conversation_id is null
    or exists (
      select 1
      from public.ai_conversations conversation
      where conversation.id = conversation_id
        and conversation.actor_id = (select auth.uid())
        and conversation.status = 'active'
    )
  )
  and status = 'input_received'
  and failure_code is null
  and failure_message is null
  and finished_at is null
);

drop policy if exists "actors update their ai jobs" on public.ai_jobs;
create policy "actors update their ai jobs"
on public.ai_jobs for update to authenticated
using (
  actor_id = (select auth.uid())
  and (project_id is null or public.can_access_project(project_id))
)
with check (
  actor_id = (select auth.uid())
  and (project_id is null or public.can_access_project(project_id))
  and (
    conversation_id is null
    or exists (
      select 1
      from public.ai_conversations conversation
      where conversation.id = conversation_id
        and conversation.actor_id = (select auth.uid())
    )
  )
);

commit;
