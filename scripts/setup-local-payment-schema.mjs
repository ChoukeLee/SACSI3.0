import assert from 'node:assert/strict';
import { buildLocalPaymentSchema } from './lib/local-payment-schema.mjs';
import { localSql, safeFailure } from './lib/local-supabase-runtime.mjs';

try {
  const schema = buildLocalPaymentSchema();
  if (!process.argv.includes('--apply')) {
    console.log(`Reviewed payment slice: ${schema.sourceFiles.length} sources, sha256=${schema.checksum}`);
    console.log('Dry-run only. Use --apply for the isolated local empty database.');
  } else {
    const marker = localSql("select to_regclass('private.local_payment_bootstrap') is not null;");
    if (marker === 't') {
      const installed = localSql('select checksum from private.local_payment_bootstrap;');
      if (installed === schema.previousChecksum) {
        localSql(`begin; select pg_advisory_xact_lock(918274610);
          do $$ begin if not exists(select 1 from private.local_payment_bootstrap where checksum='${schema.previousChecksum}')
            then raise exception 'Bootstrap changed concurrently'; end if; end $$;
          ${schema.upgradeSql}
          update private.local_payment_bootstrap set checksum='${schema.checksum}' where checksum='${schema.previousChecksum}';
          commit;`);
        console.log('Applied reviewed timestamp-function hardening to previous local slice.');
      } else {
        assert.equal(installed, schema.checksum, 'Local schema differs; manual review required');
        console.log('Matching local payment slice already installed; no changes.');
      }
    } else {
      // One transaction: an error cannot expose an intermediate policy state.
      localSql(`begin;
        select pg_advisory_xact_lock(918274610);
        do $$ begin
          if exists(select 1 from pg_tables where schemaname in ('public','private'))
            or exists(select 1 from auth.users) then
            raise exception 'Refusing non-empty test database';
          end if;
        end $$;
        ${schema.sql}
        create table private.local_payment_bootstrap(checksum text primary key);
        revoke all on private.local_payment_bootstrap from public,anon,authenticated,service_role;
        alter table private.local_payment_bootstrap enable row level security;
        insert into private.local_payment_bootstrap values ('${schema.checksum}');
        notify pgrst, 'reload schema';
        commit;`);
      console.log('Installed local payment slice atomically; no historical business rows loaded.');
    }
    console.log(`Public tables with RLS disabled: ${localSql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;")}`);
  }
} catch (error) { safeFailure(error); }
