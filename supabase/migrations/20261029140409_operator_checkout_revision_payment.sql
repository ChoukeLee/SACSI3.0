begin;

-- A new corrective event explicitly linked to a completed correction. The old
-- request, audit, receipts and cleaning history are never replaced or replayed.
create function public.booking_checkout_revision_payment_protocol_version() returns integer
language sql security invoker set search_path='' as $$ select 1; $$;
revoke all on function public.booking_checkout_revision_payment_protocol_version() from public,anon,authenticated,service_role;
grant execute on function public.booking_checkout_revision_payment_protocol_version() to authenticated;

create unique index operator_checkout_revision_parent_once
on private.operator_booking_operations (((request_data->>'correctsRequestId')::uuid))
where status='completed' and request_data->>'operation'='revise_checkout_and_collect';

create function private.checkout_revision_state(bid uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.daily_bookings%rowtype; u public.units%rowtype;
begin
  select * into b from public.daily_bookings where id=bid;
  if auth.uid() is null or not coalesce(public.has_app_role('admin'),false)
    or not coalesce(public.can_access_unit(b.unit_id),false)
    or not coalesce(private.current_operator_action_allowed('correct_daily_booking','L3'),false)
    or not coalesce(private.current_operator_action_allowed('record_daily_payment','L2'),false)
  then raise exception 'operationForbidden' using errcode='42501'; end if;
  select * into u from public.units where id=b.unit_id;
  return jsonb_build_object('booking',to_jsonb(b),'unit',to_jsonb(u),'businessDate',current_date,
    'receivables',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.receivables r where source_type='daily_booking' and source_id=bid),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where source_type='daily_booking' and source_id=bid),'[]'::jsonb),
    'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.ledger_entries l join public.payments p on p.id=l.payment_id where p.source_type='daily_booking' and p.source_id=bid),'[]'::jsonb),
    'allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.payment_id,a.receivable_id) from public.payment_receivable_allocations a join public.payments p on p.id=a.payment_id where p.source_type='daily_booking' and p.source_id=bid),'[]'::jsonb),
    'cleaningTasks',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.cleaning_tasks c where daily_booking_id=bid),'[]'::jsonb));
end; $$;

