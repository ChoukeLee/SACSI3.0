import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

const migration = "20261025115930_cimac_customer_profiles_membership_links.sql";
const admin = randomUUID(),
  deniedAdmin = randomUUID(),
  finance = randomUUID(),
  boss = randomUUID();
const project = randomUUID(),
  otherProject = randomUUID(),
  building = randomUUID(),
  otherBuilding = randomUUID();
const units = Array.from({ length: 8 }, () => randomUUID());
const customers = Array.from({ length: 42 }, () => randomUUID());
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
let initialFacts: unknown, companyId: string, companyRequest: string, companyInput: any;
let warehouseId: string;
const factsSql = `select jsonb_build_object(
  'leases',(select jsonb_agg(to_jsonb(x) order by id) from lease_contracts x),
  'payments',(select jsonb_agg(to_jsonb(x) order by id) from payments x),
  'ledger',(select jsonb_agg(to_jsonb(x) order by id) from ledger_entries x),
  'receivables',(select jsonb_agg(to_jsonb(x) order by id) from receivables x),
  'units',(select jsonb_agg(to_jsonb(x) order by id) from units x)) value`;
async function owner(sql: string, args: unknown[] = []) {
  await db.query("reset role");
  return db.query(sql, args);
}
async function login(id: string | null = admin, client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
}
async function sync(
  rows: any[],
  request: string = randomUUID(),
  actor: string | null = admin,
  client = db,
) {
  await login(actor, client);
  return (
    await client.query("select cimac_customer_profiles_sync_rpc($1,$2) value", [request, { rows }])
  ).rows[0].value;
}
async function directory(mode = "list", id: string | null = null, input: any = {}, actor = admin) {
  await login(actor);
  return (
    await db.query("select cimac_customer_directory_read_rpc($1,$2,$3,1) value", [input, mode, id])
  ).rows[0].value;
}
async function account(id: string | null) {
  await login();
  return (await db.query("select cimac_customer_account_rpc($1,null,1) value", [id])).rows[0].value;
}
async function existing(id: string, patch: any = {}) {
  const c = (
    await owner("select id,name,phone,notes,updated_at::text from customers where id=$1", [id])
  ).rows[0];
  return {
    rowKey: id,
    customerId: id,
    expectedUpdatedAt: c.updated_at,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    membershipStatus: "current",
    sourceReference: "Synthetic verified customer sheet",
    links: [],
    ...patch,
  };
}
function fresh(rowKey: string = randomUUID(), links: any[] = []) {
  return {
    rowKey,
    customerId: null,
    expectedUpdatedAt: null,
    name: "Synthetic company",
    phone: "000-test",
    notes: "Preserved synthetic notes",
    membershipStatus: "current",
    sourceReference: "Synthetic authorized profile",
    links,
  };
}
function link(unitId: string, patch: any = {}) {
  return {
    unitId,
    brand: "Synthetic brand",
    relationshipKind: "signed_contract",
    signingState: "signed_effective",
    signedDate: null,
    sourceReference: "Synthetic signed scan + user confirmation",
    ...patch,
  };
}
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const manifest = JSON.parse(
    readFileSync(resolve("supabase/baselines/rebuild-manifest.json"), "utf8"),
  );
  await installApplicationRebuild(
    db,
    manifest.overlays.some((x: any) => x.file === migration) ? { beforeMigration: migration } : {},
  );
  for (const [id, role] of [
    [admin, "admin"],
    [deniedAdmin, "admin"],
    [finance, "finance"],
    [boss, "boss"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1::uuid,$1::text||'@test.invalid')", [
      id,
    ]);
    await db.query("insert into user_profiles(id,role,display_name) values($1,$2,$3)", [
      id,
      role,
      role,
    ]);
  }
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_long_lease,allows_sale) values($1,'CIMAC','Synthetic CIMAC','restricted',true,true),($2,'OTHER','Synthetic other','open',true,true)",
    [project, otherProject],
  );
  await db.query(
    "insert into project_account_access(project_id,account_email,account_id) select $1,id::text||'@test.invalid',id from auth.users where id=any($2::uuid[])",
    [project, [admin, finance, boss]],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'CP-C','Synthetic CIMAC'),($3,$4,'CP-O','Synthetic other')",
    [building, project, otherBuilding, otherProject],
  );
  for (let n = 0; n < units.length; n++)
    await db.query(
      "insert into units(id,building_id,code,unit_no,floor_label,kind,status) values($1,$2,$3,$4,'G','storefront','reserved')",
      [units[n], n >= 6 ? otherBuilding : building, `CP-${n}`, String(100 + n)],
    );
  for (let n = 0; n < customers.length; n++)
    await db.query(
      "insert into customers(id,name,phone,notes,encrypted_document_no) values($1,$2,'original-phone','original-notes','DO-NOT-RETURN-PRIVATE-DOCUMENT')",
      [customers[n], n < 2 ? "Same name" : `Synthetic customer ${n}`],
    );
  for (let n = 0; n < 79; n++) {
    const customer =
      n === 0
        ? customers[0]
        : n === 1
          ? customers[1]
          : n === 2
            ? customers[2]
            : customers[3 + ((n - 3) % 39)];
    const unit = n === 0 ? units[0] : n === 2 ? units[6] : units[1];
    await db.query(
      "insert into lease_contracts(unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,$3,current_date-100,current_date+300,'monthly',1,100,$4)",
      [unit, customer, `CP-LEASE-${n}`, n === 0 ? "draft" : n === 2 ? "active" : "terminated"],
    );
  }
  // A current OTHER-project lease does not prevent hiding this person's old
  // CIMAC membership. Keep the total historical contract fixture at 79.
  await db.query("update lease_contracts set customer_id=$1 where contract_no='CP-LEASE-2'", [
    customers[1],
  ]);
  await db.query(
    "update lease_contracts set customer_id=$1,unit_id=$2,status='active' where contract_no='CP-LEASE-3'",
    [customers[2], units[7]],
  );
  for (let n = 0; n < 98; n++) {
    const p = (
      await db.query(
        "insert into payments(customer_id,unit_id,source_type,payment_date,amount,currency) values($1,$2,'lease_deposit',current_date-10,10,'XOF') returning id",
        [customers[1], units[1]],
      )
    ).rows[0].id;
    await db.query(
      "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency) values($1,$2,$3,current_date-10,'liability_in','lease_deposit',10,'XOF')",
      [building, units[1], p],
    );
  }
  await db.query(
    "insert into receivables(building_id,unit_id,customer_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status,currency) select $1,$2,$3,'lease_contract','lease_rent','Synthetic history',current_date-1,100,0,'pending','XOF' from generate_series(1,2)",
    [building, units[1], customers[1]],
  );
  initialFacts = (await db.query(factsSql)).rows[0].value;
  await db.query(readFileSync(resolve("supabase/migrations", migration), "utf8"));
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

