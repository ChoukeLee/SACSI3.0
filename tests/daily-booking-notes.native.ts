import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
}, 45_000);
afterAll(async () => {
  await cluster?.close();
});

async function login(actor: string | null, client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
}

async function seed(status = "confirmed", role = "admin", notes: string | null = null) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims','{}',false)");
  const actor = randomUUID();
  const project = randomUUID();
  const building = randomUUID();
  const unit = randomUUID();
  const otherUnit = randomUUID();
  const agent = randomUUID();
  const booking = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    actor,
    `${actor}@test.invalid`,
  ]);
  await db.query(
    "insert into public.user_profiles(id,role,display_name) values($1,$2,'Synthetic')",
    [actor, role],
  );
  await db.query(
    "insert into public.projects(id,code,display_name,allows_daily_rental) values($1::uuid,$1::text,'Synthetic',true)",
    [project],
  );
  await db.query(
    "insert into public.buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic')",
    [building, project],
  );
  await db.query(
    `insert into public.units(id,building_id,code,unit_no,floor_label)
     values($1::uuid,$2,$1::text,'Test 1','1'),($3::uuid,$2,$3::text,'Test 2','1')`,
    [unit, building, otherUnit],
  );
  await db.query(
    "insert into public.unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',true),($2,'daily_rental',true)",
    [unit, otherUnit],
  );
  await db.query("insert into public.customers(id,name) values($1,'Synthetic agent')", [agent]);
  await db.query(
    `insert into public.daily_bookings
      (id,unit_id,customer_id,booking_agent_id,check_in,check_out,nightly_price_xof,total_amount_xof,final_amount_xof,status,notes,updated_at)
     values($1,$2,$3,$3,current_date-2,current_date-1,40000,40000,40000,$4,$5,'2026-01-01 12:34:56.123456+00')`,
    [booking, unit, agent, status, notes],
  );
  return { actor, project, unit, otherUnit, booking };
}

type Fixture = Awaited<ReturnType<typeof seed>>;
type SaveResult = { status: "saved" | "conflict"; notes: string | null };

async function save(fixture: Fixture, expected: string | null, notes: string | null, client = db) {
  const result = await client.query<{ result: SaveResult }>(
    "select public.update_daily_booking_notes_rpc($1,$2,$3,$4) result",
    [fixture.booking, fixture.unit, expected, notes],
  );
  return result.rows[0].result;
}

async function bookingState(booking: string) {
  await db.query("reset role");
  return (
    await db.query<{ state: Record<string, unknown> }>(
      "select to_jsonb(b) state from public.daily_bookings b where id=$1",
      [booking],
    )
  ).rows[0].state;
}

async function noteAudits(booking: string) {
  await db.query("reset role");
  return (
    await db.query(
      `select actor_id,entity_type,before_data,after_data,metadata from public.audit_logs
       where entity_id=$1 and action='update_daily_booking_notes' order by created_at,id`,
      [booking],
    )
  ).rows;
}

it.each([
  ["pending_review", "admin"],
  ["confirmed", "front_desk"],
  ["checked_in", "rental_sales"],
  ["checked_out", "front_desk"],
  ["cancelled", "rental_sales"],
])("updates only the notes on a %s order as %s", async (status, role) => {
  const f = await seed(status, role, " Original remark ");
  const before = await bookingState(f.booking);
  await login(f.actor);
  expect(await save(f, " Original remark ", "\t Updated remark \r\n")).toEqual({
    status: "saved",
    notes: "Updated remark",
  });
  expect(await bookingState(f.booking)).toEqual({ ...before, notes: "Updated remark" });
  expect(await noteAudits(f.booking)).toEqual([
    {
      actor_id: f.actor,
      entity_type: "daily_booking",
      before_data: { notes: " Original remark " },
      after_data: { notes: "Updated remark" },
      metadata: { channel: "sacsi_web", unit_id: f.unit },
    },
  ]);
});

it("preserves the historical marker through editing and clearing and blocks fabrication", async () => {
  const f = await seed("checked_out", "admin", "[历史补录] 原备注");
  await login(f.actor);
  await expect(save(f, "[历史补录] 原备注", "\n[历史补录] fabricated")).rejects.toThrow(
    "dailyBookingNotesInvalid",
  );
  expect(await save(f, "[历史补录] 原备注", "新备注")).toEqual({
    status: "saved",
    notes: "[历史补录] 新备注",
  });
  expect(await save(f, "[历史补录] 新备注", "\n ")).toEqual({
    status: "saved",
    notes: "[历史补录]",
  });
  expect(await save(f, "[历史补录]", null)).toEqual({ status: "saved", notes: "[历史补录]" });
  expect(await noteAudits(f.booking)).toHaveLength(2);
  const ordinary = await seed();
  await login(ordinary.actor);
  await expect(save(ordinary, null, "  [历史补录] fabricated")).rejects.toThrow(
    "dailyBookingNotesInvalid",
  );
  expect(await noteAudits(ordinary.booking)).toHaveLength(0);
});

