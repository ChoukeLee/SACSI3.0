-- Harden application authorization at the database boundary.
-- UI and Server Action checks remain defense-in-depth; RLS is authoritative.

alter type public.user_role add value if not exists 'rental_sales';

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case lower(coalesce(auth.jwt() ->> 'email', ''))
    when 'admin@sacsi.com' then 'admin'
    when 'boss@sacsi.com' then 'boss'
    when 'finance@sacsi.com' then 'finance'
    when 'front@sacsi.com' then 'front_desk'
    when 'ying@sacsi.com' then 'rental_sales'
    else (
      select role::text
      from public.user_profiles
      where id = auth.uid()
    )
  end;
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated, service_role;

create or replace function public.has_app_role(variadic allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or coalesce(public.current_user_role() = any(allowed_roles), false);
$$;

revoke all on function public.has_app_role(text[]) from public;
grant execute on function public.has_app_role(text[]) to authenticated, service_role;

-- Remove legacy policies that treated every authenticated account as a
-- fully trusted database writer. Recreate the complete policy set below.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'buildings', 'units', 'unit_business_flags', 'customers',
        'daily_bookings', 'lease_contracts', 'sale_contracts',
        'sale_payment_schedule', 'payments', 'ledger_entries',
        'cleaning_tasks', 'notifications', 'audit_logs', 'user_profiles',
        'receivables', 'lease_settlements', 'attachments',
        'system_settings', 'business_targets'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

-- Reference and operational reads.
create policy "app roles read buildings" on public.buildings for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read units" on public.units for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read unit flags" on public.unit_business_flags for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read customers" on public.customers for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read daily bookings" on public.daily_bookings for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read leases" on public.lease_contracts for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read sales" on public.sale_contracts for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read sale schedules" on public.sale_payment_schedule for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read payments" on public.payments for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read ledger" on public.ledger_entries for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read cleaning" on public.cleaning_tasks for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read receivables" on public.receivables for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read settlements" on public.lease_settlements for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "finance roles read attachments" on public.attachments for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance'));
create policy "app roles read settings" on public.system_settings for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));
create policy "app roles read targets" on public.business_targets for select to authenticated
  using (public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales'));

-- Buildings, settings, targets and profiles.
create policy "admin manages buildings" on public.buildings for all to authenticated
  using (public.has_app_role('admin'))
  with check (public.has_app_role('admin'));
create policy "admin manages unit flags" on public.unit_business_flags for all to authenticated
  using (public.has_app_role('admin'))
  with check (public.has_app_role('admin'));
create policy "admin manages settings" on public.system_settings for all to authenticated
  using (public.has_app_role('admin'))
  with check (public.has_app_role('admin'));
create policy "management manages targets" on public.business_targets for all to authenticated
  using (public.has_app_role('admin', 'boss'))
  with check (public.has_app_role('admin', 'boss'));
create policy "users read own profile" on public.user_profiles for select to authenticated
  using (id = auth.uid() or public.has_app_role('admin'));
create policy "admin manages profiles" on public.user_profiles for all to authenticated
  using (public.has_app_role('admin'))
  with check (public.has_app_role('admin'));

-- Unit and customer maintenance.
create policy "operations insert units" on public.units for insert to authenticated
  with check (public.has_app_role('admin', 'front_desk', 'rental_sales'));
create policy "operations update units" on public.units for update to authenticated
  using (public.has_app_role('admin', 'front_desk', 'rental_sales'))
  with check (public.has_app_role('admin', 'front_desk', 'rental_sales'));
create policy "admin deletes units" on public.units for delete to authenticated
  using (public.has_app_role('admin'));

create policy "customer operators insert customers" on public.customers for insert to authenticated
  with check (public.has_app_role('admin', 'finance', 'front_desk', 'rental_sales'));
create policy "customer operators update customers" on public.customers for update to authenticated
  using (public.has_app_role('admin', 'finance', 'front_desk', 'rental_sales'))
  with check (public.has_app_role('admin', 'finance', 'front_desk', 'rental_sales'));
create policy "admin deletes customers" on public.customers for delete to authenticated
  using (public.has_app_role('admin'));

-- Daily-rental creation must use the atomic RPC for non-admin operators.
create policy "admin inserts daily bookings directly" on public.daily_bookings for insert to authenticated
  with check (public.has_app_role('admin'));
create policy "daily operators update daily bookings" on public.daily_bookings for update to authenticated
  using (public.has_app_role('admin', 'front_desk', 'rental_sales'))
  with check (public.has_app_role('admin', 'front_desk', 'rental_sales'));
create policy "admin deletes daily bookings" on public.daily_bookings for delete to authenticated
  using (public.has_app_role('admin'));

create or replace function public.enforce_daily_cancel_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'cancelled'
    and not public.has_app_role('admin')
  then
    raise exception 'dailyCancelPermissionDenied' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_daily_cancel_role on public.daily_bookings;
create trigger trg_daily_cancel_role
before update of status on public.daily_bookings
for each row execute function public.enforce_daily_cancel_role();

-- Rental/sales agents own contract structure; finance owns payment effects.
create policy "rental sales manages leases" on public.lease_contracts for insert to authenticated
  with check (public.has_app_role('admin', 'rental_sales'));
create policy "rental sales updates leases" on public.lease_contracts for update to authenticated
  using (public.has_app_role('admin', 'rental_sales'))
  with check (public.has_app_role('admin', 'rental_sales'));
create policy "admin deletes leases" on public.lease_contracts for delete to authenticated
  using (public.has_app_role('admin'));

create policy "rental sales manages sales" on public.sale_contracts for insert to authenticated
  with check (public.has_app_role('admin', 'rental_sales'));
create policy "rental sales updates sales" on public.sale_contracts for update to authenticated
  using (public.has_app_role('admin', 'rental_sales'))
  with check (public.has_app_role('admin', 'rental_sales'));
create policy "admin deletes sales" on public.sale_contracts for delete to authenticated
  using (public.has_app_role('admin'));

create policy "sale operators insert schedules" on public.sale_payment_schedule for insert to authenticated
  with check (public.has_app_role('admin', 'finance', 'rental_sales'));
create policy "sale operators update schedules" on public.sale_payment_schedule for update to authenticated
  using (public.has_app_role('admin', 'finance', 'rental_sales'))
  with check (public.has_app_role('admin', 'finance', 'rental_sales'));
create policy "admin deletes schedules" on public.sale_payment_schedule for delete to authenticated
  using (public.has_app_role('admin'));

-- Finance writes. Front desk/rental sales are restricted to daily-rental
-- sources required by their operational workflow.
create policy "finance or daily operators insert payments" on public.payments for insert to authenticated
  with check (
    public.has_app_role('admin', 'finance')
    or (
      public.has_app_role('front_desk', 'rental_sales')
      and source_type = 'daily_booking'
    )
  );
create policy "finance updates payments" on public.payments for update to authenticated
  using (public.has_app_role('admin', 'finance'))
  with check (public.has_app_role('admin', 'finance'));
create policy "authorized reversals delete payments" on public.payments for delete to authenticated
  using (
    public.has_app_role('admin', 'finance')
    or (
      public.has_app_role('front_desk', 'rental_sales')
      and source_type = 'daily_booking'
    )
  );

create policy "finance or daily operators insert ledger" on public.ledger_entries for insert to authenticated
  with check (
    public.has_app_role('admin', 'finance')
    or (
      public.has_app_role('front_desk', 'rental_sales')
      and category = 'daily_rental'
    )
  );
create policy "finance updates ledger" on public.ledger_entries for update to authenticated
  using (public.has_app_role('admin', 'finance'))
  with check (public.has_app_role('admin', 'finance'));
create policy "admin deletes ledger" on public.ledger_entries for delete to authenticated
  using (public.has_app_role('admin'));

create policy "finance or daily operators insert receivables" on public.receivables for insert to authenticated
  with check (
    public.has_app_role('admin', 'finance')
    or (
      public.has_app_role('front_desk', 'rental_sales')
      and source_type = 'daily_booking'
    )
  );
create policy "finance or daily operators update receivables" on public.receivables for update to authenticated
  using (
    public.has_app_role('admin', 'finance')
    or (
      public.has_app_role('front_desk', 'rental_sales')
      and source_type = 'daily_booking'
    )
  )
  with check (
    public.has_app_role('admin', 'finance')
    or (
      public.has_app_role('front_desk', 'rental_sales')
      and source_type = 'daily_booking'
    )
  );
create policy "admin deletes receivables" on public.receivables for delete to authenticated
  using (public.has_app_role('admin'));

create policy "rental sales manages settlements" on public.lease_settlements for insert to authenticated
  with check (public.has_app_role('admin', 'rental_sales'));
create policy "rental sales updates settlements" on public.lease_settlements for update to authenticated
  using (public.has_app_role('admin', 'rental_sales'))
  with check (public.has_app_role('admin', 'rental_sales'));
create policy "admin deletes settlements" on public.lease_settlements for delete to authenticated
  using (public.has_app_role('admin'));

-- Cleaning, notifications, attachments and auditing.
create policy "daily operators insert cleaning" on public.cleaning_tasks for insert to authenticated
  with check (public.has_app_role('admin', 'front_desk', 'rental_sales'));
create policy "daily operators update cleaning" on public.cleaning_tasks for update to authenticated
  using (public.has_app_role('admin', 'front_desk', 'rental_sales'))
  with check (public.has_app_role('admin', 'front_desk', 'rental_sales'));
create policy "admin deletes cleaning" on public.cleaning_tasks for delete to authenticated
  using (public.has_app_role('admin'));

create policy "users read own notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "app roles create notifications" on public.notifications for insert to authenticated
  with check (public.has_app_role('admin', 'finance', 'front_desk', 'rental_sales'));
create policy "users update own notifications" on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "users delete own notifications" on public.notifications for delete to authenticated
  using (user_id = auth.uid());

create policy "finance uploads attachments" on public.attachments for insert to authenticated
  with check (public.has_app_role('admin', 'finance') and uploaded_by = auth.uid());
create policy "finance updates attachments" on public.attachments for update to authenticated
  using (public.has_app_role('admin', 'finance'))
  with check (public.has_app_role('admin', 'finance'));
create policy "admin deletes attachments" on public.attachments for delete to authenticated
  using (public.has_app_role('admin'));

create policy "app roles insert audit logs" on public.audit_logs for insert to authenticated
  with check (
    public.has_app_role('admin', 'boss', 'finance', 'front_desk', 'rental_sales')
    and actor_id = auth.uid()
  );
create policy "management reads all audit logs" on public.audit_logs for select to authenticated
  using (public.has_app_role('admin', 'boss'));
create policy "finance reads financial audit logs" on public.audit_logs for select to authenticated
  using (
    public.has_app_role('finance')
    and entity_type in (
      'payment', 'receivable', 'ledger_entry', 'lease_contract',
      'sale_contract', 'daily_booking'
    )
  );
create policy "rental sales reads operational audit logs" on public.audit_logs for select to authenticated
  using (
    public.has_app_role('rental_sales')
    and entity_type in (
      'unit', 'customer', 'lease_contract', 'sale_contract',
      'daily_booking', 'cleaning_task', 'payment'
    )
  );

-- Never trust actor identifiers supplied by clients or RPC payloads.
create or replace function public.set_authenticated_audit_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    new.actor_id := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.set_authenticated_audit_actor() from public;

drop trigger if exists trg_set_authenticated_audit_actor on public.audit_logs;
create trigger trg_set_authenticated_audit_actor
before insert on public.audit_logs
for each row execute function public.set_authenticated_audit_actor();

-- Storage receipt uploads are finance-only. Authorized app roles may read
-- receipt objects through short-lived signed URLs.
drop policy if exists "Authenticated users can read receipts" on storage.objects;
drop policy if exists "Authenticated users can upload receipts" on storage.objects;
drop policy if exists "Uploader or admin can delete receipts" on storage.objects;

create policy "finance roles read receipts"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and public.has_app_role('admin', 'boss', 'finance')
  );
