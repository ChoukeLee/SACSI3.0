import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { parseCimacFinance } from "../src/features/business-actions/cimac-finance";
import { verifyCimacFinanceResult } from "../src/features/business-actions/cimac-finance-verification";

type Json = Record<string, any>;
const migrationName = "20261102192233_cimac_finance_completion.sql";
const scopeMigrationName = "20261102192937_cimac_finance_commercial_scope.sql";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;
const actor = randomUUID();
let project: string,
  building: string,
  apartmentBuilding: string,
  sequence = 600;
let definitionsBefore: Json[], definitionsAfter: Json[];

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const applied = await installApplicationRebuild(db, { beforeMigration: scopeMigrationName });
  if (!applied.includes(migrationName))
    await db.query(await readFile(`supabase/migrations/${migrationName}`, "utf8"));
  const definitionsSql =
    "select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl,p.prosecdef,p.proconfig,p.proowner,p.provolatile from pg_proc p where p.oid in ('private.cimac_finance_validate_scope(jsonb)'::regprocedure,'private.execute_cimac_finance(jsonb,jsonb,timestamptz,text)'::regprocedure) order by p.oid";
  definitionsBefore = (await db.query(definitionsSql)).rows;
  await db.query(await readFile(`supabase/migrations/${scopeMigrationName}`, "utf8"));
  definitionsAfter = (await db.query(definitionsSql)).rows;
  await db.query("insert into auth.users(id,email) values($1,'cimac-finance@test.invalid')", [
    actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic finance')",
    [actor],
  );
  project = (
    await db.query(
      "insert into projects(code,display_name,allows_long_lease) values('CIMAC','Synthetic',true) returning id",
    )
  ).rows[0].id;
  building = (
    await db.query(
      "insert into buildings(project_id,code,display_name) values($1,'CIMAC-B04','Synthetic') returning id",
      [project],
    )
  ).rows[0].id;
  apartmentBuilding = (
    await db.query(
      "insert into buildings(project_id,code,display_name) values($1,'CIMAC-B17','Synthetic B17 apartments') returning id",
      [project],
    )
  ).rows[0].id;
  for (const number of ["1701", "1702", "1703", "1704"])
    await db.query(
      "insert into units(building_id,code,unit_no,floor_label,status,kind,asset_subtype,area_sqm,notes) values($1,$2,$3,'G','reserved','storefront','apartment_ground_floor_shop',57.75,'Original B17 ground-floor shop')",
      [apartmentBuilding, "CIMAC-B17-" + number, number],
    );
  await login();
  const apartments = (
    await db.query("select cimac_apartments_initialize_rpc($1) value", [randomUUID()])
  ).rows[0].value;
  expect(apartments.roomCount).toBe(64);
}, 60000);
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
async function seed(
  opts: {
    available?: boolean;
    name?: string;
    no?: string;
    foreign?: boolean;
    amount?: string;
    kind?: string;
    fx?: string;
  } = {},
) {
  const uid = randomUUID(),
    cid = randomUUID(),
    customer = randomUUID(),
    no = opts.no ?? String(++sequence),
    name = opts.name ?? `Synthetic ${randomUUID()}`;
  let bid = building;
  if (opts.foreign) {
    const pid = (
      await owner("insert into projects(code,display_name) values($1,'Foreign') returning id", [
        randomUUID(),
      ])
    ).rows[0].id;
    bid = (
      await db.query(
        "insert into buildings(project_id,code,display_name) values($1,$2,'Foreign') returning id",
        [pid, randomUUID()],
      )
    ).rows[0].id;
  }
  await owner(
    "insert into units(id,building_id,code,unit_no,floor_label,status,kind,asset_subtype,area_sqm,reservation_holder_name,notes) values($1,$2,$3,$4,'G',$5,'storefront','commercial_shop',64,$6,'Original unit history')",
    [
      uid,
      bid,
      randomUUID(),
      no,
      opts.available ? "available" : "reserved",
      opts.available ? null : name,
    ],
  );
  if (!opts.available) {
    await db.query(
      "insert into customers(id,name,notes) values($1,$2,'Original customer history')",
      [customer, name],
    );
    await db.query(
      "insert into lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,deposit_months,status,commencement_state,signing_state,expected_end_confirmed,source_reference) values($1,$2,$3,$4,'annual',5,1000000,3000000,3,'draft','pending_project_opening','pending_confirmation',false,'Original contract history')",
      [cid, uid, customer, randomUUID()],
    );
    await db.query(
      "insert into property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,is_active) values($1,57600,'2027-04-01','2028-03-31',true)",
      [uid],
    );
  }
  let payment: string | undefined;
  if (opts.amount) {
    payment = (
      await db.query(
        "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,notes) values($1,$2,$3,$4,'2026-09-01',$5,'CNY',$6,null,'Original receipt evidence') returning id",
        [customer, uid, opts.kind ?? "lease_deposit", cid, opts.amount, opts.fx ?? "80"],
      )
    ).rows[0].id;
    await db.query(
      "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,amount_cny,description) values($1,$2,$3,'2026-09-01',$4,$5,round($6::numeric*$7::numeric,2),$6,'Original ledger evidence')",
      [
        bid,
        uid,
        payment,
        opts.kind === "lease_rent" ? "income" : "liability_in",
        opts.kind ?? "lease_deposit",
        opts.amount,
        opts.fx ?? "80",
      ],
    );
  }
  return { uid, cid, customer, no, name, payment };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
function request(operations: Json[]): Json {
  return {
    requestId: randomUUID(),
    protocolVersion: "1.0",
    connectorVersion: "0.9.0",
    originalInstruction: "Explicit synthetic reconciliation",
    inputSource: "excel_screenshot",
    operations,
  };
}
function receipt(amountXof: string): Json {
  return {
    amountXof,
    paymentDate: "2026-10-26",
    paymentMethod: "cash",
    sourceText: "Synthetic confirmed receipt",
    externalReceiptNo: `EXT-${randomUUID()}`,
  };
}
function collect(f: Fixture, amount = "1000000"): Json {
  return {
    type: "collect",
    customerId: f.customer,
    customerName: f.name,
    category: "lease_deposit",
    receipt: receipt(amount),
    parts: [{ contractId: f.cid, amountXof: amount }],
    annotation: "Confirmed deposit",
  };
}
function fresh(f: Fixture, name = `New ${randomUUID()}`, amount = "1000000"): Json {
  return {
    type: "new_deposit",
    customerName: name,
    receipt: receipt(amount),
    units: [{ unitNo: f.no, monthlyRentXof: "920000", depositXof: "2760000", amountXof: amount }],
    annotation: "Confirmed unsigned reservation",
  };
}
function reclassify(f: Fixture, from = "lease_deposit", amount = "35500.00"): Json {
  return {
    type: "reclassify",
    paymentId: f.payment,
    expectedSourceType: from,
    targetSourceType: from === "lease_deposit" ? "lease_rent" : "lease_deposit",
    amountCny: amount,
    annotation: "Confirmed category correction",
  };
}
function identity(f: Fixture): Json {
  return {
    type: "identity",
    customerId: f.customer,
    customerName: f.name,
    units: [{ unitNo: f.no, expectedHolderName: f.name }],
    managementNames: ["Manager one", "Manager two"],
    annotation: "Same shop, different managers",
  };
}
async function preview(r: Json, client = db) {
  await login(actor, client);
  return (await client.query("select preview_cimac_finance($1) value", [r])).rows[0].value;
}
async function execute(r: Json, snapshot: Json, client = db) {
  await login(actor, client);
  return (
    await client.query(
      "select execute_cimac_finance($1,$2,clock_timestamp()+interval '5 minutes','synthetic-deployment') value",
      [r, snapshot],
    )
  ).rows[0].value;
}
async function apply(r: Json) {
  const canonical = parseCimacFinance(r);
  const p = await preview(canonical),
    result = await execute(canonical, p.snapshot);
  expect(
    verifyCimacFinanceResult(result, canonical, actor),
    "HTTP verifier must accept actual PostgreSQL evidence",
  ).toBe(true);
  const connectorPath = new URL("../operator-connector/cimac-finance.mjs", import.meta.url).href;
  const connector = await import(/* @vite-ignore */ connectorPath);
  expect(connector.normalizeCimacFinanceRequest(r)).toEqual(canonical);
  expect(
    connector.verifyCimacFinanceResult(result, canonical, actor),
    "Connector verifier must accept actual PostgreSQL evidence",
  ).toBe(true);
  return result;
}
async function state() {
  return (await owner("select private.cimac_finance_state() value")).rows[0].value;
}

it("exposes version only to authenticated and requires scoped normal admin", async () => {
  await login();
  expect(
    (await db.query("select cimac_finance_protocol_version() v,can_execute_cimac_finance() ok"))
      .rows[0],
  ).toEqual({ v: 1, ok: true });
  const f = await seed(),
    r = request([collect(f)]),
    finance = randomUUID();
  await owner("insert into auth.users(id) values($1)", [finance]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'finance','Synthetic finance')",
    [finance],
  );
  await login(finance);
  await expect(db.query("select preview_cimac_finance($1)", [r])).rejects.toThrow(/Forbidden/);
  await owner("set role anon");
  await expect(db.query("select cimac_finance_protocol_version()")).rejects.toThrow(
    /permission denied/,
  );
  await owner("set role service_role");
  await expect(db.query("select preview_cimac_finance($1)", [r])).rejects.toThrow(
    /permission denied/,
  );
});

