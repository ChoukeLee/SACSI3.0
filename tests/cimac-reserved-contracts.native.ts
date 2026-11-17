import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

type Json = Record<string, any>;
const migration = "20261117195243_cimac_materialize_reserved_contracts.sql";
const actor = randomUUID(),
  secondAdmin = randomUUID(),
  outsider = randomUUID();
const project = randomUUID(),
  otherProject = randomUUID(),
  building = randomUUID(),
  otherBuilding = randomUUID();
const roles = new Map<string, string>([
  [actor, "admin"],
  [secondAdmin, "admin"],
  [outsider, "admin"],
]);
for (const role of ["finance", "boss", "rental_sales", "front_desk"]) roles.set(randomUUID(), role);
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>,
  db: pg.Client,
  sequence = 600;

async function owner(sql: string, args: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, args);
}
async function login(
  id: string | null = actor,
  client = db,
  jwtRole = "authenticated",
  databaseRole = "authenticated",
) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: id,
      role: jwtRole,
      app_metadata: { role: "admin" },
      user_metadata: { role: "admin" },
    }),
  ]);
  if (!["authenticated", "anon", "service_role"].includes(databaseRole))
    throw Error("unsupported_synthetic_role");
  await client.query(`set role ${databaseRole}`);
}
async function execute(
  input: Json,
  request: string = randomUUID(),
  id: string | null = actor,
  client = db,
) {
  await login(id, client);
  return (
    await client.query("select public.cimac_reserved_contracts_rpc($1,$2) value", [request, input])
  ).rows[0].value;
}
const snapshotSql = `select jsonb_build_object(
 'customers',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.customers x),
 'units',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.units x),
 'flags',(select coalesce(jsonb_agg(to_jsonb(x) order by unit_id,business_type),'[]') from public.unit_business_flags x),
 'memberships',(select coalesce(jsonb_agg(to_jsonb(x) order by project_id,customer_id),'[]') from private.cimac_customer_memberships x),
 'links',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from private.cimac_customer_unit_links x),
 'leases',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.lease_contracts x),
 'sales',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.sale_contracts x),
 'daily',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.daily_bookings x),
 'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.payments x),
 'ledger',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.ledger_entries x),
 'receivables',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.receivables x),
 'fees',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.property_fee_rules x),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.audit_logs x),
 'journal',(select coalesce(jsonb_agg(to_jsonb(x) order by request_id),'[]') from private.cimac_reserved_contract_requests x)) value`;
async function snapshot(): Promise<Json> {
  return (await owner(snapshotSql)).rows[0].value;
}

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  expect(await installApplicationRebuild(db)).toContain(migration);
  for (const [id, role] of roles) {
    await owner("insert into auth.users(id,email) values($1,$2)", [id, `${id}@test.invalid`]);
    await db.query(
      "insert into public.user_profiles(id,role,display_name) values($1,$2,'Synthetic actor')",
      [id, role],
    );
  }
  await owner(
    "insert into public.projects(id,code,display_name,access_mode,allows_long_lease,allows_sale) values($1,'CIMAC','Synthetic park','restricted',true,true),($2,'OTHER','Synthetic unrelated park','open',true,true)",
    [project, otherProject],
  );
  for (const id of roles.keys())
    if (id !== outsider)
      await db.query(
        "insert into public.project_account_access(project_id,account_email,account_id) values($1,$2,$3)",
        [project, `${id}@test.invalid`, id],
      );
  await db.query(
    "insert into public.buildings(id,project_id,code,display_name) values($1,$2,'CIMAC-B06','Synthetic commercial building'),($3,$4,'OTHER-B06','Synthetic other building')",
    [building, project, otherBuilding, otherProject],
  );
}, 60000);
afterAll(async () => {
  await cluster?.close();
});

