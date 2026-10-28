import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createNativePaymentPostgres } from './helpers/native-payment-postgres';
import { installApplicationRebuild } from './helpers/application-rebuild';

let cluster:Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db:Awaited<ReturnType<Awaited<ReturnType<typeof createNativePaymentPostgres>>['connect']>>;
beforeAll(async()=>{
  cluster=await createNativePaymentPostgres();db=await cluster.connect();
  await installApplicationRebuild(db);
},45000);
afterAll(async()=>{await cluster?.close();});

async function login(actor:string,role='authenticated') {
  await db.query('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,role,email:'synthetic@test.invalid'})]);
  await db.query('set role '+role);
}
async function seed(status='confirmed',role='admin') {
  await db.query('reset role');
  const actor=randomUUID(),project=randomUUID(),building=randomUUID(),unit=randomUUID(),target=randomUUID(),agent=randomUUID(),booking=randomUUID();
  await db.query(`insert into auth.users(id,email) values('${actor}','operation@test.invalid');
    insert into public.user_profiles(id,role,display_name) values('${actor}','${role}','Synthetic');
    insert into public.projects(id,code,display_name,allows_daily_rental) values('${project}','${project}','Test',true);
    insert into public.buildings(id,project_id,code,display_name) values('${building}','${project}','${building}','Test');
    insert into public.units(id,building_id,code,unit_no,floor_label,status) values('${unit}','${building}','${unit}','T01','T','reserved'),('${target}','${building}','${target}','T02','T','available');
    insert into public.unit_business_flags(unit_id,business_type,is_enabled) values('${unit}','daily_rental',true),('${target}','daily_rental',true);
    insert into public.customers(id,name) values('${agent}','颖');
    insert into public.daily_bookings(id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,billing_status)
    values('${booking}','${unit}','${agent}','${agent}',current_date,current_date+2,10000,20000,20000,'${status}','need_top_up');
    insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
    values('${building}','${unit}','${agent}','daily_booking','${booking}','daily_rental','Test',current_date,20000);`);
  const dates=(await db.query("select current_date::text today,(current_date+2)::text later,(current_date+3)::text extra")).rows[0];
  await login(actor);
  return {actor,unit,target,agent,booking,...dates};
}
function request(f:any,operation:string,extra:Record<string,unknown>={}) {
 return {requestId:randomUUID(),operation,originalInstruction:'Synthetic operation',...(operation==='create'?{}:{bookingId:f.booking}),...extra};
}
async function preview(q:any){return (await db.query("select public.operator_booking_operation('preview',$1) v",[q])).rows[0].v;}
async function draft(q:any,replaces:string|null=null){
 const snap=await preview(q);
 return (await db.query("select public.operator_booking_operation('create',$1,null,$2,now()+interval '5 minutes','test',$3) v",[q,snap,replaces])).rows[0].v;
}
async function confirm(id:string){return (await db.query("select public.operator_booking_operation('confirm',null,$1,null,null,'test') v",[id])).rows[0].v;}
async function owner(sql:string,params:any[]=[]){await db.query('reset role');return db.query(sql,params);}
it('creates a booking and receivable with agent/guest/actor separated, then checks in without inventing payment',async()=>{
 const f=await seed(),q=request(f,'create',{unitId:f.target,bookingAgentId:f.agent,guestName:'Synthetic guest',checkIn:f.today,checkOut:f.later,nightlyPriceXof:10000});
 const d=await draft(q),done=await confirm(d.id);expect(done.verified).toBe(true);
 expect(await confirm(d.id)).toMatchObject({status:'completed_previously',verified:false});
 const b=(await owner('select * from daily_bookings where id=$1',[done.bookingId])).rows[0];
 expect(b.booking_agent_id).toBe(f.agent);expect(b.guest_name).toBe('Synthetic guest');expect(b.status).toBe('confirmed');
 await login(f.actor);const next=await draft({...request(f,'check_in'),bookingId:done.bookingId});await confirm(next.id);
 expect((await owner('select status,prepaid_amount_xof from daily_bookings where id=$1',[done.bookingId])).rows[0]).toMatchObject({status:'checked_in',prepaid_amount_xof:'0.00'});
 expect((await owner("select count(*)::int n from payments where source_id=$1",[done.bookingId])).rows[0].n).toBe(0);
 expect((await owner("select actor_id from audit_logs where entity_id=$1 and action='operator_booking_create'",[done.bookingId])).rows[0].actor_id).toBe(f.actor);
});
it.each(['cancel','void_checkin'])('preserves history when performing %s',async op=>{
 const f=await seed(op==='cancel'?'confirmed':'checked_in'),d=await draft(request(f,op,{reason:'合成测试纠错原因'}));await confirm(d.id);
 expect((await owner('select status from daily_bookings where id=$1',[f.booking])).rows[0].status).toBe('cancelled');
});
it('adjusts dates and price and synchronizes receivable',async()=>{
 const f=await seed(),d=await draft(request(f,'change_stay',{checkIn:f.today,checkOut:f.extra,nightlyPriceXof:12000,reason:'合成测试调整日期'}));await confirm(d.id);
 expect((await owner("select amount_xof from receivables where source_id=$1",[f.booking])).rows[0].amount_xof).toBe('36000.00');
});
it('transfers an unpaid reservation without moving financial history',async()=>{
 const f=await seed(),d=await draft(request(f,'transfer',{targetUnitId:f.target,reason:'合成测试转移预订'}));await confirm(d.id);
 expect((await owner('select unit_id from daily_bookings where id=$1',[f.booking])).rows[0].unit_id).toBe(f.target);
 expect((await owner('select unit_id from receivables where source_id=$1',[f.booking])).rows[0].unit_id).toBe(f.target);
});
async function pay(f:any) {
 await db.query("select public.daily_record_payment_rpc($1,20000,current_date,null,$2,'{}')",[f.booking,randomUUID()]);
 return (await db.query("select id from payments where source_id=$1 and amount>0",[f.booking])).rows[0].id;
}
it('separates erroneous-payment reversal from actual refund',async()=>{
 const f=await seed('checked_in'),pid=await pay(f);
 const d=await draft(request(f,'reverse',{paymentId:pid,reason:'合成测试录错收款'}));await confirm(d.id);
 expect((await owner("select request_kind,amount from payments where request_id=$1",[d.request_id])).rows[0]).toEqual({request_kind:'daily_reversal',amount:'-20000.00'});
});
it('records an actual refund with expense ledger, actor and retained original receipt',async()=>{
 const f=await seed('checked_out');await pay(f);
 const d=await draft(request(f,'refund',{amountXof:5000,finalAmountXof:15000,paymentDate:f.today,paymentMethod:'bank_transfer',reason:'合成测试客户实际退款'}));await confirm(d.id);
 const payment=(await owner("select * from payments where request_id=$1",[d.request_id])).rows[0];
 expect(payment).toMatchObject({request_kind:'daily_refund',amount:'-5000.00',payment_method:'bank_transfer',reversal_of_payment_id:null});
 expect((await owner('select direction,amount_xof from ledger_entries where payment_id=$1',[payment.id])).rows[0]).toEqual({direction:'expense',amount_xof:'5000.00'});
 expect((await owner('select final_amount_xof,prepaid_amount_xof from daily_bookings where id=$1',[f.booking])).rows[0]).toMatchObject({final_amount_xof:'15000.00',prepaid_amount_xof:'15000.00'});
 const original=(await owner('select id from payments where source_id=$1 and amount>0',[f.booking])).rows[0].id;
 await login(f.actor);
 await expect(db.query("select public.daily_reverse_payment_rpc($1,'synthetic legacy reversal',$2,'{}')",[original,randomUUID()])).rejects.toThrow('operationRefundReviewRequired');
});
it('rejects refund exceeding credit and never touches another booking',async()=>{
 const f=await seed('checked_out');await pay(f);
 await expect(preview(request(f,'refund',{amountXof:10001,finalAmountXof:10000,paymentDate:f.today,paymentMethod:'cash',reason:'合成测试超额退款'}))).rejects.toThrow('operationRefundReviewRequired');
});
it('rejects stale snapshots and expires/replaces only under the original request id',async()=>{
 const f=await seed(),q=request(f,'cancel',{reason:'合成测试取消原因'}),d=await draft(q);
 await owner("update daily_bookings set notes='changed' where id=$1",[f.booking]);await login(f.actor);
 await expect(confirm(d.id)).rejects.toThrow('operationChanged');
 const replacement=await draft(q,d.id);await expect(confirm(d.id)).rejects.toThrow('operationExpired');await confirm(replacement.id);
});
it('rejects another account and revoked privileges at confirmation',async()=>{
 const f=await seed(),d=await draft(request(f,'cancel',{reason:'合成测试权限隔离'}));await seed();
 await expect(confirm(d.id)).rejects.toThrow('operationForbidden');
 await owner("update user_profiles set role='boss' where id=$1",[f.actor]);await login(f.actor);
 await expect(confirm(d.id)).rejects.toThrow('operationForbidden');
});
it('front desk may check in but not refund or cancel',async()=>{
 const f=await seed('confirmed','front_desk');await draft(request(f,'check_in'));
 await expect(preview(request(f,'cancel',{reason:'合成测试角色边界'}))).rejects.toThrow('operationForbidden');
});
it('fails closed on room conflict and unsupported paid transfer',async()=>{
 const f=await seed('checked_in');await pay(f);
 await expect(preview(request(f,'transfer',{targetUnitId:f.target,reason:'合成测试已收款换房'}))).rejects.toThrow('operationAssistanceRequired');
 await expect(preview(request(f,'create',{unitId:f.unit,bookingAgentId:f.agent,checkIn:f.today,checkOut:f.later,nightlyPriceXof:10000}))).rejects.toThrow('operationRoomConflict');
});
it('keeps anonymous and service-role execution denied and private storage inaccessible',async()=>{
 await db.query('reset role');
 const row=(await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.operator_booking_operation(text,jsonb,uuid,jsonb,timestamptz,text,uuid)'::regprocedure")).rows[0];
 expect(row).toEqual({prosecdef:false,anon:false,service:false});
 expect((await db.query("select has_table_privilege('authenticated','private.operator_booking_operations','select') allowed")).rows[0].allowed).toBe(false);
});
it('concurrent confirmations across connections execute once',async()=>{
 const f=await seed(),d=await draft(request(f,'cancel',{reason:'合成测试并发取消'}));
 const clients=await Promise.all([cluster.connect(),cluster.connect()]);
 try {
   for(const client of clients){await client.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:f.actor,role:'authenticated'})]);await client.query('set role authenticated');}
   const results=await Promise.all(clients.map(client=>client.query("select public.operator_booking_operation('confirm',null,$1,null,null,'test') v",[d.id])));
   expect(results.map(r=>r.rows[0].v.status).sort()).toEqual(['completed','completed_previously']);
   expect((await owner("select count(*)::int n from audit_logs where entity_id=$1 and action='operator_booking_cancel'",[f.booking])).rows[0].n).toBe(1);
 } finally {for(const client of clients)await client.end();}
});
it('rolls back all effects when audit insertion fails',async()=>{
 const f=await seed(),d=await draft(request(f,'cancel',{reason:'合成测试审计失败'}));
 await owner(`create function public.test_booking_audit_failure() returns trigger language plpgsql as $$
 begin if new.action='operator_booking_cancel' then raise exception 'syntheticAuditFailure'; end if; return new; end; $$;
 create trigger test_booking_audit_failure before insert on public.audit_logs for each row execute function public.test_booking_audit_failure();`);
 try {
   await login(f.actor);await expect(confirm(d.id)).rejects.toThrow('syntheticAuditFailure');
   expect((await owner('select status from daily_bookings where id=$1',[f.booking])).rows[0].status).toBe('confirmed');
   expect((await owner('select status from private.operator_booking_operations where id=$1',[d.id])).rows[0].status).toBe('pending');
 } finally {await owner('drop trigger test_booking_audit_failure on public.audit_logs; drop function public.test_booking_audit_failure()');}
});
it('rejects expired and wrong-release confirmations',async()=>{
 const f=await seed(),d=await draft(request(f,'cancel',{reason:'合成测试过期保护'}));
 await expect(db.query("select public.operator_booking_operation('confirm',null,$1,null,null,'wrong-release')",[d.id])).rejects.toThrow('operationExpired');
 await owner("update private.operator_booking_operations set expires_at=now()-interval '1 second' where id=$1",[d.id]);await login(f.actor);
 await expect(confirm(d.id)).rejects.toThrow('operationExpired');
});
it('rejects actor injection and forged preview snapshots',async()=>{
 const f=await seed(),q=request(f,'cancel',{reason:'合成测试伪造快照'});
 await expect(preview({...q,actor_id:f.actor})).rejects.toThrow('operationInvalidRequest');
 await expect(db.query("select public.operator_booking_operation('create',$1,null,'{}',now()+interval '5 minutes','test')",[q])).rejects.toThrow('operationChanged');
});
it('corrects a paid occupied booking room without changing amounts, receipts or agent',async()=>{
 const f=await seed('checked_in'),pid=await pay(f);
 const before=(await owner('select * from payments where id=$1',[pid])).rows[0];
 await login(f.actor);const q=request(f,'correct_room',{targetUnitId:f.target,reason:'合成测试原房号录入错误'}),d=await draft(q);
 expect(d.expected_snapshot.plan.paymentCount).toBe(1);await confirm(d.id);
 const after=(await owner('select * from payments where id=$1',[pid])).rows[0];
 expect(after).toEqual({...before,unit_id:f.target});
 expect((await owner('select unit_id,booking_agent_id,status from daily_bookings where id=$1',[f.booking])).rows[0]).toEqual({unit_id:f.target,booking_agent_id:f.agent,status:'checked_in'});
 expect((await owner('select unit_id from ledger_entries where payment_id=$1',[pid])).rows[0].unit_id).toBe(f.target);
 const audit=(await owner("select metadata from audit_logs where entity_id=$1 and action='operator_booking_correct_room'",[f.booking])).rows[0].metadata;
 expect(audit.room_correction_before.payments[0].unit_id).toBe(f.unit);
 expect(audit.booking_agent_id).toBe(f.agent);
});
it('a future reservation preserves a currently occupied room',async()=>{
 const f=await seed('checked_in');
 const end=(await db.query("select (current_date+5)::text d")).rows[0].d;
 const d=await draft(request(f,'create',{unitId:f.unit,bookingAgentId:f.agent,checkIn:f.extra,checkOut:end,nightlyPriceXof:10000}));
 await confirm(d.id);
 expect((await owner('select status from public.units where id=$1',[f.unit])).rows[0].status).toBe('daily_occupied');
});

