begin;

drop policy if exists "actors create their ai conversations" on public.ai_conversations;
create policy "actors create their ai conversations"
on public.ai_conversations for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and status = 'active'
  and public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales')
);

commit;
