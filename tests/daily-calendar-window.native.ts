import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { dailyBookingFinancePosition } from "../src/features/daily-rentals/calendar-finance-model";
import { decodeCalendarWindow } from "../src/features/daily-rentals/calendar-window-model";
import { buildBookingMap } from "../src/features/daily-rentals/room-status";
import type { DailyBookingRow } from "../src/types/database";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID(),
  project = randomUUID(),
  building = randomUUID(),
  unit = randomUUID(),
  guest = randomUUID(),
  otherBuilding = randomUUID(),
  otherUnit = randomUUID();
const oldPaid = randomUUID(),
  oldDebt = randomUUID(),
  openStay = randomUUID(),
  monthCheckout = randomUUID(),
  cleanedBooking = randomUUID(),
  currentPaymentBooking = randomUUID();
let today: string, from: string, to: string;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const installed = await installApplicationRebuild(db);
  const file = "20261015212832_daily_calendar_window_reads.sql";
  if (!installed.includes(file))
    await db.query(readFileSync(resolve("supabase/migrations", file), "utf8"));
  await db.query("insert into auth.users(id,email) values($1,'calendar-window@test.invalid')", [
    actor,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Window test')",
    [actor],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query(
    "insert into projects(id,code,display_name,allows_daily_rental) values($1,'SACSI','Synthetic',true)",
    [project],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'SACSI11','Window'),($3,$2,'SACSI5','Other')",
    [building, project, otherBuilding],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,'WINDOW-1','1','1','available'),($3,$4,'WINDOW-2','2','1','available')",
    [unit, building, otherUnit, otherBuilding],
  );
  await db.query(
    "insert into unit_business_flags(unit_id,business_type,is_enabled,default_price_xof) values($1,'daily_rental',true,50),($2,'daily_rental',true,50)",
    [unit, otherUnit],
  );
  await db.query("insert into customers(id,name) values($1,'Window guest')", [guest]);
  ({ today, from, to } = (
    await db.query(
      'select current_date::text today,(current_date-1)::text "from",(current_date+7)::text "to"',
    )
  ).rows[0]);
  await db.query(
    `insert into daily_bookings(id,unit_id,customer_id,check_in,check_out,actual_check_out,checkout_mode,status,nightly_price_xof,final_amount_xof,prepaid_amount_xof,manual_discount_amount_xof,total_amount_xof)
    values($1,$7,$8,current_date-400,current_date-398,current_date-398,'fixed','checked_out',50,100,100,0,100),
    ($2,$7,$8,current_date-400,current_date-398,current_date-398,'fixed','checked_out',50,100,0,0,100),
    ($3,$7,$8,current_date-100,null,null,'open','checked_in',50,1,20,4,100),
    ($4,$7,$8,(date_trunc('month',current_date)::date-3),current_date,current_date,'fixed','checked_out',50,123,123,0,123),
    ($5,$7,$8,current_date-700,current_date-699,current_date-699,'fixed','checked_out',50,50,50,0,50),
    ($6,$7,$8,current_date-800,current_date-799,current_date-799,'fixed','cancelled',50,50,50,0,50)`,
    [oldPaid, oldDebt, openStay, monthCheckout, cleanedBooking, currentPaymentBooking, unit, guest],
  );
  await db.query(
    "insert into cleaning_tasks(unit_id,daily_booking_id,is_completed) values($1,$2,false)",
    [unit, cleanedBooking],
  );
  await db.query(
    `insert into payments(unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method)
    values($1,'daily_booking',$2,current_date-900,20,'XOF',1,'cash'),($1,'daily_booking',$2,current_date,30,'XOF',1,'cash'),($1,'daily_booking',$3,current_date,50,'XOF',1,'cash'),($1,'daily_booking',$4,current_date-500,50,'XOF',1,'cash')`,
    [unit, openStay, currentPaymentBooking, oldPaid],
  );
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function read(start = from, end = to, target = building) {
  await db.query("set role authenticated");
  try {
    return decodeCalendarWindow(
      (
        await db.query("select public.daily_calendar_window_rpc($1,$2,$3) result", [
          target,
          start,
          end,
        ])
      ).rows[0].result,
      { buildingId: target, from: start, to: end },
    );
  } finally {
    await db.query("reset role");
  }
}
it("matches complete-history financial totals and preserves all current/month/cleaning contexts, not only the visible period", async () => {
  const full = (
    await db.query(
      "select to_jsonb(b) doc from daily_bookings b where unit_id=$1 order by check_in desc,id desc",
      [unit],
    )
  ).rows.map((row) => row.doc) as DailyBookingRow[];
  const expected = dailyBookingFinancePosition(full, today),
    result = await read();
  expect(result.currentOutstanding).toBe(expected.currentOutstanding);
  expect(result.monthSettled).toBe(expected.monthSettled);
  const actualPosition = dailyBookingFinancePosition(result.bookings, today);
  expect(actualPosition.currentOutstanding).toBe(expected.currentOutstanding);
  expect(actualPosition.monthSettled).toBe(expected.monthSettled);
  expect(result.bookings.map((b) => b.id)).toEqual(
    expect.arrayContaining([
      oldDebt,
      openStay,
      monthCheckout,
      cleanedBooking,
      currentPaymentBooking,
    ]),
  );
  expect(result.bookings.map((b) => b.id)).not.toContain(oldPaid);
  const fullPayments = (
    await db.query(
      "select id from payments where source_id=any($1) or payment_date>=date_trunc('month',current_date)::date and unit_id=$2",
      [result.bookings.map((b) => b.id), unit],
    )
  ).rows
    .map((row) => row.id)
    .sort();
  expect(result.payments.map((p) => p.id).sort()).toEqual(fullPayments);
  expect(result.dailyUnits.map((u) => u.id)).toEqual([unit]);
  expect(result.unitLookupUnits.every((u) => u.building_id === building)).toBe(true);
  const other = await read(from, to, otherBuilding);
  expect(other.bookings).toEqual([]);
  expect(other.payments).toEqual([]);
});
it("loads a historical period from the database without losing cross-boundary stays or complete booking payment history", async () => {
  const dates = (
    await db.query('select (current_date-401)::text "from",(current_date-397)::text "to"')
  ).rows[0];
  const result = await read(dates.from, dates.to);
  expect(result.bookings.map((b) => b.id)).toContain(oldPaid);
  expect(result.payments.some((p) => p.source_id === oldPaid)).toBe(true);
  const all = (
    await db.query(
      "select to_jsonb(b) doc from daily_bookings b where unit_id=$1 order by check_in desc,id desc",
      [unit],
    )
  ).rows.map((row) => row.doc) as DailyBookingRow[];
  expect(
    buildBookingMap(result.bookings, {
      todayStr: today,
      tomorrowStr: to,
      visibleFrom: dates.from,
      visibleTo: dates.to,
    }),
  ).toEqual(
    buildBookingMap(all, {
      todayStr: today,
      tomorrowStr: to,
      visibleFrom: dates.from,
      visibleTo: dates.to,
    }),
  );
});
it("keeps more than 1000 overlapping historical rows rather than silently truncating the scalar snapshot", async () => {
  await db.query(
    `insert into daily_bookings(unit_id,customer_id,check_in,check_out,actual_check_out,checkout_mode,status,nightly_price_xof,final_amount_xof,prepaid_amount_xof,total_amount_xof)
    select $1,$2,current_date-2,current_date,current_date,'fixed','checked_out',50,100,100,100 from generate_series(1,1051)`,
    [unit, guest],
  );
  const result = await read();
  expect(result.bookingCount).toBeGreaterThan(1051);
  expect(result.bookingCount).toBe(result.bookings.length);
});
it("keeps exact JS billing across fixed/open modes, zero/stored totals, discounts and actual departures", async () => {
  for (const mode of ["fixed", "open"])
    for (const status of ["checked_in", "checked_out"])
      for (const final of [null, 0, 40.25]) {
        await db.query(
          `insert into daily_bookings(unit_id,customer_id,check_in,check_out,actual_check_out,checkout_mode,status,nightly_price_xof,final_amount_xof,prepaid_amount_xof,manual_discount_amount_xof,total_amount_xof)
      values($1,$2,current_date-3,current_date+2,$3,$4,$5,10.5,$6,4.25,1.5,100)`,
          [unit, guest, status === "checked_out" ? today : null, mode, status, final],
        );
      }
  const full = (
    await db.query(
      "select to_jsonb(b) doc from daily_bookings b where unit_id=$1 order by check_in desc,id desc",
      [unit],
    )
  ).rows.map((row) => row.doc) as DailyBookingRow[];
  const expected = dailyBookingFinancePosition(full, today),
    result = await read();
  expect(result.currentOutstanding).toBe(expected.currentOutstanding);
  expect(result.monthSettled).toBe(expected.monthSettled);
});
it("retains an explicit agreed settlement adjustment and its final amount in the native calendar context", async () => {
  const id = randomUUID();
  await db.query(
    `insert into daily_bookings(id,unit_id,customer_id,check_in,check_out,actual_check_out,checkout_mode,status,
      nightly_price_xof,total_amount_xof,final_amount_xof,prepaid_amount_xof,settlement_adjustment_amount_xof,settlement_adjustment_reason)
      values($1,$2,$3,current_date-13,current_date,current_date,'fixed','checked_out',40000,520000,560000,560000,40000,'Synthetic explicit agreed settlement')`,
    [id, unit, guest],
  );
  const result = await read();
  expect(result.bookings.find((booking) => booking.id === id)).toMatchObject({
    total_amount_xof: 520000,
    settlement_adjustment_amount_xof: 40000,
    settlement_adjustment_reason: "Synthetic explicit agreed settlement",
    final_amount_xof: 560000,
    prepaid_amount_xof: 560000,
  });
  const full = (
    await db.query(
      "select to_jsonb(b) doc from daily_bookings b where unit_id=$1 order by check_in desc,id desc",
      [unit],
    )
  ).rows.map((row) => row.doc) as DailyBookingRow[];
  const expected = dailyBookingFinancePosition(full, today);
  expect(result.currentOutstanding).toBe(expected.currentOutstanding);
  expect(result.monthSettled).toBe(expected.monthSettled);
});
it("rejects oversized/invalid windows and rechecks current role/project grants; anonymous cannot execute", async () => {
  await expect(read(to, from)).rejects.toThrow("invalidCalendarWindow");
  const far = (await db.query("select (current_date+100)::text d")).rows[0].d;
  await expect(read(from, far)).rejects.toThrow("invalidCalendarWindow");
  await db.query("update projects set access_mode='restricted' where id=$1", [project]);
  try {
    await expect(read()).rejects.toThrow("calendarPermissionDenied");
  } finally {
    await db.query("update projects set access_mode='open' where id=$1", [project]);
  }
  const missing = randomUUID();
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: missing, role: "authenticated" }),
  ]);
  try {
    await expect(read()).rejects.toThrow("calendarPermissionDenied");
  } finally {
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: "authenticated" }),
    ]);
  }
  expect(
    (
      await db.query(
        "select prosecdef,provolatile,has_function_privilege('anon',oid,'execute') anon from pg_proc where oid='public.daily_calendar_window_rpc(uuid,date,date)'::regprocedure",
      )
    ).rows[0],
  ).toEqual({ prosecdef: false, provolatile: "s", anon: false });
});

