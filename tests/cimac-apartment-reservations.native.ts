import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

const migration = "20261102193036_cimac_b17_apartment_reservations.sql";
const admin = randomUUID(),
  secondAdmin = randomUUID(),
  finance = randomUUID(),
  boss = randomUUID(),
  sales = randomUUID(),
  desk = randomUUID(),
  outsider = randomUUID();
const project = randomUUID(),
  otherProject = randomUUID(),
  building = randomUUID(),
  shopBuilding = randomUUID(),
  otherBuilding = randomUUID();
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
let applied: string[],
  beforeFacts: unknown,
  beforeUnits: unknown,
  shop: string,
  foreignUnit: string;
const units = new Map<string, { id: string; stamp: string }>();
const facts = `select jsonb_build_object(
 'contracts',(select jsonb_agg(to_jsonb(t) order by id) from public.lease_contracts t),
 'customers',(select jsonb_agg(to_jsonb(t) order by id) from public.customers t),
 'payments',(select jsonb_agg(to_jsonb(t) order by id) from public.payments t),
 'ledger',(select jsonb_agg(to_jsonb(t) order by id) from public.ledger_entries t),
 'receivables',(select jsonb_agg(to_jsonb(t) order by id) from public.receivables t),
 'propertyRules',(select jsonb_agg(to_jsonb(t) order by id) from public.property_fee_rules t),
 'flags',(select jsonb_agg(to_jsonb(t) order by unit_id,business_type) from public.unit_business_flags t)) value`;
