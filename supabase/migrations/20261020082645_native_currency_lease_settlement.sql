begin;

-- Native rent is a distinct money dimension, never a USD number in *_xof.
-- Zero XOF slots mean no XOF valuation; native slots carry the actual amount.
alter table public.lease_contracts
 add column rent_currency public.currency_code not null default 'XOF',
 add column monthly_rent_amount numeric(14,2),
 add constraint lease_native_rent_check check (
  (rent_currency='XOF' and monthly_rent_amount is null) or
  (rent_currency in ('USD','CNY') and monthly_rent_amount is not null and monthly_rent_amount>0 and monthly_rent_amount::text not in ('NaN','Infinity','-Infinity') and monthly_rent_xof=0));
alter table public.payments
 add column native_settlement boolean not null default false,
 alter column exchange_rate_to_xof drop not null,
 add constraint payment_native_settlement_check check (
  (native_settlement and currency in ('USD','CNY') and source_type='lease_rent' and amount>0 and amount::text not in ('NaN','Infinity','-Infinity') and exchange_rate_to_xof is null)
  or (not native_settlement and exchange_rate_to_xof is not null));
alter table public.receivables
 add column amount_native numeric(14,2),
 add column paid_amount_native numeric(14,2),
 add constraint receivable_native_amount_check check (
  (amount_native is null and paid_amount_native is null) or
  (currency in ('USD','CNY') and source_type='lease_contract' and category='lease_rent'
   and amount_native>0 and amount_native::text not in ('NaN','Infinity','-Infinity')
   and paid_amount_native is not null and paid_amount_native between 0 and amount_native and amount_xof=0 and paid_amount_xof=0
   and (status<>'paid' or paid_amount_native=amount_native)));
alter table public.ledger_entries
 add column currency public.currency_code not null default 'XOF',
 add column amount_native numeric(14,2),
 add constraint ledger_native_amount_check check (
  (currency='XOF' and amount_native is null) or
  (currency in ('USD','CNY') and amount_native is not null and amount_native::text not in ('NaN','Infinity','-Infinity') and amount_xof=0));

create function private.guard_native_lease_money() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c public.lease_contracts%rowtype;
begin
 if tg_table_name='payments' and new.source_type='lease_rent' then
  select * into c from public.lease_contracts where id=new.source_id;
  if c.rent_currency<>'XOF' and (not new.native_settlement or new.currency<>c.rent_currency) then
   raise exception 'nativeLeaseCurrencyRequired';
  end if;
  if new.native_settlement and (c.id is null or c.rent_currency<>new.currency) then
   raise exception 'nativeLeaseCurrencyMismatch';
  end if;
 elsif tg_table_name='receivables' and new.source_type='lease_contract' and new.category='lease_rent' then
  select * into c from public.lease_contracts where id=new.source_id;
  if c.rent_currency<>'XOF' and (new.currency<>c.rent_currency or new.amount_native is null) then
   raise exception 'nativeLeaseReceivableRequired';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_native_lease_money() from public,anon,service_role;
grant execute on function private.guard_native_lease_money() to authenticated;
create trigger guard_native_lease_payment before insert or update on public.payments
 for each row execute function private.guard_native_lease_money();
create trigger guard_native_lease_receivable before insert or update on public.receivables
 for each row execute function private.guard_native_lease_money();

