// Read-only release acceptance using the installed ordinary-user session.
// Never prepares a draft, confirms an operation or writes a business record.
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {verifyPackage} from '../operator-connector/verify-package.mjs';
let stage='package';
try {
  const directory=resolve(process.argv[2]??''),expected=process.argv[3];
  assert.match(expected??'',/^[a-f0-9]{40}$/);
  assert.equal(verifyPackage(directory).version,'0.5.0');
  const {runtime}=await import(pathToFileURL(join(directory,'runtime.mjs')));
  const {config,client,store}=runtime();
  assert.equal(config.appUrl,'https://sacsi-3-0.vercel.app');
  assert.equal(config.supabaseUrl,'https://afadqifyaoixkvxywxqb.supabase.co');
  await store.lock(async()=>{
    stage='capabilities';
    const manifest=await client.capabilities();
    assert.equal(manifest.serverRelease,expected);
    assert.equal(manifest.bookingOperations.available,true);
    assert.equal(manifest.bookingOperations.version,1);
    assert.equal(manifest.bookingOperations.operations.length,9);
    assert.equal(manifest.dailyWorkflow.executionAvailable,true);
    assert.equal(manifest.collectionWorkflow.available,true);
    stage='status';
    assert.equal((await client.bookingOperation('status',{requestId:randomUUID()})).status,'not_found');
    for(const path of ['bookings/status','collections/status','confirmations/status'])
      assert.equal((await client.api(`${path}?requestId=${randomUUID()}`)).status,'not_found');
    stage='options';
    const options=await client.bookingOperation('options',{buildingCode:'RELEASE-NO-SUCH-BUILDING',unitNo:'NO-SUCH-UNIT'});
    assert.deepEqual(options.units,[]);
    const token=await client.token();
    for(const path of ['booking-operations/preview','booking-operations/prepare','booking-operations/drafts']){
      stage='anonymous-'+path;
      const response=await fetch(`${config.appUrl}/api/operator/v1/${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json'},body:'{}'});
      assert.equal(response.status,401);
    }
    stage='bearer-confirmation';
    const denied=await fetch(`${config.appUrl}/api/operator/v1/booking-operations/confirmations/${randomUUID()}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:'{}'});
    assert.equal(denied.status,403);
    stage='pending';const pending=await client.pending('list');
    console.log(JSON.stringify({status:'passed',serverRelease:manifest.serverRelease,connectorVersion:'0.5.0',identity:manifest.identity.displayName,operations:9,recoveryEndpoints:4,anonymousDenied:true,bearerConfirmationDenied:true,pendingCount:pending.items.length,businessWrites:0}));
  });
}catch(error){
  console.error(JSON.stringify({status:'failed',stage,code:error.code==='ERR_ASSERTION'?'assertion_failed':/^[a-zA-Z0-9_]{1,100}$/.test(error.message)?error.message:'verification_failed'}));process.exitCode=1;
}
