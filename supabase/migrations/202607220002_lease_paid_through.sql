alter table public.lease_contracts
  add column if not exists expected_end_confirmed boolean not null default true,
  add column if not exists paid_through_date date;

comment on column public.lease_contracts.expected_end_confirmed is
  'Whether expected_end_date comes from a confirmed contract rather than a legacy placeholder.';

comment on column public.lease_contracts.paid_through_date is
  'Latest date through which rent has been confirmed as paid.';