-- Separate native rent entry: strict currency, explicit dates/method, no FX.
-- Only existing, explicitly selected service periods can be collected. This
-- does not invent renewal terms, deposits, or unidentified historical periods.
create function public.record_native_lease_rent_rpc(
 p_contract_id uuid,p_payment_date date,p_amount numeric,p_currency public.currency_code,
 p_paid_through_date date,p_payment_method text,p_notes text,p_external_receipt_no text,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.lease_contracts%rowtype; u public.units%rowtype; p public.payments%rowtype;
 r public.receivables%rowtype; remaining numeric; applied numeric; due numeric; result jsonb;
begin
 if auth.uid() is null or not coalesce(public.has_app_role('admin','finance'),false) then
  raise exception 'leaseFinancePermissionDenied' using errcode='42501'; end if;
 if p_request_id is null or p_payment_date is null or p_paid_through_date is null
  or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<>p_amount
  or p_currency is null or p_currency not in ('USD','CNY')
  or p_payment_method is null or p_payment_method not in ('cash','check','bank_transfer','other') then
  raise exception 'invalidNativeRentPayload'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into strict c from public.lease_contracts where id=p_contract_id for update;
 if not coalesce(public.can_access_unit(c.unit_id),false) then raise exception 'leaseAccessDenied' using errcode='42501'; end if;
 if c.rent_currency<>p_currency or c.status<>'active' then raise exception 'nativeLeaseRequiresReview'; end if;
 select * into p from public.payments where request_id=p_request_id;
 if p.id is not null then
  if p.source_id<>c.id or not p.native_settlement or p.amount<>p_amount or p.currency<>p_currency
    or p.payment_date<>p_payment_date or p.payment_method is distinct from p_payment_method
    or p.external_receipt_no is distinct from nullif(btrim(p_external_receipt_no),'')
    or not exists(select 1 from public.audit_logs a where a.entity_type='native_lease_rent' and a.entity_id=p.id
      and a.actor_id=auth.uid() and a.metadata->>'paid_through_date'=p_paid_through_date::text
      and a.metadata->>'input_notes' is not distinct from nullif(btrim(p_notes),'')) then raise exception 'requestIdConflict'; end if;
  return jsonb_build_object('success',true,'payment_id',p.id,'reference_no',p.receipt_no,'idempotent',true);
 end if;
 if p_paid_through_date>c.expected_end_date or p_paid_through_date<=coalesce(c.paid_through_date,c.start_date-1) then
  raise exception 'nativeRentPeriodRequiresReview'; end if;
 -- Require known periods ending at the requested coverage boundary.
 select coalesce(sum(amount_native-paid_amount_native),0) into due from public.receivables
  where source_type='lease_contract' and source_id=c.id and category='lease_rent' and currency=p_currency
   and status in ('pending','partial','overdue') and service_period_end<=p_paid_through_date;
 if due<>p_amount or not exists(select 1 from public.receivables where source_id=c.id
  and category='lease_rent' and status in ('pending','partial','overdue') and service_period_end=p_paid_through_date) then
  raise exception 'nativeRentAllocationRequiresReview'; end if;
 select * into strict u from public.units where id=c.unit_id;
 insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,
  exchange_rate_to_xof,native_settlement,payment_method,external_receipt_no,notes,request_id,request_kind)
 values(c.customer_id,c.unit_id,'lease_rent',c.id,p_payment_date,p_amount,p_currency,null,true,
  p_payment_method,nullif(btrim(p_external_receipt_no),''),concat_ws('；','原币租金结算，不折算XOF','已缴至：'||p_paid_through_date,nullif(btrim(p_notes),'')),p_request_id,'native_lease_rent') returning * into p;
 insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,amount_native,description)
 values(u.building_id,c.unit_id,p.id,p_payment_date,'income','lease_rent',0,p_currency,p_amount,'原币租金 '||c.contract_no);
 remaining:=p_amount;
 for r in select * from public.receivables where source_type='lease_contract' and source_id=c.id
  and category='lease_rent' and currency=p_currency and status in ('pending','partial','overdue')
  and service_period_end<=p_paid_through_date order by due_date,id for update loop
  applied:=least(r.amount_native-r.paid_amount_native,remaining);
  update public.receivables set paid_amount_native=paid_amount_native+applied,
    status=case when paid_amount_native+applied>=amount_native then 'paid' else 'partial' end,updated_at=now() where id=r.id;
  remaining:=remaining-applied;
 end loop;
 if remaining<>0 then raise exception 'nativeRentAllocationMismatch'; end if;
 update public.lease_contracts set paid_through_date=p_paid_through_date,updated_at=now() where id=c.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'create','native_lease_rent',p.id,jsonb_build_object('request_id',p_request_id,'contract_id',c.id,
  'currency',p_currency,'amount',p_amount,'paid_through_date',p_paid_through_date,'input_notes',nullif(btrim(p_notes),'')));
 return jsonb_build_object('success',true,'payment_id',p.id,'reference_no',p.receipt_no,'idempotent',false);
