begin;
-- Explicit booking operations only; no arbitrary SQL, table or column writes.
create table private.operator_booking_operations (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  actor_id uuid not null references auth.users(id), unit_id uuid not null references public.units(id),
  request_data jsonb not null, expected_snapshot jsonb not null, deployment text not null,
  expires_at timestamptz not null, created_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','completed','superseded')),
  replaces_id uuid references private.operator_booking_operations(id), result jsonb
);
create unique index operator_booking_operations_current on private.operator_booking_operations(request_id) where status<>'superseded';
create index operator_booking_operations_actor on private.operator_booking_operations(actor_id);
create index operator_booking_operations_unit on private.operator_booking_operations(unit_id);
create index operator_booking_operations_replaces on private.operator_booking_operations(replaces_id);
alter table private.operator_booking_operations enable row level security;
revoke all on private.operator_booking_operations from public,anon,authenticated,service_role;

create function private.booking_operation_allowed(q jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and
 case q->>'operation'
 when 'create' then public.has_app_role('admin','rental_sales') and private.current_operator_action_allowed('create_daily_booking','L2')
 when 'check_in' then public.has_app_role('admin','front_desk','rental_sales') and private.current_operator_action_allowed('check_in_daily_booking','L2')
 when 'cancel' then public.has_app_role('admin') and private.current_operator_action_allowed('cancel_no_show_booking','L3')
 when 'reverse' then public.has_app_role('admin') and private.current_operator_action_allowed('reverse_daily_payment','L3')
 when 'transfer' then public.has_app_role('admin') and private.current_operator_action_allowed('transfer_daily_booking','L3')
 when 'correct_room' then public.has_app_role('admin') and private.current_operator_action_allowed('transfer_daily_booking','L3')
 when 'refund' then public.has_app_role('admin') and private.current_operator_action_allowed('refund_daily_payment','L3')
 when 'change_stay' then public.has_app_role('admin') and private.current_operator_action_allowed('correct_daily_booking','L3')
 when 'void_checkin' then public.has_app_role('admin') and private.current_operator_action_allowed('correct_daily_booking','L3')
 else false end
 and public.can_access_unit(case when q->>'operation'='create' then (q->>'unitId')::uuid
 else (select unit_id from public.daily_bookings where id=(q->>'bookingId')::uuid) end)
 and (q->>'operation' not in ('transfer','correct_room') or public.can_access_unit((q->>'targetUnitId')::uuid));
$$;

insert into private.operator_action_catalog(action_name,domain,risk_level,is_write,description,default_roles)
values('refund_daily_payment','daily_rental','L3',true,'登记实际日租退款',array['admin'])
on conflict(action_name) do nothing;

create function private.preview_booking_operation(q jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.daily_bookings%rowtype; u public.units%rowtype; target public.units%rowtype;
 original_payment public.payments%rowtype; agent public.customers%rowtype; op text:=q->>'operation';
 ci date; co date; price numeric; total numeric; paid numeric:=0; amt numeric:=0; s jsonb; required text[]; allowed text[];
begin
 if jsonb_typeof(q) is distinct from 'object' or length(btrim(coalesce(q->>'originalInstruction',''))) not between 1 and 4000
 or coalesce(q->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 then raise exception 'operationInvalidRequest'; end if;
 required:=case op when 'create' then array['unitId','bookingAgentId','checkIn','checkOut','nightlyPriceXof']
 when 'check_in' then array['bookingId'] when 'cancel' then array['bookingId','reason']
 when 'reverse' then array['bookingId','paymentId','reason']
 when 'refund' then array['bookingId','amountXof','finalAmountXof','paymentDate','paymentMethod','reason']
 when 'change_stay' then array['bookingId','checkIn','checkOut','nightlyPriceXof','reason']
 when 'transfer' then array['bookingId','targetUnitId','reason']
 when 'correct_room' then array['bookingId','targetUnitId','reason']
 when 'void_checkin' then array['bookingId','reason'] else null end;
 allowed:=array['operation','requestId','originalInstruction']||required||case when op='create' then array['guestName'] else array[]::text[] end;
 if required is null or not q ?& required or exists(select 1 from jsonb_object_keys(q) k where not k=any(allowed))
 or exists(select 1 from jsonb_each(q) e where e.value='null'::jsonb) then raise exception 'operationInvalidRequest'; end if;
 if not coalesce(private.booking_operation_allowed(q),false) then raise exception 'operationForbidden' using errcode='42501'; end if;
 if op not in ('create','check_in') and length(btrim(coalesce(q->>'reason',''))) not between 5 and 1000 then raise exception 'operationReasonRequired'; end if;
 if op='create' then
   select * into u from public.units where id=(q->>'unitId')::uuid;
   select * into agent from public.customers where id=(q->>'bookingAgentId')::uuid;
   if agent.id is null or agent.is_blacklisted or btrim(agent.name) not in ('Chouke','Niamke','Fulo','Esai','黄姐','颖','镇淮','悦凯','孙敏','李军','振咏','5号前台') then raise exception 'operationAgentInvalid'; end if;
   if length(coalesce(q->>'guestName',''))>120 then raise exception 'operationInvalidRequest'; end if;
 else
   select * into b from public.daily_bookings where id=(q->>'bookingId')::uuid;
   select * into u from public.units where id=b.unit_id;
   select coalesce(sum(amount),0) into paid from public.payments where source_type='daily_booking' and source_id=b.id;
   if b.id is null or b.checkout_mode<>'fixed' or b.check_out is null then raise exception 'operationAssistanceRequired'; end if;
   if exists(select 1 from public.payments where source_type='daily_booking' and source_id=b.id and (currency::text<>'XOF' or exchange_rate_to_xof<>1))
   or b.prepaid_amount_xof is distinct from paid or paid<0 then raise exception 'operationFinanceMismatch'; end if;
   if (select count(*) from public.receivables where source_type='daily_booking' and source_id=b.id and status<>'cancelled')<>1
   or not exists(select 1 from public.receivables where source_type='daily_booking' and source_id=b.id and status<>'cancelled'
     and amount_xof=b.final_amount_xof and paid_amount_xof=least(paid,b.final_amount_xof) and unit_id=b.unit_id and currency::text='XOF'
     and management_status not in ('historical_pending','excluded')) then raise exception 'operationFinanceMismatch'; end if;
 end if;
 ci:=b.check_in; co:=b.check_out; price:=b.nightly_price_xof; total:=b.final_amount_xof;
 if op in ('create','change_stay') then
   ci:=(q->>'checkIn')::date; co:=(q->>'checkOut')::date; price:=(q->>'nightlyPriceXof')::numeric;
   if not isfinite(ci) or not isfinite(co) or ci::text<>q->>'checkIn' or co::text<>q->>'checkOut'
   or co<=ci or price<=0 or price>999999999999 or trunc(price)<>price or jsonb_typeof(q->'nightlyPriceXof')<>'number' then raise exception 'operationInvalidRequest'; end if;
   if op='create' and ci<current_date then raise exception 'operationInvalidDate'; end if;
   if op='change_stay' and (b.status not in ('pending_review','confirmed','checked_in') or
      (b.status='checked_in' and (ci<>b.check_in or co<=current_date)) or
      (b.status<>'checked_in' and ci<current_date)) then raise exception 'operationInvalidDate'; end if;
   total:=(co-ci)*price-coalesce(b.manual_discount_amount_xof,0);
   if total<paid or total<0 or total>999999999999 then raise exception 'operationRefundReviewRequired'; end if;
 end if;
 if op='check_in' and (b.status<>'confirmed' or b.check_in<>current_date) then raise exception 'operationInvalidDate'; end if;
 if op='cancel' and (b.status not in ('pending_review','confirmed') or paid<>0
    or exists(select 1 from public.payments where source_type='daily_booking' and source_id=b.id)) then raise exception 'operationAssistanceRequired'; end if;
 if op='void_checkin' and (b.status<>'checked_in' or b.actual_check_out is not null or paid<>0
    or exists(select 1 from public.payments where source_type='daily_booking' and source_id=b.id)
    or exists(select 1 from public.cleaning_tasks where daily_booking_id=b.id)) then raise exception 'operationAssistanceRequired'; end if;
 if op in ('transfer','correct_room') then
   -- Future, unpaid reservation transfer only. Occupied/paid history is never relabelled.
   if (op='transfer' and (b.status not in ('pending_review','confirmed') or b.check_in<current_date or paid<>0
     or exists(select 1 from public.payments where source_type='daily_booking' and source_id=b.id)))
   or (op='correct_room' and b.status not in ('pending_review','confirmed','checked_in'))
   or exists(select 1 from public.cleaning_tasks where daily_booking_id=b.id) then raise exception 'operationAssistanceRequired'; end if;
   if op='correct_room' and exists(select 1 from public.payments p where p.source_type='daily_booking' and p.source_id=b.id
     and (p.unit_id is distinct from b.unit_id or (select count(*) from public.ledger_entries l where l.payment_id=p.id)<>1
       or not exists(select 1 from public.ledger_entries l where l.payment_id=p.id and l.unit_id=p.unit_id and l.building_id=u.building_id
         and l.amount_xof=abs(p.amount) and l.direction=case when p.amount<0 then 'expense' else 'income' end)))
   then raise exception 'operationFinanceMismatch'; end if;
   select * into target from public.units where id=(q->>'targetUnitId')::uuid;
   if target.id is null or target.id=u.id then raise exception 'operationInvalidRequest'; end if;
 else target:=u; end if;
 if op in ('create','change_stay','check_in','transfer','correct_room') then
   if target.status in ('locked','maintenance','sold','leased')
   or not exists(select 1 from public.unit_business_flags where unit_id=target.id and business_type='daily_rental' and is_enabled)
   or exists(select 1 from public.lease_contracts where unit_id=target.id and status='active')
   or exists(select 1 from public.sale_contracts where unit_id=target.id and status='active')
   or exists(select 1 from public.daily_bookings other where other.unit_id=target.id and other.id is distinct from b.id
     and other.status in ('pending_review','confirmed','checked_in') and other.check_in<co
     and ci<case when other.checkout_mode='open' then date '9999-12-31' else coalesce(other.check_out,other.check_in+1) end)
   then raise exception 'operationRoomConflict'; end if;
   if op='correct_room' and b.status='checked_in' and
     (exists(select 1 from public.daily_bookings where unit_id=target.id and status='checked_in' and id<>b.id)
      or exists(select 1 from public.cleaning_tasks where unit_id=target.id and not is_completed)) then raise exception 'operationRoomConflict'; end if;
   if op='check_in' and (exists(select 1 from public.cleaning_tasks where unit_id=u.id and not is_completed)
   or exists(select 1 from public.daily_bookings where unit_id=u.id and status='checked_in' and id<>b.id)) then raise exception 'operationRoomConflict'; end if;
 end if;
 if op='reverse' then
   select * into original_payment from public.payments where id=(q->>'paymentId')::uuid and source_type='daily_booking' and source_id=b.id;
   if original_payment.id is null or original_payment.amount<=0 or original_payment.reversal_of_payment_id is not null
   or exists(select 1 from public.payments where reversal_of_payment_id=original_payment.id)
   or exists(select 1 from public.payments where source_type='daily_booking' and source_id=b.id and request_kind='daily_refund')
   then raise exception 'operationAssistanceRequired'; end if;
   amt:=original_payment.amount;
 end if;
 if op='refund' then
   amt:=(q->>'amountXof')::numeric; total:=(q->>'finalAmountXof')::numeric;
   if b.status<>'checked_out' or jsonb_typeof(q->'amountXof')<>'number' or jsonb_typeof(q->'finalAmountXof')<>'number'
   or amt<=0 or trunc(amt)<>amt or total<0 or trunc(total)<>total or total>least(b.final_amount_xof,b.total_amount_xof) or amt>paid-total
   or (q->>'paymentDate')::date>current_date or not isfinite((q->>'paymentDate')::date)
   or ((q->>'paymentDate')::date)::text<>q->>'paymentDate'
   or (q->>'paymentDate')::date<b.check_in
   or q->>'paymentMethod' not in ('cash','check','bank_transfer','other') then raise exception 'operationRefundReviewRequired'; end if;
 end if;
 s:=jsonb_build_object('booking',to_jsonb(b),'unit',to_jsonb(u),'targetUnit',to_jsonb(target),'agent',to_jsonb(agent),'businessDate',current_date,
 'receivables',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.receivables r where source_type='daily_booking' and source_id=b.id),'[]'::jsonb),
 'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.ledger_entries l join public.payments x on x.id=l.payment_id where x.source_type='daily_booking' and x.source_id=b.id),'[]'::jsonb),
 'attachments',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.attachments a where a.linked_type='payment' and a.linked_id in (select id from public.payments where source_type='daily_booking' and source_id=b.id)),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.payments x where source_type='daily_booking' and source_id=b.id),'[]'::jsonb));
 return jsonb_build_object('snapshot',s,'plan',jsonb_build_object('operation',op,'unitId',u.id,'unitCode',u.code,'targetUnitCode',target.code,
 'bookingId',b.id,'bookingAgent',coalesce(agent.name,(select name from public.customers where id=b.booking_agent_id)),
 'guestName',case when op='create' then q->>'guestName' else b.guest_name end,
 'checkInBefore',b.check_in,'checkInAfter',ci,'checkOutBefore',b.check_out,'checkOutAfter',co,
 'priceBefore',b.nightly_price_xof,'priceAfter',price,'totalBefore',b.final_amount_xof,'totalAfter',case when op in ('cancel','void_checkin') then 0 else total end,
 'paidBefore',paid,'paidAfter',paid-case when op in ('reverse','refund') then amt else 0 end,
 'amountXof',amt,'paymentDate',q->>'paymentDate','paymentMethod',q->>'paymentMethod','reason',q->>'reason',
 'paymentCount',(select count(*) from public.payments where source_type='daily_booking' and source_id=b.id),
 'receivableCount',(select count(*) from public.receivables where source_type='daily_booking' and source_id=b.id),
 'ledgerCount',(select count(*) from public.ledger_entries l join public.payments x on x.id=l.payment_id where x.source_type='daily_booking' and x.source_id=b.id),
 'notice',case when op='reverse' then '纠正错误收款，不代表实际退钱。' when op='refund' then '记录已经实际退给客户的款项，不会发起银行转账。'
 when op='check_in' then '仅办理入住，本单不收款；需要同时收款请勿拆单绕过组合核验。'
 when op='transfer' then '仅转移未入住且无收款的预订；不重标已发生的财务历史。'
 when op='correct_room' then '仅纠正原本录错的房号，不是实际搬房。整单及关联收款、账本、应收的房间归属一起修正；金额、收据编号和经办人不变，旧归属保存在审计中。'
 else '本人核对完整影响后确认。' end));