it("narrows only six commercial number predicates and preserves function ACL/mode/settings", () => {
  expect(definitionsAfter).toHaveLength(2);
  for (let index = 0; index < definitionsBefore.length; index++) {
    const { definition, ...old } = definitionsBefore[index],
      { definition: current, ...now } = definitionsAfter[index];
    expect(now).toEqual(old);
    const expected = definition
      .replaceAll(
        "where p.code='CIMAC' and u.unit_no=part->>'unitNo'",
        "where p.code='CIMAC' and u.unit_no=part->>'unitNo' and u.kind='storefront' and u.asset_subtype='commercial_shop'",
      )
      .replaceAll(
        "where p.code='CIMAC' and us.unit_no=part->>'unitNo'",
        "where p.code='CIMAC' and us.unit_no=part->>'unitNo' and us.kind='storefront' and us.asset_subtype='commercial_shop'",
      );
    expect(current).toBe(expected);
  }
});

it("posts exact XOF cash deposit and marks partial then fully funded", async () => {
  const f = await seed();
  const a = await apply(request([collect(f)]));
  expect(a.paymentIds).toHaveLength(1);
  expect(a.verification.payments[0]).toMatchObject({
    source_type: "lease_deposit",
    source_id: f.cid,
    amount: 1000000,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_method: "cash",
    actual_collector: null,
    recorded_by: actor,
  });
  expect(a.verification.contracts[0].deposit_received).toBe(false);
  const b = await apply(request([collect(f, "2000000")]));
  expect(b.verification.contracts[0].deposit_received).toBe(true);
  expect(b.verification.depositPayments).toHaveLength(2);
  expect(b.verification.depositLedger).toHaveLength(2);
  expect(b.verification.receivables).toEqual([]);
  expect(b.verification.units[0].notes).toMatch(
    /最新押金收款.*累计已收3000000(?:\.00)?XOF.*尚需补0(?:\.00)?XOF/,
  );
  expect(b.verification.units[0].notes).toContain("Original unit history");
  expect(b.verification.contracts[0].source_reference).toContain("Original contract history");
  expect(b.verification.contracts[0].source_reference).toContain("最新押金收款");
});

