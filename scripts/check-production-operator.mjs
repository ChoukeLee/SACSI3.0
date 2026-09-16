import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loginPrompt } from '../operator-connector/login-prompt.mjs';
import { VERSION } from '../operator-connector/core.mjs';

// Read-only business acceptance. Login/logout affect this test's auth session only.
// Never call drafts/create/confirm/payment RPCs with executable input.
const origin='https://sacsi-3-0.vercel.app';
let auth;
try {
  const env=parseEnv(readFileSync(new URL('../.env.local',import.meta.url),'utf8'));
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'https://afadqifyaoixkvxywxqb.supabase.co');
  const expected=process.argv[2];assert.match(expected??'',/^[a-f0-9]{40}$/);
  auth=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const credentials=await loginPrompt();
  const signed=await auth.auth.signInWithPassword(credentials);credentials.password='';
  assert.equal(signed.error,null,'normal account login failed');
  const token=signed.data.session.access_token;
  const api=async(path,body,authenticated=true)=>{
    const response=await fetch(`${origin}/api/operator/v1/${path}`,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  };
  assert.equal((await api('capabilities',null,false)).status,401);
  const manifest=await api('capabilities');assert.equal(manifest.status,200);assert.equal(manifest.data.serverRelease,expected);
  assert.equal(manifest.data.identity.userId,signed.data.user.id);
  const protocol=await auth.rpc('operator_daily_payment_protocol_version');assert.equal(protocol.error,null);assert.equal(protocol.data,2);
  const denied=await api(`confirmations/${randomUUID()}`,{});assert.equal(denied.status,403);assert.equal(denied.data.code,'browser_confirmation_required');
  const anonymousDraft=await api('confirmations/drafts',{},false);assert.equal(anonymousDraft.status,401);
  const rows=await auth.from('daily_bookings').select('id,total_amount_xof,final_amount_xof,prepaid_amount_xof').in('status',['confirmed','checked_in']).not('check_out','is',null).neq('checkout_mode','open').limit(100);
  assert.equal(rows.error,null);
  const booking=rows.data.find(b=>Number(b.final_amount_xof??b.total_amount_xof)>Number(b.prepaid_amount_xof??0));
  assert.ok(booking,'no eligible booking for read-only preview; manual acceptance required');
  const request={requestId:randomUUID(),protocolVersion:'1.0',connectorVersion:VERSION,actionName:'query_daily_booking',scope:'business_data',exceptionalBusinessCase:false,
    inputSource:'natural_language',originalInstruction:'发布只读核验，不创建确认单，不入账',input:{bookingId:booking.id}};
  const query=await api('actions',request);assert.equal(query.status,200);assert.equal(query.data.status,'completed');
  const preview=await api('confirmations/prepare',{...request,actionName:'record_daily_payment',inputSource:'excel_screenshot',
    input:{bookingId:booking.id,amountXof:1,paymentDate:new Date().toISOString().slice(0,10),receiptNo:'READ-ONLY-RELEASE-CHECK'}});
  assert.equal(preview.status,200,'read-only preview unavailable');assert.equal(preview.data.status,'preview_requires_human_confirmation');assert.ok(preview.data.previewProof);
  console.log(JSON.stringify({status:'passed',serverRelease:manifest.data.serverRelease,protocol:2,normalAccount:true,anonymousDenied:true,bearerConfirmationDenied:true,
    confirmationGateEnabled:true,readOnlyQuery:true,signedReadOnlyPreview:true,businessWrites:0}));
} catch {console.error('Production read-only acceptance failed; no credentials or business records printed.');process.exitCode=1;}
finally {if(auth){const out=await auth.auth.signOut({scope:'local'});if(out.error){console.error('Test session logout not confirmed.');process.exitCode=1;}}}
