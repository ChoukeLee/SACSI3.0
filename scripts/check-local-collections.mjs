// Full real Auth/PostgREST + Next HTTP acceptance. Fixed loopback-only stack.
// Run the isolated Next server first: node scripts/start-local-operator-web.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { localCredentials,localSql,safeFailure } from './lib/local-supabase-runtime.mjs';
async function main(){
  const credentials=localCredentials(); // Enforces project id, no cloud link, loopback ports.
  if(process.argv.includes('--apply')) {
    const installed=localSql("select to_regprocedure('public.operator_collection_protocol_version()') is not null;");
    if(installed==='f')localSql(readFileSync(new URL('../supabase/migrations/20260922171433_operator_batch_collections.sql',import.meta.url),'utf8'));
  }
  assert.equal(localSql('select public.operator_collection_protocol_version();'),'1');
  const opts={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(credentials.API_URL,credentials.SERVICE_ROLE_KEY,opts);
  const client=createClient(credentials.API_URL,credentials.ANON_KEY,opts);
  const ids=Object.fromEntries(['project','building','unit','customer','lease','rent','fee','request'].map(n=>[n,randomUUID()]));
  const email=`local-collection-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');
  let userId,confirmationId;
  const cookies=new Map();
  const browser=createServerClient(credentials.API_URL,credentials.ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(c=>cookies.set(c.name,c.value))}});
  const post=async(path,body,headers={})=>{
    const response=await fetch(`http://127.0.0.1:3100/api/operator/v1/${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,200,`${path}: ${data.code||'unexpected response'}`);return data;
  };
  try{
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null);userId=created.data.user.id;
    localSql(`begin;
      insert into public.user_profiles(id,role,display_name) values('${userId}','admin','Synthetic stage4');
      insert into public.projects(id,code,display_name,allows_daily_rental) values('${ids.project}','TEST-${ids.project}','Synthetic',true);
      insert into public.buildings(id,project_id,code,display_name) values('${ids.building}','${ids.project}','TEST-${ids.building}','Synthetic');
      insert into public.units(id,building_id,code,unit_no,floor_label) values('${ids.unit}','${ids.building}','TEST-${ids.unit}','T01','T');
      insert into public.customers(id,name) values('${ids.customer}','Synthetic customer');
      insert into public.lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,status,start_date,expected_end_date)
        values('${ids.lease}','${ids.unit}','${ids.customer}','TEST-${ids.lease}','monthly',26,600000,'active','2026-08-26','2027-08-25');
      insert into public.receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof) values
        ('${ids.rent}','${ids.building}','${ids.unit}','${ids.customer}','lease_contract','${ids.lease}','lease_rent','Synthetic rent','2026-08-26',3600000),
        ('${ids.fee}','${ids.building}','${ids.unit}','${ids.customer}','lease_contract','${ids.lease}','property_fee','Synthetic fee','2026-08-26',240000);
      commit;`);
    const login=await client.auth.signInWithPassword({email,password});assert.equal(login.error,null);
    assert.equal((await browser.auth.signInWithPassword({email,password})).error,null);
    const bearer={Authorization:`Bearer ${login.data.session.access_token}`};
    const cookie={Origin:'http://127.0.0.1:3100',Cookie:[...cookies].map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('; ')};
    const request={requestId:ids.request,protocolVersion:'1.0',connectorVersion:'0.2.0',originalInstruction:'Synthetic receipt only',totalXof:3840000,rows:[{lineId:'1',sourceText:'Synthetic 384万',domain:'lease',targetId:ids.lease,totalXof:3840000,paymentDate:new Date().toISOString().slice(0,10),paymentMethod:'bank_transfer',paidThroughDate:'2027-02-25',allocations:[{receivableId:ids.rent,amountXof:3600000},{receivableId:ids.fee,amountXof:240000}]}]};
    const preview=await post('collections/prepare',request,bearer);
    const draft=await post('collections/drafts',{request,previewProof:preview.previewProof},bearer);confirmationId=draft.confirmation.id;
    const denied=await fetch(`http://127.0.0.1:3100/api/operator/v1/collections/${confirmationId}`,{method:'POST',headers:{...bearer,Origin:cookie.Origin}});assert.equal(denied.status,403);
    const result=await post(`collections/${confirmationId}`,{},cookie);assert.equal(result.verified,true);assert.equal(result.items.length,2);
    const retry=await post(`collections/${confirmationId}`,{},cookie);assert.equal(retry.verified,true);
    assert.equal(localSql(`select count(*) from public.payments where source_id='${ids.lease}';`),'2');
    assert.equal(localSql(`select count(*) from public.audit_logs where actor_id='${userId}' and action='operator_collection_item';`),'2');
    console.log('PASS: real local Auth + signed preview + PostgREST draft + cookie HTTP confirmation + no duplicates + authenticated audit; productionWrites=0');
  } finally {
    await client.auth.signOut().catch(()=>{});await browser.auth.signOut().catch(()=>{});
    if(userId){
      // Remove only this run's random synthetic IDs, after sessions are revoked.
      localSql(`begin;
        delete from private.operator_collection_batches where actor_id='${userId}';
        delete from public.ledger_entries where unit_id='${ids.unit}';
        delete from public.payments where source_id='${ids.lease}';
        delete from public.audit_logs where actor_id='${userId}';
        delete from public.receivables where unit_id='${ids.unit}';
        delete from public.lease_contracts where id='${ids.lease}';
        delete from public.unit_business_flags where unit_id='${ids.unit}';
        delete from public.units where id='${ids.unit}';delete from public.customers where id='${ids.customer}';
        delete from public.buildings where id='${ids.building}';delete from public.projects where id='${ids.project}';
        delete from public.user_profiles where id='${userId}';commit;`);
      assert.equal((await admin.auth.admin.deleteUser(userId)).error,null);
    }
  }
}
main().catch(safeFailure);