it("creates two explicitly priced unsigned drafts with partial deposits and preserves old retired history", async () => {
  const a = await seed({ available: true }),
    b = await seed({ available: true });
  const before = await state();
  const op = fresh(a);
  op.units.push({ ...op.units[0], unitNo: b.no });
  op.receipt.amountXof = "2000000";
  const out = await apply(request([op]));
  expect(out.paymentIds).toHaveLength(2);
  for (const c of out.verification.contracts)
    expect(c).toMatchObject({
      status: "draft",
      commencement_state: "pending_project_opening",
      signing_state: "pending_confirmation",
      signed_date: null,
      start_date: null,
      expected_end_date: null,
      actual_end_date: null,
      paid_through_date: null,
      monthly_rent_xof: 920000,
      deposit_amount_xof: 2760000,
      deposit_received: false,
      free_months: 12,
    });
  expect(
    out.verification.contracts.every((c: Json) => c.source_reference.includes("2028-04-01")),
  ).toBe(true);
  const after = await state();
  for (const p of before.payments) expect(after.payments).toContainEqual(p);
  expect(after.receivables).toEqual(before.receivables);
});

it("records annual net paid property bills and verified allocations without changing gross fee rules", async () => {
  const f = await seed(),
    before = await state(),
    op = collect(f, "691000");
  op.category = "property_fee";
  op.parts[0].discountXof = "200";
  op.servicePeriod = { start: "2027-04-01", end: "2028-03-31" };
  const out = await apply(request([op]));
  expect(out.verification.receivables).toHaveLength(1);
  expect(out.verification.receivables[0]).toMatchObject({
    category: "property_fee",
    amount_xof: 691000,
    paid_amount_xof: 691000,
    status: "paid",
    due_date: "2027-04-01",
    service_period_start: "2027-04-01",
    service_period_end: "2028-03-31",
    service_period_confirmed_by: actor,
  });
  expect(out.verification.allocations).toHaveLength(1);
  expect(out.verification.allocations[0].amount_xof).toBe(691000);
  expect(out.verification.units[0].notes).toContain("最新年度物业已结清");
  expect(out.verification.units[0].notes).toContain("覆盖2027-04-01至2028-03-31");
  expect(out.verification.units[0].notes).toContain("优惠200XOF");
  const after = await state();
  expect(after.fees).toEqual(before.fees);
  for (const row of before.receivables) expect(after.receivables).toContainEqual(row);
  await expect(apply(request([op]))).rejects.toThrow(/PropertyConflict/);
});

