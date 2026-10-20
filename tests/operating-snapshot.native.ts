import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { decodeOperatingSnapshot } from "../src/features/management/operating-snapshot";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: Awaited<ReturnType<Awaited<ReturnType<typeof createNativePaymentPostgres>>["connect"]>>;
const actor = randomUUID(),
  project = randomUUID(),
  otherProject = randomUUID();
const building = randomUUID(),
  unit = randomUUID(),
  customer = randomUUID(),
  booking = randomUUID();
let today: string;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  await db.query("insert into auth.users(id,email) values($1,'operating@test.invalid');", [actor]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Dashboard test')",
    [actor],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  today = (await db.query("select current_date::text d")).rows[0].d;
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_daily_rental) values($1,'SACSI','Test','open',true),($2,'CIMAC','Private','restricted',false)",
    [project, otherProject],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'DASH','Dashboard')",
    [building, project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status,occupancy_verified,construction_status) values($1,$2,'DASH-1','1','1','available',true,'operational')",
    [unit, building],
  );
  await db.query("insert into customers(id,name) values($1,'Test guest')", [customer]);
  await db.query(
    "insert into daily_bookings(id,unit_id,customer_id,guest_customer_id,check_in,check_out,total_amount_xof,status) values($1,$2,$3,$3,current_date,current_date+1,1000,'confirmed')",
    [booking, unit, customer],
  );
  await db.query(
    "insert into payments(unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method) select $1,'parking_fee',null,current_date,100,'XOF',1,'cash' from generate_series(1,1051)",
    [unit],
  );
  await db.query(
    "insert into payments(unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,'daily_booking',$2,current_date,1000,'XOF',1,'cash'),($1,'lease_deposit',null,current_date,99999,'XOF',1,'cash'),($1,'lease_rent',null,current_date,800,'XOF',1,'offset'),($1,'lease_rent_refund',null,current_date,50,'XOF',1,'cash'),($1,'lease_rent',null,current_date,2,'CNY',100,'bank_transfer'),($1,'lease_other_expense',null,current_date,80,'XOF',1,'cash')",
    [unit, booking],
  );
  await db.query(
    "insert into receivables(building_id,unit_id,customer_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status,management_status) values($1,$2,$3,'lease_contract','lease_rent','Due',current_date,500,200,'partial','managed'),($1,$2,$3,'lease_contract','lease_rent','History',current_date,1000,0,'pending','historical_pending'),($1,$2,$3,'lease_contract','lease_rent','Future',current_date+1,400,0,'pending','managed')",
    [building, unit, customer],
  );
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function snapshot(id = project) {
  await db.query("set role authenticated");
  try {
    return decodeOperatingSnapshot(
      (await db.query("select public.management_operating_snapshot_rpc($1) result", [id])).rows[0]
        .result,
    );
  } finally {
    await db.query("reset role");
  }
}
it("aggregates beyond all UI page limits, separates cash/deposit/offset/allocation and daily bookings", async () => {
  const result = await snapshot();
  expect(result.netCollected).toBe(105100 + 1000 - 50 + 200);
  expect(result.dailyNet).toBe(1000);
  expect(result.dueOutstanding).toBe(300);
  expect(result.overdue).toBe(0);
  expect(result.upcoming).toBe(400);
  expect(result.historicalPending).toBe(1);
  expect(result.dailyInHouse).toBe(0);
  expect(result.asOf).toBe(today);
  expect(result.trend).toHaveLength(12);
  expect(result.trend[11].count).toBe(1054);
  expect(result.excludedCount).toBe(1);
  expect(result.trend[0].count).toBe(0);
  expect(
    result.businessNet.lease + result.businessNet.sale + result.businessNet.asset + result.dailyNet,
  ).toBe(result.netCollected);
});

