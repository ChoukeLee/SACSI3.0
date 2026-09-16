begin;

-- The live schema contains this table although historical repository migrations
-- do not. Apply against the audited full baseline, not the payment-only fixture.
-- Align with finance:write (admin/finance), admin-only deletion, and project scope.
alter table public.property_fee_rules enable row level security;
drop policy "Authenticated can read property fee rules" on public.property_fee_rules;
drop policy "Authenticated can write property fee rules" on public.property_fee_rules;

create policy "app roles read property fee rules" on public.property_fee_rules
for select to authenticated
using (public.has_app_role('admin','boss','finance','front_desk','rental_sales')
  and public.can_access_unit(unit_id));

create policy "finance inserts property fee rules" on public.property_fee_rules
for insert to authenticated
with check (public.has_app_role('admin','finance') and public.can_access_unit(unit_id));

create policy "finance updates property fee rules" on public.property_fee_rules
for update to authenticated
using (public.has_app_role('admin','finance') and public.can_access_unit(unit_id))
with check (public.has_app_role('admin','finance') and public.can_access_unit(unit_id));

create policy "admin deletes property fee rules" on public.property_fee_rules
for delete to authenticated
using (public.has_app_role('admin') and public.can_access_unit(unit_id));

commit;
