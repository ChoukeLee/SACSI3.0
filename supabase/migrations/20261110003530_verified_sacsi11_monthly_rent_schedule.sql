begin;

-- Only user-confirmed SACSI11 monthly leases opt in via their source reference.
-- Service coverage and the day cash is due are separate facts.
create function private.sacsi11_monthly_rent_basis(
  c public.lease_contracts, p_paid_through date
) returns table(enabled boolean, period_start date, period_end date, due_on date, period_source text, bill_note text)
language plpgsql stable security invoker set search_path='' as $$
declare
  month_start date;
  next_month date;
  days_in_month integer;
  days_in_next_month integer;
  service_day integer;
  original_service_day integer;
  candidate_due date;
begin
  enabled:=false;
  if position('【月付排账】' in coalesce(c.source_reference,''))>0 then
    select exists(
      select 1 from public.units u
      join public.buildings b on b.id=u.building_id
      join public.projects p on p.id=b.project_id
      where u.id=c.unit_id and b.code='SACSI11' and p.code='SACSI'
    ) into enabled;
  end if;
  if not enabled or c.status<>'active' or c.payment_cycle<>'monthly'
    or c.rent_currency<>'XOF' or c.commencement_state<>'started' or c.actual_end_date is not null
    or c.monthly_rent_xof<=0 or c.monthly_rent_xof::text in ('NaN','Infinity','-Infinity')
    or c.start_date is null or not isfinite(c.start_date) or c.start_date>current_date
    or p_paid_through is null or not isfinite(p_paid_through) or p_paid_through<c.start_date-1 then
    return next; return;
  end if;

  period_start:=p_paid_through+1;
  month_start:=date_trunc('month',period_start)::date;
  next_month:=(month_start+interval '1 month')::date;
  days_in_month:=next_month-month_start;
  days_in_next_month:=(next_month+interval '1 month')::date-next_month;

  service_day:=extract(day from period_start)::integer;
  original_service_day:=extract(day from c.start_date)::integer;
  -- Preserve the original service-day anchor across a short month when it
  -- agrees with the current continuous coverage boundary.
  if service_day=least(original_service_day,days_in_month) then
    service_day:=original_service_day;
  end if;
  period_end:=next_month+least(service_day,days_in_next_month)-2;

  candidate_due:=month_start+least(c.payment_day,days_in_month)-1;
  if candidate_due<period_start then
    candidate_due:=next_month+least(c.payment_day,days_in_next_month)-1;
  end if;
  if candidate_due>period_end or (c.expected_end_confirmed and
    (c.expected_end_date is null or not isfinite(c.expected_end_date) or period_end>c.expected_end_date)) then
    return next; return;
  end if;

  due_on:=candidate_due;
  period_source:='【月付排账】依据已确认付款日和连续缴租覆盖';
  bill_note:=format('【月付排账】根据租金已缴至日期 %s 和每月 %s 日付款生成',p_paid_through,c.payment_day);
  return next;
end;
$$;
revoke all on function private.sacsi11_monthly_rent_basis(public.lease_contracts,date)
  from public,anon,authenticated,service_role;