it("corrects entire CNY categories while retaining all original cash facts and IDs", async () => {
  const f = await seed({ amount: "31875", kind: "lease_rent", fx: "81.050208" }),
    r = request([reclassify(f, "lease_rent", "31875.00")]);
  const before = await state(),
    out = await apply(r),
    after = await state();
  expect(out.paymentIds).toEqual([]);
  expect(after.payments).toHaveLength(before.payments.length);
  expect(after.ledger).toHaveLength(before.ledger.length);
  const change = out.verification.reclassifications[0];
  const { source_type: a, ...old } = change.paymentBefore,
    { source_type: b, ...now } = change.paymentAfter;
  expect(a).toBe("lease_rent");
  expect(b).toBe("lease_deposit");
  expect(now).toEqual(old);
  expect(now.payment_method).toBeNull();
  expect(now.exchange_rate_to_xof).toBe(81.050208);
  const { direction: d, category: k, description: x, ...prior } = change.ledgerBefore,
    { direction: nd, category: nk, description: nx, ...next } = change.ledgerAfter;
  expect([d, k]).toEqual(["income", "lease_rent"]);
  expect([nd, nk]).toEqual(["liability_in", "lease_deposit"]);
  expect(nx).not.toBe(x);
  expect(next).toEqual(prior);
  expect(out.operationResults[0].paymentIds).toEqual([f.payment]);
});

it("reclassifies deposit to rent and recomputes deposit flag from remaining known historic money", async () => {
  const f = await seed({ amount: "35500" });
  await owner("update lease_contracts set deposit_received=true where id=$1", [f.cid]);
  const out = await apply(request([reclassify(f)]));
  expect(out.verification.contracts[0].deposit_received).toBe(false);
  expect(out.verification.depositPayments).toEqual([]);
  expect(out.verification.reclassifications[0].ledgerAfter.direction).toBe("income");
});

it("aligns only confirmed scoped holder labels and adds managers without changing global identity/history", async () => {
  const f = await seed();
  await owner("update units set reservation_holder_name='Old typo' where id=$1", [f.uid]);
  const op = identity(f);
  op.units[0].expectedHolderName = "Old typo";
  op.holderName = f.name;
  const before = await state(),
    out = await apply(request([op])),
    after = await state();
  expect(out.verification.units[0].reservation_holder_name).toBe(f.name);
  expect(out.verification.contracts[0].source_reference).toContain("Original contract history");
  expect(out.verification.contracts[0].source_reference).toContain("同一商铺不同管理人");
  expect(after.customers).toEqual(before.customers);
  expect(after.payments).toEqual(before.payments);
});

it("permits explicit identity annotations on the same collected customer units", async () => {
  const f = await seed();
  const out = await apply(request([collect(f), identity(f)]));
  expect(out.operationCount).toBe(2);
  expect(out.paymentIds).toHaveLength(1);
});

it.each(["sql", "table", "patch"])("rejects unknown %s fields", async (key) => {
  const f = await seed(),
    op = collect(f);
  op[key] = "arbitrary";
  await expect(preview(request([op]))).rejects.toThrow(/InvalidRequest/);
});

it("rejects invalid monetary sum, future date, discount on deposits, duplicate parts and wrong methods", async () => {
  const f = await seed();
  for (const edit of [
    (o: Json) => (o.receipt.amountXof = "999999"),
    (o: Json) => (o.receipt.paymentDate = "2099-01-01"),
    (o: Json) => (o.parts[0].discountXof = "0"),
    (o: Json) => o.parts.push(o.parts[0]),
    (o: Json) => (o.receipt.paymentMethod = "bank_transfer"),
  ]) {
    const op = collect(f);
    edit(op);
    await expect(preview(request([op]))).rejects.toThrow(/cimacFinance/);
  }
});

it("rejects duplicate new-customer identities inside one batch", async () => {
  const a = await seed({ available: true }),
    b = await seed({ available: true }),
    one = fresh(a, "Synthetic same customer"),
    two = fresh(b, "SYNTHETIC SAME CUSTOMER");
  // Call the SQL parser directly too: upstream validation cannot be bypassed.
  await expect(preview(request([one, two]))).rejects.toThrow(/DuplicateTarget/);
});

it("rejects foreign project, excluded 231, active or occupied conflicting units", async () => {
  for (const opt of [{ foreign: true }, { no: "231" }]) {
    const f = await seed(opt);
    await expect(preview(request([collect(f)]))).rejects.toThrow(/ScopeConflict/);
  }
  const f = await seed();
  await owner(
    "update lease_contracts set status='active',commencement_state='started',start_date='2026-01-01',expected_end_date='2027-01-01' where id=$1",
    [f.cid],
  );
  await expect(preview(request([collect(f)]))).rejects.toThrow(/ScopeConflict/);
});

