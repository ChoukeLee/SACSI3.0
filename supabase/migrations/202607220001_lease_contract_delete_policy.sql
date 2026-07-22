-- Deletion is initiated only by application server actions protected by requireRole("admin").
-- The original RLS migration accidentally omitted the lease-contract DELETE policy.
drop policy if exists "Authenticated can delete lease_contracts" on public.lease_contracts;

create policy "Authenticated can delete lease_contracts"
  on public.lease_contracts for delete
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@sacsi.com');
