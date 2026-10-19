import { beforeAll, afterAll, it, expect } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: Awaited<ReturnType<typeof cluster.connect>>;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
it("rebuilds all current application entrypoints from an empty isolated database", async () => {
  const result =
    await db.query(`select public.booking_operations_protocol_version() booking,public.daily_workflow_protocol_version() daily,public.operator_collection_protocol_version() collections,
    (select count(*)::int from auth.users) users,(select count(*)::int from public.payments) payments,
    (select count(*)::int from public.audit_logs) audit`);
  expect(result.rows[0]).toEqual({
    booking: 1,
    daily: 1,
    collections: 1,
    users: 0,
    payments: 0,
    audit: 0,
  });
  expect(
    (
      await db.query(
        "select 1 from pg_enum where enumtypid='public.currency_code'::regtype and enumlabel='USD'",
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await db.query(
        "select to_regprocedure('public.record_lease_financial_entry_v2_rpc(uuid,text,date,numeric,public.currency_code,numeric,date,text,text,text,uuid)') is not null present",
      )
    ).rows[0].present,
  ).toBe(true);
});
it("does not grant anonymous execution or direct access to confirmation records", async () => {
  const result =
    await db.query(`select has_function_privilege('anon','public.operator_booking_operation(text,jsonb,uuid,jsonb,timestamptz,text,uuid)','execute') anon,
    has_table_privilege('authenticated','private.operator_booking_operations','select') direct,
    (select relrowsecurity from pg_class where oid='private.operator_booking_operations'::regclass) rls`);
  expect(result.rows[0]).toEqual({ anon: false, direct: false, rls: true });
});
it("rebuilds the bounded read models without new privileged functions or anonymous access", async () => {
  for (const signature of [
    "public.contract_workspace_read_rpc(text,jsonb,text,uuid)",
    "public.daily_calendar_context_rpc(uuid,date,date)",
    "public.daily_calendar_cash_summary_rpc(uuid)",
    "public.daily_customer_candidates_rpc(uuid,text,integer,text[])",
    "public.customer_directory_read_rpc(jsonb,text,uuid,integer)",
  ]) {
    const result = await db.query(
      `select p.prosecdef privileged, p.provolatile volatility,
        has_function_privilege('anon',p.oid,'execute') anonymous,
        has_function_privilege('service_role',p.oid,'execute') service,
        has_function_privilege('authenticated',p.oid,'execute') authenticated
       from pg_proc p where p.oid=to_regprocedure($1)`,
      [signature],
    );
    expect(result.rows).toEqual([
      { privileged: false, volatility: "s", anonymous: false, service: false, authenticated: true },
    ]);
  }
});
it("refuses to rebuild over an existing database", async () => {
  await expect(installApplicationRebuild(db)).rejects.toThrow("Fresh test database required");
});