it("rejects overpayment and uncertain native deposits without fabricating FX", async () => {
  const f = await seed();
  await expect(preview(request([collect(f, "3000001")]))).rejects.toThrow(/DepositConflict/);
  // Native unknown history may enter only through the existing controlled note
  // pathway; synthetic fixture installation does not weaken its production guard.
  await owner("alter table payments disable trigger guard_cimac_maintenance_payment");
  let pay: string;
  try {
    pay = (
      await db.query(
        "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,native_settlement,request_kind) values($1,$2,'lease_deposit',$3,'2026-09-01',1000,'CNY',null,true,'cimac_maintenance') returning id",
        [f.customer, f.uid, f.cid],
      )
    ).rows[0].id;
  } finally {
    await db.query("alter table payments enable trigger guard_cimac_maintenance_payment");
  }
  await owner(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,amount_native) values($1,$2,$3,'2026-09-01','liability_in','lease_deposit',0,'CNY',1000)",
    [building, f.uid, pay!],
  );
  await expect(preview(request([collect(f)]))).rejects.toThrow(/DepositConflict/);
});

it("rejects a different UUID replay of identical cash facts", async () => {
  const f = await seed(),
    op = collect(f);
  await apply(request([op]));
  await expect(preview(request([op]))).rejects.toThrow(/DuplicateReceipt/);
});

it("rejects reclassification with amount mismatch, multiple ledgers or previous refund", async () => {
  const a = await seed({ amount: "35500" });
  await expect(preview(request([reclassify(a, "lease_deposit", "2.00")]))).rejects.toThrow(
    /ReclassificationConflict/,
  );
  const b = await seed({ amount: "35500" });
  await owner(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,$3,'2026-09-01','liability_in','lease_deposit',1)",
    [building, b.uid, b.payment],
  );
  await expect(preview(request([reclassify(b)]))).rejects.toThrow(/HistoryConflict/);
  const c = await seed({ amount: "35500" });
  await owner(
    "insert into payments(customer_id,unit_id,source_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,reversal_of_payment_id) values($1,$2,$3,'lease_deposit_refund','2026-10-01',1,'CNY',80,$4)",
    [c.customer, c.uid, c.cid, c.payment],
  );
  await expect(preview(request([reclassify(c)]))).rejects.toThrow(/Conflict/);
});

it("replay/status return historical unverified evidence and changed payload never reexecutes", async () => {
  const f = await seed(),
    r = request([collect(f)]),
    p = await preview(r);
  const out = await execute(r, p.snapshot),
    before = await state();
  const replay = await execute(r, p.snapshot);
  expect(replay).toMatchObject({
    status: "completed_previously",
    verified: false,
    idempotent: true,
    requestId: r.requestId,
  });
  await login();
  expect(
    (await db.query("select find_cimac_finance($1) value", [r.requestId])).rows[0].value,
  ).toMatchObject({ status: "completed_previously", verified: false });
  expect(out.request).toEqual(r);
  r.originalInstruction += " changed";
  await expect(execute(r, p.snapshot)).rejects.toThrow(/RequestIdConflict/);
  expect(await state()).toEqual(before);
});

it("snapshot CAS detects even unrelated scoped changes and expired execution is rejected", async () => {
  const f = await seed(),
    r = request([collect(f)]),
    p = await preview(r);
  await owner("update units set notes='Concurrent changed' where id=$1", [f.uid]);
  await expect(execute(r, p.snapshot)).rejects.toThrow(/SnapshotChanged/);
  const freshPreview = await preview(r);
  await login();
  await expect(
    db.query("select execute_cimac_finance($1,$2,clock_timestamp()-interval '1 second','test')", [
      r,
      freshPreview.snapshot,
    ]),
  ).rejects.toThrow(/Expired/);
});

it("rolls every effect back if a late operation fails during posting", async () => {
  const a = await seed(),
    b = await seed({ available: true });
  const r = request([collect(a), fresh(b)]),
    p = await preview(r),
    before = await state();
  await owner(
    "create function private.synthetic_finance_fail() returns trigger language plpgsql as $$ begin if new.name like 'New %' then raise exception 'SyntheticLateFailure'; end if; return new; end $$; create trigger synthetic_finance_fail before insert on customers for each row execute function private.synthetic_finance_fail()",
  );
  try {
    await expect(execute(r, p.snapshot)).rejects.toThrow(/SyntheticLateFailure/);
  } finally {
    await owner(
      "drop trigger synthetic_finance_fail on customers; drop function private.synthetic_finance_fail()",
    );
  }
  expect(await state()).toEqual(before);
  expect(
    (
      await owner("select count(*) n from private.cimac_finance_requests where request_id=$1", [
        r.requestId,
      ])
    ).rows[0].n,
  ).toBe("0");
});

it("denies legacy updates/deletes and clearing protection labels on newly posted and corrected rows", async () => {
  const f = await seed(),
    out = await apply(request([collect(f)])),
    pid = out.paymentIds[0],
    lid = out.verification.ledger[0].id;
  await login();
  for (const sql of [
    "update payments set request_kind=null,amount=1 where id=$1",
    "delete from payments where id=$1",
  ])
    await expect(db.query(sql, [pid])).rejects.toThrow(/Protected/);
  await expect(
    db.query("update ledger_entries set amount_xof=1 where id=$1", [lid]),
  ).rejects.toThrow(/Protected/);
  const c = await seed({ amount: "35500" }),
    corrected = await apply(request([reclassify(c)]));
  await login();
  await expect(
    db.query("update payments set source_type='lease_deposit' where id=$1", [c.payment]),
  ).rejects.toThrow(/Protected/);
  expect(corrected.verification.reclassifications[0].paymentAfter.amount).toBe(35500);
});

