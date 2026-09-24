import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applicationSchemaSql } from './lib/application-schema.mjs';
import { buildLocalPaymentSchema, reviewedSlice } from './lib/local-payment-schema.mjs';
import { root, localSql, docker, project, safeFailure } from './lib/local-supabase-runtime.mjs';

try {
  assert.ok(process.argv.includes('--legacy-baseline'), 'Historical 2026-09-16 baseline only. Use npm run test:db-rebuild for the current schema; explicit --legacy-baseline required for historical reproduction.');
  const raw = readFileSync(join(root,'supabase/baselines/20260916.application-schema.json'),'utf8').replaceAll('\r\n','\n');
  const snapshot = JSON.parse(raw);
  const hash = createHash('sha256').update(raw).digest('hex');
  assert.equal(hash,'6816fa8930d606dcd9c4ac66f5370967ad5a5da60b716165594768627c795dff','Baseline changed; review required');
  const reviewed = buildLocalPaymentSchema(); // verifies overlay source hashes
  const source = name => readFileSync(join(root,'supabase/migrations',name),'utf8').replaceAll('\r\n','\n');
  const pending = ['20260915150854_harden_operator_daily_payment_integrity.sql','20260915162247_add_operator_payment_confirmations.sql',
    '20260915222405_add_operator_confirmation_reprepare.sql','20260916170356_harden_receivable_timestamp_search_path.sql'];
  const overlays = pending.map(name => source(name).trim().replace(/^begin;/i,'').replace(/commit;$/i,''));
  const rulePolicy=source('20260916173232_restrict_property_fee_rule_access.sql');
  assert.equal(createHash('sha256').update(rulePolicy).digest('hex'),'2fc23d75ff64a73c439098e2db20ca7f705c4d861769cbe0bc888a616f321000','Rule policy overlay changed; review required');
  overlays.push(rulePolicy.trim().replace(/^begin;/i,'').replace(/commit;$/i,''));
  const constants = reviewedSlice(source('20260914133925_add_operator_action_grants.sql'),'insert into private.operator_action_catalog (','create or replace function private.current_operator_action_allowed(');
  const baseline = applicationSchemaSql(snapshot);
  console.log(`Schema-only baseline: ${snapshot.tables.length} tables, ${snapshot.functions.length} functions, ${snapshot.policies.length} policies; SHA256 ${hash}`);
  if (process.argv.includes('--apply')) {
    // Exact fixed local environment is verified by localSql, before even the backup.
    assert.equal(localSql('select count(*) from auth.users;'),'0','Refuse to replace a test database with users');
    assert.equal(localSql("select count(*) from pg_extension e join pg_namespace n on n.oid=e.extnamespace where n.nspname in ('public','private');"),'0','Public extensions require review');
    localSql(`do $$ declare t record; n bigint; begin for t in select schemaname,tablename from pg_tables where schemaname in ('public','private') and tablename not in ('operator_action_catalog','local_payment_bootstrap') loop execute format('select count(*) from %I.%I',t.schemaname,t.tablename) into n; if n<>0 then raise exception 'Refuse nonempty test table'; end if; end loop; end $$;`);
    // Schema-only backup is recoverable; no real/business rows exist in this environment.
    writeFileSync(join(root,`work/local-schema-before-full-${Date.now()}.sql`), docker(['exec',`supabase_db_${project}`,'pg_dump','-U','postgres','-d','postgres','--schema-only','--schema=public','--schema=private']));
    const transaction = `begin; select pg_advisory_xact_lock(918274610);
      lock table auth.users in share row exclusive mode;
      do $$ declare t record; n bigint; begin
        if exists(select 1 from auth.users) then raise exception 'Refuse concurrent Auth users'; end if;
        for t in select schemaname,tablename from pg_tables where schemaname in ('public','private') order by schemaname,tablename loop
          execute format('lock table %I.%I in access exclusive mode',t.schemaname,t.tablename);
          if t.tablename not in ('operator_action_catalog','local_payment_bootstrap') then
            execute format('select count(*) from %I.%I',t.schemaname,t.tablename) into n;
            if n<>0 then raise exception 'Refuse concurrent test rows'; end if;
          end if;
        end loop;
      end $$;
      drop schema public cascade; drop schema private cascade;
      create schema public authorization pg_database_owner; create schema private authorization postgres;
      ${baseline}
      ${constants}
      ${overlays.join('\n')}
      create table private.local_payment_bootstrap(checksum text primary key, baseline_sha256 text not null, scope text not null);
      alter table private.local_payment_bootstrap enable row level security;
      revoke all on private.local_payment_bootstrap from public,anon,authenticated,service_role;
      insert into private.local_payment_bootstrap values ('${reviewed.checksum}','${hash}','full application catalog plus pending operator migrations');
      notify pgrst, 'reload schema'; commit;`;
    try { localSql(transaction); } catch(error) {
      // DDL only. No credentials or row values are part of the SQL error.
      const errorText = String(error.stderr ?? '').split('\n').filter(l => /ERROR:|LINE [0-9]+:|DETAIL:/.test(l)).join('\n');
      console.error(errorText); throw error;
    }
    console.log('Installed full application schema with no production rows; schema-only backup retained in work/.');
  } else console.log('Dry-run only. --apply replaces the empty, fixed local test schema transactionally; never a cloud database.');
} catch (error) { safeFailure(error); }
