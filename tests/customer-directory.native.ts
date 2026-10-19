import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import {
  decodeCustomerDirectory,
  parseCustomerDirectoryQuery,
} from "../src/features/customers/customer-directory-model";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID(),
  project = randomUUID(),
  building = randomUUID(),
  unit = randomUUID(),
  hiddenProject = randomUUID(),
  hiddenBuilding = randomUUID(),
  hiddenUnit = randomUUID();
const guest = randomUUID(),
  agent = randomUUID(),
  legacy = randomUUID(),
  shared = randomUUID(),
  unassigned = randomUUID();
const stay = randomUUID(),
  legacyStay = randomUUID(),
  sharedStay = randomUUID(),
  hiddenStay = randomUUID();
const migration = "20261019225507_customer_directory_read.sql";
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const installed = await installApplicationRebuild(db);
  if (!installed.includes("20261015222540_contract_workspace_read_models.sql"))
    await db.query(
      readFileSync(
        resolve("supabase/migrations/20261015222540_contract_workspace_read_models.sql"),
        "utf8",
      ),
    );
  if (!installed.includes(migration))
    await db.query(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  await db.query("insert into auth.users(id,email) values($1,'customer-directory@test.invalid')", [
    actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic directory')",
    [actor],
  );
  await claims(actor);
  await db.query(
    "insert into projects(id,code,display_name,allows_sale,allows_daily_rental,access_mode) values($1,'SACSI','Synthetic',true,true,'open'),($2,'HIDDEN','Hidden',true,true,'restricted')",
    [project, hiddenProject],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'DIR-A','Synthetic A'),($3,$4,'DIR-H','Hidden')",
    [building, project, hiddenBuilding, hiddenProject],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,'DIR-101','101','1','available'),($3,$4,'DIR-H101','H101','1','available')",
    [unit, building, hiddenUnit, hiddenBuilding],
  );
  await db.query(
    "insert into customers(id,name,phone,encrypted_document_no,is_blacklisted,blacklist_reason) values($1,'Same name','111','PRIVATE-DOCUMENT',false,null),($2,'Same name','222',null,false,null),($3,'Legacy ambiguous',null,null,false,null),($4,'Shared identity','444',null,true,'Synthetic risk'),($5,'Unassigned customer',null,null,false,null)",
    [guest, agent, legacy, shared, unassigned],
  );
  await db.query(
    "insert into customers(name) select 'Directory customer '||lpad(n::text,3,'0') from generate_series(1,48)n",
  );
  await db.query(
    `insert into daily_bookings(id,unit_id,customer_id,guest_customer_id,booking_agent_id,check_in,check_out,checkout_mode,status,nightly_price_xof,total_amount_xof,prepaid_amount_xof)
    values($1,$5,$6,$7,$6,current_date,current_date+3,'fixed','confirmed',10,30,0),
    ($2,$5,$8,null,$6,current_date-5,current_date-4,'fixed','checked_out',10,10,10),
    ($3,$5,$9,$9,$9,current_date-2,current_date-1,'fixed','checked_out',10,10,10),
    ($4,$10,$7,$7,null,current_date,current_date+1,'fixed','confirmed',10,10,0)`,
    [stay, legacyStay, sharedStay, hiddenStay, unit, agent, guest, legacy, shared, hiddenUnit],
  );
  await db.query(
    "insert into lease_contracts(unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,'DIR-LEASE',current_date-30,current_date+330,'monthly',1,100,'active')",
    [unit, shared],
  );
  await db.query(
    "insert into sale_contracts(unit_id,customer_id,contract_no,signed_date,payment_plan_type,total_amount_xof,status) values($1,$2,'DIR-SALE',current_date,'one_time',100,'active')",
    [unit, shared],
  );
  // More than a single relationship page for an exact known person.
  await db.query(
    "insert into lease_contracts(unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) select $1,$2,'DIR-MANY-'||n,current_date-n,current_date+300,'monthly',1,100,'terminated' from generate_series(1,27)n",
    [unit, agent],
  );
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function claims(id: string | null) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
}
async function read(
  patch: Record<string, string | number> = {},
  mode: "list" | "detail" = "list",
  id?: string,
  page = 1,
) {
  const query = parseCustomerDirectoryQuery(patch);
  await db.query("set role authenticated");
  try {
    const { rows } = await db.query("select customer_directory_read_rpc($1::jsonb,$2,$3,$4) data", [
      JSON.stringify(query),
      mode,
      id ?? null,
      page,
    ]);
    return decodeCustomerDirectory(rows[0].data, query, mode, id, page);
  } finally {
    await db.query("reset role");
  }
}
it("paginates complete authorized customer rows, including no-business records, at the DB boundary", async () => {
  const a = await read(),
    b = await read({ page: 2 });
  expect(a.rows).toHaveLength(40);
  expect(b.rows).toHaveLength(a.total - 40);
  expect(a.total).toBe(53);
  expect(new Set([...a.rows, ...b.rows].map((r) => r.id)).size).toBe(a.total);
  expect([...a.rows, ...b.rows].some((r) => r.id === unassigned)).toBe(true);
  expect(a.profile).toBeNull();
  expect(a.relationships).toEqual([]);
  expect(JSON.stringify(a)).not.toContain("PRIVATE-DOCUMENT");
});
it("keeps exact guest, agent and ambiguous legacy roles separate without merging same names", async () => {
  const g = (await read({ projectId: project, filter: "guest" })).rows;
  expect(g.map((r) => r.id).sort()).toEqual([guest, shared].sort());
  expect(g.find((r) => r.id === guest)?.roles).toEqual(["daily_guest"]);
  const a = (await read({ projectId: project, filter: "contact" })).rows;
  expect(a.find((r) => r.id === agent)?.roles).toEqual(["daily_agent", "lease"]);
  expect((await read({ projectId: project, filter: "unknown" })).rows.map((r) => r.id)).toEqual([
    legacy,
  ]);
  const same = await read({ search: "Same name" });
  expect(same.rows).toHaveLength(2);
  expect(new Set(same.rows.map((r) => r.id)).size).toBe(2);
});
it("deduplicates directory customers but preserves multiple valid roles on one booking", async () => {
  const data = await read({ projectId: project }, "detail", shared);
  expect(data.rows).toHaveLength(1);
  expect(data.rows[0].roles).toEqual(["daily_agent", "daily_guest", "lease", "sale"]);
  expect(data.relationshipTotal).toBe(4);
  expect(
    data.relationships
      .filter((r) => r.id === sharedStay)
      .map((r) => r.role)
      .sort(),
  ).toEqual(["daily_agent", "daily_guest"]);
  expect(data.profile?.is_blacklisted).toBe(true);
  expect(data.profile?.blacklist_reason).toBe("Synthetic risk");
});
it("offers a separate unassociated-visible-project scope without guessing attribution", async () => {
  const data = await read({ projectId: "__unassigned__" });
  expect(data.total).toBe(49);
  expect(data.rows.some((r) => r.id === shared)).toBe(false);
  expect((await read({ projectId: "__unassigned__", search: "Unassigned" })).rows[0].id).toBe(
    unassigned,
  );
  expect((await read({ projectId: project })).rows.some((r) => r.id === unassigned)).toBe(false);
});
it("paginates all detail relationships without loading financial or attachment history", async () => {
  const a = await read({ projectId: project }, "detail", agent),
    b = await read({ projectId: project }, "detail", agent, 2);
  expect(a.relationshipTotal).toBe(29);
  expect(a.relationships).toHaveLength(25);
  expect(b.relationships).toHaveLength(4);
  expect(
    new Set([...a.relationships, ...b.relationships].map((r) => `${r.role}:${r.id}`)).size,
  ).toBe(29);
  expect(a).not.toHaveProperty("payments");
  expect(a).not.toHaveProperty("receivables");
  expect(a).not.toHaveProperty("attachments");
  expect(a.profile).not.toHaveProperty("encrypted_document_no");
});
it("retains searches beyond the first page and treats wildcard text literally", async () => {
  expect((await read({ search: "Directory customer 048" })).rows).toHaveLength(1);
  expect((await read({ search: "%_" })).rows).toEqual([]);
  expect((await read({ projectId: project, search: "101 111" })).rows.map((r) => r.id)).toEqual([
    guest,
  ]);
});
it("does not turn an unconfirmed/sentinel lease end or open checkout estimate into a confirmed date", async () => {
  await db.query(
    "update lease_contracts set expected_end_confirmed=false,expected_end_date='2099-12-31' where contract_no='DIR-LEASE'",
  );
  await db.query(
    "update daily_bookings set checkout_mode='open',check_out=current_date+100 where id=$1",
    [sharedStay],
  );
  try {
    const data = await read({ projectId: project }, "detail", shared);
    const lease = data.relationships.find((r) => r.code === "DIR-LEASE")!;
    expect(lease.endDate).toBeNull();
    expect(lease.endDateKind).toBeNull();
    expect(
      data.relationships
        .filter((r) => r.id === sharedStay)
        .every((r) => r.endDate === null && r.endDateKind === null),
    ).toBe(true);
    await db.query(
      "update lease_contracts set actual_end_date=current_date-1 where contract_no='DIR-LEASE'",
    );
    const actual = (await read({ projectId: project }, "detail", shared)).relationships.find(
      (r) => r.code === "DIR-LEASE",
    )!;
    expect(actual.endDate).toBeTruthy();
    expect(actual.endDateKind).toBe("actual");
  } finally {
    await db.query(
      "update lease_contracts set expected_end_confirmed=true,expected_end_date=current_date+330,actual_end_date=null where contract_no='DIR-LEASE'",
    );
    await db.query(
      "update daily_bookings set checkout_mode='fixed',check_out=current_date-1 where id=$1",
      [sharedStay],
    );
  }
});
it("rejects invalid, cross-project, inaccessible and nonexistent scope without expanding to all", async () => {
  await expect(read({ projectId: randomUUID() })).rejects.toThrow("CustomerDirectoryDenied");
  await expect(read({ projectId: project, buildingId: hiddenBuilding })).rejects.toThrow(
    "CustomerDirectoryDenied",
  );
  await expect(read({ projectId: hiddenProject })).rejects.toThrow("CustomerDirectoryDenied");
  await expect(read({ projectId: project }, "detail", unassigned)).rejects.toThrow(
    "CustomerDirectoryNotFound",
  );
  const data = await read({}, "detail", guest);
  expect(data.relationships.some((r) => r.id === hiddenStay)).toBe(false);
  expect(data.buildings.some((b) => b.id === hiddenBuilding)).toBe(false);
});
it.each(["admin", "boss", "finance", "rental_sales"])(
  "preserves the current %s allowed role with no financial writes",
  async (role) => {
    await db.query("update user_profiles set role=$1 where id=$2", [role, actor]);
    const before = (
      await db.query(
        "select (select count(*) from payments) payments,(select count(*) from ledger_entries) ledger,(select count(*) from receivables) receivables,(select count(*) from audit_logs) audit,(select sum(monthly_rent_xof) from lease_contracts) rent",
      )
    ).rows;
    expect((await read()).total).toBe(53);
    await read({ projectId: project }, "detail", shared);
    expect(
      (
        await db.query(
          "select (select count(*) from payments) payments,(select count(*) from ledger_entries) ledger,(select count(*) from receivables) receivables,(select count(*) from audit_logs) audit,(select sum(monthly_rent_xof) from lease_contracts) rent",
        )
      ).rows,
    ).toEqual(before);
    await db.query("update user_profiles set role='admin' where id=$1", [actor]);
  },
);
it("rejects front desk, revoked roles and anonymous access immediately", async () => {
  await db.query("update user_profiles set role='front_desk' where id=$1", [actor]);
  await expect(read()).rejects.toThrow("CustomerDirectoryDenied");
  await db.query("update user_profiles set role='admin' where id=$1", [actor]);
  await claims(null);
  await expect(read()).rejects.toThrow("CustomerDirectoryDenied");
  await claims(actor);
});
it("is stable invoker and grants neither anonymous nor service-role execution", async () => {
  const row = (
    await db.query(
      "select p.prosecdef,p.provolatile,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p where p.oid='customer_directory_read_rpc(jsonb,text,uuid,integer)'::regprocedure",
    )
  ).rows[0];
  expect(row).toEqual({
    prosecdef: false,
    provolatile: "s",
    anon: false,
    service: false,
    authenticated: true,
  });
});