it("exactly matches binary half-value rounding, discount subtraction and ordered accumulation", async () => {
  for (const [price, nights] of [
    [10.23, 50],
    [10.15, 30],
    [0.58, 25],
    [0.29, 50],
    [1.15, 10],
  ]) {
    await db.query(
      `insert into daily_bookings(unit_id,customer_id,check_in,check_out,actual_check_out,checkout_mode,status,nightly_price_xof,final_amount_xof,prepaid_amount_xof,manual_discount_amount_xof,total_amount_xof)
      values($1,$2,current_date-$3::integer,current_date,current_date,'fixed','checked_out',$4,null,0.3,0.1,100)`,
      [unit, guest, nights, price],
    );
  }
  const full = (
    await db.query(
      "select to_jsonb(b) doc from daily_bookings b where unit_id=$1 order by check_in desc,id desc",
      [unit],
    )
  ).rows.map((row) => row.doc) as DailyBookingRow[];
  const expected = dailyBookingFinancePosition(full, today),
    result = await read();
  expect(result.currentOutstanding).toBe(expected.currentOutstanding);
  expect(result.monthSettled).toBe(expected.monthSettled);
});

it("retains a sold disabled-daily unit with a current stay without inventing permission to create another booking", async () => {
  const disabled = randomUUID();
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,'DISABLED-DAILY','99','9','sold')",
    [disabled, building],
  );
  await db.query(
    "insert into unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',false)",
    [disabled],
  );
  await db.query(
    "insert into daily_bookings(unit_id,customer_id,check_in,check_out,checkout_mode,status,nightly_price_xof,total_amount_xof) values($1,$2,current_date-2,current_date+2,'fixed','checked_in',50,200)",
    [disabled, guest],
  );
  const result = await read();
  expect(result.dailyUnits.find((u) => u.id === disabled)).toMatchObject({
    status: "sold",
    daily_rental_enabled: false,
  });
  expect(result.bookings.some((b) => b.unit_id === disabled)).toBe(true);
});

