// Uses the installed ordinary-user session. Never creates a draft or payment.
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {verifyPackage} from '../operator-connector/verify-package.mjs';
let stage='package';
try{
  const directory=resolve(process.argv[2]??''),expected=process.argv[3];assert.match(expected??'',/^[a-f0-9]{40}$/);
  assert.equal(verifyPackage(directory).version,'0.4.0');
  const {runtime}=await import(pathToFileURL(join(directory,'runtime.mjs')));
  const {config,client,store}=runtime();
  assert.equal(config.appUrl,'https://sacsi-3-0.vercel.app');assert.equal(config.supabaseUrl,'https://afadqifyaoixkvxywxqb.supabase.co');
  await store.lock(async()=>{
    stage='capabilities';
    const manifest=await client.capabilities();assert.equal(manifest.serverRelease,expected);assert.equal(manifest.dailyWorkflow.executionAvailable,true);assert.equal(manifest.collectionWorkflow.available,true);
    for(const path of ['bookings/status','collections/status','confirmations/status']){
      stage=path;
      const status=await client.api(`${path}?requestId=${randomUUID()}`);assert.equal(status.status,'not_found');
    }
    stage='booking-search';
    const search=await client.dailyWorkflow('search',{buildingCode:'RELEASE-NO-SUCH-BUILDING',unitNo:'NO-SUCH-UNIT'});assert.deepEqual(search.candidates,[]);
    const token=await client.token();
    for(const path of ['bookings/prepare','bookings/drafts','confirmations/drafts']){
      stage='anonymous-'+path;
      const response=await fetch(`${config.appUrl}/api/operator/v1/${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,401);
    }
    for(const path of ['bookings/confirmations','collections','confirmations']){
      stage='bearer-'+path;
      const response=await fetch(`${config.appUrl}/api/operator/v1/${path}/${randomUUID()}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
    }
    stage='pending';const pending=await client.pending('list');
    console.log(JSON.stringify({status:'passed',serverRelease:manifest.serverRelease,connectorVersion:'0.4.0',identity:manifest.identity.displayName,dailyWorkflow:true,collections:true,recoveryEndpoints:3,anonymousDenied:true,bearerConfirmationDenied:true,pendingCount:pending.items.length,businessWrites:0}));
  });
}catch(error){console.error(JSON.stringify({status:'failed',stage,code:error.code==='ERR_ASSERTION'?'assertion_failed':/^[a-zA-Z0-9_]{1,100}$/.test(error.message)?error.message:'verification_failed',actual:typeof error.actual==='number'?error.actual:undefined}));process.exitCode=1;}
