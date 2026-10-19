begin;

-- An end date can be confirmed without inventing an unknown period start.
alter table public.receivables drop constraint receivable_service_period_valid;
alter table public.receivables add constraint receivable_service_period_valid check (
  (service_period_start is null and service_period_end is null and service_period_source is null)
  or (service_period_end is not null and isfinite(service_period_end)
    and (service_period_start is null or (isfinite(service_period_start) and service_period_end>=service_period_start))
    and service_period_source is not null and length(btrim(service_period_source)) between 1 and 1000)
);

create table private.lease_rent_period_requests (
 request_id uuid primary key, actor_id uuid not null, contract_id uuid not null,
 input jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table private.lease_rent_period_requests enable row level security;
revoke all on private.lease_rent_period_requests from public,anon,authenticated,service_role;

create function public.lease_rent_period_review_rpc(p_contract_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c public.lease_contracts%rowtype; facts jsonb; payments jsonb; receivables jsonb;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
   or not coalesce(public.has_app_role('admin'),false) then
   raise exception 'leasePeriodPermissionDenied' using errcode='42501'; end if;
 select * into c from public.lease_contracts where id=p_contract_id;
 if not found or not coalesce(public.can_access_unit(c.unit_id),false) then
   raise exception 'leasePeriodPermissionDenied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) into payments
  from public.payments p where p.source_id=c.id;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.due_date,r.id),'[]'::jsonb) into receivables
  from public.receivables r where r.source_type='lease_contract' and r.source_id=c.id and r.category='lease_rent';
 facts:=jsonb_build_object('contract',to_jsonb(c),'payments',payments,'receivables',receivables,
  'allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.payment_id,a.receivable_id)
   from public.payment_receivable_allocations a where a.payment_id in(select id from public.payments where source_id=c.id)
    or a.receivable_id in(select id from public.receivables where source_type='lease_contract' and source_id=c.id and category='lease_rent')),'[]'::jsonb),
  'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.ledger_entries l
   where l.payment_id in(select id from public.payments where source_id=c.id)),'[]'::jsonb));
 return jsonb_build_object('contractId',c.id,'paidThroughDate',c.paid_through_date,'status',c.status,
  'token',md5(facts::text),'payments',payments,'receivables',receivables);
end; $$;