const allUnits = "select jsonb_agg(to_jsonb(u) order by id) value from public.units u";
type Operation = {
  type: "reserve" | "cancel" | "correct_name";
  unitId: string;
  expectedUnitUpdatedAt: string;
  expectedReservationId: string | null;
  expectedReservationUpdatedAt: string | null;
  reserverName: string | null;
  reason: string;
};
type Request = { requestId: string; originalInstruction: string; operations: Operation[] };
async function owner(sql: string, parameters: unknown[] = []) {
  if (/^rollback\b/i.test(sql)) {
    const value = await db.query(sql, parameters);
    await db.query("reset role");
    return value;
  }
  await db.query("reset role");
  return db.query(sql, parameters);
}
async function login(actor: string | null = admin) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: actor,
      role: "authenticated",
      app_metadata: { role: "admin" },
      user_metadata: { role: "admin" },
    }),
  ]);
  await db.query("set role authenticated");
}
const reserve = (number = "201", name = "Synthetic reserver"): Operation => {
  const unit = units.get(number)!;
  return {
    type: "reserve",
    unitId: unit.id,
    expectedUnitUpdatedAt: unit.stamp,
    expectedReservationId: null,
    expectedReservationUpdatedAt: null,
    reserverName: name,
    reason: "Explicit synthetic unpaid undated hold",
  };
};
const request = (operations = [reserve()]): Request => ({
  requestId: randomUUID(),
  originalInstruction: "Record these synthetic apartment holds; unpaid and dates not known",
  operations,
});
async function execute(input: Request, actor: string | null = admin) {
  await login(actor);
  return (
    await db.query("select public.cimac_apartment_reservations_execute_rpc($1::jsonb) value", [
      JSON.stringify(input),
    ])
  ).rows[0].value;
}
async function status(requestId: string, actor = admin) {
  await login(actor);
  return (
    await db.query("select public.cimac_apartment_reservations_status_rpc($1) value", [requestId])
  ).rows[0].value;
}
async function count() {
  return (await owner("select count(*)::integer n from public.cimac_apartment_reservations"))
    .rows[0].n;
}
async function rejects(input: Request, message: string, actor: string | null = admin) {
  await owner("savepoint rejected");
  await expect(execute(input, actor)).rejects.toThrow(message);
  await owner("rollback to savepoint rejected");
}
function updateOperation(
  result: { rooms: Array<{ unitId: string; reservationId: string; updatedAt: string }> },
  type: "cancel" | "correct_name",
  name: string | null = null,
): Operation {
  const room = result.rooms[0],
    unit = [...units.values()].find((item) => item.id === room.unitId)!;
  return {
    type,
    unitId: room.unitId,
    expectedUnitUpdatedAt: unit.stamp,
    expectedReservationId: room.reservationId,
    expectedReservationUpdatedAt: room.updatedAt,
    reserverName: name,
    reason: "Explicit synthetic correction or cancellation",
  };
}

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  applied = await installApplicationRebuild(db);
  for (const [id, role] of [
    [admin, "admin"],
    [secondAdmin, "admin"],
    [finance, "finance"],
    [boss, "boss"],
    [sales, "rental_sales"],
    [desk, "front_desk"],
    [outsider, "admin"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@test.invalid`]);
    await db.query(
      "insert into public.user_profiles(id,role,display_name) values($1,$2,'Synthetic operator')",
      [id, role],
    );
  }
  await db.query(
    "insert into public.projects(id,code,display_name,access_mode,allows_long_lease) values($1,'CIMAC','Synthetic park','restricted',true),($2,'OTHER','Synthetic other','restricted',true)",
    [project, otherProject],
  );
  for (const id of [admin, secondAdmin, finance, boss, sales, desk])
    await db.query(
      "insert into public.project_account_access(project_id,account_email,account_id) values($1,$2,$3)",
      [project, `${id}@test.invalid`, id],
    );
  await db.query(
    "insert into public.buildings(id,project_id,code,display_name) values($1,$2,'CIMAC-B17','Synthetic B17'),($3,$2,'CIMAC-B02','Synthetic commercial building'),($4,$5,'OTHER-B17','Synthetic other')",
    [building, project, shopBuilding, otherBuilding, otherProject],
  );
  shop = (
    await db.query(
      "insert into public.units(building_id,code,unit_no,floor_label,kind,asset_subtype,status) values($1,'CIMAC-B02-201','201','G','storefront','commercial_shop','reserved') returning id",
      [shopBuilding],
    )
  ).rows[0].id;
  foreignUnit = (
    await db.query(
      "insert into public.units(building_id,code,unit_no,floor_label,kind,asset_subtype,status) values($1,'OTHER-B17-201','201','2F','apartment','apartment','available') returning id",
      [otherBuilding],
    )
  ).rows[0].id;
  const customer = (
    await db.query(
      "insert into public.customers(name) values('Synthetic original commercial tenant') returning id",
    )
  ).rows[0].id;
  const lease = (
    await db.query(
      "insert into public.lease_contracts(unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,'RESERVATION-SENTINEL',current_date,current_date+365,'monthly',1,100,'draft') returning id",
      [shop, customer],
    )
  ).rows[0].id;
  const payment = (
    await db.query(
      "insert into public.payments(customer_id,unit_id,source_type,source_id,payment_date,amount,currency) values($1,$2,'lease_deposit',$3,current_date,10,'XOF') returning id",
      [customer, shop, lease],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency) values($1,$2,$3,current_date,'liability_in','lease_deposit',10,'XOF')",
    [shopBuilding, shop, payment],
  );
  await db.query(
    "insert into public.receivables(building_id,unit_id,customer_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status,currency) values($1,$2,$3,'lease_contract','lease_rent','Synthetic existing claim',current_date,100,0,'pending','XOF')",
    [shopBuilding, shop, customer],
  );
  await db.query(
    "insert into public.property_fee_rules(unit_id,monthly_amount_xof,start_date,end_date,notes) values($1,123,'2027-04-01','2028-03-31','Synthetic original rule')",
    [shop],
  );
  await login();
  await db.query("select public.cimac_apartments_initialize_rpc($1)", [randomUUID()]);
  const rows = (
    await owner(
      "select id,unit_no,to_char(updated_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') stamp from public.units where building_id=$1 order by unit_no",
      [building],
    )
  ).rows;
  for (const row of rows) units.set(row.unit_no, { id: row.id, stamp: row.stamp });
  beforeFacts = (await owner(facts)).rows[0].value;
  beforeUnits = (await owner(allUnits)).rows[0].value;
}, 45000);
beforeEach(async () => {
  await owner("begin");
});
afterEach(async () => {
  await owner("rollback");
});
afterAll(async () => {
  await cluster?.close();
});

it("installs only schema, with scoped invoker RPCs and no seeded reservations", async () => {
  expect(applied).toContain(migration);
  expect(await count()).toBe(0);
  for (const signature of [
    "public.cimac_apartment_reservations_execute_rpc(jsonb)",
    "public.cimac_apartment_reservations_status_rpc(uuid)",
    "public.cimac_apartment_reservations_protocol_version()",
    "public.can_execute_cimac_apartment_reservations()",
  ])
    expect(
      (
        await owner(
          "select p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p where p.oid=$1::regprocedure",
          [signature],
        )
      ).rows[0],
    ).toEqual({ prosecdef: false, anon: false, service: false, authenticated: true });
  expect(
    (
      await owner(
        "select relrowsecurity from pg_class where oid='public.cimac_apartment_reservations'::regclass",
      )
    ).rows[0].relrowsecurity,
  ).toBe(true);
});
it("uses the real admin profile and B17 ACL, rejecting editable JWT claims and disabled buildings", async () => {
  for (const actor of [finance, boss, sales, desk, outsider, null])
    await rejects(request(), "CimacApartmentsDenied", actor);
  await owner("update public.buildings set is_active=false where id=$1", [building]);
  await rejects(request(), "CimacApartmentsDenied");
  await login();
  expect(
    (await db.query("select public.can_execute_cimac_apartment_reservations() allowed")).rows[0]
      .allowed,
  ).toBe(false);
  expect(await count()).toBe(0);
});
it("atomically reserves eleven unpaid undated apartments, without any other business or occupancy changes", async () => {
  const numbers = ["310", "201", "203", "301", "303", "305", "205", "308", "208", "212", "401"];
  const input = request(
    numbers.map((number, index) =>
      reserve(number, `Synthetic reserver ${index < 3 ? index : index < 6 ? 3 : index - 2}`),
    ),
  );
  const result = await execute(input);
  expect(result).toMatchObject({
    success: true,
    requestId: input.requestId,
    actorId: admin,
    projectId: project,
    buildingId: building,
    idempotent: false,
  });
  expect(result.rooms.map((room: { unitNo: string }) => room.unitNo)).toEqual(numbers);
  expect(await count()).toBe(11);
  for (const room of result.rooms)
    expect(room).toMatchObject({ status: "reserved", paymentStatus: "unpaid" });
  expect((await owner(facts)).rows[0].value).toEqual(beforeFacts);
  expect((await owner(allUnits)).rows[0].value).toEqual(beforeUnits);
  expect(
    (
      await owner(
        "select bool_and(not occupancy_verified and construction_status='unverified' and area_sqm is null) unknown from public.units where building_id=$1",
        [building],
      )
    ).rows[0].unknown,
  ).toBe(true);
  const audit = (
    await owner(
      "select actor_id,actor_role,jsonb_array_length(after_data) n,metadata from public.audit_logs where entity_type='cimac_apartment_reservations' and entity_id=$1",
      [input.requestId],
    )
  ).rows[0];
  expect(audit).toMatchObject({
    actor_id: admin,
    actor_role: "admin",
    n: 11,
    metadata: {
      financial_effect: false,
      dates_confirmed: false,
      source: "apartment_reservation",
      authorization: "explicit_instruction",
      request: input,
    },
  });
  expect(audit.metadata.payload_hash).toHaveLength(64);
});
it("recovers the same verified result without new rows, and status is explicitly historical", async () => {
  const input = request(),
    result = await execute(input);
  expect(await execute(input)).toEqual({ ...result, idempotent: true });
  expect(await count()).toBe(1);
  expect(await status(input.requestId)).toEqual({
    status: "completed_previously",
    verified: false,
    requestId: input.requestId,
    actorId: admin,
    request: input,
    result,
  });
  const absent = randomUUID();
  expect(await status(absent)).toEqual({ status: "not_found", verified: false, requestId: absent });
});
it("rejects same-request changes or reuse by another actor rather than replaying writes", async () => {
  const input = request();
  await execute(input);
  await rejects(
    { ...input, operations: [reserve("201", "A different synthetic name")] },
    "CimacApartmentReservationsRequestConflict",
  );
  await rejects(input, "CimacApartmentReservationsRequestConflict", secondAdmin);
  await owner("savepoint wrong_actor");
  await expect(status(input.requestId, secondAdmin)).rejects.toThrow(
    "CimacApartmentReservationsRequestConflict",
  );
  await owner("rollback to savepoint wrong_actor");
  expect(await count()).toBe(1);
});
it("rejects a whole conflicting batch and preserves earlier held rooms and old financial facts", async () => {
  const first = await execute(request());
  await rejects(
    request([reserve("203"), reserve("201", "Conflicting synthetic reserver")]),
    "CimacApartmentReservationsAlreadyHeld",
  );
  expect(await count()).toBe(1);
  expect((await owner("select id from public.cimac_apartment_reservations")).rows[0].id).toBe(
    first.rooms[0].reservationId,
  );
  expect((await owner(facts)).rows[0].value).toEqual(beforeFacts);
  expect((await owner(allUnits)).rows[0].value).toEqual(beforeUnits);
});
it("cannot touch a same-number commercial shop or an apartment outside B17", async () => {
  for (const unitId of [shop, foreignUnit])
    await rejects(request([{ ...reserve(), unitId }]), "CimacApartmentReservationsScopeDenied");
  await rejects(request([reserve(), reserve()]), "CimacApartmentReservationsDuplicateUnit");
  expect(await count()).toBe(0);
});
it("requires the exact current unit version and refuses locked or occupied business states", async () => {
  const original = reserve();
  await owner("update public.units set updated_at=updated_at+interval '1 second' where id=$1", [
    original.unitId,
  ]);
  await rejects(request([original]), "CimacApartmentReservationsUnitChanged");
  await owner("update public.units set updated_at=$2,operational_condition='locked' where id=$1", [
    original.unitId,
    original.expectedUnitUpdatedAt,
  ]);
  await rejects(request(), "CimacApartmentReservationsBusinessConflict");
  await owner(
    "update public.units set operational_condition='normal',status='daily_occupied' where id=$1",
    [original.unitId],
  );
  // Updating legacy status also changes its timestamp; test the real current stamp.
  const stamp = (
    await owner(
      "select to_char(updated_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') stamp from public.units where id=$1",
      [original.unitId],
    )
  ).rows[0].stamp;
  await rejects(
    request([{ ...original, expectedUnitUpdatedAt: stamp }]),
    "CimacApartmentReservationsBusinessConflict",
  );
  expect(await count()).toBe(0);
});
it("detects a real active lease even while legacy apartment readiness remains unknown", async () => {
  const unit = units.get("203")!;
  const customer = (
    await owner(
      "insert into public.customers(name) values('Synthetic independently leased apartment') returning id",
    )
  ).rows[0].id;
  await owner(
    "insert into public.lease_contracts(unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,'RESERVATION-ACTIVE-CONFLICT',current_date,current_date+365,'monthly',1,350000,'active')",
    [unit.id, customer],
  );
  const stamp = (
    await owner(
      "select to_char(updated_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') stamp from public.units where id=$1",
      [unit.id],
    )
  ).rows[0].stamp;
  const existing = (await owner(facts)).rows[0].value;
  await rejects(
    request([{ ...reserve("203"), expectedUnitUpdatedAt: stamp }]),
    "CimacApartmentReservationsBusinessConflict",
  );
  expect(await count()).toBe(0);
  expect((await owner(facts)).rows[0].value).toEqual(existing);
});
it("corrects a reserver name using reservation CAS and preserves the original audit", async () => {
  const originalRequest = request(),
    held = await execute(originalRequest);
  const change = updateOperation(held, "correct_name", "Synthetic corrected name");
  await rejects(
    request([{ ...change, expectedReservationUpdatedAt: "2000-01-01T00:00:00Z" }]),
    "CimacApartmentReservationsChanged",
  );
  const changed = await execute(request([change]));
  expect(changed.rooms[0]).toMatchObject({
    reservationId: held.rooms[0].reservationId,
    reserverName: "Synthetic corrected name",
    status: "reserved",
    paymentStatus: "unpaid",
  });
  await rejects(originalRequest, "CimacApartmentReservationsDrift");
  expect((await status(originalRequest.requestId)).result).toEqual(held);
  expect(
    (
      await owner(
        "select after_data->0->>'reserver_name' name from public.audit_logs where entity_id=$1",
        [originalRequest.requestId],
      )
    ).rows[0].name,
  ).toBe("Synthetic reserver");
});
it("cancels without deleting history or declaring the room vacant, then allows a new unpaid hold", async () => {
  const originalRequest = request(),
    held = await execute(originalRequest),
    cancelRequest = request([updateOperation(held, "cancel")]);
  const cancelled = await execute(cancelRequest);
  expect(cancelled.rooms[0]).toMatchObject({
    reservationId: held.rooms[0].reservationId,
    reserverName: "Synthetic reserver",
    status: "cancelled",
    paymentStatus: "unpaid",
  });
  expect(await count()).toBe(1);
  expect((await owner(allUnits)).rows[0].value).toEqual(beforeUnits);
  const next = await execute(request([reserve("201", "Synthetic replacement hold")]));
  expect(next.rooms[0].reservationId).not.toBe(held.rooms[0].reservationId);
  expect(await count()).toBe(2);
  await rejects(originalRequest, "CimacApartmentReservationsDrift");
  await rejects(cancelRequest, "CimacApartmentReservationsDrift");
  expect((await owner(facts)).rows[0].value).toEqual(beforeFacts);
});
it("allows independent later construction changes without resetting them during original-request recovery", async () => {
  const input = request(),
    held = await execute(input);
  await owner("update public.units set construction_status='operational' where id=$1", [
    held.rooms[0].unitId,
  ]);
  expect(await execute(input)).toEqual({ ...held, idempotent: true });
  expect(
    (
      await owner("select construction_status,occupancy_verified from public.units where id=$1", [
        held.rooms[0].unitId,
      ])
    ).rows[0],
  ).toEqual({ construction_status: "operational", occupancy_verified: false });
});
it("limits reads to existing CIMAC reader roles and denies ordinary direct writes and forged audit", async () => {
  const held = await execute(request());
  for (const actor of [admin, secondAdmin, finance, boss, sales]) {
    await login(actor);
    expect(
      (await db.query("select count(*)::integer n from public.cimac_apartment_reservations"))
        .rows[0].n,
    ).toBe(1);
  }
  for (const actor of [desk, outsider]) {
    await login(actor);
    expect(
      (await db.query("select count(*)::integer n from public.cimac_apartment_reservations"))
        .rows[0].n,
    ).toBe(0);
  }
  await owner("savepoint direct_update");
  await login();
  expect(
    (
      await db.query(
        "update public.cimac_apartment_reservations set reserver_name='Forged name' where id=$1",
        [held.rooms[0].reservationId],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await db.query("select reserver_name from public.cimac_apartment_reservations where id=$1", [
        held.rooms[0].reservationId,
      ])
    ).rows[0].reserver_name,
  ).toBe("Synthetic reserver");
  await owner("rollback to savepoint direct_update");
  await owner("savepoint direct_insert");
  await login();
  await expect(
    db.query(
      "insert into public.cimac_apartment_reservations(unit_id,building_id,reserver_name,status,created_by,updated_by,last_reason) values($1,$2,'Forged','reserved',$3,$3,'Forged')",
      [units.get("203")!.id, building, admin],
    ),
  ).rejects.toThrow("CimacApartmentReservationsDenied");
  await owner("rollback to savepoint direct_insert");
  await owner("savepoint direct_delete");
  await login();
  await expect(
    db.query("delete from public.cimac_apartment_reservations where id=$1", [
      held.rooms[0].reservationId,
    ]),
  ).rejects.toThrow("permission denied");
  await owner("rollback to savepoint direct_delete");
  await owner("savepoint audit");
  await login();
  await expect(
    db.query(
      "insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values($1,'apartment_reservation_batch','cimac_apartment_reservations',$2,jsonb_build_object('building_id',$3::text,'project_id',$4::text))",
      [admin, randomUUID(), building, project],
    ),
  ).rejects.toThrow("CimacApartmentReservationsAuditDenied");
  await owner("rollback to savepoint audit");
});
it("rejects dates, payment claims, arbitrary fields and incomplete cancellation input", async () => {
  const inputs = [
    { ...request(), payment: 100 },
    request([{ ...reserve(), startDate: "2026-11-03" } as Operation]),
    request([{ ...reserve(), paymentStatus: "paid" } as Operation]),
    request([{ ...reserve(), reserverName: " " }]),
    request([{ ...reserve(), reserverName: "A\nB" }]),
    request([{ ...reserve(), type: "cancel" }]),
    request([{ ...reserve(), expectedUnitUpdatedAt: "tomorrow" }]),
    request([{ ...reserve(), expectedUnitUpdatedAt: "2026-02-30T00:00:00Z" }]),
    request([{ ...reserve(), expectedReservationId: randomUUID() }]),
    { ...request(), originalInstruction: "" },
    request([]),
  ];
  for (const input of inputs) await rejects(input, "CimacApartmentReservationsInvalidRequest");
  expect(await count()).toBe(0);
});

it("serializes overlapping holds across connections and releases a fully rolled-back batch", async () => {
  const first = await cluster.connect(),
    second = await cluster.connect();
  const authenticate = async (client: pg.Client, actor: string) => {
    await client.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: "authenticated" }),
    ]);
    await client.query("set role authenticated");
  };
  let pending: Promise<{ result?: unknown; error?: Error }> | undefined;
  try {
    await authenticate(first, admin);
    await authenticate(second, secondAdmin);
    await first.query("begin");
    await second.query("begin");
    const firstRequest = request(),
      secondRequest = request([reserve("201", "Synthetic second operator")]);
    const held = (
      await first.query("select public.cimac_apartment_reservations_execute_rpc($1::jsonb) value", [
        JSON.stringify(firstRequest),
      ])
    ).rows[0].value;
    const pid = (await second.query("select pg_backend_pid() pid")).rows[0].pid;
    pending = second
      .query("select public.cimac_apartment_reservations_execute_rpc($1::jsonb) value", [
        JSON.stringify(secondRequest),
      ])
      .then((r) => ({ result: r.rows[0].value }))
      .catch((error: Error) => ({ error }));
    let waiting = false;
    for (let index = 0; index < 100 && !waiting; index += 1) {
      await owner("select pg_stat_clear_snapshot()");
      waiting =
        (
          await owner("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1", [
            pid,
          ])
        ).rows[0]?.waiting === true;
      if (!waiting)
        await new Promise((done) => {
          setTimeout(done, 10);
        });
    }
    expect(waiting).toBe(true);
    await first.query("rollback");
    const outcome = await pending;
    expect(outcome.error).toBeUndefined();
    expect(outcome.result).toMatchObject({
      success: true,
      actorId: secondAdmin,
      requestId: secondRequest.requestId,
    });
    const secondResult = outcome.result as { rooms: Array<{ reservationId: string }> };
    expect(secondResult.rooms[0].reservationId).not.toBe(held.rooms[0].reservationId);
    expect(
      (await second.query("select count(*)::integer n from public.cimac_apartment_reservations"))
        .rows[0].n,
    ).toBe(1);
    await second.query("rollback");
    expect(await count()).toBe(0);
    expect((await owner(facts)).rows[0].value).toEqual(beforeFacts);
  } finally {
    await first.query("rollback");
    await pending;
    await second.query("rollback");
    await first.end();
    await second.end();
  }
});