create function private.preview_checkout_revision_payment(q jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  b public.daily_bookings%rowtype; source private.operator_booking_operations%rowtype;
  source_audit public.audit_logs%rowtype; co date; pd date; ceiling_date date;
  amt numeric; gross numeric; paid numeric; base jsonb; state jsonb; conflicts jsonb;
begin
  if jsonb_typeof(q) is distinct from 'object'
    or q->>'operation' is distinct from 'revise_checkout_and_collect'
    or not q ?& array['requestId','operation','originalInstruction','bookingId','correctsRequestId','actualCheckOut','amountXof','paymentDate','paymentMethod','reason','inputSource']
    or exists(select 1 from jsonb_object_keys(q) k where k<>all(array['requestId','operation','originalInstruction','bookingId','correctsRequestId','actualCheckOut','amountXof','paymentDate','paymentMethod','reason','inputSource']))
    or exists(select 1 from jsonb_each(q) e where e.value='null'::jsonb)
    or coalesce(q->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(q->>'correctsRequestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or lower(q->>'requestId')=lower(q->>'correctsRequestId')
    or coalesce(q->>'bookingId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(q->'originalInstruction') is distinct from 'string'
    or length(btrim(q->>'originalInstruction')) not between 1 and 4000
    or jsonb_typeof(q->'reason') is distinct from 'string' or length(btrim(q->>'reason')) not between 5 and 1000
    or q->>'inputSource' not in ('natural_language','excel_screenshot')
    or q->>'paymentMethod' not in ('cash','check','bank_transfer','other')
    or jsonb_typeof(q->'amountXof') is distinct from 'number'
    or jsonb_typeof(q->'actualCheckOut') is distinct from 'string' or q->>'actualCheckOut' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(q->'paymentDate') is distinct from 'string' or q->>'paymentDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then raise exception 'operationInvalidRequest'; end if;
  if not coalesce(private.booking_operation_allowed(q),false)
  then raise exception 'operationForbidden' using errcode='42501'; end if;
  begin co:=(q->>'actualCheckOut')::date; pd:=(q->>'paymentDate')::date;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception 'operationInvalidDate'; end;
  amt:=(q->>'amountXof')::numeric;
  if not isfinite(co) or co::text<>q->>'actualCheckOut' or not isfinite(pd) or pd::text<>q->>'paymentDate'
    or pd>current_date or amt<=0 or amt>999999999999 or trunc(amt)<>amt
  then raise exception 'operationInvalidRequest'; end if;
  select * into b from public.daily_bookings where id=(q->>'bookingId')::uuid;
  select * into source from private.operator_booking_operations where request_id=(q->>'correctsRequestId')::uuid and status='completed';
  if source.id is null or source.actor_id is distinct from auth.uid() or source.unit_id is distinct from b.unit_id
    or source.request_data->>'operation' is distinct from 'correct_checkout'
    or source.request_data->>'bookingId' is distinct from b.id::text
    or source.result->>'status' is distinct from 'completed' or source.result->>'verified' is distinct from 'true'
  then raise exception 'operationCorrectionSourceInvalid'; end if;
  if exists(select 1 from private.operator_booking_operations x where x.status='completed'
    and x.request_data->>'operation'='revise_checkout_and_collect' and (x.request_data->>'correctsRequestId')::uuid=source.request_id)
  then raise exception 'operationCorrectionAlreadyRevised'; end if;
  if (select count(*) from public.audit_logs a where a.actor_id=auth.uid() and a.entity_id=b.id
    and a.action='operator_booking_correct_checkout' and a.metadata->>'request_id'=source.request_id::text)<>1
  then raise exception 'operationCorrectionSourceInvalid'; end if;
  select * into source_audit from public.audit_logs a where a.actor_id=auth.uid() and a.entity_id=b.id
    and a.action='operator_booking_correct_checkout' and a.metadata->>'request_id'=source.request_id::text;
  if to_jsonb(b) is distinct from source_audit.after_data
    or b.status is distinct from 'checked_out' or b.checkout_mode is distinct from 'fixed'
    or b.check_out is distinct from b.actual_check_out or b.check_out is null
    or b.manual_discount_amount_xof<>0 or b.settlement_adjustment_amount_xof<>0
    or source.expected_snapshot->'plan'->>'discountAfter' is distinct from '0'
    or coalesce((source.expected_snapshot->'plan'->>'adjustmentAfter')::numeric,0)<>0
  then raise exception 'operationCorrectionSourceChanged'; end if;
  ceiling_date:=(source.expected_snapshot->'snapshot'->'booking'->>'actual_check_out')::date;
  if ceiling_date is null or co<=b.actual_check_out or co>ceiling_date or co>current_date
    or b.check_in>pd or b.check_in>=co
  then raise exception 'operationInvalidDate'; end if;

  -- Reuse the existing complete finance validation at the current departure.
  -- This is read-only and cannot extend occupancy or create a receipt itself.
  base:=private.preview_checkout_correction(jsonb_build_object('requestId',q->>'requestId','operation','correct_checkout',
    'originalInstruction',q->>'originalInstruction','bookingId',b.id,'actualCheckOut',b.actual_check_out,
    'discountAmountXof',0,'reason',q->>'reason','inputSource',q->>'inputSource'));
  state:=private.checkout_revision_state(b.id);
  if state->'payments' is distinct from source.expected_snapshot->'snapshot'->'payments'
    or state->'ledger' is distinct from source.expected_snapshot->'snapshot'->'ledger'
  then raise exception 'operationCorrectionSourceChanged'; end if;
  paid:=(base->'plan'->>'paidBefore')::numeric; gross:=(co-b.check_in)*b.nightly_price_xof;
  if gross>999999999999 or paid+amt>gross then raise exception 'operationRefundReviewRequired'; end if;
  -- Only the newly restored interval is checked. Actual historical departures
  -- take precedence over old planned dates; active open stays remain unbounded.
  conflicts:=jsonb_build_object(
    'daily',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.daily_bookings x
      where x.unit_id=b.unit_id and x.id<>b.id and x.status in ('pending_review','confirmed','checked_in','checked_out')
      and x.check_in<co and b.actual_check_out<case when x.status='checked_out' then coalesce(x.actual_check_out,x.check_out,x.check_in+1)
        when x.checkout_mode='open' then date '9999-12-31' else coalesce(x.check_out,x.check_in+1) end),'[]'::jsonb),
    'leases',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.lease_contracts x where x.unit_id=b.unit_id
      and x.status in ('active','terminated') and (x.start_date is null or x.start_date<co)
      and (x.status='active' or x.actual_end_date is null or b.actual_check_out<=x.actual_end_date)),'[]'::jsonb));
  if conflicts->'daily'<>'[]'::jsonb or conflicts->'leases'<>'[]'::jsonb then raise exception 'operationRoomConflict'; end if;
  state:=state||jsonb_build_object('correctionSource',jsonb_build_object('id',source.id,'requestId',source.request_id,
    'fingerprint',md5(to_jsonb(source)::text),'auditId',source_audit.id,'auditFingerprint',md5(to_jsonb(source_audit)::text),
    'originalActualCheckOut',ceiling_date),'restoredIntervalConflicts',conflicts);
  return jsonb_build_object('snapshot',state,'plan',jsonb_build_object('operation','revise_checkout_and_collect',
    'bookingId',b.id,'unitId',b.unit_id,'unitCode',state->'unit'->>'code','bookingAgent',(select name from public.customers where id=b.booking_agent_id),
    'guestName',b.guest_name,'correctsRequestId',source.request_id,'correctionDateLimit',ceiling_date,
    'checkInBefore',b.check_in,'checkInAfter',b.check_in,'checkOutBefore',b.check_out,'checkOutAfter',co,
    'actualCheckOutBefore',b.actual_check_out,'actualCheckOutAfter',co,'priceBefore',b.nightly_price_xof,'priceAfter',b.nightly_price_xof,
    'grossBefore',b.total_amount_xof,'grossAfter',gross,'discountBefore',0,'discountAfter',0,'adjustmentBefore',0,'adjustmentAfter',0,
    'totalBefore',b.final_amount_xof,'totalAfter',gross,'paidBefore',paid,'paidAfter',paid+amt,
    'outstandingBefore',b.final_amount_xof-paid,'outstandingAfter',gross-paid-amt,
    'amountXof',amt,'paymentDate',pd,'paymentMethod',q->>'paymentMethod','reason',q->>'reason','inputSource',q->>'inputSource',
    'notice','关联已完成更正后修订实际住期并补记已收款；保留原更正、原收款、原账本、房态与保洁，不覆盖历史或执行转账。'));
