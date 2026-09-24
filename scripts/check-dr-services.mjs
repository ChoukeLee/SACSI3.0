import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { backupInput, docker, project, assertIsolated } from "./lib/dr-local-runtime.mjs";

try {
  const { directory } = backupInput(process.argv[2] ?? "");
  assertIsolated();
  assert.ok(process.env.SACSI_DR_LOGIN_PASSWORD);
  for (const service of ["auth", "storage", "rest"])
    docker(["start", `supabase_${service}_${project}`]);
  // Recreated services can have new bridge IPs; clear gateway DNS cache.
  docker(["restart", `supabase_kong_${project}`]);
  const program = `
    const assert=require('node:assert/strict');
    const crypto=require('node:crypto');
    const base='http://supabase_kong_${project}:8000';
    const anon=process.env.ANON_KEY, service=process.env.SERVICE_KEY;
    let bucket, stage='health';
    const request=async(path,token,init={})=>{
      const r=await fetch(base+path,{...init,headers:{apikey:anon,Authorization:'Bearer '+token,...init.headers},signal:AbortSignal.timeout(15000)});
      return r;
    };
    (async()=>{try{
      for(let i=0;i<20;i++){
        try{if((await request('/auth/v1/health',anon)).ok && (await request('/storage/v1/bucket',service)).ok)break;}catch{}
        if(i===19)throw new Error('health');
        await new Promise(r=>setTimeout(r,1000));
      }
      stage='restored-account-login';
      const login=await request('/auth/v1/token?grant_type=password',anon,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@sacsi.com',password:process.env.SACSI_DR_LOGIN_PASSWORD})});
      if(!login.ok){const err=await login.json().catch(()=>({}));throw new Error('login-status-'+login.status+'-'+String(err.error_code||err.code||'unknown').replace(/[^a-z_0-9-]/gi,''));}
      const session=await login.json();
      const user=await request('/auth/v1/user',session.access_token);assert.equal(user.status,200);
      assert.equal((await user.json()).id,session.user.id);
      stage='access-boundary';
      assert.equal((await request('/auth/v1/user','invalid-token')).ok,false);
      const anonymous=await request('/rest/v1/payments?select=id&limit=1',anon);
      if(anonymous.ok)assert.deepEqual(await anonymous.json(),[]);else assert.ok([401,403].includes(anonymous.status));
      const hidden=await request('/rest/v1/operator_payment_confirmations?select=request_id&limit=1',session.access_token,{headers:{'Accept-Profile':'private'}});
      assert.ok([403,406].includes(hidden.status));
      const own=await request('/rest/v1/user_profiles?select=id&limit=1',session.access_token);
      assert.equal(own.status,200);assert.ok((await own.json()).length>0);
      stage='storage-create';
      bucket='dr-synthetic-'+crypto.randomUUID();
      const create=await request('/storage/v1/bucket',service,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:bucket,name:bucket,public:false})});
      if(!create.ok){const err=await create.json().catch(()=>({}));throw new Error('storage-status-'+create.status+'-'+String(err.code||err.error||'unknown').replace(/[^a-z_0-9-]/gi,''));}
      const path='/storage/v1/object/'+bucket+'/pixel.png';
      const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
      const upload=()=>request(path,service,{method:'POST',headers:{'Content-Type':'image/png'},body:bytes});
      stage='storage-upload';
      const uploaded=await upload();
      if(!uploaded.ok){const err=await uploaded.json().catch(()=>({}));throw new Error('storage-status-'+uploaded.status+'-'+String(err.code||err.error||'unknown').replace(/[^a-z_0-9-]/gi,'')+'-'+String(err.message||'').slice(0,200));}
      stage='storage-backup-restore';
      const download=await request(path,service);assert.ok(download.ok);
      const original=Buffer.from(await download.arrayBuffer());assert.deepEqual(original,bytes);
      const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
      const encrypted=Buffer.concat([cipher.update(original),cipher.final()]),tag=cipher.getAuthTag();
      const remove=()=>request('/storage/v1/object/'+bucket,service,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:['pixel.png']})});
      assert.ok((await remove()).ok);
      assert.equal((await request(path,service)).ok,false);
      const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
      const restored=Buffer.concat([decipher.update(encrypted),decipher.final()]);
      assert.ok((await request(path,service,{method:'POST',headers:{'Content-Type':'image/png'},body:restored})).ok);
      const check=await request(path,service);assert.ok(check.ok);assert.deepEqual(Buffer.from(await check.arrayBuffer()),original);
      assert.equal((await request(path,anon)).ok,false);
      assert.ok((await remove()).ok);
      assert.ok((await request('/storage/v1/bucket/'+bucket,service,{method:'DELETE'})).ok);bucket=null;
      stage='logout';assert.ok((await request('/auth/v1/logout',session.access_token,{method:'POST'})).ok);
      console.log(JSON.stringify({passed:true,restoredAccountPasswordLogin:true,serverTokenVerification:true,invalidTokenRejected:true,anonymousFinanceDenied:true,privateSchemaDenied:true,profileRead:true,syntheticEncryptedFileRestore:true,privateFileAnonymousDenied:true,syntheticFilesCleaned:true,productionWrites:0}));
    }catch(e){console.log(JSON.stringify({passed:false,stage,code:e.code||'CHECK_FAILED',detail:/^(login|storage)-status-/.test(e.message)?e.message:undefined}));process.exitCode=1;}
    finally{if(bucket){try{await request('/storage/v1/object/'+bucket,service,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:['pixel.png']})});await request('/storage/v1/bucket/'+bucket,service,{method:'DELETE'});}catch{}}}
    })();`;
  const result = JSON.parse(
    docker(
      ["exec", "-i", "--env", "SACSI_DR_LOGIN_PASSWORD", `supabase_storage_${project}`, "node"],
      program,
    ),
  );
  writeFileSync(
    join(directory, "service-verification.json"),
    JSON.stringify(
      { ...result, verifiedAt: new Date().toISOString(), scope: "isolated restored clone only" },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(result));
  assert.equal(result.passed, true);
} catch (e) {
  // Our child emits a safe structured verdict; never dump arbitrary Docker errors.
  if (e.stdout) {
    try {
      const result = JSON.parse(e.stdout.toString());
      console.log(
        JSON.stringify({
          passed: false,
          stage: result.stage,
          code: result.code,
          detail: result.detail,
        }),
      );
    } catch {}
  }
  console.error("Local restored-service verification failed; no credentials or records printed.");
  process.exitCode = 1;
}
