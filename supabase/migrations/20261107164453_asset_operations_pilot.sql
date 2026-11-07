begin;

-- Supplemental catalog: a source row is not an occupied unit, contract or receipt.
-- Keep this additive so the established rental and finance records remain intact.
create table public.asset_operation_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  unit_id uuid references public.units(id),
  source_key text not null check(length(source_key) between 1 and 160),
  source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{64}$'),
  code text not null check(length(code) between 1 and 100),
  name text not null check(length(name) between 1 and 200),
  asset_group text not null check(length(asset_group) between 1 and 80),
  source_refs jsonb not null check(jsonb_typeof(source_refs)='array' and jsonb_array_length(source_refs)>0),
  monthly_rent_native numeric(20,2) check(monthly_rent_native>0 and monthly_rent_native::text not in ('NaN','Infinity','-Infinity')),
  rent_currency text check(rent_currency in ('XOF','CNY','USD')),
  verification text not null default 'pending' check(verification in ('pending','verified')),
  verified_by uuid references auth.users(id), verified_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id,source_key),
  check((monthly_rent_native is null)=(rent_currency is null)),
  check((verification='pending' and verified_by is null and verified_at is null) or
    (verification='verified' and verified_by is not null and verified_at is not null))
);
create unique index asset_operation_canonical_unit on public.asset_operation_assets(unit_id) where unit_id is not null;
create index asset_operation_project_group on public.asset_operation_assets(project_id,asset_group,code);

-- Immutable, source-backed management entries. They do not insert receipts or
-- mutate the existing ledger; a linked payment/ledger is an attribution only.
create table public.asset_operation_entries (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.asset_operation_assets(id),
  kind text not null check(kind in ('income','expense','deposit_in','deposit_out')),
  category text not null default 'other' check(category in ('rent','property_fee','maintenance','utilities','cleaning','security','payroll','tax','commission','insurance','other','deposit')),
  amount_native numeric(20,2) not null check(amount_native>0 and amount_native::text not in ('NaN','Infinity','-Infinity')),
  currency text not null check(currency in ('XOF','CNY','USD')),
  cash_date date, period_start date, period_end date,
  verification text not null check(verification in ('pending','verified')),
  recognition_method text not null default 'unallocated' check(recognition_method in ('unallocated','daily')),
  source_ref text not null check(length(source_ref) between 1 and 500),
  description text not null default '' check(length(description)<=2000),
  payment_id uuid references public.payments(id), ledger_entry_id uuid references public.ledger_entries(id),
  recorded_by uuid not null references auth.users(id),
  request_id uuid not null unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  verified_by uuid references auth.users(id), verified_at timestamptz,
  voided_by uuid references auth.users(id), voided_at timestamptz, void_reason text,
  check(cash_date is not null or period_start is not null),
  check((period_start is null and period_end is null) or
    (period_start is not null and period_end is not null and period_start<=period_end)),
  check(kind in ('income','expense') or period_start is null),
  check(recognition_method='unallocated' or (kind in ('income','expense') and period_start is not null)),
  check((verification='pending' and verified_by is null and verified_at is null) or
    (verification='verified' and verified_by is not null and verified_at is not null)),
  check((voided_by is null and voided_at is null and void_reason is null) or
    (voided_by is not null and voided_at is not null and void_reason is not null and length(btrim(void_reason)) between 1 and 2000))
);
create unique index asset_operation_source_once on public.asset_operation_entries(asset_id,kind,source_ref) where voided_at is null;
create unique index asset_operation_payment_once on public.asset_operation_entries(payment_id) where payment_id is not null and voided_at is null;
create unique index asset_operation_ledger_once on public.asset_operation_entries(ledger_entry_id) where ledger_entry_id is not null and voided_at is null;
create index asset_operation_entry_asset on public.asset_operation_entries(asset_id,created_at,id);