it("keeps authorized outputs identical to the published classifier while fencing RLS sources once", async () => {
  const reference = readFileSync(
    resolve("supabase/migrations/20261015181240_management_operating_snapshot.sql"),
    "utf8",
  ).replaceAll("management_operating_snapshot_rpc", "management_operating_snapshot_reference_rpc");
  await db.query(reference);
  const definition = (
    await db.query(
      "select pg_get_functiondef(oid) definition,prosecdef,provolatile from pg_proc where oid='public.management_operating_snapshot_rpc(uuid)'::regprocedure",
    )
  ).rows[0];
  expect(definition.prosecdef).toBe(false);
  expect(definition.provolatile).toBe("s");
  for (const name of [
    "raw_buildings",
    "raw_units",
    "raw_payments",
    "raw_receivables",
    "raw_leases",
    "raw_sales",
    "raw_ledger",
    "raw_daily",
  ])
    expect(definition.definition).toContain(`${name} as materialized`);
  await db.query("set role authenticated");
  try {
    // Both STABLE calls run under one statement timestamp and authenticated RLS.
    const result = (
      await db.query(
        "select public.management_operating_snapshot_rpc($1) actual,public.management_operating_snapshot_reference_rpc($1) expected",
        [project],
      )
    ).rows[0];
    expect(result.actual).toEqual({ ...result.expected, nativeSummary: [] });
    await expect(
      db.query("select public.management_operating_snapshot_rpc($1)", [otherProject]),
    ).rejects.toThrow("managementPermissionDenied");
  } finally {
    await db.query("reset role");
  }
});
it("finance project filtering applies to summary/detail/export and preserves zero separate authorized project", async () => {
  await db.query(
    "insert into ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof) values($1,$2,current_date,'income','lease_rent',123)",
    [building, unit],
  );
  await db.query("set role authenticated");
  try {
    for (const exported of [false, true]) {
      const result = (
        await db.query("select finance_read_rpc('ledger',$1,1,$2) result", [
          { projectId: project },
          exported,
        ])
      ).rows[0].result;
      expect(result.summary.income).toBe(123);
      expect(result.rows).toHaveLength(1);
    }
  } finally {
    await db.query("reset role");
  }
});
it("revoked project access and revoked role immediately fail; anonymous cannot execute", async () => {
  await expect(snapshot(otherProject)).rejects.toThrow(/managementPermissionDenied/);
  await db.query("update user_profiles set role='rental_sales' where id=$1", [actor]);
  await expect(snapshot()).rejects.toThrow(/managementPermissionDenied/);
  await db.query("update user_profiles set role='admin' where id=$1", [actor]);
  const functions = (
    await db.query(
      "select prosecdef,provolatile from pg_proc where oid='public.management_operating_snapshot_rpc(uuid)'::regprocedure",
    )
  ).rows[0];
  expect(functions).toEqual({ prosecdef: false, provolatile: "s" });
  expect(
    (
      await db.query(
        "select has_function_privilege('anon','public.management_operating_snapshot_rpc(uuid)','execute') permitted",
      )
    ).rows[0].permitted,
  ).toBe(false);
});

async function isolatedProject(restricted = false) {
  const projectId = randomUUID(),
    buildingId = randomUUID(),
    unitId = randomUUID();
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_daily_rental,allows_long_lease,allows_sale) values($1,$2,'Synthetic operating review',$3,true,true,true)",
    [projectId, projectId, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,$3,'Synthetic operating building')",
    [buildingId, projectId, buildingId],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status,occupancy_verified,construction_status) values($1,$2,$3,'REVIEW-1','1','available',true,'operational')",
    [unitId, buildingId, unitId],
  );
  return { project: projectId, building: buildingId, unit: unitId };
}
async function lease(unitId: string, contractId = randomUUID()) {
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,$3,$4,current_date,current_date+365,'monthly',1,100,'active')",
    [contractId, unitId, customer, contractId],
  );
  return contractId;
}
async function receipt(
  unitId: string | null,
  sourceType: string,
  sourceId: string | null,
  amount: number,
  currency = "XOF",
  rate = 1,
) {
  return (
    await db.query(
      "insert into payments(unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,$2,$3,current_date,$4,$5,$6,'cash') returning id",
      [unitId, sourceType, sourceId, amount, currency, rate],
    )
  ).rows[0].id as string;
}

it("attributes legacy null-unit contract receipts once, including same UUID in separate lease and sale tables", async () => {
  const f = await isolatedProject(),
    contract = await lease(f.unit);
  // Separate contract tables can legitimately share a UUID. A dual-source join
  // must not multiply a payment or invent a second asset attribution.
  await db.query(
    "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,payment_plan_type,total_amount_xof,status) values($1,$2,$3,$4,current_date,'lump_sum',1000,'active')",
    [contract, f.unit, customer, randomUUID()],
  );
  await receipt(null, "lease_rent", contract, 140);
  await receipt(null, "sale", contract, 260);
  await receipt(null, "property_fee", contract, 30);
  await receipt(null, "parking_fee", contract, 40);
  await receipt(f.unit, "lease_rent", contract, 10);
  const result = await snapshot(f.project);
  expect(result.netCollected).toBe(480);
  expect(result.businessNet).toEqual({ lease: 150, sale: 260, asset: 70 });
  expect(result.trend[11]).toMatchObject({ net: 480, count: 5, excluded: 0 });
  expect(result.excludedCount).toBe(0);
});

