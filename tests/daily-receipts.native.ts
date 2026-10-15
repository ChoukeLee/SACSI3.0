import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import type { ReceiptReadResult } from "../src/features/daily-rentals/receipt-analysis-types";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: Awaited<ReturnType<Awaited<ReturnType<typeof createNativePaymentPostgres>>["connect"]>>;
const actor = randomUUID();
const defaults = {
  dateFrom: "2026-10-01",
  dateTo: "2026-10-31",
  previousFrom: "2026-09-01",
  previousTo: "2026-09-30",
  yearFrom: "2025-10-01",
  yearTo: "2025-10-31",
  trendFrom: "2025-11-01",
  trendTo: "2026-10-31",
  method: "all",
  kind: "all",
  query: "",
};
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  await db.query("insert into auth.users(id,email) values($1,'receipts@test.invalid')", [actor]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Receipt test')",
    [actor],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

async function seed(restricted = false) {
  await db.query("reset role");
  const project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID(),
    agent = randomUUID(),
    guest = randomUUID(),
    booking = randomUUID();
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_daily_rental) values($1,$2,'Historic project',$3,true)",
    [project, project, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name,is_active,business_paused) values($1,$2,$3,'Historic building',false,true)",
    [building, project, building],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,$3,'R-100%','1','sold')",
    [unit, building, unit],
  );
  await db.query(
    "insert into unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',false)",
    [unit],
  );
  await db.query(
    "insert into customers(id,name) values($1,'Agent not guest'),($2,'Guest identity')",
    [agent, guest],
  );
  await db.query(
    "insert into daily_bookings(id,unit_id,customer_id,booking_agent_id,guest_customer_id,check_in,check_out,total_amount_xof,status) values($1,$2,$3,$3,$4,'2026-01-01','2026-01-02',100000,'cancelled')",
    [booking, unit, agent, guest],
  );
  return { project, building, unit, agent, guest, booking };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function payment(
  f: Fixture,
  amount = 100,
  date = "2026-10-10",
  extras: Record<string, unknown> = {},
) {
  await db.query("reset role");
  const row = {
    id: randomUUID(),
    unit_id: f.unit,
    source_type: "daily_booking",
    source_id: f.booking,
    payment_date: date,
    amount,
    currency: "XOF",
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
async function read(filters: Record<string, unknown> = {}, page = 1, exported = false) {
  await db.query("set role authenticated");
  try {
    return (
      await db.query<{ result: ReceiptReadResult }>(
        "select public.daily_receipts_read_rpc($1,$2,$3) result",
        [{ ...defaults, ...filters }, page, exported],
      )
    ).rows[0].result;
  } finally {
    await db.query("reset role");
  }
}

it("fresh canonical rebuild installs stable security-invoker read RPC with no anonymous execute", async () => {
  const f = (
    await db.query(
      "select prosecdef,provolatile,proconfig from pg_proc where oid='public.daily_receipts_read_rpc(jsonb,integer,boolean)'::regprocedure",
    )
  ).rows[0];
  expect(f.prosecdef).toBe(false);
  expect(f.provolatile).toBe("s");
  expect(f.proconfig).toContain('search_path=""');
  expect(
    (
      await db.query(
        "select has_function_privilege('anon','public.daily_receipts_read_rpc(jsonb,integer,boolean)','execute') allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
  expect(
    (
      await db.query(
        "select indexdef from pg_indexes where indexname='payments_daily_receipts_date_idx'",
      )
    ).rows[0].indexdef,
  ).toContain("source_type = 'daily_booking'");
});
it("all historical receipts, cancelled orders and disabled/sold units remain visible; full totals exceed a page", async () => {
  const f = await seed();
  await db.query(
    "insert into payments(unit_id,source_type,source_id,payment_date,amount,currency,payment_method) select $1,'daily_booking',$2,'2026-10-10',100,'XOF','cash' from generate_series(1,255)",
    [f.unit, f.booking],
  );
  const result = await read({ buildingId: f.building }, 2);
  expect(result.total).toBe(255);
  expect(result.rows).toHaveLength(50);
  expect(result.summary).toEqual({
    gross: 25500,
    refund: 0,
    adjustment: 0,
    net: 25500,
    count: 255,
    excludedCount: 0,
  });
  expect(result.rows[0]).toMatchObject({
    bookingId: f.booking,
    unitId: f.unit,
    guestName: "Guest identity",
    bookingAgentName: "Agent not guest",
    kind: "collection",
  });
  expect(result.buildings.some((b) => b.id === f.building)).toBe(true);
  const exported = await read({ buildingId: f.building }, 1, true);
  expect(exported.rows).toHaveLength(255);
  expect(exported.summary).toEqual(result.summary);
  const page = await read({ buildingId: f.building }, 100);
  expect(page.rows).toEqual([]);
  expect(page.summary).toEqual(result.summary);
});
it("actual refunds and linked correction reversals are separate; cross-month reversals do not restate the original month", async () => {
  const f = await seed();
  const original = await payment(f, 100, "2026-09-10");
  await payment(f, 300);
  await payment(f, -100, "2026-10-11", {
    request_kind: "daily_reversal",
    reversal_of_payment_id: original,
    payment_method: null,
  });
  await payment(f, -30, "2026-10-12", { request_kind: "daily_refund" });
  const result = await read({ buildingId: f.building });
  expect(result.summary).toEqual({
    gross: 300,
    refund: 30,
    adjustment: -100,
    net: 170,
    count: 3,
    excludedCount: 0,
  });
  expect(result.previous.net).toBe(100);
  expect(result.previous.gross).toBe(100);
  expect(result.rows.find((r) => r.kind === "reversal")).toMatchObject({
    amountXof: -100,
    reversalOf: original,
    paymentMethod: "cash",
  });
  expect(result.trend.find((t) => t.month === "2026-09")?.net).toBe(100);
  expect(result.trend.find((t) => t.month === "2026-10")?.net).toBe(170);
});
it("excludes non-cash offsets, foreign currency, fractional/zero amounts and unknown negatives without hiding their records", async () => {
  const f = await seed();
  await payment(f, 100, "2026-10-10", { payment_method: "offset" });
  await payment(f, 100, "2026-10-10", { currency: "CNY" });
  await payment(f, 100.5);
  await payment(f, 0);
  await payment(f, -100);
  await payment(f, 120, "2026-10-10", { payment_method: null });
  const result = await read({ buildingId: f.building });
  expect(result.total).toBe(6);
  expect(result.summary).toEqual({
    gross: 120,
    refund: 0,
    adjustment: 0,
    net: 120,
    count: 1,
    excludedCount: 5,
  });
  expect(
    result.rows
      .filter((r) => r.kind === "excluded")
      .every((r) => r.amountXof === null && r.exclusionReason),
  ).toBe(true);
  const unknown = await read({ buildingId: f.building, method: "unknown" });
  expect(unknown.total).toBe(1);
  expect(unknown.rows[0].paymentMethod).toBeNull();
  expect(unknown.summary.net).toBe(120);
});
it("invalid linked reversals do not become refunds or normal collections", async () => {
  const f = await seed();
  await payment(f, -100, "2026-10-10", { request_kind: "daily_reversal" });
  const original = await payment(f, 200, "2026-09-01");
  await payment(f, -100, "2026-10-10", {
    request_kind: "daily_reversal",
    reversal_of_payment_id: original,
  });
  const result = await read({ buildingId: f.building });
  expect(result.summary.excludedCount).toBe(2);
  expect(result.summary.net).toBe(0);
  expect(result.rows.every((r) => r.exclusionReason === "invalid_reversal")).toBe(true);
});
it("legacy partial refunds require matching expense evidence, while generic linked negatives stay excluded", async () => {
  const f = await seed();
  const original = await payment(f, 100, "2026-09-01");
  const partial = await payment(f, -30, "2026-10-10", {
    request_kind: "daily_partial_refund",
    reversal_of_payment_id: original,
    payment_method: null,
  });
  await db.query(
    "insert into ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,$3,'2026-10-10','expense','daily_rental',30)",
    [f.building, f.unit, partial],
  );
  const result = await read({ buildingId: f.building });
  expect(result.summary).toMatchObject({
    refund: 30,
    adjustment: 0,
    net: -30,
    count: 1,
    excludedCount: 0,
  });
  expect(result.rows[0]).toMatchObject({ kind: "refund", amountXof: -30 });
  await db.query("delete from ledger_entries where payment_id=$1", [partial]);
  const missing = await read({ buildingId: f.building });
  expect(missing.summary.excludedCount).toBe(1);
  expect(missing.rows[0].exclusionReason).toBe("invalid_partial_refund");
});
it("invalid original non-cash receipts cannot produce cash reversals", async () => {
  const f = await seed();
  const original = await payment(f, 100, "2026-09-01", { payment_method: "offset" });
  await payment(f, -100, "2026-10-10", {
    request_kind: "daily_reversal",
    reversal_of_payment_id: original,
  });
  const result = await read({ buildingId: f.building });
  expect(result.summary.excludedCount).toBe(1);
  expect(result.summary.net).toBe(0);
  expect(result.rows.map((r) => r.exclusionReason)).toEqual(["invalid_reversal"]);
});
it("valid legacy positive kinds are not discarded merely because their operation name evolved", async () => {
  const f = await seed();
  await payment(f, 100, "2026-10-10", {
    request_kind: "daily_receivable_paid_manual",
    payment_method: null,
  });
  expect((await read({ buildingId: f.building })).summary.net).toBe(100);
});
it("exact receipt identity filter remains inside RLS/project scope", async () => {
  const visible = await seed(),
    hidden = await seed(true);
  const visibleId = await payment(visible, 300),
    hiddenId = await payment(hidden, 400);
  await payment(visible, 100);
  const result = await read({ paymentId: visibleId });
  expect(result.total).toBe(1);
  expect(result.rows[0].id).toBe(visibleId);
  expect(result.summary.net).toBe(300);
  expect((await read({ paymentId: hiddenId })).total).toBe(0);
  await expect(read({ paymentId: "invalid" })).rejects.toThrow("invalidDailyReceiptsFilter");
});
it("non-finite legacy amounts remain visible as excluded records, not invalid JSON numbers", async () => {
  const f = await seed();
  await payment(f, 100, "2026-10-10", { amount: "NaN" });
  const result = await read({ buildingId: f.building });
  expect(result.rows[0]).toMatchObject({
    amount: null,
    amountXof: null,
    kind: "excluded",
    exclusionReason: "invalid_amount",
  });
  expect(result.summary).toMatchObject({ count: 0, excludedCount: 1, net: 0 });
});
it("search is literal and filters apply identically to comparison periods and trends", async () => {
  const f = await seed();
  await payment(f, 300, "2026-10-01", { receipt_no: "MATCH%", payment_method: "check" });
  await payment(f, 200, "2026-09-01", { receipt_no: "MATCH%", payment_method: "check" });
  await payment(f, 100, "2025-10-01", { receipt_no: "MATCH%", payment_method: "check" });
  await payment(f, 999, "2026-09-01", { receipt_no: "MATCH%", payment_method: "cash" });
  await payment(f, 999, "2026-10-01", { receipt_no: "MATCH_OTHER", payment_method: "check" });
  const result = await read({
    buildingId: f.building,
    query: "MATCH%",
    method: "check",
    kind: "collection",
  });
  expect(result.total).toBe(1);
  expect(result.summary.net).toBe(300);
  expect(result.previous.net).toBe(200);
  expect(result.year.net).toBe(100);
  expect(result.trend.find((t) => t.month === "2026-09")?.net).toBe(200);
  expect(result.coverage).toEqual({ firstDate: "2025-10-01", lastDate: "2026-10-01" });
});
it("legacy customer identity is not mislabeled as a guest; payment unit remains historical target after a booking correction", async () => {
  const f = await seed(),
    other = await seed();
  await payment(f, 100, "2026-10-10", { unit_id: null });
  await db.query("update daily_bookings set guest_customer_id=null,guest_name=null where id=$1", [
    f.booking,
  ]);
  const first = await read({ buildingId: f.building });
  expect(first.rows[0].guestName).toBeNull();
  expect(first.rows[0].bookingAgentName).toBe("Agent not guest");
  await payment(f, 200, "2026-10-10", { unit_id: other.unit });
  const recorded = await read({ buildingId: other.building });
  expect(recorded.rows[0].unitId).toBe(other.unit);
  expect(recorded.summary.net).toBe(200);
});
it("project restriction also protects legacy null-unit receipts and does not broaden existing permissions", async () => {
  const hidden = await seed(true),
    visible = await seed();
  await payment(hidden, 777, "2026-10-10", { unit_id: null });
  await payment(visible, 100);
  const result = await read();
  expect(result.rows.some((r) => r.bookingId === hidden.booking)).toBe(false);
  expect(result.buildings.some((r) => r.id === hidden.building)).toBe(false);
  await expect(read({ buildingId: hidden.building })).rejects.toThrow(
    "dailyReceiptsPermissionDenied",
  );
  await db.query(
    "insert into project_account_access(project_id,account_id,account_email) values($1,$2,'receipts@test.invalid')",
    [hidden.project, actor],
  );
  const allowed = await read({ buildingId: hidden.building });
  expect(allowed.summary.net).toBe(777);
  expect(allowed.rows[0].unitId).toBe(hidden.unit);
});
it.each(["front_desk", "rental_sales"])(
  "role %s cannot read finance analysis even with a valid account",
  async (role) => {
    await db.query("update user_profiles set role=$1 where id=$2", [role, actor]);
    try {
      await expect(read()).rejects.toThrow("dailyReceiptsPermissionDenied");
    } finally {
      await db.query("update user_profiles set role='admin' where id=$1", [actor]);
    }
  },
);
it.each(["finance", "boss"])("role %s can read under the existing project scope", async (role) => {
  await db.query("update user_profiles set role=$1 where id=$2", [role, actor]);
  try {
    expect((await read()).summary.count).toBeGreaterThan(0);
  } finally {
    await db.query("update user_profiles set role='admin' where id=$1", [actor]);
  }
});
it("missing identity fails before input validation and anonymous execution is rejected", async () => {
  await db.query("select set_config('request.jwt.claims','{}',false)");
  try {
    await expect(read({ dateFrom: "invalid" })).rejects.toThrow("dailyReceiptsPermissionDenied");
  } finally {
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: "authenticated" }),
    ]);
  }
  await db.query("set role anon");
  try {
    await expect(db.query("select public.daily_receipts_read_rpc('{}',1,false)")).rejects.toThrow(
      "permission denied",
    );
  } finally {
    await db.query("reset role");
  }
});
it("a missing JWT role claim cannot turn a low-role profile into permission", async () => {
  await db.query("update user_profiles set role='front_desk' where id=$1", [actor]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor }),
  ]);
  try {
    await expect(read()).rejects.toThrow("dailyReceiptsPermissionDenied");
  } finally {
    await db.query("update user_profiles set role='admin' where id=$1", [actor]);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: "authenticated" }),
    ]);
  }
});
it.each([
  { dateFrom: "2026-10-32" },
  { dateFrom: "2026-02-30" },
  { dateFrom: "2026-1-01" },
  { dateFrom: null },
  { dateFrom: "2026-11-01" },
  { dateFrom: "2024-01-01" },
  { trendFrom: "2024-01-01" },
  { previousTo: "2026-08-31" },
  { yearFrom: 20251001 },
])("rejects invalid or unbounded comparison/trend dates: %j", async (input) => {
  await expect(read(input)).rejects.toThrow("invalidDailyReceiptsDateRange");
});
it.each([
  { method: "credit" },
  { kind: "credit" },
  { buildingId: "not-a-uuid" },
  { query: "a".repeat(121) },
  { query: 1 },
  { extra: true },
])("rejects invalid filter %j", async (input) => {
  await expect(read(input)).rejects.toThrow("invalidDailyReceiptsFilter");
});
it("empty periods return real zeros, finite empty trend buckets and null coverage", async () => {
  const f = await seed();
  const result = await read({ buildingId: f.building });
  expect(result.rows).toEqual([]);
  expect(result.total).toBe(0);
  expect(result.summary).toEqual({
    gross: 0,
    refund: 0,
    adjustment: 0,
    net: 0,
    count: 0,
    excludedCount: 0,
  });
  expect(result.previous).toEqual(result.summary);
  expect(result.year).toEqual(result.summary);
  expect(result.coverage).toEqual({ firstDate: null, lastDate: null });
  expect(result.trend).toHaveLength(12);
  expect(result.trend.every((r) => r.net === 0)).toBe(true);
});
it("export fails rather than truncating after 10000 filtered rows", async () => {
  const f = await seed();
  await db.query(
    "insert into payments(unit_id,source_type,source_id,payment_date,amount,currency,payment_method) select $1,'daily_booking',$2,'2026-10-10',1,'XOF','cash' from generate_series(1,10001)",
    [f.unit, f.booking],
  );
  await expect(read({ buildingId: f.building }, 1, true)).rejects.toThrow(
    "dailyReceiptsExportTooLarge",
  );
  const result = await read({ buildingId: f.building });
  expect(result.total).toBe(10001);
  expect(result.rows).toHaveLength(50);
  expect(result.summary.net).toBe(10001);
}, 30000);
