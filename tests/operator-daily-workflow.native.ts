import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createNativePaymentPostgres } from './helpers/native-payment-postgres';
// @ts-expect-error Existing schema-only exporter is a Node module.
import { applicationSchemaSql } from '../scripts/lib/application-schema.mjs';
import { ids } from './helpers/operator-payment-database';
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
},45000);
afterAll(async()=>{await cluster?.close();});
it('finds a single-payment draft by original id with owner and permission isolation',async()=>{
  const f=await seed(),request={protocolVersion:'1.0',connectorVersion:'0.4.0',requestId:f.request.requestId,actionName:'record_daily_payment',scope:'business_data',exceptionalBusinessCase:false,inputSource:'excel_screenshot',originalInstruction:'Synthetic recovery',input:{bookingId:f.booking,amountXof:10000,paymentDate:f.request.paymentDate}};
  const snapshot=(await db.query('select public.daily_booking_operation_snapshot($1,null) v',[f.booking])).rows[0].v;
  const draft=(await db.query("select public.create_operator_payment_confirmation($1,$2,now()+interval '5 minutes') v",[JSON.stringify(request),JSON.stringify(snapshot)])).rows[0].v;
  const find=async()=> (await db.query('select public.find_operator_payment_confirmation($1) v',[f.request.requestId])).rows[0].v;
  expect(await find()).toMatchObject({id:draft.id,status:'pending',verified:false});
  const other=await seed();expect(await find()).toEqual({status:'not_found'});expect(other.actor).not.toBe(f.actor);
  await login(db,f.actor);await db.query('select public.confirm_operator_payment($1)',[draft.id]);expect(await find()).toMatchObject({status:'completed',verified:false});
  await db.query('reset role');await db.query("update public.user_profiles set role='boss' where id=$1",[f.actor]);await login(db,f.actor);await expect(find()).rejects.toThrow('confirmationForbidden');
});

async function seed(operation='extend_and_collect'){
  const actor=randomUUID(),project=randomUUID(),building=randomUUID(),unit=randomUUID(),customer=randomUUID(),booking=randomUUID();
  await db.query('reset role');
  await db.query(`insert into auth.users(id,email) values('${actor}','workflow@test.invalid');
    insert into public.user_profiles(id,role,display_name) values('${actor}','admin','Synthetic workflow');
    insert into public.projects(id,code,display_name,allows_daily_rental) values('${project}','${project}','Test',true);
    insert into public.buildings(id,project_id,code,display_name) values('${building}','${project}','${building}','Test');
    insert into public.units(id,building_id,code,unit_no,floor_label,status) values('${unit}','${building}','${unit}','T01','T','daily_occupied');
    insert into public.unit_business_flags(unit_id,business_type,is_enabled) values('${unit}','daily_rental',true);
    insert into public.customers(id,name) values('${customer}','Synthetic guest');
    insert into public.daily_bookings(id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,billing_status)
      values('${booking}','${unit}','${customer}','${customer}',current_date-3,current_date,10000,30000,30000,'checked_in','need_top_up');
    insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
      values('${building}','${unit}','${customer}','daily_booking','${booking}','daily_rental','Test',current_date-3,30000);`);
  await login(db,actor);
  const dates=(await db.query("select current_date::text today,(current_date+2)::text later")).rows[0];
  const request={requestId:randomUUID(),bookingId:booking,operation,originalInstruction:'Synthetic workflow',effectiveCheckOut:operation==='extend_and_collect'?dates.later:dates.today,amountXof:operation==='extend_and_collect'?50000:30000,paymentDate:dates.today,paymentMethod:'bank_transfer'};
  return {actor,unit,booking,request};
}
async function login(client:typeof db,actor:string){
  await client.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,role:'authenticated',email:'workflow@test.invalid'})]);await client.query('set role authenticated');
}
async function draft(request:unknown,replaces:string|null=null){
  const preview=(await db.query('select public.preview_daily_workflow($1) v',[JSON.stringify(request)])).rows[0].v;
  return (await db.query("select public.create_daily_workflow($1,$2,now()+interval '5 minutes','native',$3) v",[JSON.stringify(request),JSON.stringify(preview),replaces])).rows[0].v;
}
async function confirm(id:string){return (await db.query('select public.confirm_daily_workflow($1) v',[id])).rows[0].v;}

