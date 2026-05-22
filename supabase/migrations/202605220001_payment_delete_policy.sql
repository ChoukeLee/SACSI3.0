-- Allow authenticated users to delete payments and ledger entries
-- (application-level checks enforce business rules)

create policy "Authenticated can delete payments"
  on public.payments for delete
  using (auth.role() = 'authenticated');

create policy "Authenticated can delete ledger_entries"
  on public.ledger_entries for delete
  using (auth.role() = 'authenticated');
