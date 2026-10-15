import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { runQualityChecks, type DataSnapshot } from "../src/features/data-quality/quality-service";
import {
  scanDailyRentalIssues,
  type AuditSnapshot,
} from "../src/features/daily-rentals/daily-rental-audit";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID(),
  guest = randomUUID();
let visible: Awaited<ReturnType<typeof fixture>>, hidden: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const installed = await installApplicationRebuild(db);
  const migration = "20261015185946_optimize_quality_authorized_snapshot.sql";
  if (!installed.includes(migration))
    await db.query(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  const published = readFileSync(
    resolve("supabase/migrations/202607280004_reconcile_data_quality.sql"),
    "utf8",
  );
  const start = published.indexOf("create or replace view public.system_data_quality_findings");
  expect(start).toBeGreaterThan(0);
  await db.query(
    published
      .slice(start)
      .replaceAll("system_data_quality_findings", "system_data_quality_reference_findings"),
  );
  await db.query("insert into auth.users(id,email) values($1,'quality-snapshot@test.invalid')", [
    actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Quality snapshot test')",
    [actor],
  );
  await claims(actor);
  await db.query("insert into customers(id,name) values($1,'Synthetic quality customer')", [guest]);
  visible = await fixture(false);
  hidden = await fixture(true);
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function claims(id: string | null) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
}
async function fixture(restricted: boolean) {
  const project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID(),
    lease = randomUUID(),
    sale = randomUUID();
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_sale,allows_daily_rental) values($1,$2,'Synthetic quality project',$3,true,true)",
    [project, project, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name,is_active,business_paused) values($1,$2,$3,'Historical quality building',false,true)",
    [building, project, building],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,$3,'Q-1','1','available')",
    [unit, building, unit],
  );
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,$3,$4,current_date,current_date+365,'monthly',1,100,'active')",
    [lease, unit, guest, lease],
  );
  await db.query(
    "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,payment_plan_type,total_amount_xof,status) values($1,$2,$3,$4,current_date,'lump_sum',100,'active')",
    [sale, unit, guest, sale],
  );
  await db.query(
    "insert into receivables(building_id,unit_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status) values($1,$2,'lease_contract','lease_rent','Synthetic due',current_date-1,100,0,'pending'),($1,$2,'lease_contract','lease_rent','Synthetic overpaid',current_date,100,101,'partial')",
    [building, unit],
  );
  await db.query(
    "insert into payments(unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,'parking_fee',current_date,10,'XOF',1,'cash')",
    [unit],
  );
  await db.query(
    "insert into ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof) values($1,$2,current_date,'income','other_income',10)",
    [building, unit],
  );
  await db.query(
    "insert into daily_bookings(unit_id,customer_id,check_in,check_out,total_amount_xof,status,notes) values($1,$2,current_date-2,current_date-1,100,'checked_out','[历史补录] synthetic quality')",
    [unit, guest],
  );
  return { project, building, unit };
}
async function compare() {
  await db.query("set role authenticated");
  try {
    const result = (
      await db.query(`select public.database_quality_read_rpc() actual,
      (select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(f) order by f.severity,f.building_code,f.unit_no,f.issue_key),'[]'::jsonb),'total',count(*))
       from public.system_data_quality_reference_findings f) expected`)
    ).rows[0];
    expect(result.actual).toEqual(result.expected);
    expect(result.actual.total).toBe(result.actual.rows.length);
    return result.actual as { total: number; rows: { issue_key: string; building_code: string }[] };
  } finally {
    await db.query("reset role");
  }
}
it.each(["admin", "boss", "finance", "front_desk", "rental_sales"])(
  "preserves every published finding/ID/detail for %s under existing project RLS",
  async (role) => {
    await db.query("update user_profiles set role=$1 where id=$2", [role, actor]);
    const result = await compare();
    expect(result.rows.map((row) => row.issue_key.split(":")[0]).sort()).toEqual([
      "lease_sale_overlap",
      "payment_missing_ledger",
      "receivable_overpaid",
      "receivable_status",
      "sale_missing_receivable",
      "unit_status",
    ]);
    expect(result.rows.every((row) => row.building_code === visible.building)).toBe(true);
  },
);
it("immediately includes explicit restricted-project grants and excludes revoked projects", async () => {
  await db.query("update user_profiles set role='admin' where id=$1", [actor]);
  await db.query(
    "insert into project_account_access(project_id,account_id,account_email) values($1,$2,'quality-snapshot@test.invalid')",
    [hidden.project, actor],
  );
  expect((await compare()).total).toBe(12);
  await db.query("delete from project_account_access where project_id=$1 and account_id=$2", [
    hidden.project,
    actor,
  ]);
  expect((await compare()).total).toBe(6);
});
it("preserves all original raw source coverage and legacy/daily rule output without count/page rescans", async () => {
  const definitions: [string, string, string][] = [
    ["units", "units", "order by unit_no,id"],
    ["customers", "customers", "order by name,id"],
    ["dailyBookings", "daily_bookings", "order by check_in desc,id"],
    ["leaseContracts", "lease_contracts", "order by start_date desc,id"],
    ["saleContracts", "sale_contracts", "order by signed_date desc,id"],
    ["saleSchedules", "sale_payment_schedule", "order by installment_no,id"],
    ["receivables", "receivables", "where status<>'cancelled' order by due_date desc,id"],
    ["payments", "payments", "order by payment_date desc,id"],
    ["cleaningTasks", "cleaning_tasks", "order by id"],
    ["ledgerEntries", "ledger_entries", "order by entry_date desc,id"],
    [
      "auditLogs",
      "audit_logs",
      "where entity_type in ('daily_booking','unit') order by created_at desc,id",
    ],
  ];
  for (const role of ["admin", "boss", "finance", "front_desk", "rental_sales"]) {
    await db.query("update user_profiles set role=$1 where id=$2", [role, actor]);
    const actual: Record<string, unknown> = {},
      expected: Record<string, unknown> = {};
    await db.query("set role authenticated");
    try {
      for (const [source, table, order] of definitions) {
        const original = (
          await db.query(
            `select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) rows from (select * from public.${table} ${order}) x`,
          )
        ).rows[0].rows;
        const read = (await db.query("select database_quality_read_rpc($1) result", [source]))
          .rows[0].result;
        expect(read.total).toBe(read.rows.length);
        expect(read.rows).toEqual(
          source === "ledgerEntries"
            ? original.filter((row: { payment_id: string | null }) => row.payment_id !== null)
            : original,
        );
        actual[source] = read.rows;
        expected[source] = original;
      }
      await expect(
        db.query("select database_quality_read_rpc('payments; drop table payments')"),
      ).rejects.toThrow("invalidQualitySource");
    } finally {
      await db.query("reset role");
    }
    expect(runQualityChecks(actual as unknown as DataSnapshot)).toEqual(
      runQualityChecks(expected as unknown as DataSnapshot),
    );
    expect(scanDailyRentalIssues(actual as unknown as AuditSnapshot)).toEqual(
      scanDailyRentalIssues(expected as unknown as AuditSnapshot),
    );
  }
  await db.query("update user_profiles set role='admin' where id=$1", [actor]);
});
it("returns every finding beyond the API table-row cap without LIMIT/count rescans", async () => {
  await db.query(
    `insert into receivables(building_id,unit_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status)
    select $1,$2,'manual','other','Synthetic due '||n,current_date-1,100,0,'pending' from generate_series(1,1051) n`,
    [visible.building, visible.unit],
  );
  const result = await compare();
  expect(result.total).toBe(1057);
  expect(new Set(result.rows.map((row) => row.issue_key)).size).toBe(1057);
});
it("denies anonymous and missing-profile identities rather than inventing a healthy empty scan", async () => {
  const missing = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'missing-quality@test.invalid')", [
    missing,
  ]);
  for (const id of [missing, null]) {
    await claims(id);
    await expect(compare()).rejects.toThrow("qualityPermissionDenied");
  }
  await claims(actor);
  const catalog = (
    await db.query(
      "select prosecdef,provolatile,has_function_privilege('anon',oid,'execute') anon from pg_proc where oid='public.database_quality_read_rpc(text)'::regprocedure",
    )
  ).rows[0];
  expect(catalog).toEqual({ prosecdef: false, provolatile: "s", anon: false });
  expect(
    (
      await db.query(
        "select reloptions from pg_class where oid='public.system_data_quality_findings'::regclass",
      )
    ).rows[0].reloptions,
  ).toContain("security_invoker=true");
});
