import { randomUUID } from "node:crypto";
import type pg from "pg";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID(), project = randomUUID(), building = randomUUID(), unit = randomUUID(), customer = randomUUID(), contract = randomUUID();
beforeAll(async () => {
  cluster = await createNativePaymentPostgres(); db = await cluster.connect();
  await installApplicationRebuild(db);
  await db.query("insert into auth.users(id,email) values($1,'native@test.invalid')", [actor]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic')", [actor]);
  await db.query("insert into projects(id,code,display_name,allows_long_lease) values($1,'NATIVE','Synthetic',true)", [project]);
  await db.query("insert into buildings(id,project_id,code,display_name) values($1,$2,'NATIVE','Synthetic')", [building, project]);
  await db.query("insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,'NATIVE','6F','6','leased')", [unit, building]);
  await db.query("insert into customers(id,name) values($1,'Synthetic native customer')", [customer]);
  await db.query("insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,paid_through_date,payment_cycle,payment_day,monthly_rent_xof,rent_currency,monthly_rent_amount,status) values($1,$2,$3,'NATIVE-TEST','2026-06-01','2027-11-30','2026-05-31','semiannual',1,0,'USD',3200,'active')", [contract, unit, customer]);
  await db.query("insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,amount_native,paid_amount_native,status,service_period_start,service_period_end,service_period_source) values($1,$2,$3,'lease_contract',$4,'lease_rent','Native six months','2026-06-01',0,0,'USD',19200,0,'pending','2026-06-01','2026-11-30','Synthetic confirmed period')", [building, unit, customer, contract]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actor, role: "authenticated" })]);
  await db.query("set role authenticated");
}, 45000);
afterAll(async () => { await db?.end(); await cluster?.close(); });
const collect = (id: string, amount = 19200, currency = "USD") => db.query("select public.record_native_lease_rent_rpc($1,'2026-06-22',$2,$3,'2026-11-30','bank_transfer','Synthetic',null,$4) value", [contract, amount, currency, id]);
it("rejects legacy XOF writes and unconfirmed currencies without a new payment", async () => {
  await expect(db.query("select public.record_lease_financial_entry_v2_rpc($1,'rent_income','2026-06-22',19200,'USD',1,'2026-11-30','cash',null,null,$2)", [contract, randomUUID()])).rejects.toThrow("nativeLeaseCurrencyRequired");
  await expect(collect(randomUUID(), 19200, "CNY")).rejects.toThrow("nativeLeaseRequiresReview");
  expect((await db.query("select count(*)::int n from payments")).rows[0].n).toBe(0);
});
it("posts exactly one native receipt and native ledger, atomically allocates and retries idempotently", async () => {
  const request = randomUUID();
  await expect(collect(randomUUID(), 19201)).rejects.toThrow("nativeRentAllocationRequiresReview");
  const first = (await collect(request)).rows[0].value;
  expect(first.success).toBe(true);
  expect((await collect(request)).rows[0].value).toMatchObject({ payment_id: first.payment_id, idempotent: true });
  await expect(collect(request, 19201)).rejects.toThrow("requestIdConflict");
  expect((await db.query("select amount::text, currency::text, native_settlement, exchange_rate_to_xof from payments")).rows).toEqual([{ amount: "19200.00", currency: "USD", native_settlement: true, exchange_rate_to_xof: null }]);
  expect((await db.query("select amount_xof::text,currency::text,amount_native::text from ledger_entries")).rows).toEqual([{ amount_xof: "0.00", currency: "USD", amount_native: "19200.00" }]);
  expect((await db.query("select paid_amount_native::text,status from receivables")).rows).toEqual([{ paid_amount_native: "19200.00", status: "paid" }]);
});
it("financial reads retain full original amounts and separate aggregates across pagination and export", async () => {
  for (const kind of ["ledger", "receivables"]) {
    const data = (await db.query("select finance_read_rpc($1,$2,1,false) value", [kind, { projectId: project }])).rows[0].value;
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].amount_native).toBe(19200);
    expect(data.summary[kind === "ledger" ? "income" : "receivable"]).toBe(0);
    expect(data.nativeSummary[0]).toMatchObject({ currency: "USD", [kind === "ledger" ? "income" : "paid"]: 19200 });
    const exported = (await db.query("select finance_read_rpc($1,$2,1,true) value", [kind, { projectId: project }])).rows[0].value;
    expect(exported.nativeSummary).toEqual(data.nativeSummary);
  }
  const empty = (await db.query("select finance_read_rpc('ledger',$1,1,false) value", [{ projectId: project, dateFrom: "2026-07-01" }])).rows[0].value;
  expect(empty.rows).toEqual([]); expect(empty.nativeSummary).toEqual([]);
});
it("dashboard does not count native USD as unknown FX or as XOF cash", async () => {
  const value = (await db.query("select management_operating_snapshot_rpc($1) value", [project])).rows[0].value;
  expect(value.netCollected).toBe(0);
  expect(value.excludedCount).toBe(0);
  expect(value.nativeSummary[0].currency).toBe("USD");
});
it("native arrears survive outstanding filters while XOF balances remain zero", async () => {
  await db.query("insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,amount_native,paid_amount_native,status) values($1,$2,$3,'lease_contract',$4,'lease_rent','Native remaining','2026-12-01',0,0,'USD',3200,0,'pending')", [building, unit, customer, contract]);
  const value = (await db.query("select finance_read_rpc('receivables',$1,1,false) value", [{ projectId: project, outstandingOnly: "true" }])).rows[0].value;
  expect(value.total).toBe(1); expect(value.summary.outstanding).toBe(0);
  expect(value.nativeSummary[0].outstanding).toBe(3200);
});
it("native functions remain invoker-only and unavailable anonymously", async () => {
  expect((await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') anon from pg_proc where oid='public.record_native_lease_rent_rpc(uuid,date,numeric,currency_code,date,text,text,text,uuid)'::regprocedure")).rows[0]).toEqual({ prosecdef: false, anon: false });
});
