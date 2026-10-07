// Rollback-only migration rehearsal against the verified, isolated restored snapshot.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { project, backupInput, assertIsolated, sql } from "./lib/dr-local-runtime.mjs";
import { applicationRebuildPlan } from "./lib/application-rebuild.mjs";

try {
  assert.equal(project, "sacsi-dr-20261006");
  const { directory } = backupInput(process.argv[2] ?? "");
  const verification = JSON.parse(readFileSync(join(directory, "database-verification.json")));
  assert.equal(verification.tableContentHashesMatch, true);
  assert.equal(verification.exactSchemaMatch, true);
  assertIsolated();
  const plan = applicationRebuildPlan();
  const migrations = plan.steps.filter((step) => step.name.startsWith("20261006"));
  assert.equal(migrations.length, 4);
  const statements = migrations
    .map((step) => {
      assert.match(step.sql, /^begin;/i);
      assert.match(step.sql, /commit;\s*$/i);
      return step.sql.replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, "");
    })
    .join("\n");
  const repairRehearsal = process.argv.includes("--approved-sale-repairs");
  const repairs = repairRehearsal
    ? ["approved-sale-schedule-status-repairs.sql", "approved-sale-610-components.sql"]
        .map((name) => readFileSync(join("work", name), "utf8"))
        .join("\n")
    : "";
  const output = sql(`BEGIN;
    SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';
    ${statements}
    ${repairs}
    DO $check$ DECLARE actor uuid; BEGIN
      select id into strict actor from public.user_profiles where role='admin' order by id limit 1;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
      perform set_config('sacsi.dr.unmapped_accounts',(select count(*)::text from public.project_account_access a where a.account_id is null and exists(select 1 from auth.users u where lower(u.email)=lower(a.account_email))),true);
    END $check$;
    SET LOCAL ROLE authenticated;
    SELECT jsonb_build_object(
      'migrationsApplied',4,
      'ledgerReadMatchesFullCount',(public.finance_read_rpc('ledger','{}',1,false)->>'total')::bigint=(select count(*) from public.ledger_entries),
      'ledgerExportMatchesRead',jsonb_array_length(public.finance_read_rpc('ledger','{}',1,true)->'rows')=(public.finance_read_rpc('ledger','{}',1,false)->>'total')::bigint,
      'receivableReadWorks',public.finance_read_rpc('receivables','{}',1,false) is not null,
      'accountsReadWorks',public.account_access_summary_rpc() is not null,
      'inboxReadWorks',public.operator_task_inbox() is not null,
      'unitPositionMatchesVisibleUnits',(select count(*) from public.unit_operational_position)=(select count(*) from public.units),
      'unlinkedSaleSchedules',(select count(*) from public.sale_payment_schedule s where receivable_id is null and status<>'cancelled' and not coalesce(private.sale_components_valid(s.id),false)),
      'unlinkedOpenSaleSchedules',(select count(*) from public.sale_payment_schedule s join public.sale_contracts c on c.id=s.sale_contract_id where s.receivable_id is null and not coalesce(private.sale_components_valid(s.id),false) and s.status not in ('paid','cancelled') and c.status='active'),
      'saleScheduleStatusDisagreements',(select count(*) from public.sale_payment_schedule s join public.receivables r on r.id=s.receivable_id where (s.status='paid') is distinct from (r.status='paid') and s.status<>'cancelled'),
      'unmappedExistingProjectAccounts',current_setting('sacsi.dr.unmapped_accounts')::bigint,
      'reconciliationIssues',(public.finance_reconciliation_rpc()->>'count')::bigint
    );
    ROLLBACK;`);
  const result = JSON.parse(output.split(/\r?\n/).find((line) => line.startsWith("{")));
  for (const [name, value] of Object.entries(result))
    if (typeof value === "boolean") assert.equal(value, true, name);
  const report = {
    ...result,
    passed: true,
    releaseReady:
      result.unlinkedOpenSaleSchedules === 0 &&
      result.saleScheduleStatusDisagreements === 0 &&
      result.unmappedExistingProjectAccounts === 0,
    project,
    verifiedAt: new Date().toISOString(),
    rolledBack: true,
    productionWrites: 0,
    approvedRepairsRehearsed: repairRehearsal,
  };
  writeFileSync(
    join(directory, "architecture-upgrade-rehearsal.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch {
  console.error(
    "Isolated rollback-only architecture upgrade rehearsal failed; no production database was changed.",
  );
  process.exitCode = 1;
}
