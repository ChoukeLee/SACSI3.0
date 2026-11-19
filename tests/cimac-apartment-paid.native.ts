import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import {
  parseApartmentPaidRequest,
  verifyApartmentPaidResult,
  readApartmentPaidRows,
} from "../src/features/cimac/cimac-apartment-paid-model";

type Json = Record<string, any>;
const migrationName = "20261117181959_cimac_b17_paid_apartment_reservations.sql";
const combinedMigrationName = "20261119115407_cimac_apartment_combined_receipts.sql";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
let actor: string, project: string, building: string;
const used = new Set<string>();
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const installed = await installApplicationRebuild(db);
  if (!installed.includes(migrationName))
    await db.query(await readFile(`supabase/migrations/${migrationName}`, "utf8"));
  if (!installed.includes(combinedMigrationName))
    await db.query(await readFile(`supabase/migrations/${combinedMigrationName}`, "utf8"));
  actor = await person("admin");
  project = (
    await owner(
      "insert into projects(code,display_name,allows_long_lease) values('CIMAC','Synthetic',true) returning id",
    )
  ).rows[0].id;
  building = (
    await owner(
      "insert into buildings(project_id,code,display_name) values($1,'CIMAC-B17','Synthetic B17') returning id",
      [project],
    )
  ).rows[0].id;
  await login(actor);
  expect(
    (await db.query("select cimac_apartments_initialize_rpc($1) value", [randomUUID()])).rows[0]
      .value.roomCount,
  ).toBe(64);
  await owner("update units set construction_status='operational' where building_id=$1", [
    building,
  ]);
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
async function person(role: string) {
  const id = randomUUID();
  await owner("insert into auth.users(id,email) values($1,$2)", [id, id + "@test.invalid"]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic operator')",
    [id, role],
  );
  return id;
}
async function input(count = 1): Promise<Json> {
  const units = (
    await owner(
      "select u.*,to_jsonb(u)->>'updated_at' exact_updated_at,p.monthly_rent_xof from units u join cimac_apartment_profiles p on p.unit_id=u.id where u.building_id=$1 order by unit_no",
      [building],
    )
  ).rows
    .filter((u) => !used.has(u.id))
    .slice(0, count);
  for (const u of units) used.add(u.id);
  expect(units).toHaveLength(count);
  return {
    requestId: randomUUID(),
    originalInstruction: "Synthetic paid future apartment reservation, no actual check-in",
    customerName: "Synthetic customer " + randomUUID(),
    agreementStartDate: "2027-01-01",
    agreementEndDate: "2028-12-31",
    paidPeriodStart: "2027-01-01",
    paidPeriodEnd: "2027-03-31",
    paymentDate: "2026-11-17",
    paymentMethod: "cash",
    currency: "XOF",
    sourceRef: "synthetic-source:" + randomUUID(),
    externalReceiptNo: "SYNTHETIC-" + randomUUID(),
    reason: "User-confirmed synthetic receipt and future agreement; no occupancy assertion",
    totalAmountXof: units.reduce((n, u) => n + Number(u.monthly_rent_xof) * 5, 0),
    rooms: units.map((u) => ({
      unitId: u.id,
      expectedUnitUpdatedAt: u.exact_updated_at,
      expectedHoldId: null,
      expectedHoldUpdatedAt: null,
      monthlyRentXof: Number(u.monthly_rent_xof),
      depositMonths: 2,
      rentPrepayMonths: 3,
      depositAmountXof: Number(u.monthly_rent_xof) * 2,
      rentAmountXof: Number(u.monthly_rent_xof) * 3,
    })),
  };
}
async function execute(p: Json, id = actor, client = db) {
  await login(id, client);
  const result = (
    await client.query("select cimac_apartment_paid_receipt_execute_rpc($1) value", [p])
  ).rows[0].value;
  const units = result.data.verification.units;
  verifyApartmentPaidResult(
    result,
    parseApartmentPaidRequest(p),
    id,
    project,
    building,
    new Map(units.map((u: Json) => [u.id, u.unit_no])),
  );
  return result;
}
async function combinedInput(count = 1, holdCount = 0): Promise<Json> {
  const p = await input(count);
  p.schemaVersion = 2;
  for (const [index, room] of p.rooms.entries()) {
    const profile = (
      await owner(
        "select monthly_property_fee_xof from cimac_apartment_profiles where unit_id=$1",
        [room.unitId],
      )
    ).rows[0];
    room.propertyFeeAmountXof = Number(profile.monthly_property_fee_xof) * 12;
    room.propertyPeriodStart = "2027-01-01";
    room.propertyPeriodEnd = "2027-12-31";
    p.totalAmountXof += room.propertyFeeAmountXof;
    if (index < holdCount) {
      await login();
      await db.query("select cimac_apartment_reservations_execute_rpc($1)", [
        {
          requestId: randomUUID(),
          originalInstruction: "Synthetic existing unpaid hold with explicit later replacement",
          operations: [
            {
              type: "reserve",
              unitId: room.unitId,
              expectedUnitUpdatedAt: room.expectedUnitUpdatedAt,
              expectedReservationId: null,
              expectedReservationUpdatedAt: null,
              reserverName: "Synthetic previous reserver " + index,
              reason: "Synthetic original unpaid reservation",
            },
          ],
        },
      ]);
      const hold = (
        await owner(
          "select id,to_jsonb(h)->>'updated_at' stamp from cimac_apartment_reservations h where unit_id=$1 and status='reserved'",
          [room.unitId],
        )
      ).rows[0];
      room.expectedHoldId = hold.id;
      room.expectedHoldUpdatedAt = hold.stamp;
    }
  }
  return p;
}
async function snapshot() {
  return (
    await owner(
      "select jsonb_build_object('units',(select jsonb_agg(to_jsonb(u) order by id) from units u),'profiles',(select jsonb_agg(to_jsonb(x) order by unit_id) from cimac_apartment_profiles x),'holds',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from cimac_apartment_reservations x),'flags',(select coalesce(jsonb_agg(to_jsonb(x) order by unit_id,business_type),'[]') from unit_business_flags x),'leases',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from lease_contracts x),'daily',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from daily_bookings x),'receivables',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from receivables x),'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from payments x),'ledger',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from ledger_entries x),'customers',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from customers x),'receipts',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from cimac_apartment_paid_receipts x),'paid',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from cimac_apartment_paid_reservations x),'journal',(select coalesce(jsonb_agg(to_jsonb(x) order by request_id),'[]') from private.cimac_apartment_paid_requests x),'audit',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from audit_logs x)) value",
    )
  ).rows[0].value;
}