it("reserves batch UUID even for identity-only work against legacy payment and maintenance journals", async () => {
  const f = await seed(),
    r = request([identity(f)]);
  await apply(r);
  await login();
  await expect(
    db.query(
      "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,request_id) values($1,$2,'lease_deposit',$3,'2026-10-26',1,'XOF',$4)",
      [f.customer, f.uid, f.cid, r.requestId],
    ),
  ).rejects.toThrow(/RequestIdConflict/);
  await expect(
    owner(
      "insert into private.cimac_maintenance_requests(request_id,actor_id,request_data,before_state,deployment,status) values($1,$2,'{}','{}','synthetic','executing')",
      [r.requestId, actor],
    ),
  ).rejects.toThrow(/RequestIdConflict/);
});

it("concurrent same request commits once and returns completed_previously to the waiter", async () => {
  const f = await seed(),
    r = request([collect(f)]),
    p = await preview(r),
    other = await cluster.connect();
  await login();
  await db.query("begin");
  try {
    await execute(r, p.snapshot);
    const waiting = execute(r, p.snapshot, other);
    await db.query("commit");
    expect(await waiting).toMatchObject({ status: "completed_previously", verified: false });
  } finally {
    await db.query("rollback");
    await other.end();
  }
  expect(
    (
      await owner(
        "select count(*) n from payments where source_id=$1 and request_kind='cimac_finance'",
        [f.cid],
      )
    ).rows[0].n,
  ).toBe("1");
});

it("atomically completes four physical receipts split into seven postings plus classifications and identity", async () => {
  const d1 = await seed({ no: "801" }),
    d2 = await seed({ no: "802" }),
    p1 = await seed({ no: "406" }),
    p2 = await seed({ no: "408" });
  for (const [a, b] of [
    [d1, d2],
    [p1, p2],
  ]) {
    await owner("update lease_contracts set customer_id=$1 where id=$2", [a.customer, b.cid]);
    await db.query("update units set reservation_holder_name=$1 where id=$2", [a.name, b.uid]);
    b.customer = a.customer;
    b.name = a.name;
  }
  await owner(
    "update lease_contracts set deposit_amount_xof=11280000,monthly_rent_xof=3760000 where id=$1",
    [d1.cid],
  );
  await db.query(
    "update lease_contracts set deposit_amount_xof=7950000,monthly_rent_xof=2650000 where id=$1",
    [d2.cid],
  );
  const single = await seed({ available: true, no: "310" }),
    pair1 = await seed({ available: true, no: "215" }),
    pair2 = await seed({ available: true, no: "217" });
  for (const unit of [single, pair1, pair2])
    await owner(
      "insert into property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,is_active,notes) values($1,12345,'2025-01-01','2025-12-31',false,'Original inactive fee policy')",
      [unit.uid],
    );
  const rent = await seed({ no: "701", amount: "31875", kind: "lease_rent", fx: "81.050208" });
  const deposit = await seed({ no: "213", amount: "35500", fx: "80" });
  const label = await seed({ no: "305" });
  await owner("update units set reservation_holder_name='Old documentary label' where id=$1", [
    label.uid,
  ]);
  const one = fresh(single);
  one.units[0] = {
    unitNo: single.no,
    monthlyRentXof: "860000",
    depositXof: "2580000",
    amountXof: "2580000",
  };
  one.receipt.amountXof = "2580000";
  const pair = fresh(pair1);
  pair.units.push({ ...pair.units[0], unitNo: pair2.no });
  pair.receipt.amountXof = "2000000";
  const depositReceipt = collect(d1, "19230000");
  depositReceipt.parts = [
    { contractId: d1.cid, amountXof: "11280000" },
    { contractId: d2.cid, amountXof: "7950000" },
  ];
  const property = collect(p1, "1382000");
  property.category = "property_fee";
  property.parts = [
    { contractId: p1.cid, amountXof: "691000", discountXof: "200" },
    { contractId: p2.cid, amountXof: "691000", discountXof: "200" },
  ];
  property.servicePeriod = { start: "2027-04-01", end: "2028-03-31" };
  const labelOp = identity(label);
  labelOp.units[0].expectedHolderName = "Old documentary label";
  labelOp.holderName = label.name;
  const managers = identity(p1);
  managers.units.push({ unitNo: p2.no, expectedHolderName: p1.name });
  const r = request([
    depositReceipt,
    one,
    pair,
    property,
    reclassify(rent, "lease_rent", "31875.00"),
    reclassify(deposit),
    labelOp,
    managers,
  ]);
  const apartmentSnapshotSql =
    "select jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(a) order by a.unit_id) from cimac_apartment_profiles a where building_id=$1),'units',(select jsonb_agg(to_jsonb(u) order by u.id) from units u where building_id=$1),'flags',(select jsonb_agg(to_jsonb(f) order by f.unit_id) from unit_business_flags f join units u on u.id=f.unit_id where u.building_id=$1)) value";
  const apartmentsBefore = (await owner(apartmentSnapshotSql, [apartmentBuilding])).rows[0].value;
  expect(apartmentsBefore.units).toHaveLength(68);
  expect(apartmentsBefore.profiles).toHaveLength(64);
  for (const number of ["215", "310", "305", "406", "408", "213"]) {
    expect(
      apartmentsBefore.units.some((u: Json) => u.unit_no === number && u.kind === "apartment"),
    ).toBe(true);
  }
  const before = await state(),
    result = await apply(r),
    after = await state();
  expect(result.operationResults).toHaveLength(8);
  expect(result.paymentIds).toHaveLength(7);
  expect(result.verification.ledger).toHaveLength(7);
  expect(result.verification.receivables).toHaveLength(2);
  expect(result.verification.allocations).toHaveLength(2);
  expect(after.payments.length - before.payments.length).toBe(7);
  expect(after.ledger.length - before.ledger.length).toBe(7);
  expect(after.contracts.length - before.contracts.length).toBe(3);
  expect(after.receivables.length - before.receivables.length).toBe(2);
  for (const unit of [single, pair1, pair2]) {
    const oldRule = before.fees.find((f: Json) => f.unit_id === unit.uid),
      current = after.fees.find((f: Json) => f.unit_id === unit.uid);
    expect(current).toMatchObject({
      id: oldRule.id,
      is_active: true,
      monthly_amount_xof: 57600,
      start_date: "2027-04-01",
      end_date: "2028-03-31",
    });
    expect(current.notes).toContain("Original inactive fee policy");
  }
  expect(result.verification.customers.map((x: Json) => x.name)).toContain(pair.customerName);
  const changed = new Set([rent.payment, deposit.payment]);
  for (const row of before.payments.filter((x: Json) => !changed.has(x.id)))
    expect(after.payments).toContainEqual(row);
  for (const row of before.receivables) expect(after.receivables).toContainEqual(row);
  const audit = (await owner("select metadata from audit_logs where id=$1", [result.auditId]))
    .rows[0].metadata;
  expect(audit.physical_receipt_operations).toBe(4);
  expect((await owner(apartmentSnapshotSql, [apartmentBuilding])).rows[0].value).toEqual(
    apartmentsBefore,
  );
  expect(
    result.verification.units.every(
      (u: Json) => u.kind === "storefront" && u.asset_subtype === "commercial_shop",
    ),
  ).toBe(true);
});

