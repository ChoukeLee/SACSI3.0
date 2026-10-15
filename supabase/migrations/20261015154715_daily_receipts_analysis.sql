begin;

-- Reporting only: no receipt/booking/ledger row is changed and no table grant is widened.
-- Cash movements stay in their recorded payment month. A later reversal does not
-- rewrite the original month, and a refund is never inferred from a negative sign.
create function public.daily_receipts_read_rpc(
  p_input jsonb default '{}', p_page integer default 1, p_export boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  result jsonb;
  key text;
  d date;
  dates date[] := '{}';
  building_filter uuid;
  payment_filter uuid;
  search_filter text;
  method_filter text;
  kind_filter text;
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','finance','boss'),false) then
    raise exception 'dailyReceiptsPermissionDenied' using errcode='42501';
  end if;
  if p_input is null or jsonb_typeof(p_input)<>'object'
    or p_page is null or p_page<1 or p_page>2000000 or p_export is null then
    raise exception 'invalidDailyReceiptsFilter';
  end if;
  if exists(select 1 from jsonb_object_keys(p_input) x where x not in (
    'dateFrom','dateTo','previousFrom','previousTo','yearFrom','yearTo',
    'trendFrom','trendTo','buildingId','paymentId','query','method','kind')) then
    raise exception 'invalidDailyReceiptsFilter';
  end if;
  foreach key in array array['dateFrom','dateTo','previousFrom','previousTo',
    'yearFrom','yearTo','trendFrom','trendTo'] loop
    if jsonb_typeof(p_input->key) is distinct from 'string'
      or (p_input->>key) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalidDailyReceiptsDateRange';
    end if;
    begin
      d := (p_input->>key)::date;
    exception when others then raise exception 'invalidDailyReceiptsDateRange'; end;
    if to_char(d,'YYYY-MM-DD')<>p_input->>key then
      raise exception 'invalidDailyReceiptsDateRange';
    end if;
    dates := array_append(dates,d);
  end loop;
  for i in 0..3 loop
    if dates[2*i+1]>dates[2*i+2] or dates[2*i+2]-dates[2*i+1]>365 then
      raise exception 'invalidDailyReceiptsDateRange';
    end if;
  end loop;
  if p_input ? 'buildingId' and jsonb_typeof(p_input->'buildingId') not in ('string','null') then
    raise exception 'invalidDailyReceiptsFilter';
  end if;
  begin building_filter := nullif(nullif(p_input->>'buildingId',''),'all')::uuid;
  exception when others then raise exception 'invalidDailyReceiptsFilter'; end;
  if p_input ? 'paymentId' and jsonb_typeof(p_input->'paymentId') not in ('string','null') then
    raise exception 'invalidDailyReceiptsFilter';
  end if;
  begin payment_filter := nullif(p_input->>'paymentId','')::uuid;
  exception when others then raise exception 'invalidDailyReceiptsFilter'; end;
  if p_input ? 'query' and jsonb_typeof(p_input->'query')<>'string' then
    raise exception 'invalidDailyReceiptsFilter';
  end if;
  search_filter := btrim(coalesce(p_input->>'query',''));
  method_filter := coalesce(p_input->>'method','all');
  kind_filter := coalesce(p_input->>'kind','all');
  if length(search_filter)>120 or method_filter not in (
    'all','cash','check','bank_transfer','offset','other','unknown')
    or kind_filter not in ('all','collection','refund','reversal','excluded') then
    raise exception 'invalidDailyReceiptsFilter';
  end if;
  -- Explicit project gate supplements existing table RLS; inaccessible IDs do
  -- not become an alternate route into payment rows with a legacy null unit_id.
  if building_filter is not null and not public.can_access_building(building_filter) then
    raise exception 'dailyReceiptsPermissionDenied' using errcode='42501';
  end if;

  -- Evaluate each table's existing RLS once, before joining. Without these
  -- fences, conservative RLS cardinality estimates can repeatedly scan the
  -- payments/customers tables inside nested loops across every building.
  with visible_payments as materialized (
    select p.* from public.payments p where p.source_type='daily_booking'
  ), visible_bookings as materialized (
    select b.* from public.daily_bookings b
  ), visible_units as materialized (
    select u.* from public.units u
  ), visible_buildings as materialized (
    select b.* from public.buildings b where public.can_access_project(b.project_id)
  ), visible_customers as materialized (
    select c.id,c.name from public.customers c
  ), reversal_targets as materialized (
    select distinct reversal_of_payment_id id from visible_payments
    where reversal_of_payment_id is not null
  ), original_receipts as materialized (
    select original.* from visible_payments original
    join reversal_targets target on target.id=original.id
  ), scoped as materialized (
    select p.id,p.payment_date dt,p.created_at,p.source_id booking_id,
      coalesce(p.unit_id,booking.unit_id) unit_id,u.unit_no room,
      b.id building_id,b.code building_code,b.display_name building_name,
      coalesce(nullif(btrim(booking.guest_name),''),guest.name) guest_name,
      agent.name booking_agent_name,p.receipt_no,p.payment_method,p.amount,
      p.currency::text currency,p.exchange_rate_to_xof,p.request_kind,p.reversal_of_payment_id,
      p.notes,original.id original_id,original.amount original_amount,
      original.currency::text original_currency,original.source_type original_source_type,
      original.source_id original_booking_id,original.exchange_rate_to_xof original_rate,
      original.unit_id original_unit_id,p.unit_id recorded_unit_id,
      original.payment_method original_method,original.request_kind original_kind,
      original.reversal_of_payment_id original_reversal,
      case when p.request_kind='daily_reversal' and p.reversal_of_payment_id is not null
        then coalesce(nullif(p.payment_method,''),original.payment_method)
        else p.payment_method end effective_method
    from visible_payments p
    left join visible_bookings booking on booking.id=p.source_id
    join visible_units u on u.id=coalesce(p.unit_id,booking.unit_id)
    join visible_buildings b on b.id=u.building_id
    left join visible_customers guest on guest.id=booking.guest_customer_id
    left join visible_customers agent on agent.id=coalesce(booking.booking_agent_id,booking.customer_id)
    -- Look outside the requested period: cross-month reversals are legitimate.
    left join original_receipts original on original.id=p.reversal_of_payment_id
  ), classified as materialized (
    select s.*,case
      when currency<>'XOF' then 'non_xof'
      when exchange_rate_to_xof<>1 then 'currency_rate_mismatch'
      when amount is null or amount::text in ('NaN','Infinity','-Infinity')
        or amount=0 or amount<>trunc(amount) then 'invalid_amount'
      when effective_method='offset' then 'non_cash_offset'
      -- Legacy receipts may not record a method; retain their amount without
      -- inventing a cash method. Explicit unsupported methods remain excluded.
      when nullif(effective_method,'') is not null and effective_method not in ('cash','check','bank_transfer','other')
        then 'unknown_payment_method'
      when request_kind='daily_reversal' and (
        reversal_of_payment_id is null or original_id is null
        or original_source_type<>'daily_booking' or original_booking_id is distinct from booking_id
        or original_unit_id is distinct from recorded_unit_id
        or original_currency<>'XOF' or original_rate<>1 or original_amount<=0
        or original_amount::text in ('NaN','Infinity','-Infinity')
        or original_amount<>trunc(original_amount) or amount<>-original_amount
        or original_reversal is not null
        or original_kind in ('daily_refund','daily_partial_refund','daily_reversal')
        or (nullif(original_method,'') is not null and original_method not in ('cash','check','bank_transfer','other'))
      ) then 'invalid_reversal'
      when request_kind='daily_refund' and (amount>=0 or reversal_of_payment_id is not null)
        then 'invalid_refund'
      -- One legacy workflow records actual partial refunds with an original
      -- receipt link. Its explicit kind alone is insufficient: retain the
      -- negative cash movement only with the matching expense ledger evidence.
      when request_kind='daily_partial_refund' and (
        amount>=0 or reversal_of_payment_id is null or original_id is null
        or original_source_type<>'daily_booking' or original_booking_id is distinct from booking_id
        or original_unit_id is distinct from recorded_unit_id
        or original_currency<>'XOF' or original_rate<>1 or original_amount<=0
        or original_amount::text in ('NaN','Infinity','-Infinity')
        or original_amount<>trunc(original_amount) or -amount>original_amount
        or original_reversal is not null or original_kind in ('daily_refund','daily_partial_refund','daily_reversal')
        or (nullif(original_method,'') is not null and original_method not in ('cash','check','bank_transfer','other'))
        or not exists(select 1 from public.ledger_entries l where l.payment_id=s.id
          and l.direction='expense' and l.category='daily_rental' and l.amount_xof=-s.amount)
      ) then 'invalid_partial_refund'
      when reversal_of_payment_id is not null and coalesce(request_kind,'') not in ('daily_reversal','daily_partial_refund')
        then 'unrecognized_reversal'
      when amount<0 and coalesce(request_kind,'') not in ('daily_refund','daily_partial_refund','daily_reversal')
        then 'unclassified_negative'
      else null end exclusion_reason
    from scoped s
  ), labeled as materialized (
    select c.*,case when exclusion_reason is not null then 'excluded'
      when request_kind='daily_reversal' then 'reversal'
      when request_kind in ('daily_refund','daily_partial_refund') then 'refund' else 'collection' end kind
    from classified c
  ), filtered as materialized (
    select l.* from labeled l
    where (building_filter is null or building_id=building_filter)
      and (payment_filter is null or id=payment_filter)
      and (search_filter='' or position(lower(search_filter) in lower(concat_ws(' ',
        room,building_name,guest_name,booking_agent_name,receipt_no,booking_id::text)))>0)
      and (method_filter='all' or coalesce(nullif(effective_method,''),'unknown')=method_filter)
      and (kind_filter='all' or kind=kind_filter)
  ), periods as (
    select 'summary' name,dates[1] date_from,dates[2] date_to
    union all select 'previous',dates[3],dates[4]
    union all select 'year',dates[5],dates[6]
  ), summaries as (
    select periods.name,jsonb_build_object(
      'gross',coalesce(sum(amount) filter(where kind='collection'),0),
      'refund',coalesce(sum(-amount) filter(where kind='refund'),0),
      'adjustment',coalesce(sum(amount) filter(where kind='reversal'),0),
      'net',coalesce(sum(amount) filter(where kind<>'excluded'),0),
      'count',count(f.id) filter(where kind<>'excluded'),
      'excludedCount',count(f.id) filter(where kind='excluded')) doc
    from periods left join filtered f on f.dt between periods.date_from and periods.date_to
    group by periods.name
  ), months as (
    select generate_series(date_trunc('month',dates[7]::timestamp),
      date_trunc('month',dates[8]::timestamp),interval '1 month')::date bucket
  ), trends as (
    select m.bucket,jsonb_build_object('month',to_char(m.bucket,'YYYY-MM'),
      'gross',coalesce(sum(amount) filter(where kind='collection'),0),
      'refund',coalesce(sum(-amount) filter(where kind='refund'),0),
      'adjustment',coalesce(sum(amount) filter(where kind='reversal'),0),
      'net',coalesce(sum(amount) filter(where kind<>'excluded'),0),
      'count',count(f.id) filter(where kind<>'excluded'),
      'excludedCount',count(f.id) filter(where kind='excluded')) doc
    from months m left join filtered f on date_trunc('month',f.dt::timestamp)::date=m.bucket
      and f.dt between dates[7] and dates[8]
    group by m.bucket
  ), current_rows as materialized (
    select * from filtered where dt between dates[1] and dates[2]
  ), detail as (
    select id,dt,created_at,jsonb_build_object('id',id,'date',dt,'createdAt',created_at,
      'bookingId',booking_id,'unitId',unit_id,'room',room,'buildingId',building_id,
      'buildingName',building_name,'guestName',guest_name,'bookingAgentName',booking_agent_name,
      'receiptNo',receipt_no,'paymentMethod',effective_method,
      'amount',case when amount::text in ('NaN','Infinity','-Infinity') then null else amount end,'currency',currency,
      'amountXof',case when kind<>'excluded' then amount else null end,
      'kind',kind,'exclusionReason',exclusion_reason,'reversalOf',reversal_of_payment_id,'notes',notes) doc
    from current_rows
    where not p_export or (select count(*) from current_rows)<=10000
    order by dt desc,created_at desc,id
    limit case when p_export then 10001 else 50 end
    offset case when p_export then 0 else (p_page-1)*50 end
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(doc order by dt desc,created_at desc,id) from detail),'[]'::jsonb),
    'total',(select count(*) from current_rows),
    'summary',(select doc from summaries where name='summary'),
    'previous',(select doc from summaries where name='previous'),
    'year',(select doc from summaries where name='year'),
    'trend',coalesce((select jsonb_agg(doc order by bucket) from trends),'[]'::jsonb),
    'coverage',(select jsonb_build_object('firstDate',min(dt),'lastDate',max(dt)) from scoped
      where building_filter is null or building_id=building_filter),
    'buildings',coalesce((select jsonb_agg(doc order by code,id) from (
      select distinct building_id id,building_code code,jsonb_build_object(
        'id',building_id,'code',building_code,'name',building_name) doc from scoped
    ) available_buildings),'[]'::jsonb),
    'generatedAt',statement_timestamp()) into result;
  if p_export and (result->>'total')::bigint>10000 then
    raise exception 'dailyReceiptsExportTooLarge';
  end if;
  return result;
end; $$;
revoke all on function public.daily_receipts_read_rpc(jsonb,integer,boolean) from public,anon;
grant execute on function public.daily_receipts_read_rpc(jsonb,integer,boolean) to authenticated;
comment on function public.daily_receipts_read_rpc(jsonb,integer,boolean) is
  'Read-only daily rental XOF receipt analysis, authenticated finance roles, existing RLS and project scope, one snapshot; excluded records remain visible, exports fail above 10000 rows.';

create index if not exists payments_daily_receipts_date_idx
  on public.payments(payment_date desc,created_at desc,id)
  where source_type='daily_booking';

notify pgrst,'reload schema';

commit;