end $$;
revoke all on function public.record_native_lease_rent_rpc(uuid,date,numeric,public.currency_code,date,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.record_native_lease_rent_rpc(uuid,date,numeric,public.currency_code,date,text,text,text,uuid) to authenticated;

comment on column public.payments.native_settlement is 'Native contractual rent, no XOF valuation. Null FX is intentional; original currency totals remain separate.';
comment on column public.lease_contracts.monthly_rent_amount is 'Native monthly rent; *_xof is zero for an unvalued native-currency contract, not a free lease.';
-- Keep RLS and the public finance result contract unchanged. Project joins must
-- not repeatedly rescan an RLS-protected ledger for every visible building.
-- A STABLE invoker shares one calling-statement snapshot across the authorized
-- scope reads and the detail/summary/export query; it never writes business data.
-- Scope arrays are PL/pgSQL parameters, not SubPlans evaluated after every RLS
-- check. A call-local custom plan retains cheap scope rejection before those
-- checks even after PostgreSQL would normally switch to a generic cached plan.
create or replace function public.finance_read_rpc(p_kind text,p_filters jsonb default '{}',
  p_page integer default 1,p_export boolean default false)
returns jsonb language plpgsql stable security invoker
set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare
  result jsonb;
  requested_project uuid;
  scope_buildings uuid[];
  scope_units uuid[];
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','finance','boss'),false) then
    raise exception 'financePermissionDenied' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('ledger','receivables') or p_page is null or p_page<1 or p_page>2000000 or p_export is null
    or p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'invalidFinanceFilter'; end if;
  requested_project := nullif(p_filters->>'projectId','')::uuid;
  if requested_project is not null and not coalesce(public.can_access_project(requested_project),false) then
    raise exception 'financePermissionDenied' using errcode='42501'; end if;
  if nullif(p_filters->>'dateFrom','')::date> nullif(p_filters->>'dateTo','')::date then
    raise exception 'invalidFinanceDateRange'; end if;

  if requested_project is not null then
    select coalesce(array_agg(b.id),'{}'::uuid[]) into scope_buildings
    from public.buildings b where b.project_id=requested_project;
    select coalesce(array_agg(u.id),'{}'::uuid[]) into scope_units
    from public.units u where u.building_id=any(scope_buildings);
  end if;

  with visible_units as materialized (
    -- An explicit building wins over the unit's building for scope, but a
    -- separately authorized unit still supplies its original label/search text.
    select u.id,u.unit_no,u.building_id from public.units u
  ), visible_buildings as materialized (
    select b.id,b.project_id,b.display_name from public.buildings b
    where requested_project is null or b.project_id=requested_project
  ), source as materialized (
    select l.id,l.entry_date dt,l.building_id,l.unit_id,to_jsonb(l) doc
    from public.ledger_entries l where p_kind='ledger'
      and (requested_project is null or l.building_id=any(scope_buildings)
        or (l.building_id is null and l.unit_id=any(scope_units)))
    union all
    select r.id,r.due_date,r.building_id,r.unit_id,to_jsonb(r)
    from public.receivables r where p_kind='receivables'
      and (requested_project is null or r.building_id=any(scope_buildings)
        or (r.building_id is null and r.unit_id=any(scope_units)))
  ), filtered as materialized (
    select s.id,s.dt,s.doc||jsonb_build_object('unit_label',u.unit_no,
      'building_label',b.display_name) doc from source s
    left join visible_units u on u.id=s.unit_id
    left join visible_buildings b on b.id=coalesce(s.building_id,u.building_id)
    where (requested_project is null or b.project_id=requested_project)
    and (nullif(p_filters->>'dateFrom','') is null or s.dt>=(p_filters->>'dateFrom')::date)
    and (nullif(p_filters->>'dateTo','') is null or s.dt<=(p_filters->>'dateTo')::date)
    and (nullif(p_filters->>'buildingId','') is null or coalesce(s.building_id,u.building_id)=(p_filters->>'buildingId')::uuid)
    and (nullif(p_filters->>'direction','') is null or s.doc->>'direction'=p_filters->>'direction')
    and (nullif(p_filters->>'category','') is null or s.doc->>'category'=p_filters->>'category')
    and (p_kind<>'receivables' or coalesce(p_filters->>'outstandingOnly','false')<>'true'
      or (s.doc->>'status'<>'cancelled' and coalesce((s.doc->>'amount_native')::numeric,(s.doc->>'amount_xof')::numeric)>coalesce((s.doc->>'paid_amount_native')::numeric,(s.doc->>'paid_amount_xof')::numeric)))
    and (nullif(p_filters->>'status','') is null or s.doc->>'status'=p_filters->>'status')
    and (p_kind<>'receivables' or coalesce(nullif(p_filters->>'management',''),'managed')='all'
      or s.doc->>'management_status'=coalesce(nullif(p_filters->>'management',''),'managed'))
    and (nullif(p_filters->>'search','') is null or
      position(lower(p_filters->>'search') in lower(coalesce(s.doc->>'description',s.doc->>'title','')||' '||coalesce(u.unit_no,'')))>0)
  ), native_totals as (
    select doc->>'currency' currency,
      coalesce(sum((doc->>'amount_native')::numeric) filter(where doc->>'direction'='income'),0) income,
      coalesce(sum((doc->>'amount_native')::numeric) filter(where doc->>'direction'='expense'),0) expense,
      coalesce(sum((doc->>'amount_native')::numeric) filter(where doc->>'direction'='liability_in'),0) liability_in,
      coalesce(sum((doc->>'amount_native')::numeric) filter(where doc->>'direction'='liability_out'),0) liability_out,
      coalesce(sum((doc->>'amount_native')::numeric) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) receivable,
      coalesce(sum((doc->>'paid_amount_native')::numeric) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) paid,
      coalesce(sum(greatest(0,(doc->>'amount_native')::numeric-(doc->>'paid_amount_native')::numeric)) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) outstanding,
      coalesce(sum(greatest(0,(doc->>'amount_native')::numeric-(doc->>'paid_amount_native')::numeric)) filter(where doc->>'status' not in ('cancelled','paid') and doc->>'management_status'='managed' and dt<current_date),0) overdue
    from filtered where doc->>'amount_native' is not null group by doc->>'currency'
  ), totals as (
    select count(*) n,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='income'),0) income,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='expense'),0) expense,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='liability_in'),0) liability_in,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='liability_out'),0) liability_out,
      coalesce(sum((doc->>'amount_xof')::numeric) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) receivable,
      coalesce(sum((doc->>'paid_amount_xof')::numeric) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) paid,
      coalesce(sum(greatest(0,(doc->>'amount_xof')::numeric-(doc->>'paid_amount_xof')::numeric)) filter(where doc->>'status'<>'cancelled' and doc->>'management_status'='managed'),0) outstanding,
      coalesce(sum(greatest(0,(doc->>'amount_xof')::numeric-(doc->>'paid_amount_xof')::numeric)) filter(where doc->>'status' not in ('cancelled','paid') and doc->>'management_status'='managed' and dt<current_date),0) overdue
    from filtered
  ), detail as (
    select doc,dt,id from filtered order by dt desc,id
    limit case when p_export then 100001 else 50 end
    offset case when p_export then 0 else (p_page-1)*50 end
  ) select jsonb_build_object('kind',p_kind,'page',p_page,'pageSize',50,
    'total',n,'summary',to_jsonb(totals)-'n',
    'nativeSummary',coalesce((select jsonb_agg(to_jsonb(nt) order by currency) from native_totals nt),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(doc order by dt desc,id) from detail),'[]'::jsonb))
  into result from totals;
  if p_export and (result->>'total')::bigint>100000 then raise exception 'exportTooLarge'; end if;
  return result;