it("installs additively and keeps all 79 contracts/98 payments/98 ledgers/2 receivables byte-for-byte", async () => {
  expect((await owner(factsSql)).rows[0].value).toEqual(initialFacts);
  expect((await db.query("select count(*)::int n from customers")).rows[0].n).toBe(42);
  for (const signature of [
    "cimac_customer_profiles_sync_rpc(uuid,jsonb)",
    "cimac_customer_directory_read_rpc(jsonb,text,uuid,integer)",
  ]) {
    const row = (
      await db.query(
        "select p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p where p.oid=$1::regprocedure",
        [signature],
      )
    ).rows[0];
    expect(row).toEqual({ prosecdef: false, anon: false, service: false, authenticated: true });
  }
});
it("requires a real admin and current CIMAC ACL, not a role supplied in editable claims", async () => {
  for (const actor of [finance, boss, deniedAdmin, null])
    await expect(sync([fresh()], randomUUID(), actor)).rejects.toThrow("CimacCustomerSyncDenied");
  await login(deniedAdmin);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: deniedAdmin, role: "authenticated", user_metadata: { role: "admin" } }),
  ]);
  await expect(
    db.query("select cimac_customer_profiles_sync_rpc($1,$2)", [randomUUID(), { rows: [fresh()] }]),
  ).rejects.toThrow("CimacCustomerSyncDenied");
  await expect(directory("list", null, {}, deniedAdmin)).rejects.toThrow("CimacCustomerSyncDenied");
  await expect(sync([await existing(customers[2])])).rejects.toThrow("CimacCustomerSyncDenied");
});
it("creates one explicitly identified company with multiple links and no synthetic business or cash", async () => {
  companyRequest = randomUUID();
  companyInput = {
    rows: [
      fresh("company-row", [
        link(units[1]),
        link(units[2]),
        link(units[3], { signedDate: "2026-10-12" }),
      ]),
    ],
  };
  const result = await sync(companyInput.rows, companyRequest);
  companyId = result.rows[0].customerId;
  expect(result).toMatchObject({
    success: true,
    actorId: admin,
    requestId: companyRequest,
    projectId: project,
    idempotent: false,
  });
  expect(companyId).not.toBe(customers[0]);
  const data = await directory("detail", companyId);
  expect(data.rows[0]).toMatchObject({
    roomCount: 3,
    relationshipCount: 3,
    roles: ["park_link"],
    membershipStatus: "current",
  });
  expect(
    data.relationships.every((r: any) => r.role === "park_link" && r.status === "signed_effective"),
  ).toBe(true);
  expect(data.relationships.filter((r: any) => r.startDate === null)).toHaveLength(2);
  expect(data.relationships.find((r: any) => r.unitId === units[3])).toMatchObject({
    startDate: "2026-10-12",
    signedDate: "2026-10-12",
    sourceReference: "Synthetic signed scan + user confirmation",
  });
  expect(JSON.stringify(data)).not.toContain("DO-NOT-RETURN-PRIVATE-DOCUMENT");
  expect((await owner(factsSql)).rows[0].value).toEqual(initialFacts);
  const audit = (
    await db.query(
      "select actor_id,actor_role,before_data,after_data,metadata from audit_logs where entity_id=$1",
      [companyRequest],
    )
  ).rows[0];
  expect(audit.actor_id).toBe(admin);
  expect(audit.actor_role).toBe("admin");
  expect(audit.before_data[0].customerId).toBeNull();
  expect(audit.after_data[0].customerId).toBe(companyId);
  expect(audit.after_data[0].links).toHaveLength(3);
});
it("opens an empty company account without leaking another customer's history on the same unit", async () => {
  const data = await account(companyId);
  expect(data.selectedCustomerId).toBe(companyId);
  expect(data.canWrite).toBe(false);
  expect(data.customer.unitCount).toBe(3);
  expect(data.customer.contractCount).toBe(0);
  for (const key of [
    "contracts",
    "receivables",
    "payments",
    "allocations",
    "feeTerms",
    "meterReadings",
  ])
    expect(data[key]).toEqual([]);
  expect(data.customer.balances).toEqual([]);
});
it("supports a member with zero links and zero relationships, without guessing a warehouse unit", async () => {
  const result = await sync([fresh("warehouse-row", [])]);
  warehouseId = result.rows[0].customerId;
  const data = await directory("detail", warehouseId);
  expect(data.rows[0]).toMatchObject({ roomCount: 0, relationshipCount: 0, roles: [] });
  expect(data.relationshipTotal).toBe(0);
  expect((await account(warehouseId)).customer).toMatchObject({
    unitCount: 0,
    contractCount: 0,
    balances: [],
  });
});
it("replays a request exactly and rejects changed input or a different actor", async () => {
  const replay = await sync(companyInput.rows, companyRequest);
  expect(replay).toMatchObject({ idempotent: true });
  expect(replay.rows[0].customerId).toBe(companyId);
  const changed = structuredClone(companyInput.rows);
  changed[0].name = "Changed";
  await expect(sync(changed, companyRequest)).rejects.toThrow("CimacCustomerSyncRequestConflict");
  await owner(
    "insert into project_account_access(project_id,account_email,account_id) values($1,$2,$3)",
    [project, `${deniedAdmin}@test.invalid`, deniedAdmin],
  );
  await expect(sync(companyInput.rows, companyRequest, deniedAdmin)).rejects.toThrow(
    "CimacCustomerSyncRequestConflict",
  );
  expect(
    (await owner("select count(*)::int n from audit_logs where entity_id=$1", [companyRequest]))
      .rows[0].n,
  ).toBe(1);
});
it("retains draft lease status but enriches its exact identity link without double-counting", async () => {
  const before = await directory("detail", customers[0]);
  await sync([
    await existing(customers[0], { links: [link(units[0], { signedDate: "2026-10-17" })] }),
  ]);
  const after = await directory("detail", customers[0]);
  expect(after.relationshipTotal).toBe(before.relationshipTotal);
  expect(after.rows[0].relationshipCount).toBe(before.rows[0].relationshipCount);
  expect(after.relationships[0]).toMatchObject({
    role: "lease",
    status: "draft",
    signingState: "signed_effective",
    signedDate: "2026-10-17",
    brand: "Synthetic brand",
  });
  expect((await directory("list", null, { search: "Same name" })).rows).toHaveLength(2);
});
it("rejects active/draft CIMAC archive but hides a terminated CIMAC member with active business elsewhere", async () => {
  await expect(
    sync([await existing(customers[0], { membershipStatus: "archived" })]),
  ).rejects.toThrow("CimacCustomerSyncArchiveActive");
  const ids = [customers[1], ...customers.slice(4, 8)];
  const archivedRows = [];
  for (const id of ids) archivedRows.push(await existing(id, { membershipStatus: "archived" }));
  await sync(archivedRows);
  const list = await directory();
  expect(list.rows.some((r: any) => ids.includes(r.id))).toBe(false);
  expect(
    (await directory("list", null, { membershipStatus: "archived" })).rows
      .map((r: any) => r.id)
      .sort(),
  ).toEqual([...ids].sort());
  const history = await directory("detail", customers[1]);
  expect(history.rows[0].membershipStatus).toBe("archived");
  expect(history.relationshipTotal).toBeGreaterThan(0);
  await login();
  const other = (
    await db.query("select customer_directory_read_rpc($1,'detail',$2,1) value", [
      { projectId: otherProject },
      customers[1],
    ])
  ).rows[0].value;
  expect(other.rows[0].id).toBe(customers[1]);
  expect((await account(customers[1])).payments).toHaveLength(98);
  expect((await account(null)).customerPage.rows.some((r: any) => ids.includes(r.id))).toBe(false);
  expect((await owner(factsSql)).rows[0].value).toEqual(initialFacts);
});
it("restores a project membership without deleting links, history, or other project visibility", async () => {
  await sync([await existing(warehouseId, { membershipStatus: "archived" })]);
  expect(
    (await directory("list", null, { membershipStatus: "archived" })).rows.some(
      (r: any) => r.id === warehouseId,
    ),
  ).toBe(true);
  await sync([await existing(warehouseId, { membershipStatus: "current" })]);
  expect((await directory("detail", warehouseId)).rows[0]).toMatchObject({
    membershipStatus: "current",
    relationshipCount: 0,
  });
});
it("refuses cross-customer live unit conflicts while retaining terminated history", async () => {
  await expect(sync([fresh("conflict-lease", [link(units[0])])])).rejects.toThrow(
    "CimacCustomerSyncUnitConflict",
  );
  await expect(sync([fresh("conflict-link", [link(units[2])])])).rejects.toThrow(
    "CimacCustomerSyncUnitConflict",
  );
  await expect(sync([fresh("cross-project", [link(units[6])])])).rejects.toThrow(
    "CimacCustomerSyncDenied",
  );
  await expect(
    sync([fresh("same-a", [link(units[4])]), fresh("same-b", [link(units[4])])]),
  ).rejects.toThrow("CimacCustomerSyncUnitConflict");
});
it("introduces an existing global customer by explicit ID and CIMAC links without changing foreign leases", async () => {
  const result = await sync([await existing(customers[2], { links: [link(units[5])] })]);
  expect(result.rows[0].customerId).toBe(customers[2]);
  const data = await directory("detail", customers[2]);
  expect(data.rows[0]).toMatchObject({ roomCount: 1, relationshipCount: 1, roles: ["park_link"] });
  expect((await owner(factsSql)).rows[0].value).toEqual(initialFacts);
});
it("rejects stale versions atomically and never changes a same-name second customer", async () => {
  const row = await existing(customers[8], { name: "Verified explicit ID" });
  const stale = await existing(customers[9], { expectedUpdatedAt: "2000-01-01T00:00:00Z" });
  const before = (
    await owner("select id,name,updated_at from customers where id=any($1::uuid[]) order by id", [
      [customers[8], customers[9]],
    ])
  ).rows;
  const request = randomUUID();
  await expect(sync([row, stale], request)).rejects.toThrow("CimacCustomerSyncConflict");
  expect(
    (
      await owner("select id,name,updated_at from customers where id=any($1::uuid[]) order by id", [
        [customers[8], customers[9]],
      ])
    ).rows,
  ).toEqual(before);
  expect(
    (await db.query("select count(*)::int n from audit_logs where entity_id=$1", [request])).rows[0]
      .n,
  ).toBe(0);
});
it("bounds and whitelists every layer, including date and profile-only field types", async () => {
  const row = fresh();
  for (const bad of [
    { ...row, isBlacklisted: true },
    { ...row, actorId: admin },
    { ...row, name: null },
    { ...row, phone: 123 },
    { ...row, membershipStatus: "deleted" },
    { ...row, expectedUpdatedAt: "2026-10-01" },
    { ...row, links: [link(units[4], { amount: "100" })] },
    { ...row, links: [link(units[4], { signedDate: "2026-02-30" })] },
    { ...row, links: [link(units[4]), link(units[4])] },
  ])
    await expect(sync([bad])).rejects.toThrow("CimacCustomerSyncInvalid");
  await expect(sync([row, row])).rejects.toThrow("CimacCustomerSyncInvalid");
  await expect(directory("list", null, { projectId: otherProject })).rejects.toThrow(
    "CustomerDirectoryDenied",
  );
  await expect(directory("list", null, { buildingId: otherBuilding })).rejects.toThrow(
    "CustomerDirectoryDenied",
  );
});
it("serializes retries and compares versions after waiting for another transaction", async () => {
  const row = await existing(customers[10], { name: "First concurrent writer" });
  const first = await cluster.connect(),
    second = await cluster.connect();
  await login(admin, first);
  await first.query("begin");
  const request = randomUUID();
  const a = await sync([row], request, admin, first);
  let settled = false;
  const pending = sync([row], request, admin, second).finally(() => {
    settled = true;
  });
  await new Promise((done) => {
    setTimeout(done, 80);
  });
  expect(settled).toBe(false);
  await first.query("commit");
  expect(await pending).toMatchObject({ idempotent: true, rows: a.rows });
  const stale = { ...row, name: "Second stale writer" };
  await expect(sync([stale], randomUUID(), admin, second)).rejects.toThrow(
    "CimacCustomerSyncConflict",
  );
});
it("denies direct table writes/audit forgery and preserves every historical financial row after all writes", async () => {
  await login();
  await expect(
    db.query(
      "insert into private.cimac_customer_memberships(project_id,customer_id,status,source_reference,recorded_by) values($1,$2,'current','forged',$3)",
      [project, customers[11], admin],
    ),
  ).rejects.toThrow("CimacCustomerSyncDenied");
  await expect(
    db.query(
      "insert into audit_logs(actor_id,action,entity_type,entity_id,metadata) values($1,'sync','cimac_customer_profile_sync',$2,$3)",
      [admin, randomUUID(), { project_id: project }],
    ),
  ).rejects.toThrow("CimacCustomerSyncDenied");
  expect((await owner(factsSql)).rows[0].value).toEqual(initialFacts);
  expect((await db.query("select count(*)::int n from customers")).rows[0].n).toBe(44);
});