create policy "finance uploads receipts"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.has_app_role('admin', 'finance')
  );
create policy "admin deletes receipts"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.has_app_role('admin'));

-- Existing functions historically inherited EXECUTE for PUBLIC.
alter default privileges in schema public revoke execute on functions from public;

revoke all on function public.daily_booking_operation_snapshot(uuid, uuid) from public, anon;
revoke all on function public.daily_resolve_unit_status(uuid, uuid) from public, anon;
revoke all on function public.daily_confirm_booking_rpc(uuid, jsonb) from public, anon;
revoke all on function public.daily_check_in_booking_rpc(uuid, numeric, jsonb) from public, anon;
revoke all on function public.daily_check_out_booking_rpc(
  uuid, date, numeric, numeric, text, public.unit_status, jsonb
) from public, anon;
revoke all on function public.daily_complete_cleaning_rpc(uuid, jsonb) from public, anon;
revoke all on function public.daily_cancel_booking_rpc(uuid, jsonb) from public, anon;
revoke all on function public.daily_create_booking_rpc(
  uuid, uuid, date, date, text, numeric, text, text, uuid, jsonb
) from public, anon;
revoke all on function public.confirm_receipt_payment(jsonb) from public, anon;

grant execute on function public.daily_booking_operation_snapshot(uuid, uuid) to authenticated, service_role;
grant execute on function public.daily_resolve_unit_status(uuid, uuid) to authenticated, service_role;
grant execute on function public.daily_confirm_booking_rpc(uuid, jsonb) to authenticated, service_role;
grant execute on function public.daily_check_in_booking_rpc(uuid, numeric, jsonb) to authenticated, service_role;
grant execute on function public.daily_check_out_booking_rpc(
  uuid, date, numeric, numeric, text, public.unit_status, jsonb
) to authenticated, service_role;
grant execute on function public.daily_complete_cleaning_rpc(uuid, jsonb) to authenticated, service_role;
grant execute on function public.daily_cancel_booking_rpc(uuid, jsonb) to authenticated, service_role;
grant execute on function public.daily_create_booking_rpc(
  uuid, uuid, date, date, text, numeric, text, text, uuid, jsonb
) to authenticated, service_role;
grant execute on function public.confirm_receipt_payment(jsonb) to authenticated, service_role;

