begin;

-- Reviewed lease references remain separate from contracts, receipts and receivables.
create table public.asset_operation_lease_evidence (
  asset_id uuid primary key references public.asset_operation_assets(id),
  evidence jsonb not null check (
    jsonb_typeof(evidence) = 'object'
    and evidence ? 'assetSourceRef'
    and jsonb_typeof(evidence -> 'assetSourceRef') = 'string'
  ),
  reviewed_on date not null,
  batch_id uuid not null,
  imported_at timestamptz not null default now()
);

alter table public.asset_operation_lease_evidence enable row level security;
revoke all on public.asset_operation_lease_evidence from public, anon, authenticated, service_role;
grant select on public.asset_operation_lease_evidence to authenticated;

create policy asset_operation_lease_evidence_read
  on public.asset_operation_lease_evidence for select to authenticated
  using (exists (
    select 1 from public.asset_operation_assets a
    where a.id = asset_operation_lease_evidence.asset_id
  ));

comment on table public.asset_operation_lease_evidence is
  'Source-backed rent references, coverage and follow-up facts, read under the parent asset role and project policy.';

commit;
