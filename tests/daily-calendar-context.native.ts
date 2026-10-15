import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { decodeCalendarWindow } from "../src/features/daily-rentals/calendar-window-model";
import {
  decodeCalendarCash,
  decodeCustomerSearch,
} from "../src/features/daily-rentals/calendar-context-model";
import { DAILY_BOOKING_AGENT_NAMES } from "../src/features/daily-rentals/daily-booking-agents";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID(),
  project = randomUUID(),
  building = randomUUID(),
  unit = randomUUID(),
  agent = randomUUID(),
  guest = randomUUID(),
  unrelated = randomUUID();
const hiddenProject = randomUUID(),
  hiddenBuilding = randomUUID(),
  hiddenUnit = randomUUID(),
  stay = randomUUID(),
  cancelled = randomUUID(),
  historical = randomUUID();
let today: string, from: string, to: string, originalWindowHash: string;
const migration = "20261015222541_daily_calendar_independent_context_reads.sql";
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const manifest = JSON.parse(
    readFileSync(resolve("supabase/baselines/rebuild-manifest.json"), "utf8"),
  ) as { overlays: { file: string }[] };
  await installApplicationRebuild(
    db,
    manifest.overlays.some((item) => item.file === migration) ? { beforeMigration: migration } : {},
  );
  originalWindowHash = (
    await db.query(
      "select md5(pg_get_functiondef('daily_calendar_window_rpc(uuid,date,date)'::regprocedure)) hash",
    )
  ).rows[0].hash;
  await db.query(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  await db.query("insert into auth.users(id,email) values($1,'context@test.invalid')", [actor]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic context')",
    [actor],
  );
  await claims(actor);
  await db.query(
    "insert into projects(id,code,display_name,allows_daily_rental,allows_sale,access_mode) values($1,'SACSI','Synthetic',true,true,'open'),($2,'HIDDEN','Restricted',true,true,'restricted')",
    [project, hiddenProject],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'SACSI11','Synthetic'),($3,$4,'SACSI5','Restricted')",
    [building, project, hiddenBuilding, hiddenProject],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,'CTX-1','1','1','daily_occupied'),($3,$4,'CTX-H','H','1','available')",
    [unit, building, hiddenUnit, hiddenBuilding],
  );
  await db.query(
    "insert into unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',true),($2,'daily_rental',true)",
    [unit, hiddenUnit],
  );
  await db.query(
    "insert into customers(id,name,is_blacklisted) values($1,'颖',false),($2,'Guest related only',false),($3,'Unrelated identity',false)",
    [agent, guest, unrelated],
  );
  ({ today, from, to } = (
    await db.query(
      'select current_date::text today,current_date::text "from",(current_date+8)::text "to"',
    )
  ).rows[0]);
  await db.query(
    `insert into daily_bookings(id,unit_id,customer_id,guest_customer_id,check_in,check_out,actual_check_out,checkout_mode,status,nightly_price_xof,total_amount_xof,final_amount_xof,prepaid_amount_xof)
    values($1,$4,$5,$6,current_date-3,null,null,'open','checked_in',50,100,100,10),
    ($2,$4,$7,null,current_date-800,current_date-799,null,'fixed','cancelled',50,50,50,50),
    ($3,$4,$7,null,current_date-700,current_date-698,current_date-698,'fixed','checked_out',50,100,100,100)`,
    [stay, cancelled, historical, unit, agent, guest, unrelated],
  );
  const original = randomUUID();
  await db.query(
    `insert into payments(id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method)
    values($1,$2,'daily_booking',$3,(date_trunc('month',current_date)::date-1),20,'XOF',1,'cash')`,
    [original, unit, stay],
  );
  await db.query(
    `insert into payments(unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,reversal_of_payment_id,request_kind)
    values($1,'daily_booking',$2,current_date,100,'XOF',1,'cash',null,null),
    ($1,'daily_booking',$2,current_date,-20,'XOF',1,'cash',$3,'daily_reversal')`,
    [unit, stay, original],
  );
  await db.query(
    `insert into payments(unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,request_kind)
    values($1,'daily_booking',$2,current_date,-10,'XOF',1,'cash','daily_refund'),
    ($1,'daily_booking',$2,current_date,7,'XOF',1,'offset',null),
    ($1,'daily_booking',$2,current_date,4,'CNY',100,'cash',null),
    ($1,'daily_booking',$3,current_date,30,'XOF',1,'cash',null)`,
    [unit, stay, cancelled],
  );
  await db.query(
    "insert into customers(name,is_blacklisted) select 'Candidate '||lpad(n::text,3,'0'),n=2 from generate_series(1,56)n",
  );
  await db.query(
    `insert into lease_contracts(unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status)
    values($1,$2,'CTX-LEASE',current_date,current_date+30,'monthly',1,100,'active')`,
    [unit, agent],
  );
  await db.query(
    `insert into sale_contracts(unit_id,customer_id,contract_no,signed_date,payment_plan_type,total_amount_xof,status)
    values($1,$2,'CTX-SALE',current_date,'one_time',100,'active')`,
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
async function rpc(name: string, args: unknown[]) {
  await db.query("set role authenticated");
  try {
    return (
      await db.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
        args,
      )
    ).rows[0].result;
  } finally {
    await db.query("reset role");
  }
}
async function windowRead(start = from, end = to) {
  return decodeCalendarWindow(await rpc("daily_calendar_context_rpc", [building, start, end]), {
    buildingId: building,
    from: start,
    to: end,
  });
}
it("keeps the published v1 RPC unchanged and every new read STABLE, INVOKER, authenticated-only", async () => {
  expect(
    (
      await db.query(
        "select md5(pg_get_functiondef('daily_calendar_window_rpc(uuid,date,date)'::regprocedure)) hash",
      )
    ).rows[0].hash,
  ).toBe(originalWindowHash);
  const rows = (
    await db.query(
      `select p.prosecdef,p.provolatile,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.oid in('daily_calendar_context_rpc(uuid,date,date)'::regprocedure,'daily_calendar_cash_summary_rpc(uuid)'::regprocedure,'daily_customer_candidates_rpc(uuid,text,integer,text[])'::regprocedure)`,
    )
  ).rows;
  expect(rows).toHaveLength(3);
  expect(
    rows.every((row) => !row.prosecdef && row.provolatile === "s" && !row.anon && !row.service),
  ).toBe(true);
});
it("removes only receipt-only history; preserves complete billing aggregates and every selected booking's payment evidence", async () => {
  const actual = await windowRead(),
    original = await rpc("daily_calendar_window_rpc", [building, from, to]);
  expect(actual.currentOutstanding).toBe(original.currentOutstanding);
  expect(actual.monthSettled).toBe(original.monthSettled);
  expect(actual.bookings.map((row) => row.id)).toContain(stay);
  expect(actual.bookings.map((row) => row.id)).not.toContain(cancelled);
  const all = (await db.query("select id from payments where source_id=$1", [stay])).rows
    .map((row) => row.id)
    .sort();
  expect(actual.payments.map((row) => row.id).sort()).toEqual(all);
  expect(actual.payments.some((row) => row.reversal_of_payment_id !== null)).toBe(true);
  expect(actual.customers?.map((row) => row.id).sort()).toEqual([agent, guest].sort());
  expect(actual.customers?.find((row) => row.id === agent)).toMatchObject({
    has_active_lease_contract: true,
    has_active_sale_contract: true,
    is_blacklisted: false,
  });
});
it("includes cross-window historical stays and their full history without injecting the unrelated current month's cash bookings", async () => {
  const dates = (
    await db.query('select (current_date-699)::text "from",(current_date-697)::text "to"')
  ).rows[0];
  const actual = await windowRead(dates.from, dates.to);
  expect(actual.bookings.map((row) => row.id)).toContain(historical);
  expect(actual.bookings.map((row) => row.id)).not.toContain(cancelled);
});
it("cash summary exactly matches the strict complete classifier including cancelled history, cross-month reversal, refund, FX and offset exclusions", async () => {
  const summary = decodeCalendarCash(
    await rpc("daily_calendar_cash_summary_rpc", [building]),
    building,
    today,
  );
  const month = `${today.slice(0, 7)}-01`,
    input = {
      dateFrom: month,
      dateTo: today,
      previousFrom: month,
      previousTo: today,
      yearFrom: month,
      yearTo: today,
      trendFrom: month,
      trendTo: today,
      buildingId: building,
      query: "",
      method: "all",
      kind: "all",
    };
  const full = await rpc("daily_receipts_read_rpc", [input, 1, true]);
  expect(summary.cash).toEqual(full.summary);
  expect(summary.cash).toMatchObject({ net: 100, excludedCount: 2 });
  expect(Object.keys(summary).sort()).toEqual([
    "buildingId",
    "cash",
    "generatedAt",
    "month",
    "today",
  ]);
  expect(full.rows.some((row: { bookingId: string }) => row.bookingId === cancelled)).toBe(true);
});
it("candidate pages are authorized and complete, carry blacklist/active flags, and search treats punctuation literally", async () => {
  const query = { buildingId: building, query: "Candidate", page: 1 };
  const first = decodeCustomerSearch(
    await rpc("daily_customer_candidates_rpc", [building, query.query, 1, null]),
    query,
  );
  const second = decodeCustomerSearch(
    await rpc("daily_customer_candidates_rpc", [building, query.query, 2, null]),
    { ...query, page: 2 },
  );
  expect(first.rows).toHaveLength(50);
  expect(first.hasMore).toBe(true);
  expect(second.rows).toHaveLength(6);
  expect(second.hasMore).toBe(false);
  expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(56);
  expect(first.rows.find((row) => row.name === "Candidate 002")?.is_blacklisted).toBe(true);
  const agents = await rpc("daily_customer_candidates_rpc", [
    building,
    "",
    1,
    [...DAILY_BOOKING_AGENT_NAMES],
  ]);
  expect(agents.rows).toEqual([
    expect.objectContaining({
      id: agent,
      has_active_lease_contract: true,
      has_active_sale_contract: true,
    }),
  ]);
  expect((await rpc("daily_customer_candidates_rpc", [building, "%_", 1, null])).rows).toEqual([]);
});
it("does not truncate the cash summary or export after 1000 receipt-only historical payments, and keeps those rows off the calendar", async () => {
  await db.query(
    `insert into payments(unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method)
    select $1,'daily_booking',$2,current_date,1,'XOF',1,'cash' from generate_series(1,1051)`,
    [unit, cancelled],
  );
  const current = await windowRead(),
    summary = decodeCalendarCash(
      await rpc("daily_calendar_cash_summary_rpc", [building]),
      building,
      today,
    );
  const month = `${today.slice(0, 7)}-01`,
    input = {
      dateFrom: month,
      dateTo: today,
      previousFrom: month,
      previousTo: today,
      yearFrom: month,
      yearTo: today,
      trendFrom: month,
      trendTo: today,
      buildingId: building,
      query: "",
      method: "all",
      kind: "all",
    };
  const full = await rpc("daily_receipts_read_rpc", [input, 1, true]),
    legacy = await rpc("daily_calendar_window_rpc", [building, from, to]);
  expect(full.rows).toHaveLength(full.total);
  expect(full.total).toBeGreaterThan(1051);
  expect(summary.cash).toEqual(full.summary);
  expect(summary.cash.net).toBe(1151);
  expect(current.payments.every((payment) => payment.source_id === stay)).toBe(true);
  const before = JSON.stringify(legacy).length,
    after = JSON.stringify(current).length;
  expect(after).toBeLessThan(before / 10);
  process.stdout.write(
    JSON.stringify({
      syntheticCalendarPayload: {
        beforeBytes: before,
        afterBytes: after,
        completeReceiptLines: full.total,
        cashNet: summary.cash.net,
      },
    }) + "\n",
  );
});
it("current account grants are checked again, so revoking a project grant invalidates all three reads", async () => {
  await db.query(
    "insert into project_account_access(project_id,account_email,account_id) values($1,'context@test.invalid',$2)",
    [hiddenProject, actor],
  );
  try {
    await rpc("daily_calendar_context_rpc", [hiddenBuilding, from, to]);
    await rpc("daily_calendar_cash_summary_rpc", [hiddenBuilding]);
    await rpc("daily_customer_candidates_rpc", [hiddenBuilding, "", 1, null]);
  } finally {
    await db.query("delete from project_account_access where project_id=$1 and account_id=$2", [
      hiddenProject,
      actor,
    ]);
  }
  await expect(rpc("daily_calendar_context_rpc", [hiddenBuilding, from, to])).rejects.toThrow(
    "calendarPermissionDenied",
  );
  await expect(rpc("daily_calendar_cash_summary_rpc", [hiddenBuilding])).rejects.toThrow(
    "calendarPermissionDenied",
  );
  await expect(rpc("daily_customer_candidates_rpc", [hiddenBuilding, "", 1, null])).rejects.toThrow(
    "calendarPermissionDenied",
  );
});
it.each(["admin", "boss", "finance", "front_desk", "rental_sales"])(
  "keeps %s's current RLS and role boundaries, including immediate project/role revocation",
  async (role) => {
    await db.query("update user_profiles set role=$1 where id=$2", [role, actor]);
    try {
      expect((await windowRead()).bookings.some((row) => row.id === stay)).toBe(true);
      expect(
        (await rpc("daily_customer_candidates_rpc", [building, "颖", 1, null])).rows,
      ).toHaveLength(1);
      await expect(rpc("daily_calendar_context_rpc", [hiddenBuilding, from, to])).rejects.toThrow(
        "calendarPermissionDenied",
      );
      await expect(rpc("daily_calendar_cash_summary_rpc", [hiddenBuilding])).rejects.toThrow(
        "calendarPermissionDenied",
      );
      await expect(
        rpc("daily_customer_candidates_rpc", [hiddenBuilding, "", 1, null]),
      ).rejects.toThrow("calendarPermissionDenied");
      if (["admin", "boss", "finance"].includes(role))
        await rpc("daily_calendar_cash_summary_rpc", [building]);
      else
        await expect(rpc("daily_calendar_cash_summary_rpc", [building])).rejects.toThrow(
          "calendarPermissionDenied",
        );
      await db.query("update projects set access_mode='restricted' where id=$1", [project]);
      await expect(windowRead()).rejects.toThrow("calendarPermissionDenied");
      await expect(rpc("daily_customer_candidates_rpc", [building, "", 1, null])).rejects.toThrow(
        "calendarPermissionDenied",
      );
    } finally {
      await db.query("update projects set access_mode='open' where id=$1", [project]);
      await db.query("update user_profiles set role='admin' where id=$1", [actor]);
    }
  },
);
it("rejects missing identities/profiles and invalid windows/searches without broadening reads", async () => {
  for (const id of [null, randomUUID()]) {
    await claims(id);
    await expect(windowRead()).rejects.toThrow("calendarPermissionDenied");
    await expect(rpc("daily_calendar_cash_summary_rpc", [building])).rejects.toThrow(
      "calendarPermissionDenied",
    );
    await expect(rpc("daily_customer_candidates_rpc", [building, "", 1, null])).rejects.toThrow(
      "calendarPermissionDenied",
    );
  }
  await claims(actor);
  await expect(
    rpc("daily_customer_candidates_rpc", [building, "x".repeat(81), 1, null]),
  ).rejects.toThrow("invalidDailyCustomerQuery");
  await expect(rpc("daily_customer_candidates_rpc", [building, "", 0, null])).rejects.toThrow(
    "invalidDailyCustomerQuery",
  );
  await expect(windowRead(to, from)).rejects.toThrow("invalidCalendarWindow");
});