it("rejects apartment-only room numbers rather than treating them as commercial targets", async () => {
  const placeholder = await seed({ available: true }),
    op = fresh(placeholder);
  op.units[0].unitNo = "214";
  await expect(preview(request([op]))).rejects.toThrow(/ScopeConflict/);
});

it("retains complete long historical notes and full current annotation", async () => {
  const f = await seed(),
    historical = "Earlier documented note ".repeat(100),
    op = identity(f);
  op.annotation = "Confirmed annotation ".repeat(80);
  await owner("update units set notes=$1 where id=$2", [historical, f.uid]);
  const result = await apply(request([op]));
  expect(result.verification.units[0].notes).toContain(historical);
  expect(result.verification.units[0].notes).toContain(op.annotation.trim());
});

it("protects newly paid property bill and allocation against legacy edits", async () => {
  const f = await seed(),
    op = collect(f, "691000");
  op.category = "property_fee";
  op.parts[0].discountXof = "200";
  op.servicePeriod = { start: "2027-04-01", end: "2028-03-31" };
  const result = await apply(request([op]));
  await login();
  await expect(
    db.query("update receivables set paid_amount_xof=0,status='pending' where id=$1", [
      result.verification.receivables[0].id,
    ]),
  ).rejects.toThrow(/Protected/);
  // Legacy authenticated grants do not permit allocation writes in the first
  // place; the private exact-row trigger is additional owner-path protection.
  await expect(
    db.query("delete from payment_receivable_allocations where payment_id=$1", [
      result.paymentIds[0],
    ]),
  ).rejects.toThrow(/permission denied|Protected/);
  await expect(
    owner("update payment_receivable_allocations set amount_xof=1 where payment_id=$1", [
      result.paymentIds[0],
    ]),
  ).rejects.toThrow(/Protected/);
  await login();
  await expect(
    db.query("update ledger_entries set id=$1 where id=$2", [
      randomUUID(),
      result.verification.ledger[0].id,
    ]),
  ).rejects.toThrow(/Protected/);
  await expect(
    db.query("update receivables set id=$1 where id=$2", [
      randomUUID(),
      result.verification.receivables[0].id,
    ]),
  ).rejects.toThrow(/Protected/);
});