it("posts one physical three-room receipt as six standard payments without a lease or occupancy change", async () => {
  const p = await input(3),
    before = await snapshot(),
    r = await execute(p),
    after = await snapshot();
  expect(r.success).toBe(true);
  expect(r.idempotent).toBe(false);
  expect(r.data.paymentIds).toHaveLength(6);
  expect(r.data.ledgerIds).toHaveLength(6);
  expect(r.data.reservationIds).toHaveLength(3);
  expect(r.data.verification.payments.reduce((n: number, x: Json) => n + Number(x.amount), 0)).toBe(
    p.totalAmountXof,
  );
  expect(
    r.data.verification.payments.every(
      (x: Json) =>
        x.recorded_by === actor &&
        x.external_receipt_no === p.externalReceiptNo &&
        /^WB-CIMAC-B17-L-\d+-20261117-(DEP|RENT)-\d+$/.test(x.receipt_no),
    ),
  ).toBe(true);
  expect(
    r.data.verification.ledger
      .filter((x: Json) => x.direction === "liability_in")
      .reduce((n: number, x: Json) => n + Number(x.amount_xof), 0),
  ).toBe((p.totalAmountXof * 2) / 5);
  for (const k of ["units", "profiles", "holds", "flags", "leases", "daily", "receivables"])
    expect(after[k]).toEqual(before[k]);
  expect(after.payments).toHaveLength(before.payments.length + 6);
  expect(after.ledger).toHaveLength(before.ledger.length + 6);
  expect(after.receipts).toHaveLength(before.receipts.length + 1);
  expect(
    r.data.verification.reservations.every(
      (x: Json) =>
        x.status === "paid_reserved" &&
        x.agreement_end_date === "2028-12-31" &&
        x.property_fee_amount_xof === null &&
        x.property_period_start === null &&
        x.property_period_end === null &&
        x.property_payment_id === null,
    ),
  ).toBe(true);
});