-- Every daily operation returns this snapshot. The guard therefore rolls
-- back unauthorized SECURITY DEFINER operations before they can commit.
create or replace function public.daily_booking_operation_snapshot(
  p_booking_id uuid,
  p_unit_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking daily_bookings%rowtype;
  v_unit_id uuid;
  v_unit jsonb;
begin
  if not public.has_app_role('admin', 'front_desk', 'rental_sales') then
    raise exception 'dailyWritePermissionDenied' using errcode = '42501';
  end if;

  select * into v_booking from public.daily_bookings where id = p_booking_id;
  v_unit_id := coalesce(v_booking.unit_id, p_unit_id);

  if v_unit_id is not null then
    select to_jsonb(u) into v_unit from public.units u where u.id = v_unit_id;
  end if;

  return jsonb_build_object(
    'booking', case when v_booking.id is null then null else to_jsonb(v_booking) end,
    'unit', coalesce(v_unit, 'null'::jsonb),
    'receivables', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.due_date desc, r.created_at desc)
      from public.receivables r
      where r.source_type = 'daily_booking' and r.source_id = p_booking_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.payment_date desc, p.created_at desc)
      from public.payments p
      where p.source_type = 'daily_booking' and p.source_id = p_booking_id
    ), '[]'::jsonb),
    'cleaningTasks', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from public.cleaning_tasks c
      where c.unit_id = v_unit_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Cancellation is an admin-only operation even though other daily operators