it("source-linked null-unit receipts cannot enter a different project or bypass a restricted project's grant", async () => {
  const visible = await isolatedProject(),
    hidden = await isolatedProject(true);
  const visibleLease = await lease(visible.unit),
    hiddenLease = await lease(hidden.unit);
  await receipt(null, "lease_rent", visibleLease, 100);
  await receipt(null, "lease_rent", hiddenLease, 777);
  expect((await snapshot(visible.project)).netCollected).toBe(100);
  await expect(snapshot(hidden.project)).rejects.toThrow("managementPermissionDenied");
  await db.query(
    "insert into project_account_access(project_id,account_id,account_email) values($1,$2,'operating@test.invalid')",
    [hidden.project, actor],
  );
  const permitted = await snapshot(hidden.project);
  expect(permitted.netCollected).toBe(777);
  expect(permitted.trend[11].count).toBe(1);
  expect((await snapshot(visible.project)).netCollected).toBe(100);
  await db.query("delete from project_account_access where project_id=$1 and account_id=$2", [
    hidden.project,
    actor,
  ]);
  await expect(snapshot(hidden.project)).rejects.toThrow("managementPermissionDenied");
  expect((await snapshot(visible.project)).netCollected).toBe(100);
});

it("combines multiple buildings' daily receipts once, retains inactive history and uses recorded payment-unit attribution", async () => {
  const f = await isolatedProject(),
    elsewhere = await isolatedProject();
  const secondBuilding = randomUUID(),
    secondUnit = randomUUID();
  await db.query(
    "insert into buildings(id,project_id,code,display_name,is_active) values($1,$2,$3,'Inactive historical building',false)",
    [secondBuilding, f.project, secondBuilding],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status,occupancy_verified,construction_status) values($1,$2,$3,'REVIEW-2','2','available',true,'operational')",
    [secondUnit, secondBuilding, secondUnit],
  );
  const firstBooking = randomUUID(),
    secondBooking = randomUUID(),
    foreignBooking = randomUUID();
  for (const [id, target, status] of [
    [firstBooking, f.unit, "confirmed"],
    [secondBooking, secondUnit, "checked_in"],
    [foreignBooking, elsewhere.unit, "confirmed"],
  ]) {
    await db.query(
      "insert into daily_bookings(id,unit_id,customer_id,guest_customer_id,check_in,check_out,total_amount_xof,status) values($1,$2,$3,$3,current_date,current_date+1,1000,$4)",
      [id, target, customer, status],
    );
  }
  await receipt(f.unit, "daily_booking", firstBooking, 100);
  await receipt(null, "daily_booking", secondBooking, 250);
  // The booking now references the first asset, but the payment still records
  // its historical second-asset target. It is counted there once, not twice.
  await receipt(secondUnit, "daily_booking", firstBooking, 50);
  await receipt(null, "daily_booking", foreignBooking, 900);
  // A negative sign alone is not proof of a refund. Reuse the audited classifier.
  await receipt(f.unit, "daily_booking", firstBooking, -70);
  const result = await snapshot(f.project);
  expect(result.netCollected).toBe(400);
  expect(result.dailyNet).toBe(400);
  expect(result.dailyInHouse).toBe(1);
  expect(result.assetCount).toBe(2);
  expect(result.trend[11]).toMatchObject({ net: 400, count: 3, excluded: 1 });
  expect(result.excludedCount).toBe(1);
  expect(result.businessNet).toEqual({ lease: 0, sale: 0, asset: 0 });
  expect((await snapshot(elsewhere.project)).dailyNet).toBe(900);
});

it("retains recorded two-decimal historical FX amounts instead of silently rounding each receipt to whole XOF", async () => {
  const f = await isolatedProject();
  for (let index = 0; index < 2; index++) {
    const payment = await receipt(f.unit, "lease_rent", null, 2, "CNY", 90.7);
    await db.query(
      "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,amount_cny) values($1,$2,$3,current_date,'income','lease_rent',181.40,2)",
      [f.building, f.unit, payment],
    );
  }
  const recorded = Number(
    (
      await db.query("select sum(amount_xof) amount from ledger_entries where building_id=$1", [
        f.building,
      ])
    ).rows[0].amount,
  );
  const result = await snapshot(f.project);
  expect(recorded).toBe(362.8);
  expect(result.netCollected).toBe(recorded);
  expect(result.businessNet.lease).toBe(recorded);
  expect(result.trend[11]).toMatchObject({ net: recorded, count: 2 });
});

