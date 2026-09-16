import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';
import { localCredentials, localSql, safeFailure, root } from './lib/local-supabase-runtime.mjs';
import { pathToFileURL } from 'node:url';
import { buildLocalPaymentSchema } from './lib/local-payment-schema.mjs';
import { VERSION } from '../operator-connector/core.mjs';

// Interactive, isolated acceptance: browser actions are performed by the tester.
// The displayed credentials are disposable LOCAL test credentials, never real ones.
async function main() {
  assert.equal(localSql('select checksum from private.local_payment_bootstrap;'), buildLocalPaymentSchema().checksum);
  const status = localCredentials();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
  const client = createClient(status.API_URL, status.ANON_KEY, options);
  const ids = Object.fromEntries(['project','building','unit','agent','booking','receivable','request'].map(k => [k, randomUUID()]));
  const fullSchema = localSql("select to_regclass('public.projects') is not null;") === 't';
  const email = `browser-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  let userId;
  let connector;
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null); userId = created.data.user.id;
    localSql(`begin;
      insert into public.user_profiles(id,role,display_name) values ('${userId}','admin','本地浏览器验收员');
      ${fullSchema ? `insert into public.projects(id,code,display_name,allows_daily_rental) values ('${ids.project}','TEST-${ids.project}','Synthetic project',true);` : ''}
      insert into public.buildings(id,code,display_name${fullSchema ? ',project_id' : ''}) values ('${ids.building}','TEST-${ids.building}','隔离测试楼栋'${fullSchema ? `,'${ids.project}'` : ''});
      insert into public.units(id,building_id,code,unit_no,floor_label) values ('${ids.unit}','${ids.building}','TEST-${ids.unit}','T01','T');
      insert into public.unit_business_flags(unit_id,business_type,is_enabled) values ('${ids.unit}','daily_rental',true);
      insert into public.customers(id,name) values ('${ids.agent}','测试经办人');
      insert into public.daily_bookings(id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,billing_status)
        values ('${ids.booking}','${ids.unit}','${ids.agent}','${ids.agent}',current_date-3,current_date,10000,30000,30000,'checked_in','need_top_up');
      insert into public.receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
        values ('${ids.receivable}','${ids.building}','${ids.unit}','${ids.agent}','daily_booking','${ids.booking}','daily_rental','浏览器合成验收',current_date-3,30000);
      commit;`);
    const signed = await client.auth.signInWithPassword({ email, password });
    assert.equal(signed.error, null);
    const token = signed.data.session.access_token;
    const api = async (path, body, expected = 200, authenticated = true) => {
      const response = await fetch(`http://127.0.0.1:3100/api/operator/v1/${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(90000),
        headers: { 'Content-Type':'application/json', ...(authenticated ? { Authorization:`Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      assert.equal(response.status, expected, `HTTP ${path}: ${response.status} ${result.code ?? ''}`);
      return result;
    };
    await api('capabilities', null, 401, false);
    const manifest = await api('capabilities');
    assert.equal(manifest.identity.userId, userId);
    const request = { actionName:'record_daily_payment', inputSource:'excel_screenshot', scope:'business_data',
      exceptionalBusinessCase:false, protocolVersion:'1.0', connectorVersion:VERSION, requestId:ids.request,
      originalInstruction:'仅本地合成测试：T01 收到现金 10000 西法',
      input:{bookingId:ids.booking,amountXof:10000,paymentDate:new Date().toISOString().slice(0,10),receiptNo:'LOCAL-BROWSER'} };
    const preview = await api('confirmations/prepare', request);
    assert.ok(preview.previewProof);
    const draft = await api('confirmations/drafts', { request, previewProof:preview.previewProof });
    assert.match(draft.confirmationPath, /^\/operator\/confirmations\/[a-f0-9-]{36}$/);
    if(process.argv[2]) {
      const packagePath=resolve(process.argv[2]);
      assert.ok(packagePath.startsWith(join(root,'work',`operator-${VERSION}-local-`)),'Use only the generated local acceptance package');
      const manifest=JSON.parse(readFileSync(join(packagePath,'manifest.json'),'utf8'));
      for(const [file,hash] of Object.entries(manifest.checksums)) assert.equal(createHash('sha256').update(readFileSync(join(packagePath,file))).digest('hex'),hash,'Package checksum mismatch');
      const profile=join(packagePath,`test-profile-${ids.request}`);
      connector=(command,body)=>{ try {return JSON.parse(execFileSync(join(packagePath,'node.exe'),[join(packagePath,'cli.mjs'),command],{
        input:body ? JSON.stringify(body) : undefined,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:90000,cwd:packagePath,
        env:{...process.env,LOCALAPPDATA:profile}}));}catch(error){let code='unknown';try{code=JSON.parse(String(error.stderr).trim()).error;}catch{}assert.fail(`Connector ${command}: ${/^[a-z0-9_]+$/i.test(code)?code:'error'}`);} };
      assert.equal(connector('login',{email,password}).identity.userId,userId);
      const directory=join(profile,'SACSI','operator',createHash('sha256').update('http://127.0.0.1:3100').digest('hex').slice(0,16));
      const encrypted=readFileSync(join(directory,'session.dpapi'));
      assert.ok(!encrypted.includes(Buffer.from(password)) && !encrypted.includes(Buffer.from('accessToken')));
      const {sessionStore}=await import(pathToFileURL(join(packagePath,'session-store.mjs')).href);
      const store=sessionStore(directory), session=store.load();
      assert.ok(!encrypted.includes(Buffer.from(session.refreshToken)));
      store.save({...session,expiresAt:0});
      assert.equal(connector('capabilities').identity.userId,userId);
      assert.ok(store.load().expiresAt>Date.now());
      const query=connector('execute',{...request,requestId:randomUUID(),actionName:'query_daily_booking',inputSource:'natural_language',input:{bookingId:ids.booking}});
      assert.equal(query.status,'completed');
      const viaConnector=connector('execute',request);
      assert.equal(viaConnector.confirmationUrl,`http://127.0.0.1:3100${draft.confirmationPath}`);
      assert.equal(viaConnector.requestId,ids.request);
      const messages=[
        {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'local-acceptance',version:'1'}}},
        {jsonrpc:'2.0',method:'notifications/initialized'},
        {jsonrpc:'2.0',id:2,method:'tools/list'},
        {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'capabilities',arguments:{}}},
        {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'query_daily_booking',arguments:{bookingId:ids.booking}}},
        {jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'prepare_daily_payment',arguments:{requestId:ids.request,originalInstruction:request.originalInstruction,...request.input}}},
      ];
      let mcp;
      try { mcp=execFileSync(join(packagePath,'node.exe'),[join(packagePath,'mcp-server.mjs')],{
        input:messages.map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:180000,
        cwd:packagePath,env:{...process.env,LOCALAPPDATA:profile}}).trim().split('\n').map(line=>JSON.parse(line));
      } catch { throw new Error('local_mcp_process_failed'); }
      assert.equal(mcp.length,5);
      for(const response of mcp) { assert.ok(!response.error);assert.ok(!response.result.isError,'MCP tool failed'); }
      assert.equal(mcp[1].result.tools.length,4);
      assert.equal(JSON.parse(mcp[2].result.content[0].text).identity.userId,userId);
      assert.equal(JSON.parse(mcp[3].result.content[0].text).status,'completed');
      assert.equal(JSON.parse(mcp[4].result.content[0].text).confirmationUrl,viaConnector.confirmationUrl);
      console.log('PASS: real stdio MCP handshake, tool discovery, own-account query and same-request draft reuse; no payment executed');
      assert.equal(existsSync(join(directory,'operation.lock')),false);
      console.log('PASS: standalone package login, DPAPI encrypted session, real token refresh, original request/draft reuse, no repository dependency');
    }
    // Employee connector must not be able to approve a screenshot via bearer.
    await api(`confirmations/${draft.confirmation.id}`, {}, 403);
    assert.equal(localSql(`select count(*) from public.payments where request_id='${ids.request}';`), '0');
    console.log('PASS: real HTTP anonymous denial, own-account capabilities, signed preview, draft, bearer confirmation denial; no payment yet');
    if(process.argv.includes('--prepare-only')) { console.log('HTTP/connector-only acceptance complete; no browser execution claimed.');return; }
    console.log(`LOCAL TEST ONLY\nEmail: ${email}\nPassword: ${password}\nURL: http://127.0.0.1:3100${draft.confirmationPath}`);
    const answer = await input.question('Use browser to sign in, confirm, reload, then type VERIFY (anything else cleans up without acceptance): ');
    assert.equal(answer.trim(), 'VERIFY', 'Browser acceptance not confirmed');
    assert.equal(localSql(`select count(*) from public.payments where request_id='${ids.request}';`), '1');
    assert.equal(localSql(`select prepaid_amount_xof::int from public.daily_bookings where id='${ids.booking}';`), '10000');
    assert.equal(localSql(`select count(*) from public.audit_logs where entity_id='${ids.booking}' and actor_id='${userId}';`), '2');
    console.log('PASS: browser confirmation persisted exactly one payment and two correctly attributed audit records');
  } finally {
    input.close();
    let logoutFailed=false;
    if(connector) try { assert.equal(connector('logout').status,'signed_out'); } catch { logoutFailed=true; }
    localSql(`begin;
      delete from private.operator_confirmation_history where request_id='${ids.request}';
      delete from private.operator_payment_confirmations where booking_id='${ids.booking}';
      delete from public.ledger_entries where unit_id='${ids.unit}';
      delete from public.payments where source_id='${ids.booking}';
      delete from public.audit_logs where entity_id='${ids.booking}';
      delete from public.receivables where id='${ids.receivable}';
      delete from public.daily_bookings where id='${ids.booking}';
      delete from public.unit_business_flags where unit_id='${ids.unit}';
      delete from public.units where id='${ids.unit}';
      delete from public.customers where id='${ids.agent}';
      delete from public.buildings where id='${ids.building}';
      ${fullSchema ? `delete from public.projects where id='${ids.project}';` : ''}
      ${fullSchema ? `delete from public.login_attempts where attempt_key='email:${email}';` : ''}
      commit;`);
    if (userId) {
      await client.auth.signOut();
      assert.equal((await admin.auth.admin.deleteUser(userId)).error,null);
      assert.equal((await admin.auth.admin.getUserById(userId)).error?.status,404);
    }
    console.log('CLEANUP: only this run\'s synthetic records and local account removed');
    if(logoutFailed) {console.error('Connector remote logout was not confirmed; synthetic account nevertheless revoked and deleted.');process.exitCode=1;}
  }
}
main().catch(safeFailure);