-- may confirm, check in, check out and complete cleaning.
create or replace function public.daily_cancel_booking_rpc(
  p_booking_id uuid,
  p_actor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking daily_bookings%rowtype;
  v_next_status public.unit_status;
begin
  if not public.has_app_role('admin') then
    raise exception 'dailyCancelPermissionDenied' using errcode = '42501';
  end if;

  select * into v_booking
  from public.daily_bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then raise exception 'bookingNotFound'; end if;
  if v_booking.status not in ('pending_review', 'confirmed') then
    raise exception 'bookingCannotBeCancelled';
  end if;

  update public.daily_bookings
  set status = 'cancelled',
      prepaid_amount_xof = 0,
      updated_at = now()
  where id = p_booking_id;

  update public.receivables
  set status = 'cancelled',
      updated_at = now()
  where source_type = 'daily_booking'
    and source_id = p_booking_id;

  v_next_status := public.daily_resolve_unit_status(v_booking.unit_id, p_booking_id);
  update public.units
  set status = v_next_status,
      updated_at = now()
  where id = v_booking.unit_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'cancel',
    'daily_booking',
    p_booking_id,
    p_actor || jsonb_build_object('next_status', v_next_status)
  );

  return public.daily_booking_operation_snapshot(p_booking_id, v_booking.unit_id);
end;
$$;