it("recovers the original exact request and rejects altered-payload or new-ID source replays", async () => {
  const p = await input(),
    r = await execute(p),
    before = await snapshot();
  expect(await execute(p)).toEqual({ ...r, idempotent: true });
  await expect(execute({ ...p, reason: "Changed" })).rejects.toThrow(/RequestConflict/);
  await expect(execute({ ...p, requestId: randomUUID() })).rejects.toThrow(/DuplicateReceipt/);
  expect(await snapshot()).toEqual(before);
});

it("allows finance writes and boss reads, while denying boss writes and anonymous/service execution", async () => {
  const p = await input(),
    finance = await person("finance"),
    boss = await person("boss");
  await expect(execute(p, boss)).rejects.toThrow(/Denied/);
  const r = await execute(p, finance);
  await login(boss);
  expect(
    (
      await db.query("select cimac_apartment_paid_receipts_read_rpc($1) value", [building])
    ).rows[0].value.receipts.some((x: Json) => x.id === r.data.receiptId),
  ).toBe(true);
  for (const role of ["anon", "service_role"]) {
    await owner("select set_config('request.jwt.claims','{}',false)");
    await db.query(`set role ${role}`);
    await expect(
      db.query("select cimac_apartment_paid_receipt_execute_rpc($1)", [p]),
    ).rejects.toThrow(/permission denied/);
  }
});

it("rejects unknown fields, arithmetic mismatches, duplicate units, non-XOF and inferred dates", async () => {
  const base = await input(),
    before = await snapshot();
  for (const change of [
    (p: Json) => (p.sql = "select 1"),
    (p: Json) => p.totalAmountXof++,
    (p: Json) => (p.currency = "USD"),
    (p: Json) => p.rooms.push(p.rooms[0]),
    (p: Json) => p.rooms[0].depositAmountXof++,
    (p: Json) => (p.rooms[0].monthlyRentXof = "350000"),
    (p: Json) => (p.paidPeriodEnd = "2027-04-01"),
    (p: Json) => (p.rooms[0].expectedHoldId = randomUUID()),
    (p: Json) => (p.paymentDate = "2099-01-01"),
  ]) {
    const p = structuredClone(base);
    change(p);
    await expect(execute(p)).rejects.toThrow();
  }
  expect(await snapshot()).toEqual(before);
});

it("rejects same-number commercial shops, changed unit CAS and occupied/locked targets", async () => {
  const p = await input(),
    before = await snapshot();
  const q = structuredClone(p);
  q.rooms[0].expectedUnitUpdatedAt = "2000-01-01T00:00:00Z";
  await expect(execute(q)).rejects.toThrow(/ScopeChanged/);
  await owner("update units set operational_condition='locked' where id=$1", [p.rooms[0].unitId]);
  await expect(execute(p)).rejects.toThrow(/ScopeChanged/);
  await owner("update units set operational_condition='normal' where id=$1", [p.rooms[0].unitId]);
  expect((await snapshot()).payments).toEqual(before.payments);
});

it("blocks active unpaid holds and prevents a later unpaid hold overwriting a paid reservation", async () => {
  const p = await input(),
    room = p.rooms[0];
  await login();
  const holdRequest = {
    requestId: randomUUID(),
    originalInstruction: "Synthetic unpaid hold",
    operations: [
      {
        type: "reserve",
        unitId: room.unitId,
        expectedUnitUpdatedAt: room.expectedUnitUpdatedAt,
        reserverName: "Synthetic prior",
        reason: "Synthetic",
        expectedReservationId: null,
        expectedReservationUpdatedAt: null,
      },
    ],
  };
  await db.query("select cimac_apartment_reservations_execute_rpc($1)", [holdRequest]);
  await expect(execute(p)).rejects.toThrow(/BusinessConflict/);
  const h = (
    await owner(
      "select *,to_jsonb(r)->>'updated_at' exact_updated_at from cimac_apartment_reservations r where unit_id=$1",
      [room.unitId],
    )
  ).rows[0];
  await login();
  await db.query("select cimac_apartment_reservations_execute_rpc($1)", [
    {
      ...holdRequest,
      requestId: randomUUID(),
      operations: [
        {
          ...holdRequest.operations[0],
          type: "cancel",
          reserverName: null,
          expectedReservationId: h.id,
          expectedReservationUpdatedAt: h.exact_updated_at,
        },
      ],
    },
  ]);
  await execute(p);
  await login();
  await expect(
    db.query("select cimac_apartment_reservations_execute_rpc($1)", [
      { ...holdRequest, requestId: randomUUID() },
    ]),
  ).rejects.toThrow(/PaidAlreadyReserved/);
});

