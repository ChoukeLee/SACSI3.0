begin;

-- Read model only: all totals are calculated in one database snapshot under
-- existing RLS. This does not infer ownership, historical collectors or cash
-- from receivable allocation balances.
create function public.management_operating_snapshot_rpc(p_project_id uuid)
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
      (p.source_type in ('lease_deposit','lease_deposit_refund','lease_deposit_deduction','daily_credit','daily_payment_pending')
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
