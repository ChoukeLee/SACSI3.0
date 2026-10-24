import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { decodeCimacCustomerAccount } from "../src/features/finance/cimac-billing-model";
import {
  decodeCimacWriteResult,
  parseCimacFeeTermInput,
  parseCimacMeterReadingInput,
} from "../src/features/finance/cimac-billing-service";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID(),
  customer = randomUUID(),
  unit = randomUUID(),
  contract = randomUUID();
let building: string;
const today = new Date().toISOString().slice(0, 10),
  month = today.slice(0, 7) + "-01";
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const applied = await installApplicationRebuild(db);
  const file = "20261024222516_cimac_customer_billing_workbench.sql";
  if (!applied.includes(file))
    await db.query(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id,email) values($1,'boundary@test.invalid')", [actor]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Boundary test')",
    [actor],
  );
  const project = (
    await db.query(
      "insert into projects(code,display_name) values('CIMAC','Synthetic CIMAC') returning id",
    )
  ).rows[0].id;
  building = (
    await db.query(
      "insert into buildings(project_id,code,display_name) values($1,'TEST','Synthetic') returning id",
      [project],
    )
  ).rows[0].id;
  await db.query("insert into customers(id,name,phone) values($1,'Synthetic customer','')", [
    customer,
  ]);
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,kind,status,area_sqm) values($1,$2,'TEST-T01','T01','G','storefront','leased',173.125)",
    [unit, building],
  );
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,$3,'BOUNDARY-LEASE',current_date-30,current_date+365,'monthly',1,100000,'active')",
    [contract, unit, customer],
  );
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function login() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
}
async function read() {
  await login();
  const result = (await db.query("select cimac_customer_account_rpc($1,null,1) value", [customer]))
    .rows[0].value;
  return decodeCimacCustomerAccount(result, customer);
}
it("decodes real SQL JSON without inventing a fee balance or missing identity", async () => {
  const account = await read();
  expect(account.customer?.id).toBe(customer);
  expect(account.customer?.phone).toBe("");
  expect(account.customer?.balances).toEqual([]);
  // Existing asset storage is two-decimal; it is not the contract's fee-area snapshot.
  expect(account.units[0].area_sqm).toBe(173.13);
  expect(account.receivables).toEqual([]);
});
it("preserves a three-decimal contractual area and unknown start date through write, receipt and read", async () => {
  const request = parseCimacFeeTermInput({
    requestId: randomUUID(),
    customerId: customer,
    contractId: contract,
    unitId: unit,
    category: "property_fee",
    currency: "XOF",
    monthlyRate: "900",
    pricingBasis: "per_sqm",
    chargeableArea: "173.125",
    proration: "daily_pending_convention",
    source: "Synthetic confirmed pricing reference; start pending",
  });
  const { requestId, ...input } = request;
  await login();
  const saved = (
    await db.query("select cimac_save_fee_terms_rpc($1::jsonb,$2) value", [
      JSON.stringify(input),
      requestId,
    ])
  ).rows[0].value;
  expect(decodeCimacWriteResult(saved, request, "fee_terms", actor).record).toMatchObject({
    chargeableArea: "173.125",
    startsOn: null,
  });
  const account = await read();
  expect(account.feeTerms[0].chargeableArea).toBe("173.125");
  expect(account.feeTerms[0].startsOn).toBeNull();
  expect(account.receivables).toEqual([]);
  expect(account.payments).toEqual([]);
});
it("keeps a .001 unit difference exact even with very large meter readings", async () => {
  const request = parseCimacMeterReadingInput({
    requestId: randomUUID(),
    customerId: customer,
    contractId: contract,
    unitId: unit,
    meterKind: "water",
    meterNo: "SYNTHETIC-01",
    serviceMonth: month,
    readOn: today,
    previousReading: "100000000000.001",
    currentReading: "100000000000.002",
  });
  const { requestId, ...input } = request;
  await login();
  const saved = (
    await db.query("select cimac_save_meter_reading_rpc($1::jsonb,$2) value", [
      JSON.stringify(input),
      requestId,
    ])
  ).rows[0].value;
  expect(decodeCimacWriteResult(saved, request, "meter_reading", actor).record).toMatchObject({
    usage: "0.001",
  });
  const account = await read();
  expect(account.meterReadings[0].usage).toBe("0.001");
  expect(account.receivables).toEqual([]);
});
it("keeps building-only historical receivables visible without fabricating a unit or collection target", async () => {
  await db.query("reset role");
  await db.query(
    "insert into receivables(building_id,unit_id,customer_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status,management_status) values($1,null,$2,'manual','other','Synthetic legacy',current_date,100,20,'partial','historical_pending')",
    [building, customer],
  );
  const account = await read();
  expect(account.receivables).toHaveLength(1);
  expect(account.receivables[0].unit_id).toBeNull();
  expect(account.receivables[0].collectible).toBe(false);
  expect(account.customer?.balances).toEqual([]);
});
