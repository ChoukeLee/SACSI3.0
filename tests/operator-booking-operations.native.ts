import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createNativePaymentPostgres } from './helpers/native-payment-postgres';
// @ts-expect-error Existing schema-only exporter is a Node module.
import { applicationSchemaSql } from '../scripts/lib/application-schema.mjs';

let cluster:Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db:Awaited<ReturnType<Awaited<ReturnType<typeof createNativePaymentPostgres>>['connect']>>;
const read=(name:string)=>readFileSync(`supabase/migrations/${name}`,'utf8');
beforeAll(async()=>{
  cluster=await createNativePaymentPostgres();db=await cluster.connect();
  await db.query(`create role postgres superuser; create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; create schema extensions; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid; $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role'; $$;
    grant usage on schema auth to authenticated,anon,service_role;
    begin;
    ${applicationSchemaSql(JSON.parse(readFileSync('supabase/baselines/20260916.application-schema.json','utf8')))}
    commit;`);
  const grants=read('20260914133925_add_operator_action_grants.sql');
  await db.query(grants.slice(grants.indexOf('insert into private.operator_action_catalog ('),grants.indexOf('create or replace function private.current_operator_action_allowed(')));
  for(const name of ['20260915150854_harden_operator_daily_payment_integrity.sql','20260915162247_add_operator_payment_confirmations.sql','20260915222405_add_operator_confirmation_reprepare.sql','20260916170356_harden_receivable_timestamp_search_path.sql','20260916173232_restrict_property_fee_rule_access.sql','20260922171433_operator_batch_collections.sql','20260923080038_operator_daily_workflow.sql'])await db.query(read(name));
  await db.query(read('20260923082259_operator_pending_recovery.sql'));
  await db.query(read('20260918084208_add_admin_duplicate_checkin_correction.sql'));
  await db.query(read('20260923135331_operator_booking_operations.sql'));
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