it.each(['extend_and_collect','checkout_and_collect'])('atomically completes %s and retry never pays twice',async operation=>{
  const f=await seed(operation),d=await draft(f.request);expect(d.expected_snapshot.plan.guestName).toBe('Synthetic guest');expect((await confirm(d.id)).verified).toBe(true);
  expect((await confirm(d.id)).requestId).toBe(f.request.requestId);
  const count=(await db.query("select count(*)::int n from public.payments where source_id=$1",[f.booking])).rows[0].n;expect(count).toBe(1);
  const b=(await db.query('select status,final_amount_xof,prepaid_amount_xof from public.daily_bookings where id=$1',[f.booking])).rows[0];
  expect(Number(b.final_amount_xof)).toBe(f.request.amountXof);expect(Number(b.prepaid_amount_xof)).toBe(f.request.amountXof);
  expect(b.status).toBe(operation==='extend_and_collect'?'checked_in':'checked_out');
  const audit=(await db.query("select actor_id,actor_email from public.audit_logs where action='operator_daily_workflow' and entity_id=$1",[f.booking])).rows[0];
  expect(audit.actor_id).toBe(f.actor);expect(audit.actor_email).toBe('workflow@test.invalid');
});
it.each(['extend_and_collect','checkout_and_collect'])('rolls back %s when payment insertion fails',async operation=>{
  const f=await seed(operation),d=await draft(f.request);await db.query('reset role');
  await db.query(`create function public.test_workflow_fail() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end; $$;
    create trigger test_workflow_fail before insert on public.payments for each row execute function public.test_workflow_fail();`);
  await login(db,f.actor);await expect(confirm(d.id)).rejects.toThrow('synthetic failure');await db.query('reset role');
  await db.query('drop trigger test_workflow_fail on public.payments; drop function public.test_workflow_fail();');
  const b=(await db.query('select final_amount_xof from public.daily_bookings where id=$1',[f.booking])).rows[0];expect(Number(b.final_amount_xof)).toBe(30000);
  expect((await db.query('select count(*)::int n from public.daily_operation_requests where request_id=$1',[f.request.requestId])).rows[0].n).toBe(0);
  expect((await db.query('select status from private.operator_daily_workflows where id=$1',[d.id])).rows[0].status).toBe('pending');
  expect((await db.query('select status from public.daily_bookings where id=$1',[f.booking])).rows[0].status).toBe('checked_in');
  expect((await db.query('select count(*)::int n from public.cleaning_tasks where daily_booking_id=$1',[f.booking])).rows[0].n).toBe(0);
});
it('does not report verified when a completed payment method has changed',async()=>{
  const f=await seed(),d=await draft(f.request);await confirm(d.id);await db.query('reset role');
  await db.query("update public.payments set payment_method='cash' where request_id=$1",[f.request.requestId]);await login(db,f.actor);
  await expect(confirm(d.id)).rejects.toThrow('workflowResultChanged');
});
it('rejects changed snapshot and allows a same-request replacement, not an old page',async()=>{
  const f=await seed(),d=await draft(f.request);await db.query('reset role');await db.query("update public.daily_bookings set notes='new fact' where id=$1",[f.booking]);await login(db,f.actor);
  await expect(confirm(d.id)).rejects.toThrow('workflowChanged');
  const next=await draft(f.request,d.id);expect(next.id).not.toBe(d.id);
  await expect(confirm(d.id)).rejects.toThrow('workflowExpired');expect((await confirm(next.id)).verified).toBe(true);
});
it('rejects another actor, expiry and revoked permission',async()=>{
  const f=await seed(),d=await draft(f.request);const other=await seed();
  await expect(confirm(d.id)).rejects.toThrow('workflowForbidden');await db.query('reset role');
  await db.query("update private.operator_daily_workflows set expires_at=now()-interval '1 second' where id=$1",[d.id]);await login(db,f.actor);
  await expect(confirm(d.id)).rejects.toThrow('workflowExpired');await db.query('reset role');
  await db.query("update public.user_profiles set role='boss' where id=$1",[f.actor]);await login(db,f.actor);
  await expect(confirm(d.id)).rejects.toThrow('workflowForbidden');expect(other.actor).not.toBe(f.actor);
});
it('serializes concurrent duplicate confirmation',async()=>{
  const f=await seed(),d=await draft(f.request),a=await cluster.connect(),b=await cluster.connect();
  await login(a,f.actor);await login(b,f.actor);
  const results=await Promise.all([a,b].map(c=>c.query('select public.confirm_daily_workflow($1) v',[d.id])));
  expect(results.every(r=>r.rows[0].v.verified)).toBe(true);
  expect((await db.query('select count(*)::int n from public.payments where request_id=$1',[f.request.requestId])).rows[0].n).toBe(1);
});
it('allows only one of two separately prepared requests against the same booking snapshot',async()=>{
  const f=await seed(),first=await draft(f.request),second=await draft({...f.request,requestId:randomUUID()}),a=await cluster.connect(),b=await cluster.connect();
  await login(a,f.actor);await login(b,f.actor);
  const results=await Promise.allSettled([a.query('select public.confirm_daily_workflow($1)',[first.id]),b.query('select public.confirm_daily_workflow($1)',[second.id])]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await db.query('select count(*)::int n from public.payments where source_id=$1',[f.booking])).rows[0].n).toBe(1);
});
it('rejects overpayment and special pricing before creating confirmation',async()=>{
  const f=await seed();await expect(draft({...f.request,amountXof:50001})).rejects.toThrow('workflowOverpayment');
  await db.query('reset role');await db.query('update public.daily_bookings set manual_discount_amount_xof=100 where id=$1',[f.booking]);await login(db,f.actor);
  await expect(draft(f.request)).rejects.toThrow('workflowSpecialPricingOrState');
});
it('rejects a new conflicting stay created after preview',async()=>{
  const f=await seed(),d=await draft(f.request);await db.query('reset role');
  await db.query(`insert into public.daily_bookings(unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status)
    select unit_id,customer_id,booking_agent_id,current_date+1,current_date+3,10000,20000,20000,'confirmed' from public.daily_bookings where id=$1`,[f.booking]);await login(db,f.actor);
  await expect(confirm(d.id)).rejects.toThrow('workflowRoomConflict');
});
it('does not expose definer functions or direct tables to anonymous users',async()=>{
  await db.query('reset role');const result=await db.query("select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%daily_workflow%'");
  expect(result.rows.length).toBe(6);expect(result.rows.every(r=>!r.anon&&!r.prosecdef)).toBe(true);
  expect((await db.query("select has_table_privilege('authenticated','private.operator_daily_workflows','select') allowed")).rows[0].allowed).toBe(false);
});
