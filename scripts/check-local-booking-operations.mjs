// Only the isolated loopback stack. No production environment or credentials.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {OperatorClient} from '../operator-connector/core.mjs';
import {localCredentials,localSql,safeFailure} from './lib/local-supabase-runtime.mjs';

async function main(){
  const status=localCredentials(),options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options),client=createClient(status.API_URL,status.ANON_KEY,options);
  const cookies=new Map();
  const browser=createServerClient(status.API_URL,status.ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>cookies.set(name,value))}});
  const ids=Object.fromEntries(['project','building','unit','customer','booking','future','receivable','target'].map(key=>[key,randomUUID()]));
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
      insert into public.customers(id,name) values('${ids.customer}','颖');
      insert into public.daily_bookings(id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,billing_status)
      values('${ids.booking}','${ids.unit}','${ids.customer}','${ids.customer}',current_date-3,current_date,10000,30000,30000,'checked_in','need_top_up'),
        ('${ids.future}','${ids.unit}','${ids.customer}','${ids.customer}',current_date+10,current_date+12,10000,20000,20000,'confirmed','need_top_up');
      insert into public.receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
      values('${ids.receivable}','${ids.building}','${ids.unit}','${ids.customer}','daily_booking','${ids.booking}','daily_rental','Synthetic',current_date-3,30000);
      commit;`);

    localSql(`insert into public.units(id,building_id,code,unit_no,floor_label) values('${ids.target}','${ids.building}','TEST-${ids.target}','T02','T');
      insert into public.unit_business_flags(unit_id,business_type,is_enabled) values('${ids.target}','daily_rental',true);`);
    const signed=await client.auth.signInWithPassword({email,password});assert.equal(signed.error,null);
    assert.equal((await browser.auth.signInWithPassword({email,password})).error,null);
    const token=signed.data.session.access_token;
    const operator=new OperatorClient({formatVersion:1,localTest:true,appUrl:'http://127.0.0.1:3100',supabaseUrl:status.API_URL,publishableKey:status.ANON_KEY},
      {load:async()=>({userId,accessToken:token,expiresAt:Date.now()+3600000,appUrl:'http://127.0.0.1:3100',supabaseUrl:status.API_URL})});
    assert.equal((await operator.capabilities()).bookingOperations.available,true);
    const options=await operator.bookingOperation('options',{buildingCode:'T-'+ids.building,unitNo:'T01'});
    assert.equal(options.units.length,1);assert.equal(options.units[0].id,ids.unit);
    assert.ok(options.bookingAgents.some(agent=>agent.id===ids.customer));
    const date=JSON.parse(localSql("select json_build_object('today',current_date::text,'later',(current_date+2)::text)"));
    async function perform(request){
      const before=await operator.bookingOperation('preview',request);assert.equal(before.executionAllowed,false);
      const prepared=await operator.bookingOperation('prepare',request);
      const original=await operator.bookingOperation('status',{requestId:request.requestId});assert.equal(original.status,'pending');
      const id=prepared.confirmationUrl.split('/').at(-1),url='http://127.0.0.1:3100/api/operator/v1/booking-operations/confirmations/'+id;
      assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'http://127.0.0.1:3100'}})).status,403);
      const cookie=[...cookies].map(([k,v])=>k+'='+v).join('; ');
      const page=await fetch(prepared.confirmationUrl,{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(await page.text(),/本人确认/);
      const r=await fetch(url,{method:'POST',headers:{Cookie:cookie,Origin:'http://127.0.0.1:3100'}}),done=await r.json();
      assert.equal(r.status,200,JSON.stringify(done));assert.equal(done.verified,true);
      const retry=await fetch(url,{method:'POST',headers:{Cookie:cookie,Origin:'http://127.0.0.1:3100'}});
      assert.equal((await retry.json()).status,'completed_previously');
      assert.equal((await operator.bookingOperation('status',{requestId:request.requestId})).verified,false);
      return done;
    }
    const req=(operation,extra)=>({requestId:randomUUID(),operation,originalInstruction:'Synthetic local operation only',...extra});
    // Money is entirely synthetic and the helper pins this stack to loopback.
    const paid=await client.rpc('daily_record_payment_rpc',{p_booking_id:ids.booking,p_amount:30000,p_payment_date:date.today,p_receipt_no:'SYNTHETIC',p_request_id:randomUUID(),p_actor:{}});
    assert.equal(paid.error,null);
    await perform(req('correct_room',{bookingId:ids.booking,targetUnitId:ids.target,reason:'合成测试原房号录错'}));
    const newBooking=await perform(req('create',{unitId:ids.unit,bookingAgentId:ids.customer,guestName:'Synthetic',checkIn:date.today,checkOut:date.later,nightlyPriceXof:10000}));
    await perform(req('check_in',{bookingId:newBooking.bookingId}));
    await perform(req('void_checkin',{bookingId:newBooking.bookingId,reason:'合成测试误入住撤销'}));
    const checkout=await client.rpc('daily_check_out_booking_rpc',{p_booking_id:ids.booking,p_actual_check_out:date.today,p_final_amount:30000,p_discount_amount:0,p_discount_reason:null,p_checkout_unit_status:'cleaning_pending',p_actor:{}});
    assert.equal(checkout.error,null);
    await perform(req('refund',{bookingId:ids.booking,amountXof:5000,finalAmountXof:25000,paymentDate:date.today,paymentMethod:'bank_transfer',reason:'合成测试实际退还款项'}));
    assert.equal(localSql(`select sum(amount)::int from public.payments where source_id='${ids.booking}'`),'25000');
    assert.equal(localSql(`select count(*) from public.audit_logs where actor_id='${userId}' and action like 'operator_booking_%'`),'5');
    console.log('PASS: real local Auth + connector 0.5.0, read-only previews, signed drafts, current-account pages, bearer denial, cookie confirmations, repeat/status recovery, paid room correction, create/check-in/void, real refund and ledger audit; productionWrites=0');
  }finally{
    await client.auth.signOut();await browser.auth.signOut();
    if(userId){
      localSql(`begin;
        delete from private.operator_booking_operations where actor_id='${userId}';
        delete from public.ledger_entries where unit_id in ('${ids.unit}','${ids.target}');
        delete from public.payments where unit_id in ('${ids.unit}','${ids.target}');
        delete from public.cleaning_tasks where unit_id in ('${ids.unit}','${ids.target}');
        delete from public.daily_operation_requests where booking_id in (select id from public.daily_bookings where unit_id in ('${ids.unit}','${ids.target}'));
        delete from public.receivables where unit_id in ('${ids.unit}','${ids.target}');
        delete from public.daily_bookings where unit_id in ('${ids.unit}','${ids.target}');
        delete from public.unit_business_flags where unit_id in ('${ids.unit}','${ids.target}');
        delete from public.units where id in ('${ids.unit}','${ids.target}');
        delete from public.customers where id='${ids.customer}';
        delete from public.buildings where id='${ids.building}';delete from public.projects where id='${ids.project}';
        delete from public.audit_logs where actor_id='${userId}';delete from public.user_profiles where id='${userId}';commit;`);
      assert.equal((await admin.auth.admin.deleteUser(userId)).error,null);
    }
  }
}
main().catch(safeFailure);
