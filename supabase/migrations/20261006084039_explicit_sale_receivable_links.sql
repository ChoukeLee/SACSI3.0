begin;
alter table public.sale_payment_schedule add column receivable_id uuid references public.receivables(id);
create unique index sale_schedule_receivable_identity on public.sale_payment_schedule(receivable_id) where receivable_id is not null;

-- Historical linking is structural only: exactly one candidate in BOTH directions.
with candidates as (
  select s.id schedule_id,r.id receivable_id,
    count(*) over(partition by s.id) schedule_matches,
    count(*) over(partition by r.id) receivable_matches
  from public.sale_payment_schedule s join public.sale_contracts c on c.id=s.sale_contract_id
  join public.receivables r on r.source_type='sale_contract' and r.source_id=c.id
    and r.category=case when c.payment_plan_type='lump_sum' then 'sale_lump_sum' else 'sale_installment' end
    and r.due_date=s.due_date and r.amount_xof=s.amount_xof
    and r.status<>'cancelled' and s.status<>'cancelled'
) update public.sale_payment_schedule s set receivable_id=c.receivable_id
from candidates c where s.id=c.schedule_id and c.schedule_matches=1 and c.receivable_matches=1;

create function private.validate_sale_receivable_link() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.receivable_id is not null and not exists(select 1 from public.receivables r
    join public.sale_contracts c on c.id=new.sale_contract_id
    where r.id=new.receivable_id and r.source_type='sale_contract' and r.source_id=c.id
      and r.unit_id=c.unit_id and r.due_date=new.due_date and r.amount_xof=new.amount_xof
      and r.category=case when c.payment_plan_type='lump_sum' then 'sale_lump_sum' else 'sale_installment' end)
  then raise exception 'saleReceivableLinkMismatch'; end if;
  return new;
end; $$;
revoke all on function private.validate_sale_receivable_link() from public,anon,authenticated;
create trigger validate_sale_receivable_link before insert or update on public.sale_payment_schedule
  for each row execute function private.validate_sale_receivable_link();

-- Existing creation workflows insert a schedule, then its receivable. Link before commit.
create function private.link_new_sale_receivable() returns trigger
language plpgsql security definer set search_path='' as $$
declare schedule uuid;
begin
  if new.source_type<>'sale_contract' or new.status='cancelled' then return new; end if;
  select min(s.id::text)::uuid into schedule from public.sale_payment_schedule s
    join public.sale_contracts c on c.id=s.sale_contract_id
    where s.sale_contract_id=new.source_id and s.due_date=new.due_date and s.amount_xof=new.amount_xof
      and s.status<>'cancelled' and s.receivable_id is null
      and new.category=case when c.payment_plan_type='lump_sum' then 'sale_lump_sum' else 'sale_installment' end
      and new.unit_id=c.unit_id
    having count(*)=1;
  if schedule is not null and (select count(*) from public.receivables r where r.source_type=new.source_type
    and r.source_id=new.source_id and r.category=new.category and r.due_date=new.due_date and r.amount_xof=new.amount_xof and r.status<>'cancelled')=1
  then update public.sale_payment_schedule set receivable_id=new.id where id=schedule; end if;
  return new;
end; $$;
revoke all on function private.link_new_sale_receivable() from public,anon,authenticated;
create trigger link_new_sale_receivable after insert on public.receivables
  for each row execute function private.link_new_sale_receivable();

create table public.payment_receivable_allocations (
  payment_id uuid not null references public.payments(id),
  receivable_id uuid not null references public.receivables(id),
  amount_xof numeric(14,2) not null check(amount_xof>0),
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(payment_id,receivable_id)
);
alter table public.payment_receivable_allocations enable row level security;
revoke all on public.payment_receivable_allocations from public,anon,authenticated;
grant select on public.payment_receivable_allocations to authenticated;
create policy "authorized reads of allocations" on public.payment_receivable_allocations
  for select to authenticated using(public.has_app_role('admin','finance','boss') and exists(
    select 1 from public.receivables r where r.id=receivable_id));

-- Update only known implementation fragments, retaining all locks, replay and audit.
do $migration$
declare definition text; old_text text;
begin
  definition:=pg_get_functiondef('private.post_sale_payment_core(uuid,uuid,numeric,date,text,uuid)'::regprocedure);
  old_text:='where source_type = ''sale_contract'' and source_id = p_contract_id';
  if strpos(definition,old_text)=0 then raise exception 'saleLinkMigrationDrift'; end if;
  definition:=replace(definition,old_text,'where id=v_schedule.receivable_id and source_type = ''sale_contract'' and source_id = p_contract_id');
  old_text:='insert into public.ledger_entries(';
  if strpos(definition,old_text)=0 then raise exception 'saleLinkMigrationDrift'; end if;
  definition:=replace(definition,old_text,
    'insert into public.payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id) values(v_payment_id,v_receivable.id,p_amount,auth.uid(),p_request_id); '||old_text);
  execute definition;
  definition:=pg_get_functiondef('private.confirm_operator_collection(uuid)'::regprocedure);
  old_text:='select to_jsonb(rr) into after_row from public.receivables rr where id=r.id;';
  if strpos(definition,old_text)=0 then raise exception 'collectionAllocationMigrationDrift'; end if;
  execute replace(definition,old_text,
    'insert into public.payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id) values(payment_id,r.id,(a->>''amountXof'')::numeric,actor,child); '||old_text);
end; $migration$;

-- Read-only anomalies: never silently repair money or guess historical allocation.
create function public.finance_reconciliation_rpc() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_app_role('admin','finance','boss') then raise exception 'financePermissionDenied' using errcode='42501'; end if;
  with issues as (
    select 'sale_schedule_unlinked'::text code,s.id entity_id from public.sale_payment_schedule s
      where s.receivable_id is null and s.status<>'cancelled'
    union all
    select 'sale_link_mismatch',s.id from public.sale_payment_schedule s join public.receivables r on r.id=s.receivable_id
      where r.source_id<>s.sale_contract_id or r.due_date<>s.due_date or r.amount_xof<>s.amount_xof
    union all
    select 'allocation_amount_mismatch',a.payment_id from public.payment_receivable_allocations a
      join public.payments p on p.id=a.payment_id group by a.payment_id,p.amount,p.exchange_rate_to_xof
      having sum(a.amount_xof)<>round(p.amount*p.exchange_rate_to_xof,2)
    union all
    select 'duplicate_payment_ledger',l.payment_id from public.ledger_entries l
      where l.payment_id is not null group by l.payment_id having count(*)>1
  ) select jsonb_build_object('count',(select count(*) from issues),
    'issues',coalesce((select jsonb_agg(to_jsonb(detail)) from (select * from issues order by code,entity_id limit 100) detail),'[]'::jsonb)) into result;
  return result;
end; $$;
revoke all on function public.finance_reconciliation_rpc() from public,anon;
grant execute on function public.finance_reconciliation_rpc() to authenticated;
commit;
