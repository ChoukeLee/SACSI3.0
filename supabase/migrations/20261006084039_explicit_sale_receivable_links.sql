begin;
-- Legacy payment_plan_type contains prose, not an enum. Never interpret prose as installments.
-- Unknown plans accept existing principal categories only; identity/amount/date checks remain mandatory.
create function private.sale_principal_category_matches(plan text, category text) returns boolean
language sql immutable set search_path='' as $$
  select case when plan='lump_sum' then category='sale_lump_sum'
    when plan in ('fixed_installment','flexible_installment') then category='sale_installment'
    else category in ('sale_lump_sum','sale_installment') end;
$$;
revoke all on function private.sale_principal_category_matches(text,text) from public,anon,authenticated;
alter table public.sale_payment_schedule add column receivable_id uuid references public.receivables(id);
create unique index sale_schedule_receivable_identity on public.sale_payment_schedule(receivable_id) where receivable_id is not null;

-- Historical linking is structural only: exactly one candidate in BOTH directions.
with candidates as (
  select s.id schedule_id,r.id receivable_id,
    count(*) over(partition by s.id) schedule_matches,
    count(*) over(partition by r.id) receivable_matches
  from public.sale_payment_schedule s join public.sale_contracts c on c.id=s.sale_contract_id
  join public.receivables r on r.source_type='sale_contract' and r.source_id=c.id
    and r.unit_id=c.unit_id
    and private.sale_principal_category_matches(c.payment_plan_type,r.category)
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
      and r.status<>'cancelled'
      and not exists(select 1 from public.sale_schedule_components x where x.receivable_id=r.id)
      and private.sale_principal_category_matches(c.payment_plan_type,r.category))
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
      and private.sale_principal_category_matches(c.payment_plan_type,new.category)
      and new.unit_id=c.unit_id
    having count(*)=1;
  if schedule is not null and (select count(*) from public.receivables r where r.source_type=new.source_type
    and r.source_id=new.source_id and private.sale_principal_category_matches((select payment_plan_type from public.sale_contracts where id=new.source_id),r.category) and r.unit_id=new.unit_id and r.due_date=new.due_date and r.amount_xof=new.amount_xof and r.status<>'cancelled')=1
  then update public.sale_payment_schedule set receivable_id=new.id where id=schedule; end if;
  return new;
end; $$;
revoke all on function private.link_new_sale_receivable() from public,anon,authenticated;
create trigger link_new_sale_receivable after insert on public.receivables
  for each row execute function private.link_new_sale_receivable();

-- Explicit whole-receivable components for legacy aggregate schedules. No fuzzy backfill.
-- Write access is maintenance-only: approved identities and audit are required at release.
create table public.sale_schedule_components (
  schedule_id uuid not null references public.sale_payment_schedule(id),
  receivable_id uuid not null unique references public.receivables(id),
  basis text not null check (basis in ('principal','approved_contract_settlement_credit')),
  request_id uuid not null,
  primary key(schedule_id,receivable_id)
);
alter table public.sale_schedule_components enable row level security;
revoke all on public.sale_schedule_components from public,anon,authenticated;
grant select on public.sale_schedule_components to authenticated;
create policy "authorized component reads" on public.sale_schedule_components for select to authenticated
  using(public.has_app_role('admin','finance','boss') and exists(select 1 from public.receivables r where r.id=receivable_id)
    and exists(select 1 from public.sale_payment_schedule s where s.id=schedule_id));

