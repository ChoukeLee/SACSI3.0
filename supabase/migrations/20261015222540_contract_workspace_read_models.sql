begin;

-- Fixed business collation: natural numbers, base sensitivity, Chinese/Latin names.
create collation public.contract_workspace_order (provider=icu,locale='zh-u-kn-true-ks-level1',deterministic=false);

-- Read-only, caller-RLS-bound workspace. A page is never used as a financial total.
create function public.contract_workspace_read_rpc(p_kind text,p_input jsonb,p_mode text default 'list',p_contract_id uuid default null)
returns jsonb language plpgsql stable security invoker
set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare
 v_project uuid; v_building uuid; v_status text; v_search text; v_sort text; v_direction text;
 v_page integer; v_locale text; v_result jsonb; v_uid uuid := auth.uid();
begin
 if v_uid is null or not coalesce(public.has_app_role('admin','boss','finance','front_desk','rental_sales'),false)
    or (p_kind='sale' and not coalesce(public.has_app_role('admin','boss','finance','rental_sales'),false)) then
   raise exception 'ContractWorkspaceDenied' using errcode='42501';
 end if;
 if p_kind is null or p_mode is null or p_kind not in ('lease','sale') or p_mode not in ('list','scope','detail','context') or p_input is null or jsonb_typeof(p_input)<>'object'
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('projectId','buildingId','status','search','sort','direction','page','locale')) then
   raise exception 'ContractWorkspaceInvalid' using errcode='22023';
 end if;
 v_project:=nullif(p_input->>'projectId','')::uuid;
 v_building:=nullif(p_input->>'buildingId','')::uuid;
 v_status:=coalesce(p_input->>'status','current'); v_search:=coalesce(p_input->>'search','');
 v_sort:=coalesce(p_input->>'sort','unit');v_direction:=coalesce(p_input->>'direction','asc');
 v_page:=coalesce(p_input->>'page','1')::integer;v_locale:=coalesce(p_input->>'locale','zh');
 if v_status not in ('current','all','draft','active','terminated','expired') or length(v_search)>200 or v_page<1 or v_page>100000
  or v_sort not in ('unit','customer','period','amount','balance','status') or v_direction not in ('asc','desc') or v_locale not in ('zh','fr') then
   raise exception 'ContractWorkspaceInvalid' using errcode='22023';
 end if;
 if v_project is not null and not exists(select 1 from public.projects where id=v_project and is_active and (p_kind='lease' or allows_sale)) then
   raise exception 'ContractWorkspaceDenied' using errcode='42501';
 end if;
 if v_building is not null and not exists(select 1 from public.buildings b join public.projects p on p.id=b.project_id where b.id=v_building and b.is_active and p.is_active and (v_project is null or p.id=v_project) and (p_kind='lease' or p.allows_sale)) then
   raise exception 'ContractWorkspaceDenied' using errcode='42501';
 end if;
 with
 b as materialized (select b.*,jsonb_build_object('id',p.id,'code',p.code,'display_name',p.display_name) project
   from public.buildings b join public.projects p on p.id=b.project_id where b.is_active and p.is_active and (p_kind='lease' or p.allows_sale)),
 u as materialized (select u.* from public.units u where u.building_id in (select id from b where (v_project is null or project_id=v_project) and (v_building is null or id=v_building))),
 c as materialized (
   select c.id,c.unit_id,c.customer_id,c.status::text status,c.start_date period,c.monthly_rent_xof amount,to_jsonb(c) data
    from public.lease_contracts c where p_kind='lease' and c.unit_id in(select id from u)
   union all
   select c.id,c.unit_id,c.customer_id,c.status::text,c.signed_date,c.total_amount_xof,to_jsonb(c)
    from public.sale_contracts c where p_kind='sale' and c.unit_id in(select id from u)),
 r as materialized (select r.*,greatest(0,r.amount_xof::double precision-r.paid_amount_xof::double precision) balance
    from public.receivables r where r.source_type=p_kind||'_contract' and r.source_id in(select id from c)
      and r.status<>'cancelled' and coalesce(r.management_status::text,'managed')='managed'),
 metrics as materialized (
   select source_id,count(*) n,sum(amount_xof::double precision) total,sum(paid_amount_xof::double precision) paid,
    sum(balance) outstanding,sum(case when status<>'paid' and due_date<current_date then balance else 0 end) overdue,
    sum(case when due_date<=current_date then balance else 0 end) due,
    min(due_date) filter(where balance>0) next_due,min(due_date) filter(where balance>0) open_due from r group by source_id),
 anchors as materialized (select c.id,c.status,c.amount,nullif(c.data->>'paid_through_date','')::date+1 first_day from c where p_kind='lease'),
 periods as materialized (select *,case when first_day is null or first_day>current_date then 0 else
   greatest(0,(extract(year from current_date)::int-extract(year from first_day)::int)*12+extract(month from current_date)::int-extract(month from first_day)::int
    -case when (first_day+make_interval(months=>(extract(year from current_date)::int-extract(year from first_day)::int)*12+extract(month from current_date)::int-extract(month from first_day)::int))::date>current_date then 1 else 0 end+1) end started from anchors),
 rent_parts as materialized (
   select p.id,p.status,p.amount,p.first_day,p.started,
    coalesce(sum(r.balance) filter(where r.due_date<p.first_day),0) prior,
    coalesce(sum(r.balance) filter(where r.due_date>=p.first_day),0) covered,
    coalesce(sum(least(greatest(0,r.amount_xof::double precision),greatest(0,r.paid_amount_xof::double precision))) filter(where r.due_date>=p.first_day),0) covered_paid,
    coalesce(sum(r.balance),0) all_due,min(r.due_date) all_date,min(r.due_date) filter(where r.balance>0) open_date
   from periods p left join r on r.source_id=p.id and r.category='lease_rent' and r.due_date<=current_date group by p.id,p.status,p.amount,p.first_day,p.started),
 rent_accrued as materialized (select *,greatest(0,started*greatest(0,amount::double precision)-covered_paid) accrued from rent_parts),
 accruals as materialized (select id,case when status<>'active' then null
   when first_day is null and all_due>0 then jsonb_build_object('dueDate',all_date,'amount',all_due,'source','receivable','startedPeriods',0)
   when first_day is not null and prior+greatest(covered,accrued)>0 then jsonb_build_object(
     'dueDate',case when started>0 and accrued>0 then least(coalesce(open_date,first_day),first_day) else coalesce(open_date,first_day) end,
     'amount',prior+greatest(covered,accrued),'source',case when accrued>covered then 'contract' else 'receivable' end,'startedPeriods',started)
   else null end accrual from rent_accrued),
 enriched as materialized (
  select c.*,u.building_id,u.unit_no,b.display_name building_name,cu.name customer_name,cu.phone,
   coalesce(m.n,0) n,coalesce(m.total,0) total,coalesce(m.paid,0) paid,coalesce(m.outstanding,0) outstanding,
   coalesce(m.overdue,0) overdue,coalesce(m.due,0) due,m.next_due,
   coalesce(m.open_due, nullif(c.data->>'paid_through_date','')::date+1) attention_due,
   a.accrual,
   lower(regexp_replace(normalize(concat_ws(' ',c.data->>'contract_no',b.display_name,u.unit_no,cu.name,cu.phone),NFD),U&'[\0300-\036f]','','g')) searchable
  from c join u on u.id=c.unit_id join b on b.id=u.building_id left join public.customers cu on cu.id=c.customer_id
  left join metrics m on m.source_id=c.id left join accruals a on a.id=c.id),
 status_rows as materialized (select * from enriched where v_status='all' or
   (v_status='current' and status<>'terminated' and (p_kind='lease' or status<>'expired')) or status=v_status),
 summary_rows as materialized (select * from enriched where p_kind='lease' or id in(select id from status_rows)),
 searched as materialized (select * from status_rows e where not exists(
   select 1 from regexp_split_to_table(lower(regexp_replace(normalize(trim(v_search),NFD),U&'[\0300-\036f]','','g')),'\s+') word where word<>'' and strpos(e.searchable,word)=0)),
 ordered as materialized (select e.*,row_number() over(order by
   case when v_sort in ('amount','balance') then case when v_sort='amount' then case when amount>0 then 0 else 1 end else case when n>0 then 0 else 1 end end else 0 end,
   case when v_direction='asc' and v_sort='amount' and amount>0 then amount end asc,
   case when v_direction='desc' and v_sort='amount' and amount>0 then amount end desc,
   case when v_direction='asc' and v_sort='balance' then outstanding end asc,
   case when v_direction='desc' and v_sort='balance' then outstanding end desc,
   case when v_direction='asc' and v_sort='period' then period end asc,
   case when v_direction='desc' and v_sort='period' then period end desc,
   (case when v_direction='asc' and v_sort='customer' then customer_name end) collate public.contract_workspace_order asc,
   (case when v_direction='desc' and v_sort='customer' then customer_name end) collate public.contract_workspace_order desc,
   (case when v_direction='asc' and v_sort='status' then case when v_locale='fr' then case status when 'active' then 'Actif' when 'draft' then 'Brouillon' when 'terminated' then 'Resilie' else 'Expire' end else case status when 'active' then '生效中' when 'draft' then '草稿' when 'terminated' then '已终止' else '已过期' end end end) collate public.contract_workspace_order asc,
   (case when v_direction='desc' and v_sort='status' then case when v_locale='fr' then case status when 'active' then 'Actif' when 'draft' then 'Brouillon' when 'terminated' then 'Resilie' else 'Expire' end else case status when 'active' then '生效中' when 'draft' then '草稿' when 'terminated' then '已终止' else '已过期' end end end) collate public.contract_workspace_order desc,
   (case when v_direction='asc' and v_sort='unit' then building_name end) collate public.contract_workspace_order asc,
   (case when v_direction='desc' and v_sort='unit' then building_name end) collate public.contract_workspace_order desc,
   (case when v_direction='asc' and v_sort='unit' then unit_no end) collate public.contract_workspace_order asc,
   (case when v_direction='desc' and v_sort='unit' then unit_no end) collate public.contract_workspace_order desc,id::text collate public.contract_workspace_order) ordinal from searched e),
 selected as materialized (select * from ordered where
    (p_mode='list' and ordinal between (v_page-1)*25+1 and v_page*25)
    or p_mode in ('scope','context')
    or (p_mode='detail' and id=p_contract_id)
   union all select e.*,0::bigint from enriched e where p_mode='detail' and id=p_contract_id and id not in(select id from ordered)),
 selected_units as materialized (select u.*,coalesce((select jsonb_agg(to_jsonb(f)) from public.unit_business_flags f where f.unit_id=u.id),'[]'::jsonb) unit_business_flags from u where p_mode='context' or id in(select unit_id from selected)),
 selected_customers as materialized (select cu.* from public.customers cu where p_mode='context' or cu.id in(select customer_id from selected)),
 detail_payments as materialized (select p.* from public.payments p where p_mode='detail' and p.source_id in(select id from selected) and p.source_type=any(case when p_kind='lease' then array['lease_rent','lease_deposit','lease_contract','property_fee','lease_agency_income','lease_agency_expense','lease_furniture_income','lease_deposit_refund','lease_deposit_deduction','lease_rent_refund','lease_other_income','lease_other_expense'] else array['sale','sale_contract','property_fee','parking_fee','sale_registration_fee','sale_agency_income','sale_agency_expense','sale_other_income','sale_other_expense'] end)),
 detail_receivables as materialized (select r.* from public.receivables r where p_mode='detail' and r.source_type=p_kind||'_contract' and r.source_id in(select id from selected)),
 detail_schedules as materialized (select s.* from public.sale_payment_schedule s where p_mode='detail' and p_kind='sale' and s.sale_contract_id in(select id from selected)),
 stats as (select jsonb_build_object('scopeCount',count(*),'active',count(*) filter(where status='active'),
   'rent',coalesce(sum(amount::double precision) filter(where status='active'),0),'total',coalesce(sum(amount::double precision) filter(where status='active'),0),
   'currentDue',coalesce(sum(outstanding),0),'outstanding',coalesce(sum(outstanding),0),'received',coalesce(sum(paid),0),
   'dueOutstanding',coalesce(sum(due),0),'overdue',coalesce(sum(overdue),0),'overdueContracts',count(*) filter(where overdue>0),
   'unknownContracts',count(*) filter(where n=0),'unknownAll',count(*)>0 and coalesce(sum(n),0)=0,
   'transferDone',count(*) filter(where status='active' and data->>'transfer_status'='completed'),
   'dueSoon',count(*) filter(where status='active' and accrual is null and attention_due<=current_date+15)) value from summary_rows)
 select jsonb_build_object('kind',p_kind,'mode',p_mode,'query',p_input,'today',current_date,
  'page',v_page,'pageSize',25,'total',(select count(*) from searched),'scopeCount',(select count(*) from summary_rows),
  'stats',(select value from stats),
  'buildings',coalesce((select jsonb_agg(to_jsonb(b) order by b.code) from b),'[]'::jsonb),
  'contracts',coalesce((select jsonb_agg(data order by ordinal) from selected),'[]'::jsonb),
  'units',coalesce((select jsonb_agg(to_jsonb(u) order by u.unit_no,u.id) from selected_units u),'[]'::jsonb),
  'customers',coalesce((select jsonb_agg(to_jsonb(cu) order by cu.name,cu.id) from selected_customers cu),'[]'::jsonb),
  'summaries',coalesce((select jsonb_object_agg(id,jsonb_build_object('total',total,'paid',paid,'outstanding',outstanding,'overdue',overdue,'nextDue',next_due,'count',n,'dueOutstanding',due)) from selected),'{}'::jsonb),
  'accruals',coalesce((select jsonb_object_agg(id,accrual) from selected),'{}'::jsonb),
  'attentionDue',coalesce((select jsonb_object_agg(id,attention_due) from selected),'{}'::jsonb),
  'paymentCount',(select count(*) from detail_payments),'receivableCount',(select count(*) from detail_receivables),'scheduleCount',(select count(*) from detail_schedules),
  'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.payment_date desc,p.id desc) from detail_payments p),'[]'::jsonb),
  'receivables',coalesce((select jsonb_agg(to_jsonb(r) order by r.due_date desc,r.id desc) from detail_receivables r),'[]'::jsonb),
  'schedules',coalesce((select jsonb_agg(to_jsonb(s) order by s.installment_no,s.id) from detail_schedules s),'[]'::jsonb)
 ) into v_result;
 if p_mode='detail' and jsonb_array_length(v_result->'contracts')<>1 then raise exception 'ContractWorkspaceDenied' using errcode='42501';end if;
 return v_result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'ContractWorkspaceInvalid' using errcode='22023';
end;$$;
revoke all on function public.contract_workspace_read_rpc(text,jsonb,text,uuid) from public,anon,service_role;
grant execute on function public.contract_workspace_read_rpc(text,jsonb,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
