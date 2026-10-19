import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

vi.mock("server-only", () => ({}));
import { readUnitWorkbench } from "@/features/units/unit-workbench-service";
import { readUnitBusinessContext } from "@/features/units/unit-business-context-read";
import { decodeUnitBusinessContext } from "@/features/units/unit-workbench-model";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;
const f = {
  actor: randomUUID(),
  project: randomUUID(),
  hiddenProject: randomUUID(),
  building: randomUUID(),
  hiddenBuilding: randomUUID(),
  unit: randomUUID(),
  unknownUnit: randomUUID(),
  hiddenUnit: randomUUID(),
  tenant: randomUUID(),
  guest: randomUUID(),
  agent: randomUUID(),
  lease: randomUUID(),
  sale: randomUUID(),
  booking: randomUUID(),
};
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  await db.query("insert into auth.users(id,email) values($1,'asset-reader@test.invalid')", [
    f.actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'finance','Synthetic asset reader')",
    [f.actor],
  );
  for (const [id, restricted] of [
    [f.project, false],
    [f.hiddenProject, true],
  ] as const)
    await db.query(
      "insert into projects(id,code,display_name,access_mode,allows_sale,allows_daily_rental,allows_long_lease) values($1::uuid,$1::text,'Synthetic asset project',$2,true,true,true)",
      [id, restricted ? "restricted" : "open"],
    );
  for (const [building, project] of [
    [f.building, f.project],
    [f.hiddenBuilding, f.hiddenProject],
  ])
    await db.query(
      "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic building')",
      [building, project],
    );
  for (const [id, building, verified] of [
    [f.unit, f.building, true],
    [f.unknownUnit, f.building, false],
    [f.hiddenUnit, f.hiddenBuilding, true],
  ])
    await db.query(
      "insert into units(id,building_id,code,unit_no,floor_label,status,occupancy_verified,construction_status) values($1::uuid,$2,$1::text,$3,'1F','available',$4,'operational')",
      [id, building, id === f.unit ? "101" : id === f.unknownUnit ? "102" : "999", verified],
    );
  for (const [id, name] of [
    [f.tenant, "Explicit tenant and buyer"],
    [f.guest, "Actual guest"],
    [f.agent, "Booking agent"],
  ])
    await db.query("insert into customers(id,name) values($1,$2)", [id, name]);
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,status) values($1::uuid,$2,$3,$1::text,'2026-01-01','2027-01-01','monthly',1,600000,0,'active')",
    [f.lease, f.unit, f.tenant],
  );
  await db.query(
    "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,payment_plan_type,total_amount_xof,total_amount_confirmed,status) values($1::uuid,$2,$3,$1::text,'2026-02-01','fixed_installment',1000000,true,'active')",
    [f.sale, f.unit, f.tenant],
  );
  await db.query(
    "insert into daily_bookings(id,unit_id,customer_id,booking_agent_id,guest_customer_id,check_in,check_out,status,nightly_price_xof,total_amount_xof) values($1,$2,$3,$3,$4,'2026-10-19','2026-10-20','checked_in',40000,40000)",
    [f.booking, f.unit, f.agent, f.guest],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: f.actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
}, 60000);
afterAll(async () => {
  await cluster?.close();
});

/** Local PG only: fixed allowlisted read SQL, with real application RLS and JWT. */
function client(): Pick<SupabaseClient, "from"> {
  const tables = new Set([
    "buildings",
    "units",
    "unit_operational_position",
    "lease_contracts",
    "sale_contracts",
    "daily_bookings",
  ]);
  const simpleColumns = new Set([
    "id",
    "building_id",
    "unit_id",
    "is_active",
    "project_id",
    "code",
    "unit_no",
    "created_at",
  ]);
  return {
    from(table: string) {
      if (!tables.has(table)) throw new Error("Unexpected native asset table");
      const filters: { key: string; value: unknown; in?: boolean }[] = [];
      const orders: { key: string; ascending: boolean }[] = [];
      let columns = "",
        head = false;
      const run = async (from?: number, to?: number) => {
        const identity = (await db.query("select current_user as role,auth.uid() actor")).rows[0];
        expect(identity).toEqual({ role: "authenticated", actor: f.actor });
        const values: unknown[] = [];
        const predicates = filters.map((filter) => {
          if (filter.key === "project.is_active")
            return "exists(select 1 from public.projects p where p.id=t.project_id and p.is_active)";
          if (!simpleColumns.has(filter.key)) throw new Error("Unexpected native asset filter");
          values.push(filter.value);
          return filter.in
            ? `t.${filter.key}=any($${values.length}::uuid[])`
            : `t.${filter.key}=$${values.length}`;
        });
        const where = predicates.length ? ` where ${predicates.join(" and ")}` : "";
        try {
          const count = Number(
            (await db.query(`select count(*) as n from public.${table} t${where}`, values)).rows[0]
              .n,
          );
          if (head) return { data: null, error: null, count };
          let projection = "to_jsonb(t)";
          if (table === "buildings")
            projection +=
              " || jsonb_build_object('project',(select jsonb_build_object('code',p.code,'display_name',p.display_name,'allows_sale',p.allows_sale) from public.projects p where p.id=t.project_id))";
          if (table === "units" && columns.includes("unit_business_flags("))
            projection +=
              " || jsonb_build_object('unit_business_flags',coalesce((select jsonb_agg(to_jsonb(f)) from public.unit_business_flags f where f.unit_id=t.id),'[]'::jsonb))";
          if (table === "lease_contracts" || table === "sale_contracts")
            projection +=
              " || jsonb_build_object('customer',(select jsonb_build_object('name',c.name) from public.customers c where c.id=t.customer_id))";
          if (table === "daily_bookings")
            projection +=
              " || jsonb_build_object('guest',(select jsonb_build_object('name',c.name) from public.customers c where c.id=t.guest_customer_id),'agent',(select jsonb_build_object('name',c.name) from public.customers c where c.id=t.booking_agent_id))";
          const order = orders.length
            ? ` order by ${orders.map((row) => `t.${row.key} ${row.ascending ? "asc" : "desc"}`).join(",")}`
            : "";
          const range = from === undefined ? "" : ` limit ${to! - from + 1} offset ${from}`;
          const rows = (
            await db.query(
              `select ${projection} doc from public.${table} t${where}${order}${range}`,
              values,
            )
          ).rows.map((row) => row.doc);
          return { data: rows, error: null, count };
        } catch (error) {
          return { data: null, error: { message: String(error) }, count: null };
        }
      };
      const query = {
        select(value: string, options?: { head?: boolean }) {
          columns = value;
          head = !!options?.head;
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push({ key, value });
          return query;
        },
        in(key: string, value: unknown[]) {
          filters.push({ key, value, in: true });
          return query;
        },
        order(key: string, options?: { ascending?: boolean }) {
          if (!simpleColumns.has(key)) throw new Error("Unexpected native asset order");
          orders.push({ key, ascending: options?.ascending !== false });
          return query;
        },
        range(from: number, to: number) {
          return run(from, to);
        },
        async maybeSingle() {
          const result = await run();
          return { ...result, data: result.data?.[0] ?? null };
        },
        then(resolve: (value: unknown) => unknown) {
          return run().then(resolve);
        },
      };
      return query;
    },
  } as unknown as Pick<SupabaseClient, "from">;
}

