import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import type { ReceiptReadResult } from "../src/features/daily-rentals/receipt-analysis-types";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID();
let a: Awaited<ReturnType<typeof project>>,
  b: Awaited<ReturnType<typeof project>>,
  hidden: Awaited<ReturnType<typeof project>>;
let active: Awaited<ReturnType<typeof room>>, inactive: Awaited<ReturnType<typeof room>>;
let input: Record<string, unknown>;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  await db.query("insert into auth.users(id,email) values($1,'receipt-project@test.invalid')", [
    actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Receipt project test')",
    [actor],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  const dates = (
    await db.query(
      "select current_date::text today,date_trunc('month',current_date)::date::text month_start,(date_trunc('month',current_date)-interval '11 months')::date::text trend_start,(date_trunc('month',current_date)-interval '1 day')::date::text previous_date",
    )
  ).rows[0];
  input = {
    dateFrom: dates.month_start,
    dateTo: dates.today,
    previousFrom: dates.month_start,
    previousTo: dates.today,
    yearFrom: dates.month_start,
    yearTo: dates.today,
    trendFrom: dates.trend_start,
    trendTo: dates.today,
  };
  a = await project();
  b = await project();
  hidden = await project(true);
  active = await room(a.id);
  inactive = await room(a.id, false);
  await payment(active, 100, dates.today, { receipt_no: "MATCH%" });
  await payment(inactive, 200, dates.today, { receipt_no: "MATCH%" });
  const original = await payment(inactive, 50, dates.previous_date);
  await payment(inactive, -50, dates.today, {
    request_kind: "daily_reversal",
    reversal_of_payment_id: original,
  });
  // The original financial guard correctly refuses a reversal after an actual
  // refund. Seed the legitimate correction first, then the later cash refund.
  await payment(inactive, -20, dates.today, { request_kind: "daily_refund" });
  await payment(active, 10, dates.today, { payment_method: "offset" });
  await payment(await room(b.id), 999, dates.today);
  await payment(await room(hidden.id), 777, dates.today);
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function project(restricted = false) {
  const id = randomUUID();
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_daily_rental) values($1,$2,'Synthetic receipt project',$3,true)",
    [id, id, restricted ? "restricted" : "open"],
  );
  return { id };
}
async function room(projectId: string, isActive = true) {
  const building = randomUUID(),
    unit = randomUUID(),
    guest = randomUUID(),
    booking = randomUUID();
  await db.query(
    "insert into buildings(id,project_id,code,display_name,is_active,business_paused) values($1,$2,$3,'Historic receipt building',$4,$5)",
    [building, projectId, building, isActive, !isActive],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,$3,'H-1','1','sold')",
    [unit, building, unit],
  );
  await db.query(
    "insert into unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',false)",
    [unit],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic guest')", [guest]);
  await db.query(
    "insert into daily_bookings(id,unit_id,customer_id,check_in,check_out,total_amount_xof,status) values($1,$2,$3,current_date-2,current_date-1,200,'cancelled')",
    [booking, unit, guest],
  );
  return { building, unit, booking };
}
async function payment(
  f: Awaited<ReturnType<typeof room>>,
  amount: number,
  date: string,
  extras: Record<string, unknown> = {},
) {
  const row = {
    id: randomUUID(),
    unit_id: f.unit,
    source_type: "daily_booking",
    source_id: f.booking,
    payment_date: date,
    amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_method: "cash",
    ...extras,
  };
  const keys = Object.keys(row);
  await db.query(
    `insert into payments(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(row),
  );
  return row.id;
}
async function read(filters: Record<string, unknown> = {}) {
  await db.query("set role authenticated");
  try {
    return (
      await db.query("select daily_receipts_read_rpc($1,1,false) result", [
        { ...input, ...filters },
      ])
    ).rows[0].result as ReceiptReadResult;
  } finally {
    await db.query("reset role");
  }
}

it("one project classifier exactly equals the old per-building aggregation, including historical inactive buildings", async () => {
  const combined = await read({ projectId: a.id }),
    first = await read({ buildingId: active.building }),
    second = await read({ buildingId: inactive.building });
  expect(combined.summary).toEqual({
    gross: 300,
    refund: 20,
    adjustment: -50,
    net: 230,
    count: 4,
    excludedCount: 1,
  });
  for (const key of ["gross", "refund", "adjustment", "net", "count", "excludedCount"] as const)
    expect(combined.summary[key]).toBe(first.summary[key] + second.summary[key]);
  expect(combined.buildings.map((row) => row.id).sort()).toEqual(
    [active.building, inactive.building].sort(),
  );
  for (let i = 0; i < combined.trend.length; i++)
    for (const key of ["net", "count", "excludedCount"] as const)
      expect(combined.trend[i][key]).toBe(first.trend[i][key] + second.trend[i][key]);
});
it("management invokes the strict classifier once for its project and preserves the same daily/current/trend figures", async () => {
  await db.query("set role authenticated");
  try {
    const result = (await db.query("select management_operating_snapshot_rpc($1) result", [a.id]))
      .rows[0].result;
    const receipt = (
      await db.query("select daily_receipts_read_rpc($1,1,false) result", [
        { ...input, projectId: a.id },
      ])
    ).rows[0].result;
    expect(result.dailyNet).toBe(receipt.summary.net);
    expect(result.netCollected).toBe(receipt.summary.net);
    expect(result.excludedCount).toBe(receipt.summary.excludedCount);
    expect(result.trend.map((row: { net: number }) => row.net)).toEqual(
      receipt.trend.map((row: { net: number }) => row.net),
    );
  } finally {
    await db.query("reset role");
  }
  const definition = (
    await db.query(
      "select pg_get_functiondef('public.management_operating_snapshot_rpc(uuid)'::regprocedure) definition",
    )
  ).rows[0].definition;
  expect(definition).not.toContain("for building in");
  expect(definition).toContain("jsonb_build_object('projectId',p_project_id)");
});
it("legacy missing-project building/query inputs remain compatible and project/building scopes intersect", async () => {
  const original = await read({ buildingId: active.building, query: "MATCH%" });
  const scoped = await read({ projectId: a.id, buildingId: active.building, query: "MATCH%" });
  expect(scoped.summary).toEqual(original.summary);
  expect(scoped.rows).toEqual(original.rows);
  expect((await read({ projectId: a.id, query: "MATCH%" })).summary.net).toBe(300);
  expect((await read()).summary.net).toBe(230 + 999);
  expect(
    (await read({ projectId: a.id, buildingId: (await read({ projectId: b.id })).buildings[0].id }))
      .summary.count,
  ).toBe(0);
});
it("restricted or revoked project scope cannot bypass existing RLS or explicit project gates", async () => {
  await expect(read({ projectId: hidden.id })).rejects.toThrow("dailyReceiptsPermissionDenied");
  await db.query(
    "insert into project_account_access(project_id,account_id,account_email) values($1,$2,'receipt-project@test.invalid')",
    [hidden.id, actor],
  );
  expect((await read({ projectId: hidden.id })).summary.net).toBe(777);
  await db.query("delete from project_account_access where project_id=$1 and account_id=$2", [
    hidden.id,
    actor,
  ]);
  await expect(read({ projectId: hidden.id })).rejects.toThrow("dailyReceiptsPermissionDenied");
  expect((await read()).rows.some((row) => row.amount === 777)).toBe(false);
});
it.each([1, [], {}, "not-a-uuid"])(
  "rejects malformed internal projectId %j without widening the external API",
  async (projectId) => {
    await expect(read({ projectId })).rejects.toThrow("invalidDailyReceiptsFilter");
  },
);
it("retains invoker/STABLE attributes and no anonymous execute after definition patching", async () => {
  const attributes = (
    await db.query(
      "select prosecdef,provolatile,has_function_privilege('anon',oid,'execute') anonymous from pg_proc where oid='public.daily_receipts_read_rpc(jsonb,integer,boolean)'::regprocedure",
    )
  ).rows[0];
  expect(attributes).toEqual({ prosecdef: false, provolatile: "s", anonymous: false });
});
