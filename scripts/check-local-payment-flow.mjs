import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { localCredentials, localSql, safeFailure } from './lib/local-supabase-runtime.mjs';
import { buildLocalPaymentSchema } from './lib/local-payment-schema.mjs';

async function main() {
  assert.equal(localSql('select checksum from private.local_payment_bootstrap;'), buildLocalPaymentSchema().checksum);
  const status = localCredentials();
  const options = { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) } };
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
  const anonymous = createClient(status.API_URL, status.ANON_KEY, options);
  const accounts = [];
  const ids = Object.fromEntries(['project','building','unit','agent','booking','receivable','rule','request','directRequest','staleRequest'].map(k => [k, randomUUID()]));
  const fullSchema = localSql("select to_regclass('public.projects') is not null;") === 't';
  const paymentDate = new Date().toISOString().slice(0,10);
  const rpc = async (client, name, args = {}) => {
    const result = await client.rpc(name, args);
    assert.equal(result.error, null, `${name}: ${result.error?.message ?? 'failed'}`);
    return result.data;
  };
  const denied = async (promise, message) => { const r = await promise; assert.ok(r.error, message); };
  try {
    for (const role of ['admin', 'admin', 'boss', null, 'finance', 'front_desk']) {
      const email = `local-flow-${randomUUID()}@example.invalid`;
      const password = randomBytes(24).toString('base64url');
      const result = await admin.auth.admin.createUser({ email, password, email_confirm: true,
        // An unprovisioned account must NOT gain permissions from editable metadata.
        user_metadata: { role: 'admin' } });
      assert.equal(result.error, null, 'Could not create synthetic account');
      const client = createClient(status.API_URL, status.ANON_KEY, options);
      accounts.push({ id: result.data.user.id, client });
      if (role) localSql(`insert into public.user_profiles(id,role,display_name) values ('${result.data.user.id}','${role}','Synthetic local operator');`);
      assert.equal((await client.auth.signInWithPassword({ email, password })).error, null, 'Real login failed');
    }
    const [owner, other, boss, outsider, finance, front] = accounts;
    localSql(`begin;
      ${fullSchema ? `insert into public.projects(id,code,display_name,allows_daily_rental) values ('${ids.project}','TEST-${ids.project}','Synthetic project',true);` : ''}
      insert into public.buildings(id,code,display_name${fullSchema ? ',project_id' : ''}) values ('${ids.building}','TEST-${ids.building}','Synthetic local building'${fullSchema ? `,'${ids.project}'` : ''});
      insert into public.units(id,building_id,code,unit_no,floor_label) values ('${ids.unit}','${ids.building}','TEST-${ids.unit}','T01','T');
      insert into public.unit_business_flags(unit_id,business_type,is_enabled) values ('${ids.unit}','daily_rental',true);
      insert into public.customers(id,name) values ('${ids.agent}','Synthetic handler');
      insert into public.daily_bookings(id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,billing_status)
        values ('${ids.booking}','${ids.unit}','${ids.agent}','${ids.agent}',current_date-3,current_date,10000,30000,30000,'checked_in','need_top_up');
      insert into public.receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof)
        values ('${ids.receivable}','${ids.building}','${ids.unit}','${ids.agent}','daily_booking','${ids.booking}','daily_rental','Synthetic receivable',current_date-3,30000);
      commit;`);
    assert.equal(await rpc(owner.client,'current_user_role'), 'admin');
    assert.equal(await rpc(boss.client,'can_execute_operator_action',{p_action_name:'record_daily_payment',p_risk_level:'L2'}), false);
    assert.equal(await rpc(outsider.client,'current_user_role'), null);
    const hidden = await outsider.client.from('daily_bookings').select('id').eq('id',ids.booking);
    assert.equal(hidden.error,null); assert.deepEqual(hidden.data,[]);
    await denied(anonymous.rpc('daily_booking_operation_snapshot',{p_booking_id:ids.booking}), 'Anonymous RPC must be denied');
    await denied(boss.client.rpc('daily_record_payment_rpc',{p_booking_id:ids.booking,p_amount:1000,p_request_id:randomUUID()}),'Boss write must be denied');
    await denied(outsider.client.from('user_profiles').insert({id:outsider.id,role:'admin',display_name:'Forged'}),'Self-promotion must be denied');
    console.log('PASS: real JWT roles, read-only role denial, unprovisioned RLS and metadata spoof rejection');
    if (fullSchema) {
      const rule={id:ids.rule,unit_id:ids.unit,monthly_amount_xof:40000,start_date:paymentDate};
      await denied(outsider.client.from('property_fee_rules').insert(rule),'Unprovisioned rules write denied');
      await denied(front.client.from('property_fee_rules').insert(rule),'Front desk rules write denied');
      assert.equal((await finance.client.from('property_fee_rules').insert(rule)).error,null);
      const hiddenRules=await outsider.client.from('property_fee_rules').select('id').eq('id',ids.rule);
      assert.deepEqual(hiddenRules.data,[]);
      const bossWrite=await boss.client.from('property_fee_rules').update({monthly_amount_xof:1}).eq('id',ids.rule).select('id');
      assert.deepEqual(bossWrite.data,[]);
      assert.equal(localSql(`select monthly_amount_xof::int from public.property_fee_rules where id='${ids.rule}';`),'40000');
      console.log('PASS: property fee rules limited to provisioned roles; finance writes, read-only/unprovisioned users cannot change rules');
    }
    localSql(`update public.user_profiles set role='boss' where id='${owner.id}';`);
    assert.equal(await rpc(owner.client,'can_execute_operator_action',{p_action_name:'record_daily_payment',p_risk_level:'L2'}),false);
    assert.equal((await owner.client.auth.refreshSession()).error,null);
    assert.equal(await rpc(owner.client,'current_user_role'),'boss');
    localSql(`update public.user_profiles set role='admin' where id='${owner.id}';`);
    console.log('PASS: role revocation takes effect on existing JWT and survives real refresh');

    const request = (requestId, amount) => ({ actionName:'record_daily_payment', inputSource:'excel_screenshot', scope:'business_data',
      exceptionalBusinessCase:false, protocolVersion:'1.0', connectorVersion:'local-acceptance-v1', requestId,
      originalInstruction:'Synthetic local acceptance only',input:{bookingId:ids.booking,amountXof:amount,paymentDate,receiptNo:'LOCAL-TEST'} });
    const draft = async (requestId, amount) => rpc(owner.client,'create_operator_payment_confirmation',{
      p_request:request(requestId,amount),p_snapshot:await rpc(owner.client,'daily_booking_operation_snapshot',{p_booking_id:ids.booking}),
      p_expires_at:new Date(Date.now()+300000).toISOString() });
    const first = await draft(ids.request,10000);
    await denied(other.client.rpc('get_operator_payment_confirmation',{p_id:first.id}),'Another admin must not read proposal');
    await denied(other.client.rpc('confirm_operator_payment',{p_id:first.id}),'Another admin must not execute proposal');
    const confirmed = await rpc(owner.client,'confirm_operator_payment',{p_id:first.id});
    assert.equal(confirmed.status,'completed'); assert.equal(confirmed.verification.verified,true);
    const replay = await rpc(owner.client,'confirm_operator_payment',{p_id:first.id});
    assert.equal(replay.verification.verified,true);
    assert.equal(localSql(`select count(*) from public.payments where request_id='${ids.request}';`),'1');
    assert.equal(localSql(`select count(*) from public.audit_logs where entity_id='${ids.booking}' and actor_id='${owner.id}';`),'2');
    console.log('PASS: proposal ownership, confirmation, financial integrity, repeat submission without duplicate payment');

    const stale = await draft(ids.staleRequest,2000);
    await rpc(owner.client,'daily_record_payment_rpc',{p_booking_id:ids.booking,p_amount:1000,p_payment_date:paymentDate,
      p_request_id:ids.directRequest,p_actor:{actor_id:other.id,channel:'external_codex',original_instruction:'Synthetic forged actor test'}});
    const staleResult = await owner.client.rpc('confirm_operator_payment',{p_id:stale.id});
    assert.equal(staleResult.error?.message,'confirmationSnapshotChanged');
    const replacement = await rpc(owner.client,'reprepare_operator_payment_confirmation',{
      p_previous_id:stale.id,p_request:request(ids.staleRequest,2000),
      p_snapshot:await rpc(owner.client,'daily_booking_operation_snapshot',{p_booking_id:ids.booking}),
      p_expires_at:new Date(Date.now()+300000).toISOString() });
    assert.notEqual(replacement.id,stale.id);
    assert.equal((await rpc(owner.client,'get_operator_payment_confirmation',{p_id:stale.id})).status,'superseded');
    assert.equal((await rpc(owner.client,'confirm_operator_payment',{p_id:replacement.id})).verification.verified,true);
    assert.equal(localSql(`select prepaid_amount_xof::int from public.daily_bookings where id='${ids.booking}';`),'13000');
    assert.equal(localSql(`select count(*) from public.audit_logs where entity_id='${ids.booking}' and actor_id is distinct from '${owner.id}'::uuid;`),'0');
    const audit = await boss.client.from('audit_logs').select('id').eq('entity_id',ids.booking);
    assert.equal(audit.error,null); assert.equal(audit.data.length,6);
    console.log('PASS: stale snapshot blocked, reprepare retains history, audit actor cannot be forged, boss reads audit');
  } finally {
    // Exact run-owned UUIDs only. Never truncate shared tables or touch production.
    localSql(`begin;
      delete from private.operator_confirmation_history where request_id in ('${ids.request}','${ids.staleRequest}');
      delete from private.operator_payment_confirmations where booking_id='${ids.booking}';
      delete from public.ledger_entries where unit_id='${ids.unit}';
      delete from public.payments where source_id='${ids.booking}';
      delete from public.audit_logs where entity_id='${ids.booking}';
      delete from public.receivables where id='${ids.receivable}';
      delete from public.daily_bookings where id='${ids.booking}';
      ${fullSchema ? `delete from public.property_fee_rules where id='${ids.rule}';` : ''}
      delete from public.unit_business_flags where unit_id='${ids.unit}';
      delete from public.units where id='${ids.unit}';
      delete from public.customers where id='${ids.agent}';
      delete from public.buildings where id='${ids.building}';
      ${fullSchema ? `delete from public.projects where id='${ids.project}';` : ''}
      commit;`);
    const failures = [];
    for (const account of accounts) {
      const logout = await account.client.auth.signOut();
      const removed = await admin.auth.admin.deleteUser(account.id);
      const check = await admin.auth.admin.getUserById(account.id);
      if (logout.error || removed.error || check.error?.status !== 404) failures.push(account.id);
    }
    assert.equal(failures.length,0,'Synthetic account cleanup needs attention');
    console.log('CLEANUP: run-owned synthetic finance records and accounts removed');
  }
  console.log(`Local Auth -> PostgREST -> RLS/RPC passed on ${fullSchema ? 'full application schema' : 'payment slice'}. Browser acceptance is a separate test.`);
}
main().catch(safeFailure);
