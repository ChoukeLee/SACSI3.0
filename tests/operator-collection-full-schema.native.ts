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
  for(const name of ['20260915150854_harden_operator_daily_payment_integrity.sql','20260915162247_add_operator_payment_confirmations.sql','20260915222405_add_operator_confirmation_reprepare.sql','20260916170356_harden_receivable_timestamp_search_path.sql','20260916173232_restrict_property_fee_rule_access.sql','20260922171433_operator_batch_collections.sql'])await db.query(read(name));
},45000);
afterAll(async()=>{await cluster?.close();});
it('runs the collection transaction with complete baseline constraints, triggers and RLS',async()=>{
  const lease='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',r='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.query('insert into auth.users(id,email) values($1,$2)',[ids.actor,'native@test.invalid']);
  await db.query("insert into public.user_profiles(id,role,display_name) values($1,'admin','Synthetic operator')",[ids.actor]);
  await db.query(`insert into public.projects(id,code,display_name,allows_daily_rental) values('${ids.request}','TEST','Synthetic',true);
    insert into public.buildings(id,code,display_name,project_id) values('${ids.building}','TEST','Synthetic','${ids.request}');
    insert into public.units(id,building_id,code,unit_no,floor_label) values('${ids.unit}','${ids.building}','TEST-01','01','T');
    insert into public.customers(id,name) values('${ids.agent}','Synthetic');
    insert into public.lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,status,start_date,expected_end_date)
      values('${lease}','${ids.unit}','${ids.agent}','TEST','monthly',1,600000,'active','2026-08-01','2027-07-31');
    insert into public.receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
      values('${r}','${ids.building}','${ids.unit}','${ids.agent}','lease_contract','${lease}','lease_rent','Synthetic rent','2026-08-01',600000);`);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids.actor,role:'authenticated',email:'native@test.invalid'})]);
  await db.query('set role authenticated');
  const request={requestId:ids.secondRequest,protocolVersion:'1.0',connectorVersion:'0.2.0',originalInstruction:'Synthetic baseline receipt',totalXof:600000,rows:[{lineId:'1',sourceText:'TEST rent',domain:'lease',targetId:lease,totalXof:600000,paymentDate:'2026-09-22',paymentMethod:'cash',paidThroughDate:'2026-08-31',allocations:[{receivableId:r,amountXof:600000}]}]};
  const s=(await db.query('select public.preview_operator_collection($1) v',[JSON.stringify(request)])).rows[0].v;
  const draft=(await db.query("select public.create_operator_collection($1,$2,now()+interval '5 minutes','native') v",[JSON.stringify(request),JSON.stringify(s)])).rows[0].v;
  const result=(await db.query('select public.confirm_operator_collection($1) v',[draft.id])).rows[0].v;
  expect(result.verified).toBe(true);
  const audit=(await db.query("select actor_id,actor_email,after_data from public.audit_logs where action='operator_collection_item'")).rows[0];
  expect(audit.actor_id).toBe(ids.actor);expect(audit.actor_email).toBe('native@test.invalid');expect(audit.after_data.paid_amount_xof).toBe(600000);
  await db.query('reset role');
  const functions=await db.query(`select p.proname,has_function_privilege('anon',p.oid,'execute') anon,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like '%operator_collection%'`);
  expect(functions.rows.every(r=>r.anon===false)).toBe(true);
  expect(functions.rows.every(r=>r.proconfig.some((s:string)=>s.startsWith('search_path=')))).toBe(true);
});
