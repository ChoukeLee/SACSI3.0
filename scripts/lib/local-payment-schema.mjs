import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './local-supabase-runtime.mjs';

// Reviewed source hashes, normalized to LF. No production migration is renamed.
const approved = {
  '202605180001_initial_schema.sql': 'bd5c480fbed381086aa8b629fb6f9d0d5e93f28ac798c67f98f97ea1a413d93e',
  '202605180003_user_profiles.sql': '052337087397646a9b6e99bbecc304a9fc3ad8a681f980182fb99c16cf5aa8d5',
  '202605180005_open_daily_booking.sql': 'bc78734220d374b46ee8c6d083497d8d93273187ef55490e42c6505d68e801e2',
  '202605190001_receivables.sql': '05c64ec5e6e583bb843a017e5a48cc57e2126c122bbbe58a36f1ea981168ede4',
  '202605200001_audit_logs_enhance.sql': 'fbfcf3f22a577ceb342906db914f312d35b1218e941ebead6debc9396f3ed9ed',
  '202607280002_restore_missing_foundations.sql': '5d01c95c00f7d1709ac947fd859d22cd8368bd35a74af460b868888529f237d2',
  '202607280003_harden_authorization.sql': '28df01710804fdb605cf6f7e7d8ee1a70a19f83d78d3542250a9f1872df3b8fb',
  '202607280006_atomic_contract_payments.sql': 'fb7818ada63d877bbfccdb7aa4a7f7a198c8699b92ba0fcd86c36c7b2caf3151',
  '202607290001_atomic_daily_finance_operations.sql': 'ee5043d4df28f7dd8e1344d94b0d46719acb731e2ad86edf98588c76294abe77',
  '202608210001_promote_ying_to_admin.sql': 'ae4814033dbb356653b528e8d71730a95ca0141b4545daa63790e95ca78cd932',
  '20260905082337_ai_business_action_foundations.sql': 'f5429d30b0d69a0c56af7a7be1cc8cddb6655b0693441d2d91a92ffee0140eea',
  '20260914133925_add_operator_action_grants.sql': '522e0bcd59d1d14c98ba06275f7038df5ac99897e6201cfb48f95403d96737e0',
  '20260914133928_add_external_operator_daily_actions.sql': 'cb88062fae0b2bf799ac8d1520bd7f08f57c19ca2110533aeade65e37ecd2d6f',
  '20260915150854_harden_operator_daily_payment_integrity.sql': 'cf8f2c3bc4eb7b03c33c5912e53223a9d8c5f15dd45432b956a2bc0226202137',
  '20260915162247_add_operator_payment_confirmations.sql': '78027571a97721ba6ca9e27cfdbc59f9e2867ce75cc56d25125be5e343d0ee4d',
  '20260915222405_add_operator_confirmation_reprepare.sql': '104500980d45d61ca15b69a3e78ce8ade6513d5e6da5772367908a3791dd94e2',
  '20260916170356_harden_receivable_timestamp_search_path.sql': '10a40ac1132943a74394a4c885857cf4468e0e0b0a16ff36eba30d5009cbfd5a',
};
const hash = sql => createHash('sha256').update(sql).digest('hex');
export function reviewedSlice(sql, start, end) {
  const begin = start ? sql.indexOf(start) : 0;
  assert.ok(begin >= 0 && (!start || sql.indexOf(start, begin + start.length) === -1), 'Start anchor missing or ambiguous');
  const finish = end ? sql.indexOf(end, begin) : sql.length;
  assert.ok(finish > begin && (!end || sql.indexOf(end, finish + end.length) === -1), 'End anchor missing or ambiguous');
  return sql.slice(begin, finish);
}
export function buildLocalPaymentSchema(read = name => readFileSync(join(root, 'supabase/migrations', name), 'utf8')) {
  const source = {};
  for (const [name, checksum] of Object.entries(approved)) {
    const sql = read(name).replaceAll('\r\n', '\n');
    assert.equal(hash(sql), checksum, `Source changed; review required: ${name}`);
    source[name] = sql;
  }
  const cut = (name, start, end) => reviewedSlice(source[name], start, end);
  const body = name => {
    const sql = source[name].trim();
    assert.ok(sql.startsWith('begin;') && sql.endsWith('commit;'), 'Transaction wrapper changed');
    return sql.slice(6, -7);
  };
  const parts = [
    'create schema private; revoke all on schema private from public, anon; grant usage on schema private to authenticated, service_role;',
    source['202605180001_initial_schema.sql'],
    cut('202605180003_user_profiles.sql', null, '-- Users can read'),
    source['202605180005_open_daily_booking.sql'],
    source['202605190001_receivables.sql'],
    cut('202605200001_audit_logs_enhance.sql', null, '-- Drop overly permissive'),
    cut('202607280002_restore_missing_foundations.sql', null, 'insert into public.system_settings'),
    cut('202607280002_restore_missing_foundations.sql', 'create table if not exists public.attachments', 'insert into storage.buckets'),
    cut('202607280003_harden_authorization.sql', null, '-- Existing functions historically'),
    // Keep the current role function, NOT the real employee profile update.
    cut('202608210001_promote_ying_to_admin.sql', 'create or replace function public.current_user_role()', null),
    cut('202607280006_atomic_contract_payments.sql', null, 'create or replace function public.record_receivable_payment_rpc'),
    cut('202607290001_atomic_daily_finance_operations.sql', 'alter table public.payments', 'drop function if exists public.daily_check_in_booking_rpc'),
    cut('20260905082337_ai_business_action_foundations.sql', 'alter table public.daily_bookings\n  add column if not exists booking_agent_id', 'update public.daily_bookings'),
    cut('20260905082337_ai_business_action_foundations.sql', 'create or replace function public.sync_daily_booking_agent_identity()', '-- Replace the lease financial RPC'),
    body('20260914133925_add_operator_action_grants.sql'),
    body('20260914133928_add_external_operator_daily_actions.sql'),
    body('20260915150854_harden_operator_daily_payment_integrity.sql'),
    body('20260915162247_add_operator_payment_confirmations.sql'),
    body('20260915222405_add_operator_confirmation_reprepare.sql'),
  ];
  // Slice-only assembly: not the entire SACSI schema; no historical business seed.
  const previousSql = parts.join('\n');
  const upgradeSql = source['20260916170356_harden_receivable_timestamp_search_path.sql'];
  const sql = previousSql + '\n' + upgradeSql;
  return { sql, checksum: hash(sql), previousChecksum: hash(previousSql), upgradeSql, sourceFiles: Object.keys(approved) };
}