-- Narrow repair, not a generic edit API. Existing financial amounts, currency,
-- receipt, payment date/method, deposit, customer and formal lease dates are immutable.
-- Multiple receipts/allocations require a separately reviewed correction workflow.
create function private.correct_lease_rent_period(p_contract_id uuid,p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare c public.lease_contracts%rowtype; p public.payments%rowtype; r public.receivables%rowtype;
 old_request private.lease_rent_period_requests%rowtype; before_state jsonb; after_state jsonb;
 actor uuid:=auth.uid(); corrected date; reason text; money numeric; allocation_total numeric;
 auto_ids uuid[]; note text;
begin
 if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
   or not coalesce(public.has_app_role('admin'),false) then
   raise exception 'leasePeriodPermissionDenied' using errcode='42501'; end if;
 if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object'
   or octet_length(p_input::text)>8192
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('expectedToken','paymentId','receivableId','paidThroughDate','reason'))
   or coalesce(p_input->>'expectedToken','') !~ '^[0-9a-f]{32}$'
   or coalesce(p_input->>'paidThroughDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(p_input->'reason') is distinct from 'string'
   or length(btrim(coalesce(p_input->>'reason',''))) not between 1 and 1000 then
   raise exception 'invalidLeasePeriodCorrection'; end if;
 corrected:=(p_input->>'paidThroughDate')::date; reason:=btrim(p_input->>'reason');
 if not isfinite(corrected) or to_char(corrected,'YYYY-MM-DD')<>p_input->>'paidThroughDate' then
   raise exception 'invalidLeasePeriodCorrection'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 -- Access is rechecked even on replay; a changed payload never reuses an identity.
 perform public.lease_rent_period_review_rpc(p_contract_id);
 select * into old_request from private.lease_rent_period_requests where request_id=p_request_id;
 if found then
   if old_request.actor_id<>actor or old_request.contract_id<>p_contract_id or old_request.input is distinct from p_input then
     raise exception 'requestIdConflict'; end if;
   return old_request.result;
 end if;
 select * into c from public.lease_contracts where id=p_contract_id for update;
 if not found or not coalesce(public.can_access_unit(c.unit_id),false) then
   raise exception 'leasePeriodPermissionDenied' using errcode='42501'; end if;
 -- Same parent -> payments -> receivables order as lease finance/context writes.
 perform 1 from public.payments where source_id=c.id order by id for update;
 perform 1 from public.receivables where source_type='lease_contract' and source_id=c.id and category='lease_rent'
  order by due_date,id for update;
 before_state:=public.lease_rent_period_review_rpc(c.id);
 if before_state->>'token' is distinct from p_input->>'expectedToken' then raise exception 'leasePeriodChanged'; end if;
 if c.status<>'active' or c.commencement_state<>'started' or c.paid_through_date is null
   or c.start_date is null or corrected<c.start_date or corrected>c.start_date+interval '50 years'
   or corrected=c.paid_through_date then raise exception 'leasePeriodReviewRequired'; end if;
 if (select count(*) from public.payments where source_id=c.id and source_type in ('lease_rent','lease_contract','lease_rent_refund'))<>1 then
   raise exception 'leasePeriodReviewRequired'; end if;
 select * into p from public.payments where id=(p_input->>'paymentId')::uuid and source_id=c.id
  and source_type='lease_rent' and unit_id=c.unit_id and customer_id=c.customer_id and reversal_of_payment_id is null;
 if not found then raise exception 'leasePeriodReviewRequired'; end if;
 money:=round(p.amount*p.exchange_rate_to_xof,2);
 if money is null or money<=0 or money::text in ('NaN','Infinity','-Infinity') then raise exception 'leasePeriodReviewRequired'; end if;
 select * into r from public.receivables where id=(p_input->>'receivableId')::uuid
  and source_type='lease_contract' and source_id=c.id and category='lease_rent'
  and unit_id=c.unit_id and customer_id=c.customer_id and status='paid'
  and coalesce(management_status::text,'managed')='managed' and amount_xof=money and paid_amount_xof=money;
 if not found or (r.service_period_start is not null and corrected<r.service_period_start)
   or (select count(*) from public.receivables where source_type='lease_contract' and source_id=c.id
      and category='lease_rent' and status<>'cancelled' and paid_amount_xof>0)<>1 then
   raise exception 'leasePeriodReviewRequired'; end if;
 -- Explicit, unambiguous legacy reconciliation only. No date/amount-based reassignment.
 if exists(select 1 from public.payment_receivable_allocations where (payment_id=p.id and receivable_id<>r.id)
    or (receivable_id=r.id and payment_id<>p.id)) then raise exception 'leasePeriodReviewRequired'; end if;
 select coalesce(sum(amount_xof),0) into allocation_total from public.payment_receivable_allocations where payment_id=p.id;
 if allocation_total not in (0,money) then raise exception 'leasePeriodReviewRequired'; end if;
 -- Only the exact untouched auto-generated follow-up may be retired. Other bills,
 -- partial collections, refunds and historical/excluded debt require human review.
 if exists(select 1 from public.receivables rr where rr.source_type='lease_contract' and rr.source_id=c.id
  and rr.category='lease_rent' and rr.status<>'cancelled' and rr.id<>r.id and not (
   rr.status in ('pending','overdue') and rr.paid_amount_xof=0 and rr.amount_xof=c.monthly_rent_xof and rr.due_date=c.paid_through_date+1
   and coalesce(rr.management_status::text,'managed')='managed' and rr.service_period_start is null and rr.service_period_end is null
   and rr.notes in ('根据租金已缴至日期 '||c.paid_through_date||' 自动生成','根据租金已缴至日期 '||c.paid_through_date||' 统一补齐下一期应收')
   and not exists(select 1 from public.payment_receivable_allocations a where a.receivable_id=rr.id)
  )) then raise exception 'leasePeriodReviewRequired'; end if;
 select array_agg(id) into auto_ids from public.receivables where source_type='lease_contract' and source_id=c.id
   and category='lease_rent' and status<>'cancelled' and id<>r.id;
 if coalesce(array_length(auto_ids,1),0)>1 then raise exception 'leasePeriodReviewRequired'; end if;
 note:='【账期更正】本笔租金已缴至 '||corrected||'；此前不一致账期作废；依据：'||reason;
 update public.payments set notes=concat_ws(E'\n',notes,note) where id=p.id;
 update public.receivables set service_period_end=corrected,service_period_source=reason,service_period_confirmed_by=actor,
  notes=concat_ws(E'\n',notes,note),updated_at=now() where id=r.id;
 if allocation_total=0 then
  perform private.record_verified_payment_allocation(p.id,r.id,money,p_request_id);
 end if;
 update public.receivables set status='cancelled',notes=concat_ws(E'\n',notes,'账期更正，保留原账单但不再催收；请求号：'||p_request_id),updated_at=now()
  where id=any(coalesce(auto_ids,'{}'::uuid[]));
 update public.lease_contracts set paid_through_date=corrected,updated_at=now() where id=c.id;
 perform private.ensure_next_lease_receivable(c.id);
 if not exists(select 1 from public.receivables where source_type='lease_contract' and source_id=c.id
   and category='lease_rent' and due_date=corrected+1 and status in ('pending','overdue')
   and paid_amount_xof=0 and amount_xof=c.monthly_rent_xof) then raise exception 'leasePeriodReviewRequired'; end if;
 after_state:=public.lease_rent_period_review_rpc(c.id);
 insert into public.audit_logs(actor_id,actor_email,actor_role,action,entity_type,entity_id,before_data,after_data,metadata)
 values(actor,auth.jwt()->>'email',public.current_user_role(),'correct_lease_rent_period','lease_contract',c.id,
   before_state,after_state,jsonb_build_object('request_id',p_request_id,'payment_id',p.id,'receivable_id',r.id,
    'reason',reason,'amounts_unchanged',true,'channel','sacsi_web'));
 after_state:=jsonb_build_object('success',true,'contractId',c.id,'paymentId',p.id,'paidThroughDate',corrected,'requestId',p_request_id);
 insert into private.lease_rent_period_requests(request_id,actor_id,contract_id,input,result) values(p_request_id,actor,c.id,p_input,after_state);
 return after_state;
end; $$;

create function public.correct_lease_rent_period_rpc(p_contract_id uuid,p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.correct_lease_rent_period($1,$2,$3); $$;
revoke all on function public.lease_rent_period_review_rpc(uuid),public.correct_lease_rent_period_rpc(uuid,jsonb,uuid),
 private.correct_lease_rent_period(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.lease_rent_period_review_rpc(uuid),public.correct_lease_rent_period_rpc(uuid,jsonb,uuid),
 private.correct_lease_rent_period(uuid,jsonb,uuid) to authenticated;

-- A late payment date is NOT the rent coverage date. Confirmed historical
-- coverage must not be deducted again from rent accruing after paid_through.
do $$ declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.contract_workspace_read_rpc(text,jsonb,text,uuid)'::regprocedure);
 patched:=replace(definition,
  'filter(where r.due_date>=p.first_day),0) covered_paid',
  'filter(where coalesce(r.service_period_end,r.due_date)>=p.first_day),0) covered_paid');
 if patched=definition then raise exception 'leasePeriodReadModelPatchMissing'; end if;
 execute patched;
end; $$;
commit;