async function fixture(count = 2): Promise<Json> {
  const name = `Synthetic reserved customer ${randomUUID()}`,
    unitInputs: Json[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID(),
      no = String(++sequence);
    await owner(
      "insert into public.units(id,building_id,code,unit_no,floor_label,kind,asset_subtype,status,area_sqm,reservation_holder_name,construction_status,occupancy_verified,notes) values($1,$2,$3,$4,'G','storefront','commercial_shop','reserved',64,$5,'unverified',false,'Preserve original unit documentary notes')",
      [id, building, `CIMAC-B06-${no}`, no, name],
    );
    await db.query(
      "insert into public.unit_business_flags(unit_id,business_type,is_enabled) values($1,'long_lease',true)",
      [id],
    );
    await db.query(
      "insert into public.property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,notes) values($1,57600,'2027-04-01','2028-03-31','Preserve pre-existing fee rule')",
      [id],
    );
    unitInputs.push({
      unitId: id,
      monthlyRentXof: "900000",
      depositXof: "2700000",
      sourceReference: `Synthetic confirmed reservation for ${no}; no signed/start dates supplied`,
    });
  }
  const profile = {
    rows: [
      {
        rowKey: randomUUID(),
        customerId: null,
        expectedUpdatedAt: null,
        name,
        phone: null,
        notes: "Preserve existing customer identity and documentary links",
        membershipStatus: "current",
        sourceReference: "Synthetic explicit customer membership",
        links: unitInputs.map((u) => ({
          unitId: u.unitId,
          brand: null,
          relationshipKind: "reservation",
          signingState: "unconfirmed",
          signedDate: null,
          sourceReference: u.sourceReference,
        })),
      },
    ],
  };
  await login();
  const saved = (
    await db.query("select public.cimac_customer_profiles_sync_rpc($1,$2) value", [
      randomUUID(),
      profile,
    ])
  ).rows[0].value;
  const customerId = saved.rows[0].customerId;
  const customer = (
    await owner("select to_jsonb(c)->>'updated_at' stamp from public.customers c where id=$1", [
      customerId,
    ])
  ).rows[0];
  for (const u of unitInputs)
    u.expectedUnitUpdatedAt = (
      await owner("select to_jsonb(u)->>'updated_at' stamp from public.units u where id=$1", [
        u.unitId,
      ])
    ).rows[0].stamp;
  return {
    customerId,
    customerName: name,
    expectedCustomerUpdatedAt: customer.stamp,
    reason:
      "Materialize explicitly confirmed existing reservations; no receipt or commencement assertion",
    units: unitInputs,
  };
}
async function changeLinks(input: Json, patch: Json) {
  const c = (
    await owner(
      "select to_jsonb(c) row,to_jsonb(c)->>'updated_at' stamp from public.customers c where id=$1",
      [input.customerId],
    )
  ).rows[0];
  await login();
  await db.query("select public.cimac_customer_profiles_sync_rpc($1,$2)", [
    randomUUID(),
    {
      rows: [
        {
          rowKey: randomUUID(),
          customerId: input.customerId,
          expectedUpdatedAt: c.stamp,
          name: c.row.name,
          phone: c.row.phone,
          notes: c.row.notes,
          membershipStatus: "current",
          sourceReference: "Synthetic link-state negative fixture",
          links: input.units.map((u: Json) => ({
            unitId: u.unitId,
            brand: null,
            relationshipKind: "reservation",
            signingState: "unconfirmed",
            signedDate: null,
            sourceReference: u.sourceReference,
            ...patch,
          })),
        },
      ],
    },
  ]);
  input.expectedCustomerUpdatedAt = (
    await owner("select to_jsonb(c)->>'updated_at' stamp from public.customers c where id=$1", [
      input.customerId,
    ])
  ).rows[0].stamp;
}
async function rejectUnchanged(input: Json, pattern: RegExp = /cimacReserved/, id: string = actor) {
  const before = await snapshot();
  await expect(execute(input, randomUUID(), id)).rejects.toThrow(pattern);
  expect(await snapshot()).toEqual(before);
}