end; $$;

create function private.booking_operation(p_mode text,p_request jsonb default null,p_id uuid default null,p_snapshot jsonb default null,
 p_expires_at timestamptz default null,p_deployment text default null,p_replaces_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.operator_booking_operations%rowtype; fresh jsonb; q jsonb; rid uuid; bid uuid; uid uuid; target_id uuid;
 b public.daily_bookings%rowtype; actor jsonb; v_result jsonb; v_payment_id uuid; now_booking public.daily_bookings%rowtype;
begin
 if auth.uid() is null then raise exception 'operationForbidden' using errcode='42501'; end if;
 if p_mode='preview' then return private.preview_booking_operation(p_request); end if;
 if p_mode='status' then
   select * into w from private.operator_booking_operations where request_id=(p_request->>'requestId')::uuid and actor_id=auth.uid() and status<>'superseded';
   if not found then return jsonb_build_object('status','not_found'); end if;
 elsif p_mode in ('get','confirm') then
   select * into w from private.operator_booking_operations where id=p_id and actor_id=auth.uid();
   if not found then raise exception 'operationForbidden' using errcode='42501'; end if;
 end if;
 if p_mode in ('status','get','confirm') and not coalesce(private.booking_operation_allowed(w.request_data),false) then raise exception 'operationForbidden' using errcode='42501'; end if;
 if p_mode='get' then return to_jsonb(w); end if;
 if p_mode='status' then return jsonb_build_object('status',w.status,'id',w.id,'requestId',w.request_id,'verified',false); end if;
 if p_mode='create' then
   fresh:=private.preview_booking_operation(p_request); rid:=(p_request->>'requestId')::uuid;
   perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
   select * into w from private.operator_booking_operations where request_id=rid and status<>'superseded' for update;
   if found then
     if w.actor_id<>auth.uid() then raise exception 'operationForbidden' using errcode='42501'; end if;
     if w.request_data=p_request and w.expected_snapshot=p_snapshot and w.deployment=p_deployment and w.expires_at>now() and p_replaces_id is null then return to_jsonb(w); end if;
     if w.status='completed' or p_replaces_id is distinct from w.id then raise exception 'operationRequestConflict'; end if;
   elsif p_replaces_id is not null then raise exception 'operationRequestConflict'; end if;
   if fresh is distinct from p_snapshot then raise exception 'operationChanged'; end if;
   if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '15 minutes'
   or length(coalesce(p_deployment,'')) not between 1 and 200 then raise exception 'operationExpired'; end if;
   if exists(select 1 from public.payments where request_id=rid) or exists(select 1 from public.daily_operation_requests where request_id=rid)
   or exists(select 1 from public.daily_bookings where creation_request_id=rid) then raise exception 'operationRequestConflict'; end if;
   if w.id is not null then update private.operator_booking_operations set status='superseded' where id=w.id; end if;
   insert into private.operator_booking_operations(request_id,actor_id,unit_id,request_data,expected_snapshot,deployment,expires_at,replaces_id)
   values(rid,auth.uid(),(fresh->'plan'->>'unitId')::uuid,p_request,p_snapshot,p_deployment,p_expires_at,p_replaces_id) returning * into w;
   return to_jsonb(w);
 end if;
 if p_mode<>'confirm' then raise exception 'operationInvalidRequest'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.request_id::text,0));
 select * into w from private.operator_booking_operations where id=p_id for update;
 if not coalesce(private.booking_operation_allowed(w.request_data),false) then raise exception 'operationForbidden' using errcode='42501'; end if;
 if w.status='completed' then return w.result||jsonb_build_object('verified',false,'status','completed_previously'); end if;
 if w.status<>'pending' or w.expires_at<=now() or w.deployment is distinct from p_deployment then raise exception 'operationExpired'; end if;
 q:=w.request_data; rid:=w.request_id; bid:=(q->>'bookingId')::uuid;
 -- Reversal takes payment before booking, matching the existing reversal RPC.
 if q->>'operation'='reverse' then perform 1 from public.payments where id=(q->>'paymentId')::uuid for update; end if;
 if bid is not null then select * into b from public.daily_bookings where id=bid for update; end if;
 perform 1 from public.units where id=w.unit_id or id=(q->>'targetUnitId')::uuid order by id for update;
 perform 1 from public.receivables where source_type='daily_booking' and source_id=bid order by id for update;
 fresh:=private.preview_booking_operation(q);
 if fresh is distinct from w.expected_snapshot then raise exception 'operationChanged'; end if;
 if exists(select 1 from public.payments where request_id=rid) or exists(select 1 from public.daily_operation_requests where request_id=rid)
 or exists(select 1 from public.daily_bookings where creation_request_id=rid) then raise exception 'operationRequestConflict'; end if;
 actor:=jsonb_build_object('channel','external_codex','request_id',rid,'operation_confirmation_id',w.id,'original_instruction',q->>'originalInstruction');
 case q->>'operation'
 when 'create' then
   v_result:=public.daily_create_booking_rpc((q->>'unitId')::uuid,(q->>'bookingAgentId')::uuid,(q->>'checkIn')::date,(q->>'checkOut')::date,'fixed',(q->>'nightlyPriceXof')::numeric,null,null,rid,actor);
   bid:=(v_result->'booking'->>'id')::uuid;
   if bid is null then raise exception 'operationVerificationFailed'; end if;
   update public.daily_bookings set booking_agent_id=(q->>'bookingAgentId')::uuid,guest_name=nullif(btrim(q->>'guestName'),'') where id=bid;
   perform public.daily_confirm_booking_rpc(bid,actor);
   -- A future reservation must not overwrite today's occupied/cleaning state.
   update public.units set status=public.daily_resolve_unit_status(id,null),updated_at=now() where id=w.unit_id;
 when 'check_in' then perform public.daily_check_in_booking_rpc(bid,0,null::uuid,actor);
 when 'cancel' then perform public.daily_cancel_booking_rpc(bid,actor||jsonb_build_object('reason',q->>'reason'));
 when 'void_checkin' then perform public.daily_void_erroneous_checkin_rpc(bid,q->>'reason');
 when 'reverse' then perform public.daily_reverse_payment_rpc((q->>'paymentId')::uuid,q->>'reason',rid,actor);
 when 'change_stay' then
   update public.daily_bookings set check_in=(q->>'checkIn')::date,check_out=(q->>'checkOut')::date,
     nightly_price_xof=(q->>'nightlyPriceXof')::numeric,total_amount_xof=((q->>'checkOut')::date-(q->>'checkIn')::date)*(q->>'nightlyPriceXof')::numeric,
     final_amount_xof=(fresh->'plan'->>'totalAfter')::numeric,updated_at=now() where id=bid;
   perform public.daily_sync_booking_finance_tx(bid);
   update public.receivables set due_date=(q->>'checkIn')::date where source_type='daily_booking' and source_id=bid;
 when 'transfer' then
   target_id:=(q->>'targetUnitId')::uuid;
   update public.daily_bookings set unit_id=target_id,updated_at=now() where id=bid;
   update public.receivables set unit_id=target_id,building_id=(select building_id from public.units where id=target_id),updated_at=now()
     where source_type='daily_booking' and source_id=bid;
   update public.units set status=public.daily_resolve_unit_status(id,null),updated_at=now() where id in (b.unit_id,target_id);
 when 'refund' then
   update public.daily_bookings set final_amount_xof=(q->>'finalAmountXof')::numeric,
     manual_discount_amount_xof=case when final_amount_xof is distinct from (q->>'finalAmountXof')::numeric then total_amount_xof-(q->>'finalAmountXof')::numeric else manual_discount_amount_xof end,
     manual_discount_reason=case when final_amount_xof is distinct from (q->>'finalAmountXof')::numeric then q->>'reason' else manual_discount_reason end,updated_at=now() where id=bid;
   insert into public.payments(unit_id,customer_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,request_id,request_kind,notes)
   values(b.unit_id,b.customer_id,'daily_booking',bid,(q->>'paymentDate')::date,-(q->>'amountXof')::numeric,'XOF',1,q->>'paymentMethod',rid,'daily_refund',q->>'reason') returning id into v_payment_id;
   insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description)
   values((select building_id from public.units where id=b.unit_id),b.unit_id,v_payment_id,(q->>'paymentDate')::date,'expense','daily_rental',(q->>'amountXof')::numeric,'实际退款：'||(q->>'reason'));
   perform public.daily_sync_booking_finance_tx(bid);
 when 'correct_room' then
   target_id:=(q->>'targetUnitId')::uuid;
   update public.daily_bookings set unit_id=target_id,updated_at=now() where id=bid;
   update public.receivables set unit_id=target_id,building_id=(select building_id from public.units where id=target_id),updated_at=now()
     where source_type='daily_booking' and source_id=bid;
   update public.payments set unit_id=target_id where source_type='daily_booking' and source_id=bid;
   update public.ledger_entries set unit_id=target_id,building_id=(select building_id from public.units where id=target_id)
     where payment_id in (select id from public.payments where source_type='daily_booking' and source_id=bid);
   update public.attachments set unit_id=target_id where linked_type='payment' and linked_id in
     (select id from public.payments where source_type='daily_booking' and source_id=bid);
   update public.units set status=public.daily_resolve_unit_status(id,null),updated_at=now()
     where id in (b.unit_id,target_id) and status not in ('locked','maintenance','sold','leased');
 else raise exception 'operationInvalidRequest'; end case;
 select * into now_booking from public.daily_bookings where id=bid;
 if now_booking.id is null then raise exception 'operationVerificationFailed'; end if;
 if q->>'operation' not in ('cancel','void_checkin') and
 (now_booking.final_amount_xof is distinct from (fresh->'plan'->>'totalAfter')::numeric
 or now_booking.prepaid_amount_xof is distinct from (fresh->'plan'->>'paidAfter')::numeric)
 then raise exception 'operationVerificationFailed'; end if;
 if (q->>'operation'='create' and now_booking.status<>'confirmed')
 or (q->>'operation'='check_in' and now_booking.status<>'checked_in')
 or (q->>'operation' in ('cancel','void_checkin') and now_booking.status<>'cancelled')
 or (q->>'operation' in ('transfer','correct_room') and now_booking.unit_id is distinct from (q->>'targetUnitId')::uuid)
 then raise exception 'operationVerificationFailed'; end if;
 if q->>'operation' not in ('cancel','void_checkin') and not exists(select 1 from public.receivables
   where source_type='daily_booking' and source_id=bid and status<>'cancelled' and unit_id=now_booking.unit_id
   and amount_xof=now_booking.final_amount_xof and paid_amount_xof=least(now_booking.prepaid_amount_xof,now_booking.final_amount_xof))
 then raise exception 'operationVerificationFailed'; end if;
 if q->>'operation' in ('reverse','refund') and not exists(select 1 from public.payments p join public.ledger_entries l on l.payment_id=p.id
   where p.request_id=rid and p.source_type='daily_booking' and p.source_id=bid and p.amount=-(fresh->'plan'->>'amountXof')::numeric
   and p.unit_id=now_booking.unit_id and p.currency::text='XOF' and p.exchange_rate_to_xof=1
   and l.direction='expense' and l.amount_xof=-p.amount and l.unit_id=p.unit_id and l.entry_date=p.payment_date)
 then raise exception 'operationVerificationFailed'; end if;
 if q->>'operation'='correct_room' then
   if (select coalesce(jsonb_agg(to_jsonb(x)-'unit_id' order by x.id),'[]'::jsonb) from public.payments x where source_type='daily_booking' and source_id=bid)
      is distinct from (select coalesce(jsonb_agg(e-'unit_id' order by e->>'id'),'[]'::jsonb) from jsonb_array_elements(fresh->'snapshot'->'payments') e)
   or exists(select 1 from public.payments x where source_type='daily_booking' and source_id=bid and unit_id is distinct from target_id)
   or exists(select 1 from public.ledger_entries l join public.payments x on l.payment_id=x.id where x.source_type='daily_booking' and x.source_id=bid
      and (l.unit_id is distinct from target_id or l.building_id is distinct from (select building_id from public.units where id=target_id)))
   then raise exception 'operationVerificationFailed'; end if;
 end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
 values(auth.uid(),'operator_booking_'||(q->>'operation'),'daily_booking',bid,to_jsonb(b),to_jsonb(now_booking),actor||jsonb_build_object('reason',q->>'reason','plan',fresh->'plan','booking_agent_id',now_booking.booking_agent_id,'input_source','natural_language','payment_date',q->>'paymentDate',
 'room_correction_before',case when q->>'operation'='correct_room' then fresh->'snapshot' else null end));
 if q->>'operation' not in ('create','reverse','refund') then
   insert into public.daily_operation_requests(request_id,operation_kind,booking_id,payload)
   values(rid,'operator_'||(q->>'operation'),bid,q);
 end if;
 v_result:=jsonb_build_object('status','completed','verified',true,'requestId',rid,'bookingId',bid,'operation',q->>'operation');
 update private.operator_booking_operations set status='completed',result=v_result where id=w.id;
 return v_result;