end; $$;

create function private.apply_checkout_revision_payment(q jsonb, expected jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare bid uuid:=(q->>'bookingId')::uuid; rid uuid:=(q->>'requestId')::uuid; pid uuid; state jsonb; p public.payments%rowtype; r public.receivables%rowtype;
begin
  if private.preview_checkout_revision_payment(q) is distinct from expected then raise exception 'operationChanged'; end if;
  update public.daily_bookings set check_out=(q->>'actualCheckOut')::date,actual_check_out=(q->>'actualCheckOut')::date,
    total_amount_xof=(expected->'plan'->>'totalAfter')::numeric,final_amount_xof=(expected->'plan'->>'totalAfter')::numeric,
    manual_discount_amount_xof=0,manual_discount_reason=q->>'reason',updated_at=now() where id=bid;
  perform public.daily_sync_booking_finance_tx(bid);
  perform private.operator_record_daily_payment(bid,(q->>'amountXof')::numeric,(q->>'paymentDate')::date,null,rid,
    jsonb_build_object('channel','external_codex','input_source',q->>'inputSource','original_instruction',q->>'originalInstruction',
      'request_id',rid,'corrects_request_id',q->>'correctsRequestId'));
  update public.payments set payment_method=q->>'paymentMethod' where request_id=rid;
  select * into p from public.payments where request_id=rid;
  pid:=p.id; state:=private.checkout_revision_state(bid);
  select * into r from public.receivables where source_type='daily_booking' and source_id=bid;
  if pid is null or p.source_type is distinct from 'daily_booking' or p.source_id is distinct from bid
    or p.unit_id::text is distinct from expected->'snapshot'->'booking'->>'unit_id'
    or p.customer_id::text is distinct from expected->'snapshot'->'booking'->>'customer_id'
    or p.amount is distinct from (q->>'amountXof')::numeric or p.currency::text is distinct from 'XOF'
    or p.exchange_rate_to_xof is distinct from 1 or p.payment_date is distinct from (q->>'paymentDate')::date
    or p.payment_method is distinct from q->>'paymentMethod' or p.recorded_by is distinct from auth.uid()
    or p.request_kind is distinct from 'daily_payment'
    or (select coalesce(jsonb_agg(e order by e->>'id'),'[]'::jsonb) from jsonb_array_elements(state->'payments') e where e->>'id'<>pid::text)
      is distinct from expected->'snapshot'->'payments'
    or (select coalesce(jsonb_agg(e order by e->>'id'),'[]'::jsonb) from jsonb_array_elements(state->'ledger') e where e->>'payment_id'<>pid::text)
      is distinct from expected->'snapshot'->'ledger'
    or (select coalesce(jsonb_agg(e order by e->>'payment_id',e->>'receivable_id'),'[]'::jsonb) from jsonb_array_elements(state->'allocations') e where e->>'payment_id'<>pid::text)
      is distinct from expected->'snapshot'->'allocations'
    or jsonb_array_length(state->'payments')<>jsonb_array_length(expected->'snapshot'->'payments')+1
    or jsonb_array_length(state->'ledger')<>jsonb_array_length(expected->'snapshot'->'ledger')+1
    or jsonb_array_length(state->'allocations')<>jsonb_array_length(expected->'snapshot'->'allocations')+1
    or state->'unit' is distinct from expected->'snapshot'->'unit'
    or state->'cleaningTasks' is distinct from expected->'snapshot'->'cleaningTasks'
    or not exists(select 1 from public.ledger_entries l where l.payment_id=pid and l.unit_id=p.unit_id
      and l.building_id=r.building_id and l.entry_date=p.payment_date and l.direction='income' and l.category='daily_rental' and l.amount_xof=p.amount)
    or not exists(select 1 from public.payment_receivable_allocations a where a.payment_id=pid and a.receivable_id=r.id
      and a.amount_xof=p.amount and a.actor_id=auth.uid() and a.request_id=rid)
    or (private.operator_daily_payment_integrity(bid,rid,auth.uid())->>'verified') is distinct from 'true'
    or state->'booking'->>'status' is distinct from 'checked_out'
    or state->'booking'->>'check_in' is distinct from expected->'snapshot'->'booking'->>'check_in'
    or (state->'booking'->>'nightly_price_xof')::numeric is distinct from (expected->'plan'->>'priceBefore')::numeric
    or (state->'booking'->>'check_out')::date is distinct from (q->>'actualCheckOut')::date
    or (state->'booking'->>'actual_check_out')::date is distinct from (q->>'actualCheckOut')::date
    or (state->'booking'->>'total_amount_xof')::numeric is distinct from (expected->'plan'->>'totalAfter')::numeric
    or (state->'booking'->>'final_amount_xof')::numeric is distinct from (expected->'plan'->>'totalAfter')::numeric
    or (state->'booking'->>'prepaid_amount_xof')::numeric is distinct from (expected->'plan'->>'paidAfter')::numeric
    or state->'booking'->>'billing_status' is distinct from (case when (expected->'plan'->>'outstandingAfter')::numeric=0 then 'settled' else 'partially_paid' end)
    or r.amount_xof is distinct from (expected->'plan'->>'totalAfter')::numeric or r.paid_amount_xof is distinct from (expected->'plan'->>'paidAfter')::numeric
  then raise exception 'operationVerificationFailed'; end if;
end; $$;

-- Narrow reviewed dispatch anchors retain later room, native-money and actor
-- safeguards; an unexpected function shape aborts the entire migration.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.booking_operation_allowed(jsonb)'::regprocedure);
  anchor:='when ''correct_checkout'' then';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'checkoutRevisionMigrationDrift'; end if;
  execute replace(definition,anchor,'when ''revise_checkout_and_collect'' then public.booking_checkout_revision_payment_protocol_version()=1 and public.booking_checkout_correction_protocol_version()=1 and public.has_app_role(''admin'') and private.current_operator_action_allowed(''correct_daily_booking'',''L3'') and private.current_operator_action_allowed(''record_daily_payment'',''L2'') '||anchor);
  definition:=pg_get_functiondef('private.preview_booking_operation(jsonb)'::regprocedure);
  anchor:=' if op=''correct_checkout'' then';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'checkoutRevisionMigrationDrift'; end if;
  execute replace(definition,anchor,' if op=''revise_checkout_and_collect'' then return private.preview_checkout_revision_payment(q); end if;'||chr(10)||anchor);
  definition:=pg_get_functiondef('private.booking_operation(text,jsonb,uuid,jsonb,timestamptz,text,uuid)'::regprocedure);
  anchor:='when ''correct_checkout'' then';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'checkoutRevisionMigrationDrift'; end if;
  definition:=replace(definition,anchor,'when ''revise_checkout_and_collect'' then perform private.apply_checkout_revision_payment(q,fresh); '||anchor);
  anchor:='q->>''operation''=''correct_checkout''';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>2 then raise exception 'checkoutRevisionMigrationDrift'; end if;
  definition:=replace(definition,anchor,'q->>''operation'' in (''correct_checkout'',''revise_checkout_and_collect'')');
  anchor:='''reason'',q->>''reason'',''plan'',fresh->''plan''';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'checkoutRevisionMigrationDrift'; end if;
  definition:=replace(definition,anchor,'''corrects_request_id'',q->>''correctsRequestId'','||anchor);
  anchor:=' update private.operator_booking_operations set status=''completed'',result=v_result where id=w.id;';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'checkoutRevisionMigrationDrift'; end if;
  definition:=replace(definition,anchor,$patch$
 if q->>'operation'='revise_checkout_and_collect' then
   v_result:=v_result||jsonb_build_object('amountXof',(q->>'amountXof')::numeric,
     'paymentId',(select id from public.payments where request_id=rid),'correctsRequestId',q->>'correctsRequestId');
 end if;
 update private.operator_booking_operations set status='completed',result=v_result where id=w.id;$patch$);
  execute definition;
end; $$;

revoke all on function private.checkout_revision_state(uuid),private.preview_checkout_revision_payment(jsonb),private.apply_checkout_revision_payment(jsonb,jsonb)
from public,anon,authenticated,service_role;
commit;