create function private.sale_components_valid(p_schedule uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce(s.receivable_id is null and s.status<>'cancelled'
    and count(x.receivable_id)>1 and sum(r.amount_xof)=s.amount_xof
    and bool_and(r.source_type='sale_contract' and r.source_id=c.id and r.unit_id=c.unit_id
      and r.customer_id=c.customer_id and r.currency::text='XOF' and r.status<>'cancelled'
      and r.paid_amount_xof between 0 and r.amount_xof
      and not exists(select 1 from public.sale_payment_schedule other where other.receivable_id=r.id)
      and ((x.basis='principal' and r.category in ('sale_lump_sum','sale_installment'))
        or (x.basis='approved_contract_settlement_credit' and r.category='other'))),false)
  from public.sale_payment_schedule s join public.sale_contracts c on c.id=s.sale_contract_id
  join public.sale_schedule_components x on x.schedule_id=s.id join public.receivables r on r.id=x.receivable_id
  where s.id=p_schedule group by s.id,c.id;
$$;
revoke all on function private.sale_components_valid(uuid) from public,anon,authenticated;
grant execute on function private.sale_components_valid(uuid) to authenticated;

create function private.sale_component_paid(p_schedule uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce(private.sale_components_valid(p_schedule),false)
    and coalesce((select bool_and(r.status='paid' and r.paid_amount_xof=r.amount_xof)
      from public.sale_schedule_components x join public.receivables r on r.id=x.receivable_id
      where x.schedule_id=p_schedule),false);
$$;
revoke all on function private.sale_component_paid(uuid) from public,anon,authenticated;
grant execute on function private.sale_component_paid(uuid) to authenticated;

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
  definition:=replace(pg_get_functiondef('private.post_sale_payment_core(uuid,uuid,numeric,date,text,uuid)'::regprocedure),chr(13)||chr(10),chr(10));
  old_text:='v_category := case when v_contract.payment_plan_type = ''lump_sum''
    then ''sale_lump_sum'' else ''sale_installment'' end;';
  if strpos(definition,old_text)=0 then raise exception 'saleCategoryMigrationDrift'; end if;
  definition:=replace(definition,old_text,'select category into v_category from public.receivables where id=v_schedule.receivable_id and private.sale_principal_category_matches(v_contract.payment_plan_type,category);');
  old_text:='where source_type = ''sale_contract'' and source_id = p_contract_id';
  if strpos(definition,old_text)=0 then raise exception 'saleLinkMigrationDrift'; end if;
  definition:=replace(definition,old_text,'where id=v_schedule.receivable_id and unit_id=v_contract.unit_id and source_type = ''sale_contract'' and source_id = p_contract_id');
  old_text:='insert into public.ledger_entries(';
  if strpos(definition,old_text)=0 then raise exception 'saleLinkMigrationDrift'; end if;
  definition:=replace(definition,old_text,
    'insert into public.payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id) values(v_payment_id,v_receivable.id,p_amount,auth.uid(),p_request_id); '||old_text);
  execute definition;
  definition:=pg_get_functiondef('private.finance_operation(text,jsonb,uuid)'::regprocedure);
  old_text:='v_category:=case when c.payment_plan_type=''lump_sum'' then ''sale_lump_sum'' else ''sale_installment'' end;';
  if strpos(definition,old_text)=0 then raise exception 'saleDispatcherCategoryMigrationDrift'; end if;
  definition:=replace(definition,old_text,'select category into v_category from public.receivables where id=s.receivable_id and private.sale_principal_category_matches(c.payment_plan_type,category);');
  old_text:='if (select count(*) from public.receivables where source_type=''sale_contract'' and source_id=c.id and category=v_category and due_date=s.due_date and amount_xof=s.amount_xof and status<>''cancelled'')<>1 then raise exception ''ambiguousSaleReceivable''; end if;';
  if strpos(definition,old_text)=0 then raise exception 'saleDispatcherLinkMigrationDrift'; end if;
  execute replace(definition,old_text,
    'if s.receivable_id is null or not exists(select 1 from public.receivables where id=s.receivable_id and source_type=''sale_contract'' and source_id=c.id and unit_id=c.unit_id and category=v_category and due_date=s.due_date and amount_xof=s.amount_xof and status<>''cancelled'') then raise exception ''ambiguousSaleReceivable''; end if;');
  definition:=pg_get_functiondef('private.operator_collection_snapshot(jsonb)'::regprocedure);
  old_text:='if (select count(*) from public.receivables rr where rr.source_type=''sale_contract'' and rr.source_id=target and rr.category=r.category and rr.due_date=r.due_date and rr.amount_xof=r.amount_xof and rr.status<>''cancelled'')<>1 then raise exception ''collectionScheduleAmbiguous''; end if;';
  if strpos(definition,old_text)=0 then raise exception 'collectionSnapshotLinkMigrationDrift'; end if;
  definition:=replace(definition,old_text,'');
  old_text:='s.sale_contract_id=target and s.due_date=r.due_date and s.amount_xof=r.amount_xof and s.status<>''cancelled''';
  if strpos(definition,old_text)=0 then raise exception 'collectionSnapshotLinkMigrationDrift'; end if;
  definition:=replace(definition,old_text,'s.sale_contract_id=target and s.status<>''cancelled'' and ((s.receivable_id=r.id and s.due_date=r.due_date and s.amount_xof=r.amount_xof) or (private.sale_components_valid(s.id) and exists(select 1 from public.sale_schedule_components x where x.schedule_id=s.id and x.receivable_id=r.id)))');
  old_text:='jsonb_agg(to_jsonb(s)) from public.sale_payment_schedule s where';
  if strpos(definition,old_text)=0 then raise exception 'collectionComponentSnapshotDrift'; end if;
  -- Snapshot every component (including previously paid credits), preventing stale confirmation.
  execute replace(definition,old_text,'jsonb_agg(to_jsonb(s)||jsonb_build_object(''components'',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object(''receivable'',to_jsonb(rr)) order by x.receivable_id) from public.sale_schedule_components x join public.receivables rr on rr.id=x.receivable_id where x.schedule_id=s.id),''[]''::jsonb))) from public.sale_payment_schedule s where');
  definition:=pg_get_functiondef('private.confirm_operator_collection(uuid)'::regprocedure);
  old_text:='where sale_contract_id=r.source_id and due_date=r.due_date and amount_xof=r.amount_xof and status<>''cancelled'';';
  if strpos(definition,old_text)=0 then raise exception 'collectionPaymentLinkMigrationDrift'; end if;
  definition:=replace(definition,old_text,'where sale_contract_id=r.source_id and ((receivable_id=r.id and due_date=r.due_date and amount_xof=r.amount_xof) or (private.sale_components_valid(id) and exists(select 1 from public.sale_schedule_components x where x.schedule_id=public.sale_payment_schedule.id and x.receivable_id=r.id))) and status<>''cancelled''; if not found then raise exception ''collectionScheduleAmbiguous''; end if;');
  old_text:='case when next_paid=r.amount_xof then ''paid''::public.payment_status';
  if strpos(definition,old_text)=0 then raise exception 'collectionComponentStatusDrift'; end if;
  definition:=replace(definition,old_text,'case when (receivable_id is not null and next_paid=r.amount_xof) or private.sale_component_paid(id) then ''paid''::public.payment_status');
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
      where s.receivable_id is null and s.status<>'cancelled' and not exists(select 1 from public.sale_schedule_components x where x.schedule_id=s.id)
    union all
    select 'sale_component_mismatch',s.id from public.sale_payment_schedule s
      where exists(select 1 from public.sale_schedule_components x where x.schedule_id=s.id) and not coalesce(private.sale_components_valid(s.id),false)
    union all
    select 'sale_schedule_status_disagreement',s.id from public.sale_payment_schedule s
      where coalesce(private.sale_components_valid(s.id),false) and (s.status='paid') is distinct from private.sale_component_paid(s.id)
    union all
    select 'sale_link_mismatch',s.id from public.sale_payment_schedule s join public.receivables r on r.id=s.receivable_id
      where r.source_id<>s.sale_contract_id or r.due_date<>s.due_date or r.amount_xof<>s.amount_xof
    union all
    select 'sale_schedule_status_disagreement',s.id from public.sale_payment_schedule s join public.receivables r on r.id=s.receivable_id
      where (s.status='paid') is distinct from (r.status='paid') and s.status<>'cancelled'
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