// Synthetic reproduction of a missed checkout: expected one night, actual
// checkout accidentally recorded 21 days later. No production IDs or sessions.
async function missedCheckout() {
 const f=await seed('checked_out');
 const dates=(await owner(`select (current_date-21)::text arrival,(current_date-20)::text departure,
   current_date::text recorded,(current_date+1)::text future`)).rows[0];
 await owner(`update daily_bookings set check_in=current_date-21,check_out=current_date-20,
   actual_check_out=current_date,nightly_price_xof=80000,total_amount_xof=1680000,final_amount_xof=1680000 where id=$1`,[f.booking]);
 await owner(`update receivables set due_date=current_date-21,amount_xof=1680000 where source_id=$1`,[f.booking]);
 await owner(`update units set status='available' where id=$1`,[f.unit]);
 await owner(`insert into cleaning_tasks(unit_id,daily_booking_id,is_completed,completed_at) values($1,$2,true,now())`,[f.unit,f.booking]);
 await login(f.actor);
 await db.query("select public.daily_record_payment_rpc($1,40000,current_date-21,null,$2,'{}')",[f.booking,randomUUID()]);
 return {...f,...dates};
}
function correction(f:any,extra:Record<string,unknown>={}) {
 return request(f,'correct_checkout',{actualCheckOut:f.departure,discountAmountXof:40000,
   reason:'合成测试：漏退房，一晚房费八万优惠四万',inputSource:'excel_screenshot',...extra});
}
async function correctionState(f:any) {
 return (await owner(`select jsonb_build_object('booking',(select to_jsonb(b) from daily_bookings b where id=$1),
   'receivables',(select jsonb_agg(to_jsonb(r) order by r.id) from receivables r where source_id=$1),
   'payments',(select jsonb_agg(to_jsonb(p) order by p.id) from payments p where source_id=$1),
   'ledger',(select jsonb_agg(to_jsonb(l) order by l.id) from ledger_entries l join payments p on p.id=l.payment_id where p.source_id=$1),
   'cleaning',(select jsonb_agg(to_jsonb(c) order by c.id) from cleaning_tasks c where daily_booking_id=$1),
   'unit',(select to_jsonb(u) from units u where id=$2)) v`,[f.booking,f.unit])).rows[0].v;
}
it('previews and atomically settles a missed checkout with explicit discount, preserving all money and room history',async()=>{
 const f=await missedCheckout(),q=correction(f),before=await correctionState(f);
 await login(f.actor);const snap=await preview(q);
 expect(snap.plan).toMatchObject({actualCheckOutBefore:f.recorded,actualCheckOutAfter:f.departure,
   priceAfter:80000,grossBefore:1680000,grossAfter:80000,discountAfter:40000,
   totalAfter:40000,paidAfter:40000,outstandingBefore:1640000,outstandingAfter:0});
 expect(await correctionState(f)).toEqual(before);
 await login(f.actor);const d=await draft(q),done=await confirm(d.id);
 expect(done).toMatchObject({status:'completed',verified:true,requestId:q.requestId,operation:'correct_checkout'});
 const after=await correctionState(f);
 expect(after.booking).toMatchObject({status:'checked_out',check_in:f.arrival,check_out:f.departure,
   actual_check_out:f.departure,nightly_price_xof:80000,total_amount_xof:80000,
   manual_discount_amount_xof:40000,final_amount_xof:40000,prepaid_amount_xof:40000,billing_status:'settled',booking_agent_id:f.agent});
 expect(after.receivables[0]).toMatchObject({amount_xof:40000,paid_amount_xof:40000,status:'paid'});
 for(const key of ['payments','ledger','cleaning','unit'])expect(after[key]).toEqual(before[key]);
 const audit=(await owner("select * from audit_logs where entity_id=$1 and action='operator_booking_correct_checkout'",[f.booking])).rows[0];
 expect(audit.actor_id).toBe(f.actor);expect(audit.before_data.actual_check_out).toBe(f.recorded);
 expect(audit.after_data.actual_check_out).toBe(f.departure);
 expect(audit.metadata.input_source).toBe('excel_screenshot');
 expect(audit.metadata.checkout_correction_before.payments).toEqual(before.payments);
 await login(f.actor);expect(await confirm(d.id)).toMatchObject({status:'completed_previously',verified:false});
 expect((await db.query("select public.operator_booking_operation('status',$1) v",[{requestId:q.requestId}])).rows[0].v).toMatchObject({status:'completed',verified:false});
 await expect(draft({...q,discountAmountXof:0})).rejects.toThrow('operationRequestConflict');
});
it('rejects settlement reductions below real receipts without inventing a refund',async()=>{
 const f=await missedCheckout(),before=await correctionState(f);await login(f.actor);
 await expect(preview(correction(f,{discountAmountXof:50000}))).rejects.toThrow('operationRefundReviewRequired');
 expect(await correctionState(f)).toEqual(before);
});
it('rejects unsupported dates, discounts, sources and injected payment fields',async()=>{
 const f=await missedCheckout();
 for(const extra of [
   {actualCheckOut:f.arrival},{actualCheckOut:f.future},{actualCheckOut:'2026-02-30'},
   {actualCheckOut:'infinity'},{discountAmountXof:-1},{discountAmountXof:0.5},
   {discountAmountXof:80001},{discountAmountXof:'40000'},
   {inputSource:'screenshot_claimed_as_language'},{inputSource:null},{paymentMethod:'cash'},{finalAmountXof:0},
 ])await expect(preview(correction(f,extra))).rejects.toThrow(/operationInvalid(Date|Request)/);
});
it('keeps historical corrections admin-only and rechecks revoked roles and other actors',async()=>{
 const f=await missedCheckout(),d=await draft(correction(f));
 const other=await seed('checked_out','front_desk');
 await expect(preview(correction(f))).rejects.toThrow('operationForbidden');
 await expect(confirm(d.id)).rejects.toThrow('operationForbidden');
 await owner("update user_profiles set role='rental_sales' where id=$1",[f.actor]);await login(f.actor);
 await expect(confirm(d.id)).rejects.toThrow('operationForbidden');
 expect(other.actor).not.toBe(f.actor);
});
it('refuses non-checked-out records and inconsistent receivables or ledger before mutation',async()=>{
 const f=await missedCheckout();
 await owner("update daily_bookings set status='checked_in' where id=$1",[f.booking]);await login(f.actor);
 await expect(preview(correction(f))).rejects.toThrow('operationAssistanceRequired');
 await owner("update daily_bookings set status='checked_out' where id=$1;",[f.booking]);
 await owner('update receivables set amount_xof=amount_xof-1 where source_id=$1',[f.booking]);await login(f.actor);
 await expect(preview(correction(f))).rejects.toThrow('operationFinanceMismatch');
 await owner('update receivables set amount_xof=1680000 where source_id=$1',[f.booking]);
 await owner('update ledger_entries set amount_xof=amount_xof+1 where payment_id in(select id from payments where source_id=$1)',[f.booking]);await login(f.actor);
 await expect(preview(correction(f))).rejects.toThrow('operationFinanceMismatch');
});
it('rejects a changed checkout snapshot and replaces only under the same request',async()=>{
 const f=await missedCheckout(),q=correction(f),d=await draft(q);
 await owner("update daily_bookings set notes='合成测试并发修改' where id=$1",[f.booking]);await login(f.actor);
 await expect(confirm(d.id)).rejects.toThrow('operationChanged');
 const replacement=await draft(q,d.id);expect(replacement.request_id).toBe(q.requestId);
 await expect(confirm(d.id)).rejects.toThrow('operationExpired');
 expect(await confirm(replacement.id)).toMatchObject({status:'completed',verified:true});
});
it('rolls back both correction and receivable when audit fails',async()=>{
 const f=await missedCheckout(),d=await draft(correction(f)),before=await correctionState(f);
 await owner(`create function public.test_checkout_audit_failure() returns trigger language plpgsql as $$
 begin if new.action='operator_booking_correct_checkout' then raise exception 'syntheticCheckoutAuditFailure'; end if; return new; end; $$;
 create trigger test_checkout_audit_failure before insert on audit_logs for each row execute function public.test_checkout_audit_failure();`);
 try {
   await login(f.actor);await expect(confirm(d.id)).rejects.toThrow('syntheticCheckoutAuditFailure');
   expect(await correctionState(f)).toEqual(before);
   expect((await owner('select status from private.operator_booking_operations where id=$1',[d.id])).rows[0].status).toBe('pending');
 } finally {await owner('drop trigger test_checkout_audit_failure on audit_logs; drop function public.test_checkout_audit_failure()');}
});
it('serializes concurrent historical correction confirmations and writes exactly one audit',async()=>{
 const f=await missedCheckout(),d=await draft(correction(f)),clients=await Promise.all([cluster.connect(),cluster.connect()]);
 try {
   for(const client of clients){await client.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:f.actor,role:'authenticated'})]);await client.query('set role authenticated');}
   const result=await Promise.all(clients.map(client=>client.query("select public.operator_booking_operation('confirm',null,$1,null,null,'test') v",[d.id])));
   expect(result.map(r=>r.rows[0].v.status).sort()).toEqual(['completed','completed_previously']);
   expect((await owner("select count(*)::int n from audit_logs where entity_id=$1 and action='operator_booking_correct_checkout'",[f.booking])).rows[0].n).toBe(1);
 } finally {for(const client of clients)await client.end();}
});
it('keeps correction helpers inaccessible and preserves later operational room safeguards',async()=>{
 await db.query('reset role');
 const grants=(await db.query(`select has_function_privilege('authenticated','private.apply_checkout_correction(jsonb,jsonb)','execute') helper,
   has_function_privilege('anon','public.booking_checkout_correction_protocol_version()','execute') anon,
   has_function_privilege('service_role','public.booking_checkout_correction_protocol_version()','execute') service`)).rows[0];
 expect(grants).toEqual({helper:false,anon:false,service:false});
 const definition=(await db.query("select pg_get_functiondef('private.preview_booking_operation(jsonb)'::regprocedure) d")).rows[0].d;
 expect(definition).toContain('operational_condition');
});
it('can disable only historical corrections at the database boundary without enabling a generic RPC bypass',async()=>{
 const f=await missedCheckout();
 await owner("create or replace function public.booking_checkout_correction_protocol_version() returns integer language sql security invoker set search_path='' as $$ select 0; $$;");
 try { await login(f.actor);await expect(preview(correction(f))).rejects.toThrow('operationForbidden'); }
 finally {await owner("create or replace function public.booking_checkout_correction_protocol_version() returns integer language sql security invoker set search_path='' as $$ select 1; $$;");}
 await login(f.actor);expect((await preview(correction(f))).plan.outstandingAfter).toBe(0);
});