it("protects paid cash, ledger, records and audit against direct mutation including source-type escape", async () => {
  const r = await execute(await input()),
    before = await snapshot();
  await login();
  await expect(
    db.query("update payments set source_type='manual',request_kind=null where id=$1", [
      r.data.paymentIds[0],
    ]),
  ).rejects.toThrow(/PaidImmutable/);
  await expect(
    db.query("delete from ledger_entries where id=$1", [r.data.ledgerIds[0]]),
  ).rejects.toThrow(/PaidImmutable/);
  await expect(
    db.query("update cimac_apartment_paid_reservations set status='paid_reserved' where id=$1", [
      r.data.reservationIds[0],
    ]),
  ).rejects.toThrow(/permission denied/);
  await expect(
    owner(
      "delete from audit_logs where entity_id=$1 and entity_type='cimac_apartment_paid_receipt'",
      [r.data.requestId],
    ),
  ).rejects.toThrow(/PaidImmutable/);
  expect(await snapshot()).toEqual(before);
});

it("rolls the entire batch back on a late failure, preserving old cash and customer history", async () => {
  const p = await input(3),
    before = await snapshot();
  await owner(
    "create function private.synthetic_paid_failure() returns trigger language plpgsql as $$ begin raise exception 'SyntheticPaidLateFailure'; end $$; create trigger synthetic_paid_failure before insert on cimac_apartment_paid_reservations for each row execute function private.synthetic_paid_failure()",
  );
  try {
    await expect(execute(p)).rejects.toThrow(/SyntheticPaidLateFailure/);
  } finally {
    await owner(
      "drop trigger synthetic_paid_failure on cimac_apartment_paid_reservations; drop function private.synthetic_paid_failure()",
    );
  }
  expect(await snapshot()).toEqual(before);
});

it("serializes exact concurrent requests and emits one physical receipt only", async () => {
  const p = await input(),
    other = await cluster.connect();
  try {
    const result = await Promise.all([execute(p), execute(p, actor, other)]);
    expect(result.map((x) => x.idempotent).sort()).toEqual([false, true]);
    expect(result[0].data).toEqual(result[1].data);
  } finally {
    await other.end();
  }
});

it("makes the paid customer visible in normal customer/directory/account reads without inventing lease links", async () => {
  const p = await input(),
    result = await execute(p),
    customer = result.data.customerId;
  await login();
  expect((await db.query("select id,name from customers where id=$1", [customer])).rows).toEqual([
    { id: customer, name: p.customerName },
  ]);
  const detail = (
    await db.query("select cimac_customer_directory_read_rpc($1,'detail',$2,1) value", [
      { projectId: project, buildingId: building },
      customer,
    ])
  ).rows[0].value;
  expect(detail.profile.id).toBe(customer);
  expect(detail.relationships).toEqual([]);
  expect(detail.rows[0].roles).toEqual([]);
  const otherBuilding = (
    await owner(
      "insert into buildings(project_id,code,display_name) values($1,$2,'Synthetic other') returning id",
      [project, "CIMAC-OTHER-" + randomUUID()],
    )
  ).rows[0].id;
  await login();
  await expect(
    db.query("select cimac_customer_directory_read_rpc($1,'detail',$2,1)", [
      { projectId: project, buildingId: otherBuilding },
      customer,
    ]),
  ).rejects.toThrow(/NotFound/);
  const account = (await db.query("select cimac_customer_account_rpc($1,'',1) value", [customer]))
    .rows[0].value;
  expect(JSON.stringify(account)).toContain(result.data.paymentIds[0]);
  const read = (
    await db.query("select cimac_apartment_paid_receipts_read_rpc($1) value", [building])
  ).rows[0].value;
  expect(
    readApartmentPaidRows(
      read,
      project,
      building,
      new Map(
        (await db.query("select id,unit_no from units where building_id=$1", [building])).rows.map(
          (u: Json) => [u.id, u.unit_no],
        ),
      ),
    ).has(p.rooms[0].unitId),
  ).toBe(true);
});