end; $$;
revoke all on function public.finance_read_rpc(text,jsonb,integer,boolean) from public,anon;
grant execute on function public.finance_read_rpc(text,jsonb,integer,boolean) to authenticated;
notify pgrst,'reload schema';

-- Read model only: all totals are calculated in one database snapshot under
-- existing RLS. This does not infer ownership, historical collectors or cash
-- from receivable allocation balances.
create or replace function public.management_operating_snapshot_rpc(p_project_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  result jsonb;
  daily jsonb;
  building record;
  daily_bucket record;
  trend jsonb := '{}'::jsonb;
  daily_net numeric := 0;
  daily_excluded bigint := 0;
  today date := (statement_timestamp() at time zone 'Africa/Abidjan')::date;
  month_start date;
  trend_start date;
  daily_input jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','boss','finance'),false)
    or p_project_id is null or not coalesce(public.can_access_project(p_project_id),false) then
    raise exception 'managementPermissionDenied' using errcode='42501';
  end if;
  month_start := date_trunc('month',today::timestamp)::date;
  trend_start := (month_start-interval '11 months')::date;
  daily_input := jsonb_build_object('dateFrom',month_start,'dateTo',today,
    'previousFrom',month_start,'previousTo',today,'yearFrom',month_start,'yearTo',today,
    'trendFrom',trend_start,'trendTo',today);
  -- Reuse the independently tested daily receipt classifier, including partial
  -- refund ledger evidence and cross-month reversals. Historical inactive
  -- buildings stay in the reporting perimeter.
  for building in select b.id from public.buildings b
    where b.project_id=p_project_id and public.can_access_building(b.id) loop
    daily := public.daily_receipts_read_rpc(daily_input||jsonb_build_object('buildingId',building.id),1,false);
    daily_net := daily_net+(daily->'summary'->>'net')::numeric;
    daily_excluded := daily_excluded+(daily->'summary'->>'excludedCount')::bigint;
    for daily_bucket in select x->>'month' as month_key,(x->>'net')::numeric net,
      (x->>'excludedCount')::bigint excluded,(x->>'count')::bigint receipt_count from jsonb_array_elements(daily->'trend') x loop
      trend := jsonb_set(trend,array[daily_bucket.month_key],jsonb_build_object(
        'net',coalesce((trend->daily_bucket.month_key->>'net')::numeric,0)+daily_bucket.net,
        'excluded',coalesce((trend->daily_bucket.month_key->>'excluded')::bigint,0)+daily_bucket.excluded,
        'count',coalesce((trend->daily_bucket.month_key->>'count')::bigint,0)+daily_bucket.receipt_count));
    end loop;
  end loop;

  with visible_units as materialized (
    select u.* from public.units u join public.buildings b on b.id=u.building_id
    where b.project_id=p_project_id
  ), visible_payments as materialized (
    select p.*,coalesce(u.building_id,ml.building_id) building_id,
      ml.direction manual_direction,ml.amount_xof manual_amount_xof,ml.entry_date manual_date,
      ml.category manual_category,ml.building_id manual_building_id
    from public.payments p
    left join public.lease_contracts lc on lc.id=p.source_id
      and (p.source_type like 'lease%' or p.source_type in ('property_fee','parking_fee'))
    left join public.sale_contracts sc on sc.id=p.source_id
      and (p.source_type like 'sale%' or p.source_type in ('property_fee','parking_fee'))
    left join visible_units u on u.id=coalesce(p.unit_id,
      case when lc.unit_id is null or sc.unit_id is null or lc.unit_id=sc.unit_id
        then coalesce(lc.unit_id,sc.unit_id) else null end)
    left join public.ledger_entries ml on p.source_type='manual' and ml.id=p.source_id and ml.payment_id=p.id
    join public.buildings pb on pb.id=coalesce(u.building_id,ml.building_id) and pb.project_id=p_project_id
    where p.source_type<>'daily_booking' and p.payment_date between trend_start and today
      and (p.unit_id is null or u.id is not null)
  ), classified as materialized (
    select p.*,case
      when p.amount::text in ('NaN','Infinity','-Infinity') or p.amount=0
        or p.exchange_rate_to_xof is null or p.exchange_rate_to_xof<=0
        or p.exchange_rate_to_xof::text in ('NaN','Infinity','-Infinity')
        or (p.currency='XOF' and p.exchange_rate_to_xof<>1)
        or p.payment_method='offset'
        or (nullif(p.payment_method,'') is not null and p.payment_method not in ('cash','check','bank_transfer','other')) then null
      when p.source_type in ('lease_deposit','lease_deposit_refund','lease_deposit_deduction',
        'daily_credit','daily_payment_pending') or p.source_type like '%expense' then null
      when p.reversal_of_payment_id is not null or p.request_kind like '%reversal%' or p.amount<0 then null
      when p.source_type='manual' then case when p.manual_direction='income'
        and p.manual_amount_xof=round(p.amount*p.exchange_rate_to_xof,2)
        and p.manual_date=p.payment_date and p.manual_building_id=p.building_id
        and p.manual_category<>'sale_non_cash_consideration' then round(p.amount*p.exchange_rate_to_xof,2) else null end
      when p.source_type in ('lease_rent_refund','sale_refund') then -round(p.amount*p.exchange_rate_to_xof,2)
      when p.source_type in ('lease_rent','lease_contract','sale','sale_contract','property_fee',
        'parking_fee','lease_agency_income','lease_furniture_income','lease_other_income',
        'sale_agency_income','sale_other_income','sale_registration_fee') then round(p.amount*p.exchange_rate_to_xof,2)
      else null end cash_xof,
      case when p.source_type in ('sale','sale_contract','sale_agency_income','sale_other_income','sale_registration_fee','sale_refund') then 'sale'
        when p.source_type in ('property_fee','parking_fee','manual') then 'asset' else 'lease' end business,
      (p.native_settlement or p.source_type in ('lease_deposit','lease_deposit_refund','lease_deposit_deduction','daily_credit','daily_payment_pending')
        or p.source_type like '%expense'
        or (p.source_type='manual' and coalesce(p.manual_direction in ('expense','liability_in','liability_out'),false))) non_collection
    from visible_payments p
  ), receivables as materialized (
    select r.*,u.unit_no,b.display_name building_name,
      greatest(r.amount_xof-r.paid_amount_xof,0) balance
    from public.receivables r left join public.units u on u.id=r.unit_id
    join public.buildings b on b.id=coalesce(r.building_id,u.building_id)
    where b.project_id=p_project_id and r.status<>'cancelled'
  ), managed as materialized (
    select * from receivables where management_status='managed'
  ), leases as materialized (
    select l.*,u.unit_no from public.lease_contracts l join visible_units u on u.id=l.unit_id
    where l.status='active'
  ), native_groups as (
    select distinct rent_currency currency from leases where rent_currency<>'XOF'
  ), native_totals as (
    select g.currency,
      coalesce((select sum(c.amount) from classified c where c.native_settlement and c.currency=g.currency and c.payment_date>=month_start and c.payment_method is distinct from 'offset'),0) income,
      0 expense,0 liability_in,0 liability_out,
      coalesce((select sum(amount_native) from managed r where r.currency=g.currency and r.due_date<=today),0) receivable,
      coalesce((select sum(paid_amount_native) from managed r where r.currency=g.currency and r.due_date<=today),0) paid,
      coalesce((select sum(greatest(amount_native-paid_amount_native,0)) from managed r where r.currency=g.currency and r.due_date<=today),0) outstanding,
      coalesce((select sum(greatest(amount_native-paid_amount_native,0)) from managed r where r.currency=g.currency and r.due_date<today),0) overdue
    from native_groups g
  ), sales as materialized (
    select s.*,u.unit_no from public.sale_contracts s join visible_units u on u.id=s.unit_id
    where s.status in ('active','draft')
  ), renewals as materialized (
    select * from leases where expected_end_confirmed and expected_end_date between today and today+30
  ), asset_attention as materialized (
    select * from visible_units where operational_condition<>'normal'
      or not occupancy_verified or construction_status='unverified'
  ), sale_attention as materialized (
    select * from sales where status='draft' or not total_amount_confirmed
  ), months as (
    select generate_series(trend_start::timestamp,month_start::timestamp,interval '1 month')::date bucket
  ), series as (
    select m.bucket,jsonb_build_object('month',to_char(m.bucket,'YYYY-MM'),
      'net',coalesce(sum(c.cash_xof),0)+coalesce((trend->to_char(m.bucket,'YYYY-MM')->>'net')::numeric,0),
      'count',count(c.id) filter(where c.cash_xof is not null)+coalesce((trend->to_char(m.bucket,'YYYY-MM')->>'count')::bigint,0),
      'excluded',count(c.id) filter(where c.cash_xof is null and not c.non_collection)
        +coalesce((trend->to_char(m.bucket,'YYYY-MM')->>'excluded')::bigint,0)) doc
    from months m left join classified c on date_trunc('month',c.payment_date::timestamp)::date=m.bucket
    group by m.bucket
  ) select jsonb_build_object(
    'nativeSummary',coalesce((select jsonb_agg(to_jsonb(nt) order by currency) from native_totals nt),'[]'::jsonb),
    'projectId',p_project_id,'asOf',today,'monthStart',month_start,'generatedAt',statement_timestamp(),
    'netCollected',coalesce((select sum(cash_xof) from classified where payment_date>=month_start),0)+daily_net,
    'excludedCount',daily_excluded+coalesce((select count(*) from classified where payment_date>=month_start
      and cash_xof is null and not non_collection),0),
    'dueOutstanding',coalesce((select sum(balance) from managed where due_date<=today),0),
    'overdue',coalesce((select sum(balance) from managed where due_date<today),0),
    'upcoming',coalesce((select sum(balance) from managed where due_date>today and due_date<=today+15),0),
    'historicalPending',coalesce((select count(*) from receivables where management_status='historical_pending' and balance>0),0),
    'attentionCount',(select count(*) from renewals)+(select count(*) from asset_attention)+(select count(*) from sale_attention),
    'assetCount',(select count(*) from visible_units),
    'assetAttention',(select count(*) from asset_attention),
    'leaseCount',(select count(*) from leases),'renewalCount',(select count(*) from renewals),
    'saleCount',(select count(*) from sales),'saleAttention',(select count(*) from sale_attention),
    'dailyInHouse',(select count(*) from public.daily_bookings d join visible_units u on u.id=d.unit_id where d.status='checked_in'),
    'dailyNet',daily_net,
    'businessNet',jsonb_build_object(
      'lease',coalesce((select sum(cash_xof) from classified where payment_date>=month_start and business='lease'),0),
      'sale',coalesce((select sum(cash_xof) from classified where payment_date>=month_start and business='sale'),0),
      'asset',coalesce((select sum(cash_xof) from classified where payment_date>=month_start and business='asset'),0)),
    'trend',coalesce((select jsonb_agg(doc order by bucket) from series),'[]'::jsonb),
    'dueItems',coalesce((select jsonb_agg(doc order by due_date,id) from (
      select due_date,id,jsonb_build_object('id',id,'date',due_date,'title',title,'unit',unit_no,
        'building',building_name,'balance',balance,'sourceType',source_type) doc
      from managed where balance>0 and due_date<=today order by due_date,id limit 8
    ) x),'[]'::jsonb),
    'renewals',coalesce((select jsonb_agg(jsonb_build_object('id',id,'unit',unit_no,'date',expected_end_date)
      order by expected_end_date,id) from (select * from renewals order by expected_end_date,id limit 5) x),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.management_operating_snapshot_rpc(uuid) from public,anon,service_role;
grant execute on function public.management_operating_snapshot_rpc(uuid) to authenticated;
comment on function public.management_operating_snapshot_rpc(uuid) is
  'Project-scoped operating dashboard; existing RLS; cash receipts exclude deposits, operating expenses, offsets and unclassified corrections. Daily uses audited daily_receipts_read_rpc. Receivables are current managed balances, not cash.';
notify pgrst,'reload schema';

commit;
