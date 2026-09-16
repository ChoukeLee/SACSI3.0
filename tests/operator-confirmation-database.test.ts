import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { asCaller, createPaymentDatabase, ids, recordPayment, seedPaymentDatabase } from "./helpers/operator-payment-database";
import { previewRequest } from "./fixtures/operator-preview";
let db: PGlite;
beforeAll(async () => {
  db = await createPaymentDatabase();
  await db.exec(readFileSync("supabase/migrations/20260915162247_add_operator_payment_confirmations.sql", "utf8"));
  await db.exec(`create function public.test_confirmation_audit_failure() returns trigger language plpgsql as $$
    begin if new.action='confirm_operator_payment' and current_setting('test.fail_confirmation',true)='on' then raise exception 'testAuditFailure'; end if; return new; end $$;
    create trigger test_confirmation_audit_failure before insert on public.audit_logs for each row execute function public.test_confirmation_audit_failure();`);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role; set test.fail_confirmation='off'; truncate private.operator_payment_confirmations, public.ledger_entries,public.payments,public.receivables,public.audit_logs,public.daily_bookings,public.units,public.customers,public.buildings,private.operator_action_grants,public.user_profiles,auth.users cascade;`);
  await seedPaymentDatabase(db);
});
async function snapshot() { return (await asCaller(db, () => db.query<{ result: unknown }>("select public.daily_booking_operation_snapshot($1) result", [ids.booking]))).rows[0].result; }
async function create(request = previewRequest(), expected?: unknown) {
  const data = expected ?? await snapshot();
  return (await asCaller(db, () => db.query<{ result: { id: string; status: string } }>("select public.create_operator_payment_confirmation($1,$2,clock_timestamp()+interval '5 minutes') result", [JSON.stringify(request), JSON.stringify(data)]))).rows[0].result;
}
async function confirm(id: string) { return (await asCaller(db, () => db.query<{ result: Record<string, unknown> }>("select public.confirm_operator_payment($1) result", [id]))).rows[0].result; }
async function counts() { return (await db.query("select (select count(*)::int from public.payments) payments,(select count(*)::int from public.audit_logs) audits,(select count(*)::int from private.operator_payment_confirmations where status='completed') completed")).rows[0]; }

describe("actual confirmation transaction", () => {
  it("creates only a pending draft, then atomically pays and audits once", async () => {
    const draft = await create(); expect(await counts()).toEqual({ payments: 0, audits: 0, completed: 0 });
    expect(await confirm(draft.id)).toMatchObject({ status: "completed", requestId: ids.request, verification: { verified: true } });
    expect(await counts()).toEqual({ payments: 1, audits: 2, completed: 1 });
    expect(await confirm(draft.id)).toMatchObject({ status: "completed" });
    expect(await counts()).toEqual({ payments: 1, audits: 2, completed: 1 });
  });
  it("makes draft creation idempotent without refreshing its lifetime", async () => {
    const data = await snapshot(); const first = await create(previewRequest(), data); const second = await create(previewRequest(), data);
    expect(second).toEqual(first);
  });
  it("rejects changed fields for the same request ID", async () => {
    await create(); const changed = previewRequest(); changed.input.amountXof = 20000;
    await expect(create(changed)).rejects.toThrow("confirmationRequestConflict");
  });
  it("does not let another actor read or confirm the draft", async () => {
    const draft = await create();
    for (const name of ["get_operator_payment_confirmation", "confirm_operator_payment"]) {
      await expect(asCaller(db, () => db.query(`select public.${name}($1)`, [draft.id]), { actor: ids.otherActor })).rejects.toThrow("confirmationNotFound");
    }
    expect(await counts()).toEqual({ payments: 0, audits: 0, completed: 0 });
  });
  it("blocks expired drafts", async () => {
    const draft = await create(); await db.query("update private.operator_payment_confirmations set expires_at=clock_timestamp()-interval '1 second' where id=$1", [draft.id]);
    await expect(confirm(draft.id)).rejects.toThrow("confirmationExpired");
  });
  it("checks expiry after a previous-day creation", async () => {
    const draft = await create(); await db.query("update private.operator_payment_confirmations set created_at=clock_timestamp()-interval '1 day' where id=$1", [draft.id]);
    await expect(confirm(draft.id)).rejects.toThrow("confirmationExpired");
  });
  it("blocks a stale snapshot after an intervening payment", async () => {
    const draft = await create(); await asCaller(db, () => recordPayment(db, { requestId: ids.secondRequest }));
    await expect(confirm(draft.id)).rejects.toThrow("confirmationSnapshotChanged");
    expect(await counts()).toEqual({ payments: 1, audits: 1, completed: 0 });
  });
  it("rolls payment and confirmation state back when confirmation audit fails", async () => {
    const draft = await create(); await db.exec("set test.fail_confirmation='on'");
    await expect(confirm(draft.id)).rejects.toThrow("testAuditFailure");
    expect(await counts()).toEqual({ payments: 0, audits: 0, completed: 0 });
    await db.exec("set test.fail_confirmation='off'"); expect(await confirm(draft.id)).toMatchObject({ status: "completed" });
  });
  it("rechecks action permission before consuming a draft", async () => {
    const draft = await create(); await db.query("update public.user_profiles set role='boss' where id=$1", [ids.actor]);
    await expect(confirm(draft.id)).rejects.toThrow("confirmationForbidden");
  });
  it("denies anonymous execution and direct employee table access", async () => {
    await expect(asCaller(db, () => db.query("select public.confirm_operator_payment($1)", [ids.request]), { actor: null, role: "anon" })).rejects.toThrow(/permission denied/);
    await expect(asCaller(db, () => db.query("select * from private.operator_payment_confirmations"))).rejects.toThrow(/permission denied/);
  });
});