it("rejects reclassification of an allocated original even if money and ledger match", async () => {
  const f = await seed({ amount: "35500" });
  const bill = (
    await owner(
      "insert into receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status) values($1,$2,$3,'lease_contract',$4,'lease_deposit','Synthetic allocated deposit','2026-09-01',2840000,2840000,'paid') returning id",
      [building, f.uid, f.customer, f.cid],
    )
  ).rows[0].id;
  await db.query(
    "insert into payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id) values($1,$2,2840000,$3,$4)",
    [f.payment, bill, actor, randomUUID()],
  );
  await expect(preview(request([reclassify(f)]))).rejects.toThrow(/ReclassificationConflict/);
});

it("preserves excluded warehouse/current231 rows and earlier journal exactly", async () => {
  const excluded = await seed({ available: true });
  await owner("update units set asset_subtype='warehouse',area_sqm=545 where id=$1", [
    excluded.uid,
  ]);
  const prior = randomUUID();
  await db.query(
    "insert into private.cimac_maintenance_requests(request_id,actor_id,request_data,before_state,after_state,result,deployment,status) values($1,$2,'{}','{}','{}','{}','synthetic earlier','completed')",
    [prior, actor],
  );
  const earlier = (
    await db.query(
      "select to_jsonb(r) value from private.cimac_maintenance_requests r where request_id=$1",
      [prior],
    )
  ).rows[0].value;
  const before = await state(),
    target = await seed();
  await apply(request([collect(target)]));
  const after = await state();
  for (const row of before.units.filter(
    (u: Json) => u.asset_subtype === "warehouse" || u.unit_no === "231",
  ))
    expect(after.units).toContainEqual(row);
  expect(
    (
      await owner(
        "select to_jsonb(r) value from private.cimac_maintenance_requests r where request_id=$1",
        [prior],
      )
    ).rows[0].value,
  ).toEqual(earlier);
});

it("rejects any existing other-family journal UUID before execution", async () => {
  const f = await seed(),
    r = request([collect(f)]),
    p = await preview(r);
  await owner(
    "insert into private.finance_operation_requests(request_id,actor_id,operation,payload,result) values($1,$2,'synthetic','{}','{}')",
    [r.requestId, actor],
  );
  await expect(execute(r, p.snapshot)).rejects.toThrow(/RequestIdConflict/);
});

it("detects pending no-payment legacy journal UUID in both directions", async () => {
  const f = await seed(),
    r = request([collect(f)]),
    p = await preview(r);
  const insert =
    "insert into private.operator_collection_batches(request_id,actor_id,request_data,expected_snapshot,deployment,expires_at) values($1,$2,'{}','{}','synthetic',clock_timestamp()+interval '5 minutes')";
  await owner(insert, [r.requestId, actor]);
  await expect(execute(r, p.snapshot)).rejects.toThrow(/RequestIdConflict/);
  const next = request([identity(f)]);
  await apply(next);
  await expect(owner(insert, [next.requestId, actor])).rejects.toThrow(/RequestIdConflict/);
});

it("rejects exact ledger history with a previous actual refund", async () => {
  const f = await seed({ amount: "35500" });
  const refund = (
    await owner(
      "insert into payments(customer_id,unit_id,source_id,source_type,payment_date,amount,currency,exchange_rate_to_xof) values($1,$2,$3,'lease_deposit_refund','2026-10-01',100,'CNY',80) returning id",
      [f.customer, f.uid, f.cid],
    )
  ).rows[0].id;
  await db.query(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,amount_cny) values($1,$2,$3,'2026-10-01','liability_out','lease_deposit',8000,100)",
    [building, f.uid, refund],
  );
  await expect(preview(request([reclassify(f)]))).rejects.toThrow(/ReclassificationConflict/);
});

it("blocks a raw legacy payment racing an uncommitted identity-only UUID", async () => {
  const f = await seed(),
    r = request([identity(f)]),
    p = await preview(r),
    other = await cluster.connect();
  await login();
  await db.query("begin");
  let pending: Promise<unknown> | undefined;
  try {
    await execute(r, p.snapshot);
    await login(actor, other);
    pending = other.query(
      "insert into payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,request_id) values($1,$2,'lease_deposit',$3,'2026-10-26',1,'XOF',$4)",
      [f.customer, f.uid, f.cid, r.requestId],
    );
    const observed = pending.then(
      () => ({ error: null }),
      (error) => ({ error }),
    );
    await db.query("commit");
    expect((await observed).error?.message).toMatch(/RequestIdConflict/);
  } finally {
    await db.query("rollback");
    await other.end();
  }
});