it("reuses the existing identity and reserved links to create only two unsigned, unstarted XOF draft contracts", async () => {
  const input = await fixture(),
    request = randomUUID(),
    before = await snapshot(),
    result = await execute(input, request),
    after = await snapshot();
  expect(result).toMatchObject({
    success: true,
    requestId: request,
    actorId: actor,
    projectId: project,
    idempotent: false,
  });
  expect(result.contracts).toHaveLength(2);
  expect(result.contracts.map((c: Json) => c.unitId)).toEqual(
    input.units.map((u: Json) => u.unitId),
  );
  const ids = result.contracts.map((c: Json) => c.contractId);
  expect(new Set(ids).size).toBe(2);
  const fresh = after.leases.filter((c: Json) => ids.includes(c.id));
  expect(fresh).toHaveLength(2);
  for (const c of fresh) {
    const terms = input.units.find((u: Json) => u.unitId === c.unit_id);
    expect(c).toMatchObject({
      customer_id: input.customerId,
      status: "draft",
      commencement_state: "pending_project_opening",
      signing_state: "pending_confirmation",
      start_date: null,
      expected_end_date: null,
      actual_end_date: null,
      paid_through_date: null,
      signer_name: null,
      expected_end_confirmed: false,
      deposit_received: false,
      deposit_months: 3,
      rent_currency: "XOF",
    });
    // The rebuild snapshot may predate this nullable production-only date column.
    expect(c.signed_date ?? null).toBeNull();
    expect(Number(c.monthly_rent_xof)).toBe(Number(terms.monthlyRentXof));
    expect(Number(c.deposit_amount_xof)).toBe(Number(terms.depositXof));
    expect(c.source_reference).toContain(terms.sourceReference);
  }
  expect(after.leases.filter((c: Json) => !ids.includes(c.id))).toEqual(before.leases);
  for (const key of [
    "customers",
    "units",
    "flags",
    "memberships",
    "links",
    "sales",
    "daily",
    "payments",
    "ledger",
    "receivables",
    "fees",
  ])
    expect(after[key]).toEqual(before[key]);
  const audits = after.audit.filter((a: Json) => !before.audit.some((b: Json) => a.id === b.id));
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    entity_type: "cimac_reserved_contracts",
    entity_id: request,
    actor_id: actor,
    actor_role: "admin",
    metadata: {
      input,
      request_id: request,
      channel: "cimac_reserved_contracts_rpc",
      non_financial: true,
    },
  });
  expect(audits[0].metadata.result).toEqual(result);
});

it("recovers the same immutable request without another contract or audit", async () => {
  const p = await fixture(),
    request = randomUUID(),
    first = await execute(p, request),
    before = await snapshot(),
    second = await execute(p, request);
  expect(second).toEqual({ ...first, idempotent: true });
  expect(await snapshot()).toEqual(before);
});
it("rejects different payload or a different actor under a previously completed request", async () => {
  const p = await fixture(),
    request = randomUUID();
  await execute(p, request);
  const before = await snapshot();
  await expect(execute({ ...p, reason: "Changed reason" }, request)).rejects.toThrow(
    /cimacReservedRequestConflict/,
  );
  await expect(execute(p, request, secondAdmin)).rejects.toThrow(/cimacReservedRequestConflict/);
  expect(await snapshot()).toEqual(before);
});
it.each(["finance", "boss", "rental_sales", "front_desk"])(
  "rejects real %s despite forged admin claims",
  async (role) => {
    const id = [...roles].find(([, r]) => r === role)![0];
    await rejectUnchanged(await fixture(), /cimacReservedPermissionDenied|permission denied/i, id);
  },
);
it("rejects an admin without the restricted CIMAC project grant", async () => {
  await rejectUnchanged(
    await fixture(),
    /cimacReservedPermissionDenied|permission denied/i,
    outsider,
  );
});
it.each(["anon", "service_role"])(
  "does not grant the %s role a privileged shortcut",
  async (role) => {
    const p = await fixture(),
      before = await snapshot();
    await login(actor, db, role, role);
    await expect(
      db.query("select public.cimac_reserved_contracts_rpc($1,$2)", [randomUUID(), p]),
    ).rejects.toThrow(/permission denied|cimacReservedPermissionDenied/i);
    expect(await snapshot()).toEqual(before);
  },
);
it("rejects an absent actor even when client metadata claims admin", async () => {
  const p = await fixture(),
    before = await snapshot();
  await login(null);
  await expect(
    db.query("select public.cimac_reserved_contracts_rpc($1,$2)", [randomUUID(), p]),
  ).rejects.toThrow(/cimacReservedPermissionDenied|permission denied/i);
  expect(await snapshot()).toEqual(before);
});