it("keeps the actual declared guest/agent foreign keys required by PostgREST embeds", async () => {
  const result = await db.query(
    "select conname from pg_constraint where conrelid='public.daily_bookings'::regclass and contype='f'",
  );
  expect(result.rows.map((row) => row.conname)).toContain("daily_bookings_guest_customer_id_fkey");
  expect(result.rows.map((row) => row.conname)).toContain("daily_bookings_booking_agent_id_fkey");
});
it("uses security-invoker projections and authenticated RLS to keep restricted-project assets hidden", async () => {
  const result = await readUnitWorkbench(client(), { building: f.building, project: f.project });
  expect(result.rows.map((row) => row.unit.id).sort()).toEqual([f.unit, f.unknownUnit].sort());
  expect(result.scopeTotal).toBe(2);
  expect(result.summary.occupied).toBe(1);
  expect(result.summary.unverified).toBe(1);
  expect(result.rows.find((row) => row.unit.id === f.unit)?.position).toMatchObject({
    ownership: "sold",
    daily_occupied: true,
    lease_occupied: true,
  });
  const hidden = await readUnitWorkbench(client(), {
    building: f.hiddenBuilding,
    unit: f.hiddenUnit,
  });
  expect(hidden.scopeUnavailable).toBe(true);
  expect(hidden.rows).toEqual([]);
  expect(hidden.selected).toBeNull();
});
it("reads all explicit relationship domains and keeps guest distinct from booking agent", async () => {
  const data = decodeUnitBusinessContext(
    await readUnitBusinessContext(client(), f.unit, 1, {
      building: f.building,
      project: f.project,
    }),
    f.unit,
    1,
  );
  expect(data.total).toBe(3);
  expect(data.relations.find((row) => row.type === "daily")).toMatchObject({
    customerId: f.guest,
    customerName: "Actual guest",
    agentId: f.agent,
    agentName: "Booking agent",
  });
  expect(data.relations.find((row) => row.type === "sale")?.customerId).toBe(f.tenant);
  expect(data.relations.find((row) => row.type === "lease")?.customerId).toBe(f.tenant);
  await expect(readUnitBusinessContext(client(), f.hiddenUnit, 1)).rejects.toMatchObject({
    status: 404,
  });
});
it("does not count unverified non-occupied property as verified vacant", async () => {
  const result = await readUnitWorkbench(client(), { building: f.building, filter: "unoccupied" });
  expect(result.total).toBe(0);
  expect(result.rows).toEqual([]);
  expect(result.scopeTotal).toBe(2);
});
it("performs business-context reads without mutation of unit, contract, payment or audit rows", async () => {
  const snapshot = async () =>
    (
      await db.query(
        "select jsonb_build_object('units',(select jsonb_agg(to_jsonb(t) order by id) from public.units t),'leases',(select count(*) from public.lease_contracts),'sales',(select count(*) from public.sale_contracts),'payments',(select count(*) from public.payments),'ledger',(select count(*) from public.ledger_entries),'audit',(select count(*) from public.audit_logs)) snapshot",
      )
    ).rows[0].snapshot;
  const before = await snapshot();
  await readUnitWorkbench(client(), { unit: f.unit });
  await readUnitBusinessContext(client(), f.unit, 1);
  expect(await snapshot()).toEqual(before);
});
