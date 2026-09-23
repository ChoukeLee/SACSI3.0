// Only the isolated loopback stack. No production environment or credentials.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {localCredentials,localSql,safeFailure} from './lib/local-supabase-runtime.mjs';

async function main(){
  const status=localCredentials(),options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options),client=createClient(status.API_URL,status.ANON_KEY,options);
  const cookies=new Map();
  const browser=createServerClient(status.API_URL,status.ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>cookies.set(name,value))}});
  const ids=Object.fromEntries(['project','building','unit','customer','booking','future','receivable'].map(key=>[key,randomUUID()]));
  const email=`workflow-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');
  let userId;
  try{
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null);userId=created.data.user.id;
    localSql(`begin;
      insert into public.user_profiles(id,role,display_name) values('${userId}','admin','Synthetic workflow');
      insert into public.projects(id,code,display_name,allows_daily_rental) values('${ids.project}','TEST-${ids.project}','Synthetic',true);
      insert into public.buildings(id,project_id,code,display_name) values('${ids.building}','${ids.project}','T-${ids.building}','Synthetic');
      insert into public.units(id,building_id,code,unit_no,floor_label) values('${ids.unit}','${ids.building}','TEST-${ids.unit}','T01','T');
      insert into public.unit_business_flags(unit_id,business_type,is_enabled) values('${ids.unit}','daily_rental',true);
      insert into public.customers(id,name) values('${ids.customer}','Synthetic workflow guest');
      insert into public.daily_bookings(id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,billing_status)
      values('${ids.booking}','${ids.unit}','${ids.customer}','${ids.customer}',current_date-3,current_date,10000,30000,30000,'checked_in','need_top_up'),
        ('${ids.future}','${ids.unit}','${ids.customer}','${ids.customer}',current_date+10,current_date+12,10000,20000,20000,'confirmed','need_top_up');
      insert into public.receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
      values('${ids.receivable}','${ids.building}','${ids.unit}','${ids.customer}','daily_booking','${ids.booking}','daily_rental','Synthetic',current_date-3,30000);
      commit;`);
    const signed=await client.auth.signInWithPassword({email,password});assert.equal(signed.error,null);
    const post=async(path,body)=>{
      const r=await fetch(`http://127.0.0.1:3100/api/operator/v1/bookings/${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${signed.data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await r.json();assert.equal(r.status,200,`${path}: ${data.code??'failed'}`);return data;
    };
    const result=await post('search',{buildingCode:`T-${ids.building}`,unitNo:'T01',amountXof:30000});
    assert.equal(result.candidates.length,2);assert.deepEqual(result.matchedBookingIds,[ids.booking]);assert.equal(result.selectedBookingId,null);
    const today=new Date().toISOString().slice(0,10),tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const base={bookingId:ids.booking,originalInstruction:'Synthetic only',paymentMethod:'cash',paymentDate:today};
    const extension=await post('plan',{...base,operation:'extend_and_collect',effectiveCheckOut:tomorrow,amountXof:40000});
    assert.equal(extension.status,'proposal_only');assert.equal(extension.changes.totalXof.after,40000);assert.equal(extension.executionAllowed,false);
    const checkout=await post('plan',{...base,operation:'checkout_and_collect',effectiveCheckOut:today,amountXof:30000});
    assert.equal(checkout.status,'proposal_only');assert.equal(checkout.cleaningRequired,true);
    assert.equal(localSql(`select count(*) from public.payments where source_id='${ids.booking}';`),'0');
    assert.equal(localSql(`select status::text from public.daily_bookings where id='${ids.booking}';`),'checked_in');
    assert.equal((await browser.auth.signInWithPassword({email,password})).error,null);
    for(const operation of ['extend_and_collect','checkout_and_collect']){
      const request={...base,requestId:randomUUID(),operation,effectiveCheckOut:operation==='extend_and_collect'?tomorrow:today,amountXof:operation==='extend_and_collect'?10000:20000};
      const preview=await post('prepare',request);
      const draft=await post('drafts',{request,previewProof:preview.previewProof});
      const id=draft.confirmationPath.split('/').at(-1);
      const endpoint=`http://127.0.0.1:3100/api/operator/v1/bookings/confirmations/${id}`;
      assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${signed.data.session.access_token}`,Origin:'http://127.0.0.1:3100'}})).status,403);
      const page=await fetch(`http://127.0.0.1:3100${draft.confirmationPath}`,{headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}});
      assert.equal(page.status,200);assert.ok((await page.text()).includes('整件业务确认'));
      for(let retry=0;retry<2;retry++){
        const response=await fetch(endpoint,{method:'POST',headers:{Origin:'http://127.0.0.1:3100',Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}});
        const result=await response.json();assert.equal(response.status,200,`${operation}: ${result.code??'failed'}`);assert.equal(result.verified,true);
      }
      assert.equal(localSql(`select count(*) from public.payments where request_id='${request.requestId}';`),'1');
    }
    assert.equal(localSql(`select status::text||':'||prepaid_amount_xof::int from public.daily_bookings where id='${ids.booking}';`),'checked_out:30000');
    assert.equal(localSql(`select count(*) from public.audit_logs where actor_id='${userId}' and actor_email='${email}' and action='operator_daily_workflow';`),'2');
    console.log('PASS: real local Auth, search/plans, signed previews, web confirmation pages, bearer denied, cookie atomic extension/checkout+collection, retry idempotency, identity audit; productionWrites=0');
  }finally{
    const signedOut=await client.auth.signOut();assert.equal(signedOut.error,null);
    await browser.auth.signOut();
    if(userId){
      localSql(`begin;
        delete from private.operator_daily_workflows where actor_id='${userId}';
        delete from public.ledger_entries where payment_id in (select id from public.payments where source_id='${ids.booking}');
        delete from public.payments where source_id='${ids.booking}';
        delete from public.cleaning_tasks where daily_booking_id='${ids.booking}';
        delete from public.daily_operation_requests where booking_id='${ids.booking}';
        delete from public.receivables where unit_id='${ids.unit}';
        delete from public.daily_bookings where id in ('${ids.booking}','${ids.future}');
        delete from public.unit_business_flags where unit_id='${ids.unit}';
        delete from public.units where id='${ids.unit}';delete from public.customers where id='${ids.customer}';
        delete from public.buildings where id='${ids.building}';delete from public.projects where id='${ids.project}';
        delete from public.audit_logs where actor_id='${userId}';delete from public.user_profiles where id='${userId}';commit;`);
      assert.equal((await admin.auth.admin.deleteUser(userId)).error,null);
    }
  }
}
main().catch(safeFailure);