it("reuses only a unique customer already scoped to CIMAC and rejects ambiguous or unrelated identities", async () => {
  const p = await input(),
    first = await execute(p),
    second = await input();
  second.customerName = p.customerName;
  expect((await execute(second)).data.customerId).toBe(first.data.customerId);
  const variant = await input();
  variant.customerName = p.customerName.toLowerCase();
  const beforeVariant = await snapshot();
  await expect(execute(variant)).rejects.toThrow(/CustomerConflict/);
  expect(await snapshot()).toEqual(beforeVariant);
  const unrelated = await input();
  await owner("insert into customers(name) values($1)", [unrelated.customerName]);
  const before = await snapshot();
  await expect(execute(unrelated)).rejects.toThrow(/CustomerConflict/);
  expect(await snapshot()).toEqual(before);
  await owner("insert into customers(name) values($1)", [unrelated.customerName]);
  await expect(execute(unrelated)).rejects.toThrow(/CustomerConflict/);
});

it("denies a restricted project's finance actor and a same-number commercial asset", async () => {
  const p = await input(),
    finance = await person("finance");
  const mode = (await owner("select access_mode from projects where id=$1", [project])).rows[0]
    .access_mode;
  await owner("update projects set access_mode='restricted' where id=$1", [project]);
  try {
    await expect(execute(p, finance)).rejects.toThrow(/Denied/);
  } finally {
    await owner("update projects set access_mode=$2 where id=$1", [project, mode]);
  }
  const b = (
    await owner(
      "insert into buildings(project_id,code,display_name) values($1,$2,'Synthetic commercial') returning id",
      [project, "CIMAC-COMMERCIAL-" + randomUUID()],
    )
  ).rows[0].id;
  const u = (
    await owner(
      "insert into units(building_id,code,unit_no,floor_label,kind,asset_subtype) values($1,$2,'201','G','storefront','commercial_shop') returning id, to_jsonb(units)->>'updated_at' exact_updated_at",
      [b, "SYNTHETIC-COMMERCIAL-" + randomUUID()],
    )
  ).rows[0];
  p.rooms[0].unitId = u.id;
  p.rooms[0].expectedUnitUpdatedAt = u.exact_updated_at;
  await expect(execute(p)).rejects.toThrow(/ScopeChanged/);
});

it("reserves its request namespace against earlier and later legacy journals", async () => {
  const p = await input();
  await owner(
    "insert into private.asset_operation_requests(request_id,actor_id,operation,payload,result) values($1,$2,'synthetic',$3,'{}')",
    [p.requestId, actor, {}],
  );
  await expect(execute(p)).rejects.toThrow(/RequestConflict/);
  p.requestId = randomUUID();
  const result = await execute(p),
    before = await snapshot();
  await expect(
    owner(
      "insert into private.asset_operation_requests(request_id,actor_id,operation,payload,result) values($1,$2,'synthetic','{}','{}')",
      [p.requestId, actor],
    ),
  ).rejects.toThrow(/RequestConflict/);
  await expect(
    owner(
      "insert into audit_logs(actor_id,action,entity_type,entity_id) values($1,'synthetic','synthetic',$2)",
      [actor, result.data.requestId],
    ),
  ).rejects.toThrow(/RequestConflict/);
  expect(await snapshot()).toEqual(before);
});

it("rejects caller-fabricated paid money and extra ledgers even with a copied source ID", async () => {
  const result = await execute(await input()),
    before = await snapshot(),
    p = result.data.verification.payments[0];
  await login();
  await expect(
    db.query(
      "insert into payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,request_id,request_kind) values($1,$2,$3,$4,$5,$6,1,'XOF',1,'cash',$7,'cimac_apartment_paid')",
      [
        randomUUID(),
        p.customer_id,
        p.unit_id,
        p.source_type,
        p.source_id,
        p.payment_date,
        randomUUID(),
      ],
    ),
  ).rejects.toThrow(/PaidMoneyDenied/);
  await expect(
    db.query(
      "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency) values($1,$2,$3,$4,'income','lease_rent',1,'XOF')",
      [building, p.unit_id, p.id, p.payment_date],
    ),
  ).rejects.toThrow(/PaidMoneyDenied/);
  expect(await snapshot()).toEqual(before);
});

