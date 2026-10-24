import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { parseCimacMaintenance } from "../src/features/business-actions/cimac-maintenance";
import { verifyCimacMaintenanceResult } from "../src/features/business-actions/cimac-maintenance-verification";

type Json = Record<string, unknown>;
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
let project: string, building: string;
const actor = randomUUID();
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const applied = await installApplicationRebuild(db);
  const migration = await readFile(
    "supabase/migrations/20261024204811_cimac_preopening_controlled_maintenance.sql",
    "utf8",
  );
  try {
    if (!applied.includes("20261024204811_cimac_preopening_controlled_maintenance.sql"))
      await db.query(migration);
  } catch (error) {
    const details = error as {
      position?: string;
      internalPosition?: string;
      internalQuery?: string;
      where?: string;
    };
    console.error({
      ...details,
      context: migration.slice(Number(details.position) - 120, Number(details.position) + 120),
    });
    throw error;
  }
  await db.query("insert into auth.users(id,email) values($1,'cimac-maintenance@test.invalid')", [
    actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic maintenance')",
    [actor],
  );
  project = (
    await db.query(
      "insert into projects(code,display_name,allows_long_lease) values('CIMAC','Synthetic CIMAC',true) returning id",
    )
  ).rows[0].id;
  building = (
    await db.query(
      "insert into buildings(project_id,code,display_name) values($1,'CIMAC-B17','Synthetic') returning id",
      [project],
    )
  ).rows[0].id;
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function owner(sql: string, args: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, args);
}
async function login(id = actor, client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
}
let serial = 300;
async function seed(
  options: {
    name?: string;
    no?: string;
    note?: string;
    fx?: string;
    amount?: string;
    otherProject?: boolean;
  } = {},
) {
  const no = options.no ?? String(++serial),
    name = options.name ?? `Synthetic ${randomUUID()}`;
  const uid = randomUUID(),
    cid = randomUUID(),
    customer = randomUUID();
  let bid = building;
  if (options.otherProject) {
    const p = (
      await owner("insert into projects(code,display_name) values($1,'Other') returning id", [
        randomUUID(),
      ])
    ).rows[0].id;
    bid = (
      await db.query(
        "insert into buildings(project_id,code,display_name) values($1,$2,'Other') returning id",
        [p, randomUUID()],
      )
    ).rows[0].id;
  }
  await owner(
    "insert into units(id,building_id,code,unit_no,floor_label,status,kind,asset_subtype,area_sqm,reservation_holder_name) values($1::uuid,$2,$1::text,$3,'G','reserved','storefront','commercial_shop',64,$4)",
    [uid, bid, no, name],
  );
  await db.query("insert into customers(id,name) values($1,$2)", [customer, name]);
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,deposit_months,status,commencement_state,signing_state,expected_end_confirmed,source_reference) values($1::uuid,$2,$3,$1::text,'annual',5,1000000,3000000,3,'draft','pending_project_opening','pending_confirmation',false,$4)",
    [cid, uid, customer, options.note ?? "Synthetic latest policy"],
  );
  await db.query(
    "insert into property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date) values($1,57600,'2027-04-01','2028-03-31')",
    [uid],
  );
  let payment: string | undefined;
  if (options.amount) {
    payment = (
      await db.query(
        "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,$2,'lease_deposit',$3,'2025-09-26',$4,'CNY',$5,'bank_transfer') returning id",
        [customer, uid, cid, options.amount, options.fx ?? "79.5"],
      )
    ).rows[0].id;
    await db.query(
      "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,$3,'2025-09-26','liability_in','lease_deposit',$4::numeric*$5::numeric)",
      [bid, uid, payment, options.amount, options.fx ?? "79.5"],
    );
  }
  return { uid, cid, customer, no, name, payment };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
function request(operations: Json[], extra: Json = {}) {
  return {
    protocolVersion: "1.0",
    connectorVersion: "0.8.0",
    requestId: randomUUID(),
    originalInstruction: "Explicit synthetic CIMAC reconciliation",
    inputSource: "excel_screenshot",
    operations,
    ...extra,
  };
}
function terms(f: Fixture): Json {
  return {
    type: "terms",
    contractIds: [f.cid],
    customerName: f.name,
    monthlyRentXof: "1800000",
    depositXof: "5400000",
    freeMonths: 12,
    rentFreeStart: "2027-04-01",
    rentFreeEnd: "2028-03-31",
    propertyRateXofPerSqm: "900",
    annotation: "Synthetic confirmed terms",
  };
}
function refund(f: Fixture, amount = "75000.00"): Json {
  return {
    amount,
    currency: "CNY",
    paymentDate: "2026-10-20",
    paymentMethod: "bank_transfer",
    originalPaymentIds: [f.payment],
  };
}
async function preview(r: Json, client = db) {
  await login(actor, client);
  return (await client.query("select preview_cimac_maintenance($1) value", [r])).rows[0].value;
}
async function execute(r: Json, snapshot: Json, client = db, expires?: string) {
  await login(actor, client);
  const result = (
    await client.query(
      "select execute_cimac_maintenance($1,$2,coalesce($3::timestamptz,clock_timestamp()+interval '5 minutes'),'synthetic-maintenance-deployment') value",
      [r, snapshot, expires ?? null],
    )
  ).rows[0].value;
  if (result.status === "completed_previously") {
    expect(result.verified).toBe(false);
    expect(result.request).toEqual(parseCimacMaintenance(r));
    expect(result.actorId).toBe(actor);
  } else expect(verifyCimacMaintenanceResult(result, parseCimacMaintenance(r), actor)).toBe(true);
  return result;
}