create table private.asset_operation_requests (
  request_id uuid primary key,actor_id uuid not null,operation text not null,
  payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table public.asset_operation_assets enable row level security;
alter table public.asset_operation_entries enable row level security;
alter table private.asset_operation_requests enable row level security;
revoke all on public.asset_operation_assets,public.asset_operation_entries,private.asset_operation_requests from public,anon,authenticated,service_role;
grant select on public.asset_operation_assets,public.asset_operation_entries to authenticated;
create policy asset_operation_assets_read on public.asset_operation_assets for select to authenticated
  using(public.has_app_role('admin','boss','finance') and public.can_access_project(project_id));
create policy asset_operation_entries_read on public.asset_operation_entries for select to authenticated
  using(exists(select 1 from public.asset_operation_assets a where a.id=asset_id));

-- This private definer is needed because direct table DML is intentionally not
-- granted. Actor, current database role and project permission precede replay.
create function private.asset_operations_write(p_operation text,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); project uuid; asset public.asset_operation_assets%rowtype; entry public.asset_operation_entries%rowtype;
  previous private.asset_operation_requests%rowtype; row_input jsonb; existing public.asset_operation_assets%rowtype;
  result jsonb; entity uuid; before_data jsonb; ids jsonb:='[]';
  v_source_key text; fingerprint text; source_refs jsonb; unit uuid; unit_project uuid;
  amount numeric; rent numeric; currency text; dt date; starts date; ends date;
  payment uuid; ledger uuid; pay public.payments%rowtype; le public.ledger_entries%rowtype;
  v_direction text; status text; ref text; expected timestamptz; recognition text; v_category text;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or not coalesce(public.has_app_role('admin','finance'),false) then
    raise exception 'assetOperationPermissionDenied' using errcode='42501';
  end if;
  if p_operation is null or p_operation not in ('import_catalog','confirm_asset','create_entry','confirm_entry','void_entry')
    or p_input is null or jsonb_typeof(p_input)<>'object' or p_request_id is null then
    raise exception 'invalidAssetOperation';
  end if;
  if p_operation='import_catalog' then
    if not public.has_app_role('admin') then raise exception 'assetOperationPermissionDenied' using errcode='42501'; end if;
    project:=(p_input->>'projectId')::uuid;
  elsif p_operation in ('confirm_entry','void_entry') then
    select * into entry from public.asset_operation_entries where id=(p_input->>'entryId')::uuid;
    if entry.id is null then raise exception 'assetOperationNotFound'; end if;
    select * into strict asset from public.asset_operation_assets where id=entry.asset_id;
    project:=asset.project_id;
  else
    select * into asset from public.asset_operation_assets where id=(p_input->>'assetId')::uuid;
    if asset.id is null then raise exception 'assetOperationNotFound'; end if;
    project:=asset.project_id;
  end if;
  if project is null or not coalesce(public.can_access_project(project),false) then
    raise exception 'assetOperationAccessDenied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('asset-operation-request:'||p_request_id,0));
  select * into previous from private.asset_operation_requests where request_id=p_request_id;
  if found then
    if previous.actor_id<>actor or previous.operation<>p_operation or previous.payload<>p_input then
      raise exception 'requestIdConflict';
    end if;
    return previous.result||jsonb_build_object('idempotent',true);
  end if;
  if p_operation='import_catalog' then
    fingerprint:=lower(p_input->>'sourceFingerprint');
    if fingerprint is null or fingerprint !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_input->'assets') is distinct from 'array'
      or jsonb_array_length(p_input->'assets') not between 1 and 1000 then raise exception 'invalidAssetSource'; end if;
    perform pg_advisory_xact_lock(hashtextextended('asset-operation-catalog:'||project,0));
    for row_input in select value from jsonb_array_elements(p_input->'assets') loop
      v_source_key:=btrim(row_input->>'sourceKey'); source_refs:=row_input->'sourceRefs';
      unit:=nullif(row_input->>'unitId','')::uuid;
      rent:=nullif(row_input->>'monthlyRentNative','')::numeric; currency:=nullif(row_input->>'rentCurrency','');
      if v_source_key is null or length(v_source_key) not between 1 and 160
        or nullif(btrim(row_input->>'code'),'') is null or nullif(btrim(row_input->>'name'),'') is null
        or nullif(btrim(row_input->>'group'),'') is null
        or jsonb_typeof(source_refs) is distinct from 'array' or jsonb_array_length(source_refs)=0
        or exists(select 1 from jsonb_array_elements(source_refs) r where jsonb_typeof(r)<>'string' or nullif(btrim(r#>>'{}'),'') is null)
        or (rent is null)<>(currency is null)
        or (rent is not null and (rent<=0 or rent::text in ('NaN','Infinity','-Infinity') or round(rent,2)<>rent or currency not in ('XOF','CNY','USD')))
        then raise exception 'invalidAssetSource'; end if;
      if unit is not null then
        select b.project_id into unit_project from public.units u join public.buildings b on b.id=u.building_id where u.id=unit;
        if unit_project is distinct from project then raise exception 'assetUnitProjectMismatch'; end if;
      end if;
      select * into existing from public.asset_operation_assets where project_id=project and source_key=v_source_key;
      if found then
        -- A new workbook version may add assets without changing existing
        -- content. Keep its original fingerprint and retain the new version in
        -- this import's audit/request; changed identity, amount or refs need review.
        if existing.unit_id is distinct from unit
          or existing.code<>btrim(row_input->>'code') or existing.name<>btrim(row_input->>'name')
          or existing.asset_group<>btrim(row_input->>'group') or existing.source_refs<>source_refs
          or existing.monthly_rent_native is distinct from rent or existing.rent_currency is distinct from currency then
          raise exception 'assetSourceChanged';
        end if;
        entity:=existing.id;
      else
        insert into public.asset_operation_assets(project_id,unit_id,source_key,source_fingerprint,code,name,asset_group,source_refs,monthly_rent_native,rent_currency,created_by)
        values(project,unit,v_source_key,fingerprint,btrim(row_input->>'code'),btrim(row_input->>'name'),btrim(row_input->>'group'),source_refs,rent,currency,actor)
        returning id into entity;
      end if;
      ids:=ids||jsonb_build_array(entity);
    end loop;
    result:=jsonb_build_object('success',true,'data',jsonb_build_object('assetIds',ids));
  else
    select * into strict asset from public.asset_operation_assets where id=asset.id for update;
    expected:=nullif(p_input->>'expectedUpdatedAt','')::timestamptz;
    if p_operation not in ('confirm_entry','void_entry') and (expected is null or asset.updated_at is distinct from expected) then raise exception 'assetOperationRecordChanged'; end if;
    before_data:=to_jsonb(asset); entity:=asset.id;
    if p_operation in ('confirm_entry','void_entry') then
      select * into strict entry from public.asset_operation_entries where id=entry.id for update;
      if expected is null or entry.updated_at is distinct from expected then raise exception 'assetOperationRecordChanged'; end if;
      if entry.voided_at is not null then raise exception 'assetEntryAlreadyVoided'; end if;
      if nullif(btrim(p_input->>'reason'),'') is null or length(p_input->>'reason')>2000 then raise exception 'assetConfirmationRequired'; end if;
      before_data:=to_jsonb(entry);
      if p_operation='void_entry' then
        update public.asset_operation_entries set voided_by=actor,voided_at=clock_timestamp(),void_reason=btrim(p_input->>'reason'),updated_at=clock_timestamp()
          where id=entry.id returning id into entity;
      else
        if asset.verification<>'verified' or entry.verification<>'pending' then raise exception 'assetConfirmationRequired'; end if;
        update public.asset_operation_entries set verification='verified',verified_by=actor,verified_at=clock_timestamp(),updated_at=clock_timestamp()
          where id=entry.id returning id into entity;
      end if;
      result:=jsonb_build_object('success',true,'data',jsonb_build_object('entryId',entity));
    elsif p_operation='confirm_asset' then
      if nullif(btrim(p_input->>'reason'),'') is null or asset.verification<>'pending' then raise exception 'assetConfirmationRequired'; end if;
      update public.asset_operation_assets set verification='verified',verified_by=actor,verified_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=asset.id returning id into entity;
      result:=jsonb_build_object('success',true,'data',jsonb_build_object('assetId',entity));
    else
      amount:=(p_input->>'amountNative')::numeric; currency:=p_input->>'currency';
      dt:=nullif(p_input->>'cashDate','')::date; starts:=nullif(p_input->>'periodStart','')::date; ends:=nullif(p_input->>'periodEnd','')::date;
      status:=p_input->>'verification'; ref:=btrim(p_input->>'sourceRef');
      recognition:=coalesce(nullif(p_input->>'recognitionMethod',''),'unallocated');
      v_category:=coalesce(nullif(p_input->>'category',''),case when p_input->>'kind' in ('deposit_in','deposit_out') then 'deposit' else 'other' end);
      if amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') or round(amount,2)<>amount
        or coalesce(currency,'') not in ('XOF','CNY','USD')
        or coalesce(p_input->>'kind','') not in ('income','expense','deposit_in','deposit_out')
        or coalesce(status,'') not in ('pending','verified') or ref is null or length(ref) not between 1 and 500
        or (dt is null and starts is null) or (dt is not null and (not isfinite(dt) or dt>current_date))
        or (starts is null)<>(ends is null)
        or (starts is not null and (not isfinite(starts) or not isfinite(ends) or starts>ends))
        or (p_input->>'kind' in ('deposit_in','deposit_out') and starts is not null)
        or recognition not in ('unallocated','daily')
        or (recognition='daily' and (starts is null or p_input->>'kind' not in ('income','expense')))
        or v_category not in ('rent','property_fee','maintenance','utilities','cleaning','security','payroll','tax','commission','insurance','other','deposit')
        or (p_input->>'kind' in ('deposit_in','deposit_out') and v_category<>'deposit')
        or (p_input->>'kind' in ('income','expense') and v_category='deposit')
        then raise exception 'invalidAssetEntry'; end if;
      if status='verified' and asset.verification<>'verified' then raise exception 'assetConfirmationRequired'; end if;
      payment:=nullif(p_input->>'paymentId','')::uuid; ledger:=nullif(p_input->>'ledgerEntryId','')::uuid;
      v_direction:=case p_input->>'kind' when 'deposit_in' then 'liability_in' when 'deposit_out' then 'liability_out' else p_input->>'kind' end;
      if payment is not null and ledger is null then
        if (select count(*) from public.ledger_entries where payment_id=payment)<>1 then raise exception 'assetPaymentLinkMismatch'; end if;
        select id into ledger from public.ledger_entries where payment_id=payment;
      end if;
      if ledger is not null then
        select * into le from public.ledger_entries where id=ledger;
        if le.id is null or (payment is not null and le.payment_id is distinct from payment) then raise exception 'assetPaymentLinkMismatch'; end if;
        payment:=coalesce(payment,le.payment_id);
      end if;
      -- Match legacy financial operations' lock order: payment before ledger.
      -- Re-read and validate the ledger after acquiring both locks.
      if payment is not null then
        select * into pay from public.payments where id=payment for update;
        if pay.id is null or asset.unit_id is null or pay.unit_id is distinct from asset.unit_id
          or (dt is not null and pay.payment_date<>dt) or pay.currency::text<>currency or pay.amount<>amount
          or pay.payment_method='offset' or pay.reversal_of_payment_id is not null
          or coalesce(pay.request_kind,'') ilike '%reversal%' or coalesce(pay.request_kind,'') ilike '%correction%'
          or (pay.payment_method is not null and pay.payment_method not in ('cash','check','bank_transfer','other')) then
          raise exception 'assetPaymentLinkMismatch'; end if;
        -- A ledger direction alone cannot classify a receipt. Daily/correction
        -- events need their dedicated audited read models and are not accepted here.
        if p_input->>'kind' not in ('income','deposit_in') then raise exception 'assetPaymentLinkMismatch'; end if;
        if (p_input->>'kind'='deposit_in' and pay.source_type not in ('lease_deposit','manual','lease_contract'))
          or (p_input->>'kind'='income' and pay.source_type not in ('lease_rent','lease_contract','lease_agency_income',
            'lease_furniture_income','lease_other_income','sale','sale_contract','sale_agency_income','sale_registration_fee',
            'sale_other_income','property_fee','parking_fee','manual')) then raise exception 'assetPaymentLinkMismatch'; end if;
      end if;
      if ledger is not null then
        select * into le from public.ledger_entries where id=ledger for update;
        if le.id is null or asset.unit_id is null or le.unit_id is distinct from asset.unit_id
          or (dt is not null and (payment is null or le.entry_date<>dt))
          or le.direction<>v_direction or le.currency::text is distinct from currency
          or (case when le.currency='XOF' then le.amount_xof else le.amount_native end) is distinct from amount
          or le.payment_id is distinct from payment then raise exception 'assetPaymentLinkMismatch'; end if;
      end if;
      if exists(select 1 from public.asset_operation_entries e where e.voided_at is null and
        ((e.asset_id=asset.id and e.kind=p_input->>'kind' and e.source_ref=ref)
        or (payment is not null and e.payment_id=payment) or (ledger is not null and e.ledger_entry_id=ledger))) then raise exception 'assetSourceAlreadyRecorded'; end if;
      insert into public.asset_operation_entries(asset_id,kind,category,amount_native,currency,cash_date,period_start,period_end,verification,recognition_method,source_ref,description,payment_id,ledger_entry_id,recorded_by,request_id,verified_by,verified_at)
      values(asset.id,p_input->>'kind',v_category,amount,currency,dt,starts,ends,status,recognition,ref,coalesce(p_input->>'description',''),payment,ledger,actor,p_request_id,
        case when status='verified' then actor end,case when status='verified' then clock_timestamp() end)
      returning id into entity;
      result:=jsonb_build_object('success',true,'data',jsonb_build_object('entryId',entity));
    end if;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,metadata)
  values(actor,'asset_operations_'||p_operation,'asset_operation',entity,before_data,
    jsonb_build_object('request_id',p_request_id,'project_id',project,'input',p_input,'channel','asset_operations_write_rpc'));
  insert into private.asset_operation_requests(request_id,actor_id,operation,payload,result)
    values(p_request_id,actor,p_operation,p_input,result);
  return result||jsonb_build_object('idempotent',false);
end $$;
revoke all on function private.asset_operations_write(text,jsonb,uuid) from public,anon,service_role;
grant execute on function private.asset_operations_write(text,jsonb,uuid) to authenticated;
create function public.asset_operations_write_rpc(p_operation text,p_input jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.asset_operations_write(p_operation,p_input,p_request_id) $$;
revoke all on function public.asset_operations_write_rpc(text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.asset_operations_write_rpc(text,jsonb,uuid) to authenticated;

create function public.asset_operations_read_rpc(p_project_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','boss','finance'),false) then
    raise exception 'assetOperationPermissionDenied' using errcode='42501'; end if;
  if p_project_id is null or not coalesce(public.can_access_project(p_project_id),false) then
    raise exception 'assetOperationAccessDenied' using errcode='42501'; end if;
  return jsonb_build_object('projectId',p_project_id,
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'projectId',a.project_id,'unitId',a.unit_id,
      'code',a.code,'name',a.name,'group',a.asset_group,'verification',a.verification,'sourceRefs',a.source_refs,
      'monthlyRentNative',a.monthly_rent_native,'rentCurrency',a.rent_currency,'costCoverageThrough',null,
      'updatedAt',a.updated_at) order by a.asset_group,a.code,a.id) from public.asset_operation_assets a where a.project_id=p_project_id),'[]'::jsonb),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'assetId',e.asset_id,'kind',e.kind,'category',e.category,
      'amountNative',e.amount_native,'currency',e.currency,'cashDate',e.cash_date,'periodStart',e.period_start,'periodEnd',e.period_end,
      'verification',e.verification,'recognitionMethod',e.recognition_method,'sourceRef',e.source_ref,'description',e.description,
      'updatedAt',e.updated_at,'voidedAt',e.voided_at,'voidReason',e.void_reason) order by e.created_at,e.id)
      from public.asset_operation_entries e join public.asset_operation_assets a on a.id=e.asset_id where a.project_id=p_project_id),'[]'::jsonb),
    'canWrite',public.has_app_role('admin','finance'),'asOf',statement_timestamp());
end $$;
revoke all on function public.asset_operations_read_rpc(uuid) from public,anon,service_role;
grant execute on function public.asset_operations_read_rpc(uuid) to authenticated;

comment on table public.asset_operation_assets is 'Source-backed supplemental asset catalog; pending rows never prove occupancy, ownership, contracts or payment.';
comment on table public.asset_operation_entries is 'Immutable management attribution with separate cash and service dates; no automatic posting to payments or the legacy ledger.';
commit;