create function private.ensure_sacsi11_monthly_rent_bill(p_contract_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.lease_contracts%rowtype; u public.units%rowtype; plan record; bill_id uuid;
begin
  select * into strict c from public.lease_contracts where id=p_contract_id for update;
  select * into strict plan from private.sacsi11_monthly_rent_basis(c,c.paid_through_date);
  if plan.due_on is null then return null; end if;

  -- A dated service overlap is definitive regardless of due date or payment
  -- status. An unpaid legacy bill without a period still requires review.
  if exists(
    select 1 from public.receivables r
    where r.source_type='lease_contract' and r.source_id=c.id and r.category='lease_rent'
      and r.status<>'cancelled' and (
        (r.service_period_start<=plan.period_end and r.service_period_end>=plan.period_start)
        or ((r.service_period_start is null or r.service_period_end is null)
          and (r.service_period_start is null or r.service_period_start<=plan.period_end)
          and (r.service_period_end is null or r.service_period_end>=plan.period_start)
          and (r.due_date between plan.period_start and plan.period_end
            or (r.status in ('pending','partial','overdue') and
              coalesce(r.amount_native,r.amount_xof)>coalesce(r.paid_amount_native,r.paid_amount_xof))))
      )
  ) then return null; end if;

  select * into strict u from public.units where id=c.unit_id;
  insert into public.receivables(
    building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,
    amount_xof,paid_amount_xof,status,currency,notes,
    service_period_start,service_period_end,service_period_source
  ) values (
    u.building_id,u.id,c.customer_id,'lease_contract',c.id,'lease_rent',
    u.unit_no||' 长租下一期租金',plan.due_on,c.monthly_rent_xof,0,
    case when plan.due_on<current_date then 'overdue' else 'pending' end,'XOF',plan.bill_note,
    plan.period_start,plan.period_end,plan.period_source
  ) returning id into bill_id;
  return bill_id;
end;
$$;
revoke all on function private.ensure_sacsi11_monthly_rent_bill(uuid)
  from public,anon,authenticated,service_role;

-- Keep existing permissions, inputs, lock ordering and non-opt-in behavior.
do $migration$
declare
  definition text;
  patch record;
  target regprocedure;
begin
  for target in select unnest(array[
    'private.record_lease_financial_entry_atomic(uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid)'::regprocedure,
    'private.correct_lease_rent_period(uuid,jsonb,uuid)'::regprocedure,
    'private.record_lease_collection_with_context(jsonb,uuid,jsonb)'::regprocedure
  ])
  loop
    definition:=replace(pg_get_functiondef(target),chr(13)||chr(10),chr(10));
    for patch in select * from (values
      (
        'private.record_lease_financial_entry_atomic(uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid)'::regprocedure,
        $$  if p_business_type='rent_income' then perform private.ensure_next_lease_receivable(v_contract.id); end if;$$,
        $$  if p_business_type='rent_income' then
    if (select enabled from private.sacsi11_monthly_rent_basis(v_contract,p_paid_through_date)) then
      if v_contract.paid_through_date is null or p_paid_through_date>v_contract.paid_through_date then
        perform private.ensure_sacsi11_monthly_rent_bill(v_contract.id);
      end if;
    else
      perform private.ensure_next_lease_receivable(v_contract.id);
    end if;
  end if;$$
      ),
      (
        'private.correct_lease_rent_period(uuid,jsonb,uuid)'::regprocedure,
        $$ auto_ids uuid[]; note text;$$,
        $$ auto_ids uuid[]; note text; old_plan record; new_plan record;$$
      ),
      (
        'private.correct_lease_rent_period(uuid,jsonb,uuid)'::regprocedure,
        $$ -- Only the exact untouched auto-generated follow-up may be retired.$$,
        $$ select * into strict old_plan from private.sacsi11_monthly_rent_basis(c,c.paid_through_date);
 select * into strict new_plan from private.sacsi11_monthly_rent_basis(c,corrected);
 -- Only the exact untouched auto-generated follow-up may be retired.$$
      ),
      (
        'private.correct_lease_rent_period(uuid,jsonb,uuid)'::regprocedure,
        $$   rr.status in ('pending','overdue') and rr.paid_amount_xof=0 and rr.amount_xof=c.monthly_rent_xof and rr.due_date=c.paid_through_date+1
   and coalesce(rr.management_status::text,'managed')='managed' and rr.service_period_start is null and rr.service_period_end is null
   and rr.notes in ('根据租金已缴至日期 '||c.paid_through_date||' 自动生成','根据租金已缴至日期 '||c.paid_through_date||' 统一补齐下一期应收')
   and not exists(select 1 from public.payment_receivable_allocations a where a.receivable_id=rr.id)$$,
        $$   rr.status in ('pending','overdue') and rr.paid_amount_xof=0 and rr.amount_xof=c.monthly_rent_xof
   and coalesce(rr.management_status::text,'managed')='managed'
   and (
     (rr.due_date=c.paid_through_date+1 and rr.service_period_start is null and rr.service_period_end is null
       and rr.notes in ('根据租金已缴至日期 '||c.paid_through_date||' 自动生成','根据租金已缴至日期 '||c.paid_through_date||' 统一补齐下一期应收'))
     or (old_plan.enabled and rr.currency='XOF' and rr.due_date=old_plan.due_on
       and rr.service_period_start=old_plan.period_start and rr.service_period_end=old_plan.period_end
       and rr.service_period_source=old_plan.period_source and rr.notes=old_plan.bill_note)
   )
   and not exists(select 1 from public.payment_receivable_allocations a where a.receivable_id=rr.id)$$
      ),
      (
        'private.correct_lease_rent_period(uuid,jsonb,uuid)'::regprocedure,
        $$ perform private.ensure_next_lease_receivable(c.id);
 if not exists(select 1 from public.receivables where source_type='lease_contract' and source_id=c.id
   and category='lease_rent' and due_date=corrected+1 and status in ('pending','overdue')
   and paid_amount_xof=0 and amount_xof=c.monthly_rent_xof) then raise exception 'leasePeriodReviewRequired'; end if;$$,
        $$ if new_plan.enabled then
   if new_plan.due_on is not null and private.ensure_sacsi11_monthly_rent_bill(c.id) is null then
     raise exception 'leasePeriodReviewRequired';
   end if;
 else
   perform private.ensure_next_lease_receivable(c.id);
   if not exists(select 1 from public.receivables where source_type='lease_contract' and source_id=c.id
     and category='lease_rent' and due_date=corrected+1 and status in ('pending','overdue')
     and paid_amount_xof=0 and amount_xof=c.monthly_rent_xof) then raise exception 'leasePeriodReviewRequired'; end if;
 end if;$$
      ),
      (
        'private.record_lease_collection_with_context(jsonb,uuid,jsonb)'::regprocedure,
        $$  paid_through_after date;$$,
        $$  paid_through_after date; next_rent_receivable_id uuid;$$
      ),
      (
        'private.record_lease_collection_with_context(jsonb,uuid,jsonb)'::regprocedure,
        $$    paid_through_after:=through_day;$$,
        $$    paid_through_after:=through_day;
    next_rent_receivable_id:=private.ensure_sacsi11_monthly_rent_bill(c.id);$$
      ),
      (
        'private.record_lease_collection_with_context(jsonb,uuid,jsonb)'::regprocedure,
        $$  if coverage is not null then result:=result||jsonb_build_object('coverage',jsonb_build_object($$,
        $$  if next_rent_receivable_id is not null then
    result:=result||jsonb_build_object('nextRentReceivableId',next_rent_receivable_id);
  end if;
  if coverage is not null then result:=result||jsonb_build_object('coverage',jsonb_build_object($$
      ),
      (
        'private.record_lease_collection_with_context(jsonb,uuid,jsonb)'::regprocedure,
        $$'coverage_explicitly_confirmed',coverage is not null,'no_receivables_created',true)$$,
        $$'coverage_explicitly_confirmed',coverage is not null,'no_receivables_created',next_rent_receivable_id is null)$$
      )
    ) edits(signature,old_text,new_text) where edits.signature=target
    loop
      if cardinality(string_to_array(definition,patch.old_text)) is distinct from 2 then
        raise exception 'Unexpected % definition for verified SACSI11 monthly rent',target;
      end if;
      definition:=replace(definition,patch.old_text,patch.new_text);
    end loop;
    execute definition;
  end loop;
end;
$migration$;

notify pgrst,'reload schema';
commit;