it("v2 records three exact components and atomically cancels only the expected hold while preserving history", async () => {
  const p = await combinedInput(2, 1),
    before = await snapshot(),
    r = await execute(p),
    after = await snapshot();
  expect(r.data.paymentIds).toHaveLength(6);
  expect(r.data.ledgerIds).toHaveLength(6);
  expect(r.data.verification.unpaidReservationsBefore).toEqual(
    before.holds.filter((h: Json) => p.rooms.some((room: Json) => room.unitId === h.unit_id)),
  );
  const old = before.holds.find((h: Json) => h.id === p.rooms[0].expectedHoldId),
    changed = after.holds.find((h: Json) => h.id === old.id);
  expect(changed.status).toBe("cancelled");
  expect(changed.reserver_name).toBe(old.reserver_name);
  expect(changed.updated_by).toBe(actor);
  expect(changed.last_reason).toBe(p.reason);
  expect(changed.cancelled_at).not.toBeNull();
  expect(
    Object.fromEntries(
      Object.entries(changed).filter(
        ([k]) => !["status", "updated_at", "updated_by", "cancelled_at", "last_reason"].includes(k),
      ),
    ),
  ).toEqual(
    Object.fromEntries(
      Object.entries(old).filter(
        ([k]) => !["status", "updated_at", "updated_by", "cancelled_at", "last_reason"].includes(k),
      ),
    ),
  );
  for (const row of r.data.verification.reservations) {
    const requestRoom = p.rooms.find((room: Json) => room.unitId === row.unit_id);
    expect(Number(row.property_fee_amount_xof)).toBe(requestRoom.propertyFeeAmountXof);
    expect(row.property_period_start).toBe("2027-01-01");
    expect(row.property_period_end).toBe("2027-12-31");
    const property = r.data.verification.payments.find(
      (x: Json) => x.id === row.property_payment_id,
    );
    expect(property.source_type).toBe("cimac_apartment_property_fee");
    expect(property.external_receipt_no).toBe(p.externalReceiptNo);
    expect(Number(property.amount)).toBe(requestRoom.propertyFeeAmountXof);
    expect(property.receipt_no).toMatch(/^WB-CIMAC-B17-L-\d+-20261117-PROP-\d+$/);
    const ledger = r.data.verification.ledger.find((x: Json) => x.payment_id === property.id);
    expect(ledger.category).toBe("property_fee");
    expect(ledger.direction).toBe("income");
    expect(Number(ledger.amount_xof)).toBe(requestRoom.propertyFeeAmountXof);
  }
  expect(
    r.data.verification.payments.reduce((sum: number, x: Json) => sum + Number(x.amount), 0),
  ).toBe(p.totalAmountXof);
  for (const key of ["units", "profiles", "flags", "leases", "daily", "receivables"])
    expect(after[key]).toEqual(before[key]);
  expect(after.receipts).toHaveLength(before.receipts.length + 1);
  expect(after.payments).toHaveLength(before.payments.length + 6);
  expect(after.ledger).toHaveLength(before.ledger.length + 6);
  expect(await execute(p)).toEqual({ ...r, idempotent: true });
  await login();
  expect(
    (await db.query("select cimac_apartment_paid_receipt_status_rpc($1) value", [p.requestId]))
      .rows[0].value.data,
  ).toEqual(r.data);
});

