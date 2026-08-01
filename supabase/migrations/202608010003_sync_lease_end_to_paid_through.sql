-- The latest paid-through date is SACSI's operationally confirmed lease end.
-- Keep the contract end date synchronized for every building.

begin;

update public.lease_contracts
set expected_end_date = paid_through_date,
    expected_end_confirmed = true,
    updated_at = now()
where status = 'active'
  and paid_through_date is not null
  and (
    expected_end_date is distinct from paid_through_date
    or expected_end_confirmed is distinct from true
  );

create or replace function public.sync_lease_end_to_paid_through()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('draft', 'active') and new.paid_through_date is not null then
    new.expected_end_date := new.paid_through_date;
    new.expected_end_confirmed := true;
  end if;
  return new;
end;
$$;

drop trigger if exists lease_end_follows_paid_through on public.lease_contracts;
create trigger lease_end_follows_paid_through
before insert or update of paid_through_date, status on public.lease_contracts
for each row execute function public.sync_lease_end_to_paid_through();

comment on column public.lease_contracts.expected_end_confirmed is
  'True when expected_end_date is confirmed from the latest registered paid-through date.';

commit;