it("retains the original cross-month payment and its structured reversal links in every relevant window", async () => {
  const original = (
    await db.query(
      "select id from payments where source_id=$1 and payment_date<date_trunc('month',current_date)::date order by payment_date limit 1",
      [openStay],
    )
  ).rows[0].id;
  const reversal = randomUUID();
  await db.query(
    `insert into payments(id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method,reversal_of_payment_id,request_kind)
    values($1,$2,'daily_booking',$3,current_date,-20,'XOF',1,'cash',$4,'daily_reversal')`,
    [reversal, unit, openStay, original],
  );
  const result = await read();
  expect(result.payments.find((p) => p.id === reversal)).toMatchObject({
    source_id: openStay,
    reversal_of_payment_id: original,
    request_kind: "daily_reversal",
    amount: -20,
  });
  expect(result.payments.some((p) => p.id === original)).toBe(true);
});

it.each(["admin", "boss", "finance", "front_desk", "rental_sales"])(
  "keeps the same complete window context for authorized %s",
  async (role) => {
    await db.query("update user_profiles set role=$1 where id=$2", [role, actor]);
    try {
      const result = await read();
      expect(result.bookingCount).toBeGreaterThan(1051);
      expect(
        result.bookings.every((b) => result.unitLookupUnits.some((u) => u.id === b.unit_id)),
      ).toBe(true);
    } finally {
      await db.query("update user_profiles set role='admin' where id=$1", [actor]);
    }
  },
);