end; $$;

create function public.operator_booking_operation(p_mode text,p_request jsonb default null,p_id uuid default null,p_snapshot jsonb default null,
 p_expires_at timestamptz default null,p_deployment text default null,p_replaces_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.booking_operation(p_mode,p_request,p_id,p_snapshot,p_expires_at,p_deployment,p_replaces_id); $$;
create function public.booking_operations_protocol_version() returns integer language sql security invoker set search_path='' as $$ select 1; $$;
-- A historical positive receipt with an actual refund cannot be blindly reversed
-- from an older UI. Serialize with refund operations using the same booking row.
create function private.guard_refunded_daily_reversal() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.source_type='daily_booking' and new.reversal_of_payment_id is not null then
   perform 1 from public.daily_bookings where id=new.source_id for update;
   if exists(select 1 from public.payments where source_type='daily_booking' and source_id=new.source_id and request_kind='daily_refund')
   then raise exception 'operationRefundReviewRequired'; end if;
 end if;
 return new;
end; $$;
create trigger guard_refunded_daily_reversal before insert on public.payments for each row execute function private.guard_refunded_daily_reversal();
revoke all on function private.guard_refunded_daily_reversal() from public,anon,authenticated,service_role;
revoke all on function private.booking_operation_allowed(jsonb),private.preview_booking_operation(jsonb),private.booking_operation(text,jsonb,uuid,jsonb,timestamptz,text,uuid),
 public.operator_booking_operation(text,jsonb,uuid,jsonb,timestamptz,text,uuid),public.booking_operations_protocol_version() from public,anon,authenticated,service_role;
grant execute on function private.booking_operation(text,jsonb,uuid,jsonb,timestamptz,text,uuid),public.operator_booking_operation(text,jsonb,uuid,jsonb,timestamptz,text,uuid),public.booking_operations_protocol_version() to authenticated;
commit;
