import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
afterAll(async () => {
  await cluster?.close();
});
it("upgrades without changing old financial rows, access or completed request replay", async () => {
  cluster = await createNativePaymentPostgres();
  const db = await cluster.connect();
  const file = "20261022092703_daily_backfill_payment_facts.sql";
  await installApplicationRebuild(db, { beforeMigration: file });
  const actor = randomUUID(),
    project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID(),
    agent = randomUUID(),
    request = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [actor]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic')", [
    actor,
  ]);
  await db.query(
    "insert into projects(id,code,display_name,allows_daily_rental) values($1::uuid,$1::text,'Synthetic',true)",
    [project],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
    [building, project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label) values($1::uuid,$2,$1::text,'204','2F')",
    [unit, building],
  );
  await db.query("insert into customers(id,name) values($1,'黄姐')", [agent]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
  const payload = {
    unitId: unit,
    customerId: agent,
    checkIn: "2026-01-01",
    checkOut: "2026-01-02",
    nightlyPriceXof: 80000,
    prepaidAmountXof: 80000,
    reason: "Synthetic legacy payload",
  };
  const call = () =>
    db.query("select finance_operation_rpc('daily_backfill',$1,$2) result", [payload, request]);
  expect((await call()).rows[0].result.success).toBe(true);
  await db.query("reset role");
  const snapshot = async () =>
    (
      await db.query(`select jsonb_build_object(
    'booking',(select jsonb_agg(to_jsonb(b)) from daily_bookings b),
    'receivables',(select jsonb_agg(to_jsonb(r)) from receivables r),
    'payments',(select jsonb_agg(to_jsonb(p)) from payments p),
    'ledger',(select jsonb_agg(to_jsonb(l)) from ledger_entries l),
    'audit',(select jsonb_agg(to_jsonb(a)) from audit_logs a),
    'acl',(select proacl::text from pg_proc where oid='private.finance_operation(text,jsonb,uuid)'::regprocedure)
  ) snapshot`)
    ).rows[0].snapshot;
  const before = await snapshot();
  // Match the rebuild loader and the Git/production SQL byte convention.
  // Windows checkout CRLF must not alter multiline drift-guard literals.
  await db.query(readFileSync(`supabase/migrations/${file}`, "utf8").replaceAll("\r\n", "\n"));
  expect(await snapshot()).toEqual(before);
  await db.query("set role authenticated");
  expect((await call()).rows[0].result.idempotent).toBe(true);
  await db.query("reset role");
  expect(await snapshot()).toEqual(before);
}, 45000);