it("uses Unicode code points for the trimmed note limit and clears ordinary notes to null", async () => {
  const f = await seed();
  const longNotes = "🙂".repeat(4000);
  await login(f.actor);
  expect(await save(f, null, ` ${longNotes}\n`)).toEqual({ status: "saved", notes: longNotes });
  await expect(save(f, longNotes, longNotes + "🙂")).rejects.toThrow("dailyBookingNotesInvalid");
  expect(await save(f, longNotes, " \n\t ")).toEqual({ status: "saved", notes: null });
  expect(await save(f, null, null)).toEqual({ status: "saved", notes: null });
  expect(await noteAudits(f.booking)).toHaveLength(2);
});

it("returns the scoped current raw value on conflict without writing or auditing", async () => {
  const f = await seed("confirmed", "admin", " exact raw ");
  await login(f.actor);
  expect(await save(f, "exact raw", "overwrite attempt")).toEqual({
    status: "conflict",
    notes: " exact raw ",
  });
  expect((await bookingState(f.booking)).notes).toBe(" exact raw ");
  expect(await noteAudits(f.booking)).toHaveLength(0);
});

it("serializes concurrent edits and audits only the winner", async () => {
  const f = await seed("confirmed", "admin", "Original");
  const clients = await Promise.all([cluster.connect(), cluster.connect()]);
  await Promise.all(clients.map((client) => login(f.actor, client)));
  const results = await Promise.all(
    clients.map((client, index) => save(f, "Original", `Edit ${index + 1}`, client)),
  );
  const winner = results.find((result) => result.status === "saved");
  expect(results.map(({ status }) => status).sort()).toEqual(["conflict", "saved"]);
  expect(results.find((result) => result.status === "conflict")?.notes).toBe(winner?.notes);
  expect((await bookingState(f.booking)).notes).toBe(winner?.notes);
  const audits = await noteAudits(f.booking);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actor_id: f.actor, after_data: { notes: winner?.notes } });
});

it.each(["boss", "finance"])("rejects the read-only %s role", async (role) => {
  const f = await seed("confirmed", role);
  await login(f.actor);
  await expect(save(f, null, "Forbidden edit")).rejects.toThrow("dailyBookingNotesDenied");
  expect(await noteAudits(f.booking)).toHaveLength(0);
});

it("rejects an absent identity, anonymous and service roles", async () => {
  const f = await seed();
  await login(null);
  await expect(save(f, null, "Forbidden edit")).rejects.toThrow("dailyBookingNotesDenied");
  await db.query("reset role");
  await db.query("set role anon");
  await expect(save(f, null, "Forbidden edit")).rejects.toThrow("permission denied for function");
  await db.query("reset role");
  await db.query("set role service_role");
  await expect(save(f, null, "Forbidden edit")).rejects.toThrow("permission denied for function");
  expect(await noteAudits(f.booking)).toHaveLength(0);
});

it("rejects an out-of-scope booking and old room ID without returning either note", async () => {
  const f = await seed("confirmed", "front_desk", "Private remark");
  await db.query("update public.projects set access_mode='restricted' where id=$1", [f.project]);
  await login(f.actor);
  await expect(save(f, null, "Forbidden edit")).rejects.toThrow("dailyBookingNotesDenied");

  await db.query("reset role");
  await db.query("update public.projects set access_mode='open' where id=$1", [f.project]);
  await db.query("update public.daily_bookings set unit_id=$1 where id=$2", [
    f.otherUnit,
    f.booking,
  ]);
  await login(f.actor);
  await expect(save(f, null, "Wrong room edit")).rejects.toThrow("dailyBookingNotesUnavailable");
  await expect(save({ ...f, booking: randomUUID() }, null, "Missing order edit")).rejects.toThrow(
    "dailyBookingNotesUnavailable",
  );
  expect(await noteAudits(f.booking)).toHaveLength(0);
});

it("rolls the note back when the audit insert fails", async () => {
  const f = await seed("confirmed", "admin", "Original note");
  await db.query(`
    create function public.synthetic_note_audit_failure() returns trigger language plpgsql as $$
    begin
      if new.action='update_daily_booking_notes' then raise exception 'syntheticNoteAuditFailure'; end if;
      return new;
    end; $$;
    create trigger synthetic_note_audit_failure before insert on public.audit_logs
    for each row execute function public.synthetic_note_audit_failure();
  `);
  try {
    await login(f.actor);
    await expect(save(f, "Original note", "New note")).rejects.toThrow("syntheticNoteAuditFailure");
    expect((await bookingState(f.booking)).notes).toBe("Original note");
    expect(await noteAudits(f.booking)).toHaveLength(0);
  } finally {
    await db.query("reset role");
    await db.query(`
      drop trigger synthetic_note_audit_failure on public.audit_logs;
      drop function public.synthetic_note_audit_failure();
    `);
  }
});