it.each(["customer", "second unit"])(
  "rejects a stale %s version without materializing the other unit",
  async (which) => {
    const p = await fixture();
    if (which === "customer") p.expectedCustomerUpdatedAt = "2000-01-01T00:00:00Z";
    else p.units[1].expectedUnitUpdatedAt = "2000-01-01T00:00:00Z";
    await rejectUnchanged(p, /cimacReservedSnapshotChanged/);
  },
);
it("rejects a changed holder on the second target atomically", async () => {
  const p = await fixture();
  await owner(
    "update public.units set reservation_holder_name='Different synthetic holder' where id=$1",
    [p.units[1].unitId],
  );
  p.units[1].expectedUnitUpdatedAt = (
    await owner("select to_jsonb(u)->>'updated_at' stamp from public.units u where id=$1", [
      p.units[1].unitId,
    ])
  ).rows[0].stamp;
  await rejectUnchanged(p);
});
it("requires current membership and an unconfirmed reservation link rather than signed documentary evidence", async () => {
  const signed = await fixture();
  await changeLinks(signed, {
    relationshipKind: "signed_contract",
    signingState: "signed_effective",
    signedDate: "2026-11-01",
  });
  await rejectUnchanged(signed);
  const dated = await fixture();
  await changeLinks(dated, { signedDate: "2026-11-01" });
  await rejectUnchanged(dated);
});
it("rejects an archived membership even though its historical links remain", async () => {
  const p = await fixture();
  const c = (
    await owner(
      "select to_jsonb(c) row,to_jsonb(c)->>'updated_at' stamp from public.customers c where id=$1",
      [p.customerId],
    )
  ).rows[0];
  await login();
  await db.query("select public.cimac_customer_profiles_sync_rpc($1,$2)", [
    randomUUID(),
    {
      rows: [
        {
          rowKey: randomUUID(),
          customerId: p.customerId,
          expectedUpdatedAt: c.stamp,
          name: c.row.name,
          phone: c.row.phone,
          notes: c.row.notes,
          membershipStatus: "archived",
          sourceReference: "Synthetic archive fixture",
          links: [],
        },
      ],
    },
  ]);
  p.expectedCustomerUpdatedAt = (
    await owner("select to_jsonb(c)->>'updated_at' stamp from public.customers c where id=$1", [
      p.customerId,
    ])
  ).rows[0].stamp;
  await rejectUnchanged(p);
});
it("rejects a pre-existing draft lease on the later target with no partial contract on the first", async () => {
  const p = await fixture();
  await owner(
    "insert into public.lease_contracts(unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,deposit_months,status,commencement_state,signing_state,expected_end_confirmed) values($1,$2,$3,'annual',5,900000,2700000,3,'draft','pending_project_opening','pending_confirmation',false)",
    [p.units[1].unitId, p.customerId, `SYNTHETIC-${randomUUID()}`],
  );
  await rejectUnchanged(p, /cimacReservedBusinessConflict/);
});
it("rejects a pre-existing sale contract on the later target atomically", async () => {
  const p = await fixture();
  await owner(
    "insert into public.sale_contracts(unit_id,customer_id,contract_no,signed_date,payment_plan_type,total_amount_xof,status) values($1,$2,$3,'2026-01-01','cash',1000000,'draft')",
    [p.units[1].unitId, p.customerId, `SYNTHETIC-${randomUUID()}`],
  );
  await rejectUnchanged(p, /cimacReservedBusinessConflict/);
});
it("rejects an existing receivable instead of materializing a second financial basis", async () => {
  const p = await fixture();
  await owner(
    "insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,currency) values($1,$2,$3,'lease_contract',$4,'lease_deposit','Synthetic existing bill','2028-04-01',100,0,'pending','XOF')",
    [building, p.units[1].unitId, p.customerId, randomUUID()],
  );
  await rejectUnchanged(p, /cimacReservedBusinessConflict/);
});
it("rejects prior cash evidence even when it is not attached to an existing lease", async () => {
  const p = await fixture();
  const payment = (
    await owner(
      "insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,notes) values($1,$2,'synthetic_unallocated_receipt',$3,'2026-11-01',100,'XOF',1,'cash','Synthetic prior cash fact') returning id",
      [p.customerId, p.units[1].unitId, randomUUID()],
    )
  ).rows[0].id;
  await owner(
    "insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,description) values($1,$2,$3,'2026-11-01','liability_in','lease_deposit',100,'XOF','Synthetic prior cash ledger')",
    [building, p.units[1].unitId, payment],
  );
  await rejectUnchanged(p, /cimacReservedBusinessConflict/);
});
it("rejects a foreign project unit rather than accepting a matching commercial shape", async () => {
  const p = await fixture(),
    id = randomUUID();
  await owner(
    "insert into public.units(id,building_id,code,unit_no,floor_label,kind,asset_subtype,status,area_sqm,reservation_holder_name) values($1,$2,$3,'999','G','storefront','commercial_shop','reserved',64,$4)",
    [id, otherBuilding, `OTHER-${id}`, p.customerName],
  );
  p.units[1].unitId = id;
  p.units[1].expectedUnitUpdatedAt = (
    await owner("select to_jsonb(u)->>'updated_at' stamp from public.units u where id=$1", [id])
  ).rows[0].stamp;
  await rejectUnchanged(p, /cimacReservedScopeConflict|cimacReservedPermissionDenied/);
});
it.each(["apartment", "available", "locked"])(
  "rejects an unsuitable %s unit without repurposing it",
  async (change) => {
    const p = await fixture();
    if (change === "apartment")
      await owner(
        "update public.units set kind='apartment',asset_subtype='apartment' where id=$1",
        [p.units[1].unitId],
      );
    else await owner("update public.units set status=$2 where id=$1", [p.units[1].unitId, change]);
    p.units[1].expectedUnitUpdatedAt = (
      await owner("select to_jsonb(u)->>'updated_at' stamp from public.units u where id=$1", [
        p.units[1].unitId,
      ])
    ).rows[0].stamp;
    await rejectUnchanged(p);
  },
);
it.each([
  "unknown top key",
  "unknown unit key",
  "numeric amount",
  "noncanonical amount",
  "fractional amount",
  "zero rent",
  "deposit mismatch",
  "duplicate unit",
  "missing reason",
  "null units",
])("rejects %s as typed input before any effect", async (kind) => {
  const p = await fixture();
  if (kind === "unknown top key") p.sql = "select 1";
  if (kind === "unknown unit key") p.units[0].startDate = "2026-11-17";
  if (kind === "numeric amount") p.units[0].monthlyRentXof = 900000;
  if (kind === "noncanonical amount") p.units[0].monthlyRentXof = "0900000";
  if (kind === "fractional amount") p.units[0].monthlyRentXof = "900000.5";
  if (kind === "zero rent") p.units[0].monthlyRentXof = "0";
  if (kind === "deposit mismatch") p.units[0].depositXof = "1";
  if (kind === "duplicate unit") p.units[1] = { ...p.units[0] };
  if (kind === "missing reason") delete p.reason;
  if (kind === "null units") p.units = null;
  await rejectUnchanged(p, /cimacReservedInvalidRequest/);
});
it("serializes two different requests for the same existing reservations so only one batch can materialize", async () => {
  const p = await fixture(),
    client = await cluster.connect(),
    before = await snapshot();
  const results = await Promise.allSettled([
    execute(p, randomUUID()),
    execute(p, randomUUID(), secondAdmin, client),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const after = await snapshot();
  expect(after.leases).toHaveLength(before.leases.length + 2);
  expect(
    after.audit.filter((a: Json) => a.entity_type === "cimac_reserved_contracts"),
  ).toHaveLength(
    before.audit.filter((a: Json) => a.entity_type === "cimac_reserved_contracts").length + 1,
  );
  for (const key of [
    "customers",
    "units",
    "flags",
    "memberships",
    "links",
    "payments",
    "ledger",
    "receivables",
    "fees",
  ])
    expect(after[key]).toEqual(before[key]);
});