async function settledOpenStay() {
 const f=await seed('checked_out');
 const dates=(await owner('select (current_date-6)::text arrival,current_date::text departure')).rows[0];
 await owner(`update daily_bookings set checkout_mode='open',check_in=current_date-6,check_out=current_date,
   actual_check_out=current_date,nightly_price_xof=80000,total_amount_xof=480000,final_amount_xof=480000 where id=$1`,[f.booking]);
 await owner('update receivables set due_date=current_date-6,amount_xof=480000 where source_id=$1',[f.booking]);
 await login(f.actor);return {...f,...dates};
}
it('waives a checked-out open stay without changing dates, mode, money history or another cancelled record',async()=>{
 const cancelled=await seed('cancelled');
 await owner("update receivables set status='cancelled' where source_id=$1",[cancelled.booking]);
 const cancelledBefore=await correctionState(cancelled);
 const f=await settledOpenStay(),q=correction(f,{actualCheckOut:f.departure,discountAmountXof:480000}),before=await correctionState(f);
 await login(f.actor);expect((await preview(q)).plan).toMatchObject({grossAfter:480000,discountAfter:480000,paidAfter:0,totalAfter:0,outstandingAfter:0});
 const d=await draft(q);expect(await confirm(d.id)).toMatchObject({status:'completed',verified:true});
 const after=await correctionState(f);
 expect(after.booking).toMatchObject({checkout_mode:'open',check_in:f.arrival,check_out:f.departure,actual_check_out:f.departure,
   nightly_price_xof:80000,total_amount_xof:480000,manual_discount_amount_xof:480000,final_amount_xof:0,prepaid_amount_xof:0,billing_status:'settled'});
 expect(after.receivables[0]).toMatchObject({amount_xof:0,paid_amount_xof:0,status:'paid'});
 for(const key of ['payments','ledger','unit','cleaning'])expect(after[key]).toEqual(before[key]);
 expect(await correctionState(cancelled)).toEqual(cancelledBefore);
});
it('never changes the historical dates of a checked-out open stay',async()=>{
 const f=await settledOpenStay(),earlier=(await db.query('select (current_date-1)::text d')).rows[0].d;
 await expect(preview(correction(f,{actualCheckOut:earlier,discountAmountXof:0}))).rejects.toThrow('operationAssistanceRequired');
 await owner('update daily_bookings set check_out=current_date+1 where id=$1',[f.booking]);await login(f.actor);
 await expect(preview(correction(f,{actualCheckOut:f.departure,discountAmountXof:480000}))).rejects.toThrow('operationAssistanceRequired');
});
it('rejects open stays that have not checked out or lack an actual checkout',async()=>{
 const f=await settledOpenStay();
 await owner("update daily_bookings set status='checked_in' where id=$1",[f.booking]);await login(f.actor);
 await expect(preview(correction(f,{actualCheckOut:f.departure,discountAmountXof:480000}))).rejects.toThrow('operationAssistanceRequired');
 await owner("update daily_bookings set status='checked_out',actual_check_out=null where id=$1",[f.booking]);await login(f.actor);
 await expect(preview(correction(f,{actualCheckOut:f.departure,discountAmountXof:480000}))).rejects.toThrow('operationAssistanceRequired');
});
it('does not reprice inconsistent open stay history or silently refund existing receipts',async()=>{
 const f=await settledOpenStay();
 await owner('update daily_bookings set total_amount_xof=480001 where id=$1',[f.booking]);await login(f.actor);
 await expect(preview(correction(f,{actualCheckOut:f.departure,discountAmountXof:480000}))).rejects.toThrow('operationFinanceMismatch');
 await owner('update daily_bookings set total_amount_xof=480000 where id=$1',[f.booking]);await login(f.actor);
 await db.query("select public.daily_record_payment_rpc($1,20000,current_date,null,$2,'{}')",[f.booking,randomUUID()]);
 await expect(preview(correction(f,{actualCheckOut:f.departure,discountAmountXof:480000}))).rejects.toThrow('operationRefundReviewRequired');
});
it('can disable open-stay discounts independently while preserving fixed-stay corrections',async()=>{
 const f=await settledOpenStay();
 await owner("create or replace function public.booking_open_checkout_discount_protocol_version() returns integer language sql security invoker set search_path='' as $$ select 0; $$;");
 try {
   await login(f.actor);await expect(preview(correction(f,{actualCheckOut:f.departure,discountAmountXof:480000}))).rejects.toThrow('operationAssistanceRequired');
   const fixed=await missedCheckout();expect((await preview(correction(fixed))).plan.totalAfter).toBe(40000);
 } finally {await owner("create or replace function public.booking_open_checkout_discount_protocol_version() returns integer language sql security invoker set search_path='' as $$ select 1; $$;");}
 expect((await owner("select has_function_privilege('anon','public.booking_open_checkout_discount_protocol_version()','execute') anon,has_function_privilege('service_role','public.booking_open_checkout_discount_protocol_version()','execute') service")).rows[0]).toEqual({anon:false,service:false});
});