it("v2 rejects stale, wrong, missing and malformed hold expectations with the entire batch unchanged", async () => {
  const base = await combinedInput(2, 2),
    before = await snapshot();
  for (const change of [
    (p: Json) => (p.rooms[1].expectedHoldId = randomUUID()),
    (p: Json) => (p.rooms[1].expectedHoldUpdatedAt = "2000-01-01T00:00:00Z"),
    (p: Json) => {
      p.rooms[0].expectedHoldId = null;
      p.rooms[0].expectedHoldUpdatedAt = null;
    },
    (p: Json) => (p.rooms[0].expectedHoldUpdatedAt = null),
    (p: Json) => (p.rooms[0].expectedHoldId = null),
    (p: Json) => (p.rooms[1].expectedHoldId = p.rooms[0].expectedHoldId),
  ]) {
    const p = structuredClone(base);
    change(p);
    await expect(execute(p)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  }
});

it("v2 validates the annual profile fee, complete period, totals, version and field whitelist", async () => {
  const base = await combinedInput(),
    before = await snapshot();
  for (const change of [
    (p: Json) => p.rooms[0].propertyFeeAmountXof++,
    (p: Json) => {
      p.rooms[0].propertyFeeAmountXof++;
      p.totalAmountXof++;
    },
    (p: Json) => (p.rooms[0].propertyFeeAmountXof = "360000"),
    (p: Json) => (p.rooms[0].propertyPeriodStart = "2027-02-01"),
    (p: Json) => (p.rooms[0].propertyPeriodEnd = "2027-11-30"),
    (p: Json) => delete p.rooms[0].propertyPeriodEnd,
    (p: Json) => delete p.schemaVersion,
    (p: Json) => (p.schemaVersion = 1),
    (p: Json) => (p.schemaVersion = "2"),
    (p: Json) => (p.rooms[0].propertyPaymentId = randomUUID()),
  ]) {
    const p = structuredClone(base);
    change(p);
    await expect(execute(p)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  }
});

it("v2 retains finance permission for no-hold receipts without granting finance the admin-only hold cancellation", async () => {
  const held = await combinedInput(1, 1),
    finance = await person("finance"),
    before = await snapshot();
  await expect(execute(held, finance)).rejects.toThrow(/Denied/);
  expect(await snapshot()).toEqual(before);
  const empty = await combinedInput();
  expect((await execute(empty, finance)).data.verification.payments).toHaveLength(3);
});

it("v2 rolls cancellation and all three cash rows back on a late failure", async () => {
  const p = await combinedInput(2, 2),
    before = await snapshot();
  await owner(
    "create function private.synthetic_combined_failure() returns trigger language plpgsql as $$ begin raise exception 'SyntheticCombinedLateFailure'; end $$; create trigger synthetic_combined_failure before insert on cimac_apartment_paid_reservations for each row execute function private.synthetic_combined_failure()",
  );
  try {
    await expect(execute(p)).rejects.toThrow(/SyntheticCombinedLateFailure/);
  } finally {
    await owner(
      "drop trigger synthetic_combined_failure on cimac_apartment_paid_reservations; drop function private.synthetic_combined_failure()",
    );
  }
  expect(await snapshot()).toEqual(before);
});

it("v2 protects property money and period metadata against edits, source escape, deletion and fabrication", async () => {
  const r = await execute(await combinedInput()),
    before = await snapshot();
  const property = r.data.verification.payments.find(
    (x: Json) => x.source_type === "cimac_apartment_property_fee",
  );
  await login();
  await expect(
    db.query("update payments set source_type='manual',request_kind=null where id=$1", [
      property.id,
    ]),
  ).rejects.toThrow(/PaidImmutable/);
  await expect(db.query("delete from payments where id=$1", [property.id])).rejects.toThrow(
    /PaidImmutable/,
  );
  await expect(
    owner(
      "update cimac_apartment_paid_reservations set property_period_end='2028-12-31' where id=$1",
      [r.data.reservationIds[0]],
    ),
  ).rejects.toThrow(/PaidImmutable/);
  await login();
  await expect(
    db.query(
      "insert into payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,request_id) values($1,$2,$3,'cimac_apartment_property_fee',$4,'2026-11-17',1,'XOF',1,'cash',$5)",
      [randomUUID(), property.customer_id, property.unit_id, property.source_id, randomUUID()],
    ),
  ).rejects.toThrow(/PaidMoneyDenied/);
  expect(await snapshot()).toEqual(before);
});

it("v2 serializes a held-room exact retry without repeating cancellation or any cash row", async () => {
  const p = await combinedInput(1, 1),
    other = await cluster.connect();
  try {
    const [one, two] = await Promise.all([execute(p), execute(p, actor, other)]);
    expect([one.idempotent, two.idempotent].sort()).toEqual([false, true]);
    expect(one.data).toEqual(two.data);
    expect(one.data.verification.payments).toHaveLength(3);
    expect(one.data.verification.unpaidReservations).toHaveLength(1);
    expect(one.data.verification.unpaidReservations[0].status).toBe("cancelled");
  } finally {
    await other.end();
  }
});