it("includes verified project-linked manual income with no unit without silently losing its coverage", async () => {
  const f = await isolatedProject();
  await db.query("set role authenticated");
  try {
    await db.query("select public.finance_operation_rpc('manual_entry',$1,$2)", [
      {
        buildingId: f.building,
        amount: 321,
        currency: "XOF",
        exchangeRateToXof: 1,
        entryDate: today,
        direction: "income",
        category: "other_income",
        receiptNo: `SYNTHETIC-${randomUUID()}`,
      },
      randomUUID(),
    ]);
  } finally {
    await db.query("reset role");
  }
  const result = await snapshot(f.project);
  expect(result.netCollected).toBe(321);
  expect(result.excludedCount).toBe(0);
  expect(result.trend[11]).toMatchObject({ net: 321, count: 1, excluded: 0 });
});

it("keeps unmatched or inconsistent scoped manual receipts visible as excluded, while known deposit liabilities remain separate", async () => {
  const f = await isolatedProject();
  await receipt(f.unit, "manual", randomUUID(), 70);
  const inconsistentLedger = randomUUID(),
    liabilityLedger = randomUUID();
  const inconsistentPayment = await receipt(f.unit, "manual", inconsistentLedger, 80);
  await db.query(
    "insert into ledger_entries(id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,$3,$4,current_date,'income','other_income',79)",
    [inconsistentLedger, f.building, f.unit, inconsistentPayment],
  );
  const liabilityPayment = await receipt(null, "manual", liabilityLedger, 999);
  await db.query(
    "insert into ledger_entries(id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,null,$3,current_date,'liability_in','lease_deposit',999)",
    [liabilityLedger, f.building, liabilityPayment],
  );
  const result = await snapshot(f.project);
  expect(result.netCollected).toBe(0);
  expect(result.excludedCount).toBe(2);
  expect(result.trend[11]).toMatchObject({ net: 0, count: 0, excluded: 2 });
  expect(result.businessNet).toEqual({ lease: 0, sale: 0, asset: 0 });
});

it("scopes root scans without changing explicit receivable-building precedence or ended-contract fallback", async () => {
  const f = await isolatedProject(),
    other = await isolatedProject(),
    contract = await lease(f.unit);
  await db.query("update lease_contracts set status='terminated' where id=$1", [contract]);
  await receipt(null, "lease_rent", contract, 211);
  for (const [buildingId, unitId, amount, paid, management, status] of [
    [f.building, other.unit, 100, 10, "managed", "partial"],
    [other.building, f.unit, 900, 0, "managed", "pending"],
    [null, f.unit, 70, 20, "managed", "partial"],
    [f.building, f.unit, 40, 40, "historical_pending", "paid"],
    [f.building, f.unit, 40, 50, "managed", "paid"],
    [f.building, f.unit, 80, 0, "managed", "cancelled"],
  ])
    await db.query(
      "insert into receivables(building_id,unit_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,management_status,status) values($1,$2,'manual','other','Scope reference',current_date,$3,$4,$5,$6)",
      [buildingId, unitId, amount, paid, management, status],
    );
  const manual = await receipt(f.unit, "manual", null, 60),
    ledger = randomUUID();
  await db.query(
    "insert into ledger_entries(id,building_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,$3,current_date,'liability_in','other',60)",
    [ledger, other.building, manual],
  );
  await db.query("update payments set source_id=$1 where id=$2", [ledger, manual]);
  await db.query("set role authenticated");
  try {
    for (const id of [f.project, other.project]) {
      const result = (
        await db.query(
          "select public.management_operating_snapshot_rpc($1) actual,public.management_operating_snapshot_reference_rpc($1) expected",
          [id],
        )
      ).rows[0];
      expect(result.actual).toEqual({ ...result.expected, nativeSummary: [] });
      if (id === f.project) {
        expect(result.actual.netCollected).toBe(211);
        expect(result.actual.dueOutstanding).toBe(140);
        expect(result.actual.historicalPending).toBe(0);
        expect(result.actual.leaseCount).toBe(0);
        expect(result.actual.excludedCount).toBe(0);
      }
    }
  } finally {
    await db.query("reset role");
  }
});