it("exposes only the strict authenticated admin RPC surface and private default-deny journals", async () => {
  const f = await seed();
  const r = request([terms(f)]);
  const finance = randomUUID();
  await owner("insert into auth.users(id,email) values($1::uuid,$1::text||'@test.invalid')", [
    finance,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'finance','Not admin')",
    [finance],
  );
  await login(finance);
  await expect(db.query("select preview_cimac_maintenance($1)", [r])).rejects.toThrow(
    "cimacMaintenanceForbidden",
  );
  await expect(db.query("select * from private.cimac_maintenance_requests")).rejects.toThrow();
  const acl = (
    await owner(
      "select has_function_privilege('anon','public.execute_cimac_maintenance(jsonb,jsonb,timestamptz,text)','execute') anon,has_function_privilege('service_role','public.execute_cimac_maintenance(jsonb,jsonb,timestamptz,text)','execute') service",
    )
  ).rows[0];
  expect(acl).toEqual({ anon: false, service: false });
  expect(
    (
      await owner(
        "select relrowsecurity from pg_class where oid='private.cimac_maintenance_requests'::regclass",
      )
    ).rows[0].relrowsecurity,
  ).toBe(true);
});
it("rejects foreign projects, unknown keys, numeric money, excluded 231 and unsigned source conflicts", async () => {
  const f = await seed();
  for (const op of [
    { ...terms(f), table: "payments" },
    { ...terms(f), monthlyRentXof: 1800000 },
    { ...terms(f), customerName: "Wrong" },
  ])
    await expect(preview(request([op]))).rejects.toThrow();
  const foreign = await seed({ otherProject: true });
  await expect(preview(request([terms(foreign)]))).rejects.toThrow("cimacMaintenanceScopeConflict");
  const excluded = await seed({ no: "231" });
  await expect(preview(request([terms(excluded)]))).rejects.toThrow(
    "cimacMaintenanceScopeConflict",
  );
  await owner(
    "update lease_contracts set status='active',commencement_state='started',start_date='2026-01-01',expected_end_date='2027-01-01' where id=$1",
    [f.cid],
  );
  await expect(preview(request([terms(f)]))).rejects.toThrow("cimacMaintenanceScopeConflict");
});
it("changes confirmed terms without creating receipts, schedules, start dates or receivables", async () => {
  const f = await seed();
  const r = request([terms(f)]);
  const p = await preview(r);
  const result = await execute(r, p.snapshot);
  expect(result.reconciliation).toMatchObject({
    paymentCount: 0,
    ledgerCount: 0,
    receivablesCreated: 0,
    originalPaymentsPreserved: true,
  });
  expect(
    (
      await owner(
        "select monthly_rent_xof::text,deposit_amount_xof::text,free_months,start_date,actual_end_date,status from lease_contracts where id=$1",
        [f.cid],
      )
    ).rows[0],
  ).toEqual({
    monthly_rent_xof: "1800000.00",
    deposit_amount_xof: "5400000.00",
    free_months: 12,
    start_date: null,
    actual_end_date: null,
    status: "draft",
  });
  expect(
    (await owner("select count(*)::int n from receivables where unit_id=$1", [f.uid])).rows[0].n,
  ).toBe(0);
  expect((await execute(r, p.snapshot)).idempotent).toBe(true);
  await expect(execute({ ...r, originalInstruction: "Different" }, p.snapshot)).rejects.toThrow(
    "cimacMaintenanceRequestIdConflict",
  );
  await login();
  expect(
    (await db.query("select find_cimac_maintenance($1) value", [r.requestId])).rows[0].value
      .requestId,
  ).toBe(r.requestId);
});
it("reverses a converted historical CNY deposit with the same FX, preserves receipt and never uses refund date as end date", async () => {
  const f = await seed({ amount: "75000", fx: "79.2" });
  const r = request([
    {
      type: "close",
      contractIds: [f.cid],
      customerName: f.name,
      refund: refund(f),
      annotation: "Synthetic full actual transfer refund",
    },
  ]);
  const original = (await owner("select to_jsonb(p) doc from payments p where id=$1", [f.payment]))
    .rows[0].doc;
  const result = await execute(r, (await preview(r)).snapshot);
  expect(result.payments[0]).toMatchObject({
    amount: "75000.00",
    currency: "CNY",
    exchangeRateToXof: "79.200000",
    nativeSettlement: false,
    ledgerAmountXof: "5940000.00",
    ledgerDirection: "liability_out",
  });
  expect(
    (await owner("select to_jsonb(p) doc from payments p where id=$1", [f.payment])).rows[0].doc,
  ).toEqual(original);
  expect(
    (
      await owner("select status,actual_end_date,start_date from lease_contracts where id=$1", [
        f.cid,
      ])
    ).rows[0],
  ).toEqual({ status: "terminated", actual_end_date: null, start_date: null });
  expect(
    (await owner("select status,reservation_holder_name from units where id=$1", [f.uid])).rows[0],
  ).toEqual({ status: "available", reservation_holder_name: null });
  expect((await owner("select notes from units where id=$1", [f.uid])).rows[0].notes).toMatch(
    /^最新核对：.*2026-10-20转账退还/,
  );
});
it("formalizes original note receipt once and refunds it in native CNY, with rename and no invented FX", async () => {
  const note = "2026-09-25已收部分押金人民币50000元";
  const f = await seed({ note });
  const r = request([
    {
      type: "close",
      contractIds: [f.cid],
      customerName: f.name,
      correctedCustomerName: `栗 ${randomUUID()}`,
      noteReceipt: {
        contractId: f.cid,
        amount: "50000.00",
        currency: "CNY",
        paymentDate: "2026-09-25",
        paymentMethod: "bank_transfer",
        noteMarker: note,
      },
      refund: {
        amount: "50000.00",
        currency: "CNY",
        paymentDate: "2026-10-05",
        paymentMethod: "bank_transfer",
        originalPaymentIds: [],
      },
      annotation: "Synthetic note formalization and actual refund",
    },
  ]);
  const result = await execute(r, (await preview(r)).snapshot);
  expect(result.paymentIds).toHaveLength(2);
  expect(
    result.payments.every(
      (p: Json) =>
        p.nativeSettlement === true &&
        p.exchangeRateToXof === null &&
        p.ledgerAmountXof === "0.00" &&
        p.ledgerCurrency === "CNY" &&
        p.ledgerAmountNative === "50000.00",
    ),
  ).toBe(true);
  expect(
    (
      await owner(
        "select sum(case when direction='liability_in' then amount_native else -amount_native end)::text balance from ledger_entries where unit_id=$1",
        [f.uid],
      )
    ).rows[0].balance,
  ).toBe("0.00");
  expect((await execute(r, {})).idempotent).toBe(true);
});
it("keeps replacement customer and receipt independent from refunded historical customer", async () => {
  const f = await seed({ amount: "100000", fx: "79.5" });
  const newName = `New customer ${randomUUID()}`;
  const r = request([
    {
      type: "replace",
      contractIds: [f.cid],
      customerName: f.name,
      refund: { ...refund(f, "100000.00"), paymentDate: "2026-10-19" },
      newCustomerName: newName,
      monthlyRentXof: "980000",
      depositXof: "2940000",
      receipt: {
        amount: "2940000",
        currency: "XOF",
        paymentDate: "2026-10-19",
        paymentMethod: "cash",
      },
      annotation: "Synthetic replacement",
    },
  ]);
  const result = await execute(r, (await preview(r)).snapshot);
  const next = result.operationResults[0].contractIds[1];
  expect(result.payments).toHaveLength(2);
  expect(
    (await owner("select customer_id from lease_contracts where id=$1", [next])).rows[0]
      .customer_id,
  ).not.toBe(f.customer);
  expect(
    (await owner("select customer_id,source_id from payments where id=$1", [f.payment])).rows[0],
  ).toEqual({ customer_id: f.customer, source_id: f.cid });
  expect(
    (await owner("select amount::text,currency from payments where source_id=$1", [next])).rows,
  ).toEqual([{ amount: "2940000.00", currency: "XOF" }]);
  const unitNote = (await owner("select notes from units where id=$1", [f.uid])).rows[0].notes;
  expect(unitNote).toContain(`最新预留：${newName}`);
  expect(unitNote).toContain("2940000 XOF，已于2026-10-19现金收取");
});
it("rejects stale snapshots, expiration, global payment request reuse and rolls back an entire multi-operation batch", async () => {
  const a = await seed(),
    b = await seed({ amount: "75000" });
  const r = request([terms(a)]);
  const p = await preview(r);
  await owner("update units set area_sqm=65 where id=$1", [a.uid]);
  await expect(execute(r, p.snapshot)).rejects.toThrow("cimacMaintenanceSnapshotChanged");
  await expect(execute(r, (await preview(r)).snapshot, db, "2020-01-01T00:00:00Z")).rejects.toThrow(
    "cimacMaintenanceExpired",
  );
  await owner("update payments set request_id=$1 where id=$2", [r.requestId, b.payment]);
  await expect(execute(r, (await preview(r)).snapshot)).rejects.toThrow(
    "cimacMaintenanceRequestIdConflict",
  );
  const failed = request([
    terms(a),
    {
      type: "close",
      contractIds: [b.cid],
      customerName: b.name,
      refund: refund(b, "74000.00"),
      annotation: "Wrong full refund",
    },
  ]);
  await expect(execute(failed, (await preview(failed)).snapshot)).rejects.toThrow(
    "cimacMaintenanceRefundConflict",
  );
  expect(
    (await owner("select monthly_rent_xof::text from lease_contracts where id=$1", [a.cid])).rows[0]
      .monthly_rent_xof,
  ).toBe("1000000.00");
  expect(
    (
      await owner(
        "select count(*)::int n from private.cimac_maintenance_requests where request_id=$1",
        [failed.requestId],
      )
    ).rows[0].n,
  ).toBe(0);
});
it("serializes identical concurrent retries to one receipt and one ledger", async () => {
  const note = "2026-09-19已收部分押金人民币2000元";
  const f = await seed({ note });
  const r = request([
    {
      type: "note_receipt",
      contractIds: [f.cid],
      customerName: f.name,
      receipt: {
        contractId: f.cid,
        amount: "2000.00",
        currency: "CNY",
        paymentDate: "2026-09-19",
        paymentMethod: "bank_transfer",
        noteMarker: note,
      },
      annotation: "Synthetic historical note",
    },
  ]);
  const p = await preview(r),
    second = await cluster.connect();
  const values = await Promise.all([execute(r, p.snapshot), execute(r, p.snapshot, second)]);
  expect(values.map((v) => v.idempotent).sort()).toEqual([false, true]);
  expect(values[0].paymentIds).toEqual(values[1].paymentIds);
  expect(
    (await owner("select count(*)::int n from payments where source_id=$1", [f.cid])).rows[0].n,
  ).toBe(1);
  await expect(
    execute(
      request(r.operations as Json[]),
      (await preview(request(r.operations as Json[]))).snapshot,
    ),
  ).rejects.toThrow();
});
it("reserves a grouped holding without unconfirmed allocation and creates an unsigned physical unit without payments", async () => {
  const f = await seed();
  await owner("delete from property_fee_rules where unit_id=$1", [f.uid]);
  await db.query("delete from lease_contracts where id=$1", [f.cid]);
  const r = request([
    {
      type: "reserve",
      unitNos: [f.no],
      customerName: f.name,
      groupMonthlyRentXof: "2920000",
      groupDepositXof: "8760000",
      annotation: "Synthetic grouped holding",
    },
    {
      type: "create_reservation",
      buildingCode: "CIMAC-B17",
      unitNo: "1703",
      customerName: `Confirmed ${randomUUID()}`,
      areaSqm: "57.75",
      monthlyRentXof: "650000",
      depositXof: "1950000",
      propertyRateXofPerSqm: "900",
      annotation: "Synthetic confirmed physical shop",
    },
  ]);
  const result = await execute(r, (await preview(r)).snapshot);
  expect(result.paymentIds).toEqual([]);
  expect(result.operationResults[0].contractIds).toEqual([]);
  const created = result.operationResults[1];
  expect(
    (
      await owner(
        "select status,start_date,expected_end_date,signing_state,deposit_received from lease_contracts where id=$1",
        [created.contractIds[0]],
      )
    ).rows[0],
  ).toEqual({
    status: "draft",
    start_date: null,
    expected_end_date: null,
    signing_state: "pending_confirmation",
    deposit_received: false,
  });
  expect(
    (
      await owner("select monthly_amount_xof::text from property_fee_rules where unit_id=$1", [
        created.unitIds[0],
      ])
    ).rows[0].monthly_amount_xof,
  ).toBe("51975.00");
});
it("cannot forge a native maintenance payment through legacy table grants", async () => {
  const f = await seed();
  await login();
  await expect(
    db.query(
      "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,native_settlement,request_kind) values($1,$2,'lease_deposit',$3,'2026-09-19',2000,'CNY',null,true,'cimac_maintenance')",
      [f.customer, f.uid, f.cid],
    ),
  ).rejects.toThrow("cimacMaintenancePaymentNotAuthorized");
});
it("handles one real group receipt/refund across six shops, not six fictitious receipts", async () => {
  const note = "2026-09-25已收部分押金人民币50000元（本组总额）";
  const f = await seed({ note });
  const group = [f];
  for (let i = 0; i < 5; i++) {
    const next = await seed({ name: f.name, note });
    await owner("update lease_contracts set customer_id=$1 where id=$2", [f.customer, next.cid]);
    group.push(next);
  }
  const ids = group.map((row) => row.cid);
  await owner("update lease_contracts set agreement_group_no=$1 where id=any($2::uuid[])", [
    `Synthetic group ${randomUUID()}`,
    ids,
  ]);
  const op = {
    type: "close",
    contractIds: ids,
    customerName: f.name,
    correctedCustomerName: `栗 ${randomUUID()}`,
    noteReceipt: {
      contractId: f.cid,
      amount: "50000.00",
      currency: "CNY",
      paymentDate: "2026-09-25",
      paymentMethod: "bank_transfer",
      noteMarker: note,
    },
    refund: {
      amount: "50000.00",
      currency: "CNY",
      paymentDate: "2026-10-05",
      paymentMethod: "bank_transfer",
      originalPaymentIds: [],
    },
    annotation: "Synthetic six-shop full closure",
  };
  const partial = request([{ ...op, contractIds: ids.slice(0, 5) }]);
  await expect(preview(partial)).rejects.toThrow("cimacMaintenanceScopeConflict");
  const r = request([op]);
  const result = await execute(r, (await preview(r)).snapshot);
  expect(result.paymentIds).toHaveLength(2);
  expect(
    (
      await owner(
        "select count(*)::int n from lease_contracts where id=any($1::uuid[]) and status='terminated' and actual_end_date is null",
        [ids],
      )
    ).rows[0].n,
  ).toBe(6);
  expect(
    (
      await owner(
        "select count(*)::int n from units where id=any($1::uuid[]) and status='available'",
        [group.map((row) => row.uid)],
      )
    ).rows[0].n,
  ).toBe(6);
});
it("corrects 57.75-square-meter fee arithmetic and preserves deferred/excluded rows byte-for-byte", async () => {
  const f = await seed();
  const excluded = (await owner("select to_jsonb(u) doc from units u where unit_no='231'")).rows[0]
    .doc;
  const warehouse = (
    await owner(
      "insert into units(building_id,code,unit_no,floor_label,status,asset_subtype,area_sqm) values($1,$2,'仓库（编号待定）','G','reserved','warehouse',513) returning to_jsonb(units) doc",
      [building, randomUUID()],
    )
  ).rows[0].doc;
  const r = request([
    {
      type: "area",
      unitNo: f.no,
      customerName: f.name,
      areaSqm: "57.75",
      propertyRateXofPerSqm: "900",
      annotation: "Synthetic confirmed area",
    },
  ]);
  const result = await execute(r, (await preview(r)).snapshot);
  expect(result.paymentIds).toEqual([]);
  expect(
    (
      await owner(
        "select monthly_amount_xof::text,(monthly_amount_xof*12)::text annual from property_fee_rules where unit_id=$1",
        [f.uid],
      )
    ).rows[0],
  ).toEqual({ monthly_amount_xof: "51975.00", annual: "623700.00" });
  const latestAreaNote = (await owner("select notes from units where id=$1", [f.uid])).rows[0]
    .notes;
  expect(latestAreaNote).toMatch(/^最新核对：/);
  expect(latestAreaNote).toContain("57.75㎡");
  expect(latestAreaNote).toContain("623700.00 XOF/年");
  expect(
    (await owner("select to_jsonb(u) doc from units u where unit_no='231'")).rows[0].doc,
  ).toEqual(excluded);
  expect(
    (await owner("select to_jsonb(u) doc from units u where id=$1", [warehouse.id])).rows[0].doc,
  ).toEqual(warehouse);
});
it("allows only one distinct request to win a concurrently shared pre-change snapshot", async () => {
  const f = await seed(),
    left = request([terms(f)]),
    right = request([terms(f)]);
  const lp = await preview(left),
    rp = await preview(right),
    second = await cluster.connect();
  const settled = await Promise.allSettled([
    execute(left, lp.snapshot),
    execute(right, rp.snapshot, second),
  ]);
  expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const failure = settled.find((result) => result.status === "rejected") as PromiseRejectedResult;
  expect(failure.reason.message).toContain("cimacMaintenanceSnapshotChanged");
});
it("checks existing financial evidence and refuses a second native receipt under a new request identity", async () => {
  const f = await seed({ amount: "75000" });
  await owner("update ledger_entries set amount_xof=amount_xof-1 where payment_id=$1", [f.payment]);
  const r = request([
    {
      type: "close",
      contractIds: [f.cid],
      customerName: f.name,
      refund: refund(f),
      annotation: "Synthetic requires consistent original ledger",
    },
  ]);
  await expect(execute(r, (await preview(r)).snapshot)).rejects.toThrow(
    "cimacMaintenanceRefundLedgerConflict",
  );
  const note = "2026-09-19已收部分押金人民币2000元";
  const n = await seed({ note });
  const op = {
    type: "note_receipt",
    contractIds: [n.cid],
    customerName: n.name,
    receipt: {
      contractId: n.cid,
      amount: "2000.00",
      currency: "CNY",
      paymentDate: "2026-09-19",
      paymentMethod: "bank_transfer",
      noteMarker: note,
    },
    annotation: "Synthetic once-only source registration",
  };
  const first = request([op]);
  await execute(first, (await preview(first)).snapshot);
  const duplicate = request([op]);
  await expect(execute(duplicate, (await preview(duplicate)).snapshot)).rejects.toThrow(
    "cimacMaintenanceNoteReceiptConflict",
  );
  expect(
    (await owner("select count(*)::int n from payments where source_id=$1", [n.cid])).rows[0].n,
  ).toBe(1);
});
it("closes only the CIMAC agreement while preserving the same customer's unrelated apartment lease", async () => {
  const f = await seed({ amount: "75000", fx: "79.2" });
  const apartment = await seed({ otherProject: true });
  await owner(
    "update lease_contracts set customer_id=$1,status='active',commencement_state='started',start_date='2026-01-01',expected_end_date='2027-01-01' where id=$2",
    [f.customer, apartment.cid],
  );
  const before = (
    await owner("select to_jsonb(c) doc from lease_contracts c where id=$1", [apartment.cid])
  ).rows[0].doc;
  const r = request([
    {
      type: "close",
      contractIds: [f.cid],
      customerName: f.name,
      refund: refund(f),
      annotation: "Synthetic CIMAC-only closure",
    },
  ]);
  await execute(r, (await preview(r)).snapshot);
  expect(
    (await owner("select to_jsonb(c) doc from lease_contracts c where id=$1", [apartment.cid]))
      .rows[0].doc,
  ).toEqual(before);
});
it("requires the exact dated original-currency amount token in note evidence, not digit substrings", async () => {
  const note = "2026-09-19已收部分押金人民币2000元（本组总额）";
  const f = await seed({ note: `Original source 2026 policy; ${note}; no FX confirmed` });
  const receipt = {
    contractId: f.cid,
    amount: "2000.00",
    currency: "CNY",
    paymentDate: "2026-09-19",
    paymentMethod: "bank_transfer",
    noteMarker: note,
  };
  for (const wrong of [
    { amount: "2.00" },
    { amount: "20.00" },
    { amount: "200.00" },
    { paymentDate: "2026-09-18" },
  ]) {
    const r = request([
      {
        type: "note_receipt",
        contractIds: [f.cid],
        customerName: f.name,
        receipt: { ...receipt, ...wrong },
        annotation: "Synthetic amount token guard",
      },
    ]);
    await expect(execute(r, (await preview(r)).snapshot)).rejects.toThrow(
      "cimacMaintenanceNoteReceiptConflict",
    );
  }
  expect(
    (await owner("select count(*)::int n from payments where source_id=$1", [f.cid])).rows[0].n,
  ).toBe(0);
});
it("shows native CNY deposits/refunds as liabilities, never rent income or XOF cash, and preserves management ACL", async () => {
  const day = (
    await owner(
      "select to_char(statement_timestamp() at time zone 'Africa/Abidjan','YYYY-MM-DD') receipt_day",
    )
  ).rows[0].receipt_day;
  const before = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  const beforeCny = before.nativeSummary.find((row: Json) => row.currency === "CNY") ?? {
    income: 0,
    liability_in: 0,
    liability_out: 0,
  };
  const note = `${day}已收部分押金人民币50000元（本组总额）`;
  const f = await seed({ note });
  const r = request([
    {
      type: "close",
      contractIds: [f.cid],
      customerName: f.name,
      noteReceipt: {
        contractId: f.cid,
        amount: "50000.00",
        currency: "CNY",
        paymentDate: day,
        paymentMethod: "bank_transfer",
        noteMarker: note,
      },
      refund: {
        amount: "50000.00",
        currency: "CNY",
        paymentDate: day,
        paymentMethod: "bank_transfer",
        originalPaymentIds: [],
      },
      annotation: "Synthetic native liability projection",
    },
  ]);
  await execute(r, (await preview(r)).snapshot);
  await login();
  const after = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  const cny = after.nativeSummary.find((row: Json) => row.currency === "CNY");
  expect(cny.income).toBe(beforeCny.income);
  expect(cny.liability_in).toBe(beforeCny.liability_in + 50000);
  expect(cny.liability_out).toBe(beforeCny.liability_out + 50000);
  expect(after.netCollected).toBe(before.netCollected);
  expect(after.businessNet).toEqual(before.businessNet);
  expect(
    (
      await owner(
        "select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.management_operating_snapshot_rpc(uuid)'::regprocedure",
      )
    ).rows[0],
  ).toEqual({ prosecdef: false, proconfig: ['search_path=""'], anon: false, service: false });
  await login();
  const ledger = (
    await db.query("select finance_read_rpc('ledger',$1,1,true) value", [{ projectId: project }])
  ).rows[0].value;
  expect(
    ledger.nativeSummary.some(
      (row: Json) =>
        row.currency === "CNY" &&
        Number(row.liability_in) >= 50000 &&
        Number(row.liability_out) >= 50000,
    ),
  ).toBe(true);
});
it("makes posted maintenance payment and ledger evidence immutable through authenticated legacy DML", async () => {
  const note = "2026-09-19已收部分押金人民币2000元（本组总额）";
  const f = await seed({ note });
  const r = request([
    {
      type: "note_receipt",
      contractIds: [f.cid],
      customerName: f.name,
      receipt: {
        contractId: f.cid,
        amount: "2000.00",
        currency: "CNY",
        paymentDate: "2026-09-19",
        paymentMethod: "bank_transfer",
        noteMarker: note,
      },
      annotation: "Synthetic immutable original currency proof",
    },
  ]);
  const result = await execute(r, (await preview(r)).snapshot),
    pid = result.paymentIds[0];
  await login();
  await expect(
    db.query(
      "update payments set native_settlement=false,request_kind=null,exchange_rate_to_xof=1 where id=$1",
      [pid],
    ),
  ).rejects.toThrow("cimacMaintenancePaymentImmutable");
  await expect(db.query("delete from payments where id=$1", [pid])).rejects.toThrow(
    "cimacMaintenancePaymentImmutable",
  );
  await expect(
    db.query(
      "update ledger_entries set currency='XOF',amount_native=null,amount_xof=2000 where payment_id=$1",
      [pid],
    ),
  ).rejects.toThrow("cimacMaintenanceLedgerImmutable");
  await expect(db.query("delete from ledger_entries where payment_id=$1", [pid])).rejects.toThrow(
    "cimacMaintenanceLedgerImmutable",
  );
  await expect(
    db.query(
      "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,amount_native) values($1,$2,$3,'2026-09-19','liability_in','lease_deposit',0,'CNY',2000)",
      [building, f.uid, pid],
    ),
  ).rejects.toThrow("cimacMaintenanceLedgerNotAuthorized");
});
it("reserves even a no-payment batch UUID against subsequent legacy payment writers", async () => {
  const f = await seed(),
    r = request([terms(f)]);
  await execute(r, (await preview(r)).snapshot);
  const foreign = await seed({ otherProject: true });
  await owner(
    "update lease_contracts set status='active',commencement_state='started',start_date='2026-01-01',expected_end_date='2027-12-31' where id=$1",
    [foreign.cid],
  );
  await login();
  await expect(
    db.query(
      "select record_lease_financial_entry_v2_rpc($1,'deposit_income','2026-10-24',100,'XOF',1,null,'cash','Synthetic conflicting legacy writer',null,$2)",
      [foreign.cid, r.requestId],
    ),
  ).rejects.toThrow("cimacMaintenanceRequestIdConflict");
  expect(
    (await owner("select count(*)::int n from payments where source_id=$1", [foreign.cid])).rows[0]
      .n,
  ).toBe(0);
});
it("retains existing native USD rent income alongside native CNY liability reporting", async () => {
  const f = await seed();
  const day = (
    await owner(
      "select to_char(statement_timestamp() at time zone 'Africa/Abidjan','YYYY-MM-DD') receipt_day",
    )
  ).rows[0].receipt_day;
  await owner(
    "update lease_contracts set status='active',commencement_state='started',start_date=$2::date-1,expected_end_date=$2::date+365,paid_through_date=$2::date-1,rent_currency='USD',monthly_rent_amount=10,monthly_rent_xof=0 where id=$1",
    [f.cid, day],
  );
  await db.query("update units set status='leased' where id=$1", [f.uid]);
  await db.query(
    "insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,amount_native,paid_amount_native,status,service_period_start,service_period_end,service_period_source) values($1,$2,$3,'lease_contract',$4,'lease_rent','Synthetic native USD period',$5,0,0,'USD',10,0,'pending',$5,$5,'Synthetic explicit period')",
    [building, f.uid, f.customer, f.cid, day],
  );
  await login();
  const before = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  await db.query(
    "select record_native_lease_rent_rpc($1,$2,10,'USD',$2,'bank_transfer','Synthetic native USD',null,$3)",
    [f.cid, day, randomUUID()],
  );
  const after = (await db.query("select management_operating_snapshot_rpc($1) value", [project]))
    .rows[0].value;
  expect(after.nativeSummary.find((row: Json) => row.currency === "USD")).toMatchObject({
    income: 10,
    liability_in: 0,
    liability_out: 0,
  });
  expect(after.nativeSummary.find((row: Json) => row.currency === "CNY")).toEqual(
    before.nativeSummary.find((row: Json) => row.currency === "CNY"),
  );
  expect(after.netCollected).toBe(before.netCollected);
});
it("reconciles the stale unpaid-deposit flag after lowering seven individual requirements to existing receipts", async () => {
  const group: Fixture[] = [];
  for (let i = 0; i < 7; i++) {
    const f = await seed();
    group.push(f);
    await owner(
      "update lease_contracts set monthly_rent_xof=1870000,deposit_amount_xof=5610000,deposit_received=false where id=$1",
      [f.cid],
    );
    await db.query("update units set notes='当前预留：旧计算尚需补押金1470000 XOF' where id=$1", [
      f.uid,
    ]);
    const pid = (
      await db.query(
        "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof) values($1,$2,'lease_deposit',$3,'2026-09-01',5400000,'XOF',1) returning id",
        [f.customer, f.uid, f.cid],
      )
    ).rows[0].id;
    await db.query(
      "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,$3,'2026-09-01','liability_in','lease_deposit',5400000)",
      [building, f.uid, pid],
    );
  }
  const r = request(group.map(terms));
  const countBefore = (await owner("select count(*)::int n from payments")).rows[0].n;
  const result = await execute(r, (await preview(r)).snapshot);
  expect(result.paymentIds).toEqual([]);
  expect((await owner("select count(*)::int n from payments")).rows[0].n).toBe(countBefore);
  expect(
    (
      await owner(
        "select count(*)::int n from lease_contracts where id=any($1::uuid[]) and deposit_received and deposit_amount_xof=5400000",
        [group.map((f) => f.cid)],
      )
    ).rows[0].n,
  ).toBe(7);
  const notes = (
    await owner("select notes from units where id=any($1::uuid[])", [group.map((f) => f.uid)])
  ).rows.map((row) => row.notes as string);
  expect(
    notes.every(
      (note) =>
        note.startsWith("最新核对：") &&
        /尚需补押金0(?:\.00)? XOF/.test(note) &&
        note.includes("历史原注") &&
        note.includes("1470000 XOF"),
    ),
  ).toBe(true);
});
it("configures both reserved shops' confirmed area fees without allocating group rent or recording payment", async () => {
  const one = await seed(),
    two = await seed({ name: one.name });
  for (const f of [one, two]) {
    await owner("delete from property_fee_rules where unit_id=$1", [f.uid]);
    await db.query("delete from lease_contracts where id=$1", [f.cid]);
  }
  await owner("update units set area_sqm=110 where id=$1", [one.uid]);
  const r = request([
    {
      type: "reserve",
      unitNos: [one.no, two.no],
      customerName: one.name,
      groupMonthlyRentXof: "2920000",
      groupDepositXof: "8760000",
      annotation: "Synthetic two-shop area fee policy",
    },
  ]);
  const result = await execute(r, (await preview(r)).snapshot);
  expect(result.paymentIds).toEqual([]);
  expect(result.operationResults[0].contractIds).toEqual([]);
  expect(
    (
      await owner(
        "select monthly_amount_xof::text value from property_fee_rules where unit_id=any($1::uuid[]) order by monthly_amount_xof",
        [[one.uid, two.uid]],
      )
    ).rows,
  ).toEqual([{ value: "57600.00" }, { value: "99000.00" }]);
});
it("blocks a concurrent legacy raw insert until the maintenance UUID reservation commits, then rejects reuse", async () => {
  const f = await seed(),
    foreign = await seed({ otherProject: true }),
    r = request([terms(f)]);
  const p = await preview(r),
    second = await cluster.connect();
  await login();
  await db.query("begin");
  try {
    await execute(r, p.snapshot);
    await login(actor, second);
    const secondPid = (await second.query("select pg_backend_pid() pid")).rows[0].pid;
    const attempt = second
      .query(
        "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,request_id) values($1,$2,'lease_deposit',$3,'2026-10-24',100,'XOF',1,$4)",
        [foreign.customer, foreign.uid, foreign.cid, r.requestId],
      )
      .then(
        () => ({ message: "unexpected success" }),
        (error: Error) => error,
      );
    let waiting = false;
    for (let i = 0; i < 50; i++) {
      const state = (
        await owner("select wait_event from pg_stat_activity where pid=$1", [secondPid])
      ).rows[0];
      if (state?.wait_event === "advisory") {
        waiting = true;
        break;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }
    expect(waiting).toBe(true);
    await db.query("commit");
    expect((await attempt).message).toContain("cimacMaintenanceRequestIdConflict");
    expect(
      (await owner("select count(*)::int n from payments where source_id=$1", [foreign.cid]))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await db.query("rollback");
  }
});
