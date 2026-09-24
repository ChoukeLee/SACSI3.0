import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { readFileSync } from "node:fs";
import { previewRequest } from "./fixtures/operator-preview";
import { createNativePaymentPostgres, paymentAdapter } from "./helpers/native-payment-postgres";
import { ids, installPaymentDatabase, migrationFunction, recordPayment, seedPaymentDatabase, verifyPayment } from "./helpers/operator-payment-database";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let owner: pg.Client;
let first: pg.Client;
let second: pg.Client;
let firstPid: number;
let secondPid: number;
const reversalRequest = "99999999-9999-4999-8999-999999999999";

async function beginCaller(client: pg.Client, actor = ids.actor) {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role: "authenticated", email: "native@test.invalid" })]);
  await client.query("set local role authenticated");
}
// Attach rejection handling immediately: deliberately blocked queries may fail
// while another connection is still releasing its transaction.
function settled<T>(promise: Promise<T>) {
  return promise.then((value) => ({ ok: true as const, value }), (error: Error & { code?: string }) => ({ ok: false as const, error }));
}
async function waitForBlock(waiter: number, blocker: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = (await owner.query<{ blocked: boolean }>("select $2::int = any(pg_blocking_pids($1::int)) blocked", [waiter, blocker])).rows[0];
    if (row.blocked) return;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error("Second backend did not demonstrably wait on the first backend");
}
async function totals() {
  return (await owner.query(`select (select count(*)::int from public.payments) payments,
    (select count(*)::int from public.ledger_entries) ledger,
    (select count(*)::int from public.audit_logs) audit,
    (select prepaid_amount_xof::int from public.daily_bookings where id='${ids.booking}') paid,
    (select paid_amount_xof::int from public.receivables where source_id='${ids.booking}') receivable_paid`)).rows[0];
}
async function initialPayment() {
  await beginCaller(first);
  await recordPayment(paymentAdapter(first));
  await first.query("commit");
  return (await owner.query<{ id: string }>("select id from public.payments where request_id=$1", [ids.request])).rows[0].id;
}
function reverse(client: pg.Client, paymentId: string, requestId = reversalRequest) {
  return client.query("select public.daily_reverse_payment_rpc($1,'Synthetic concurrency reversal',$2,'{}')", [paymentId, requestId]);
}

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  owner = await cluster.connect();
  first = await cluster.connect();
  second = await cluster.connect();
  firstPid = (await first.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0].pid;
  secondPid = (await second.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0].pid;
  await installPaymentDatabase(paymentAdapter(owner));
  await owner.query(readFileSync("supabase/migrations/20260915162247_add_operator_payment_confirmations.sql", "utf8"));
  await owner.query(readFileSync("supabase/migrations/20260915222405_add_operator_confirmation_reprepare.sql", "utf8"));
  await owner.query(migrationFunction("202607280003_harden_authorization.sql", "has_app_role"));
  await owner.query(migrationFunction("202607290001_atomic_daily_finance_operations.sql", "daily_reverse_payment_rpc"));
  await owner.query("revoke all on function public.daily_reverse_payment_rpc(uuid,text,uuid,jsonb) from public,anon; grant execute on function public.daily_reverse_payment_rpc(uuid,text,uuid,jsonb) to authenticated,service_role");
});
afterAll(async () => { await cluster?.close(); });
afterEach(async () => { await Promise.all([first?.query("rollback"), second?.query("rollback")]); });
beforeEach(async () => {
  await owner.query(`truncate public.ledger_entries, public.payments, public.receivables, public.audit_logs,
    public.daily_bookings, public.units, public.customers, public.buildings,
    private.operator_action_grants, public.user_profiles, auth.users cascade;`);
  await seedPaymentDatabase(paymentAdapter(owner));
});

describe("native PostgreSQL concurrent payment transactions", () => {
  async function replacementArgs(id: string) {
    await beginCaller(second);
    const snapshot = (await second.query("select public.daily_booking_operation_snapshot($1) result",[ids.booking])).rows[0].result;
    await second.query("commit");
    return [id,JSON.stringify(previewRequest()),JSON.stringify(snapshot)];
  }
  const replaceSql = "select public.reprepare_operator_payment_confirmation($1,$2,$3,clock_timestamp()+interval '5 minutes') result";
  it("rejects reprepare when a concurrent confirmation has already committed", async () => {
    const id = await pendingConfirmation(); const args = await replacementArgs(id);
    await beginCaller(first); await first.query("select public.confirm_operator_payment($1)",[id]);
    await beginCaller(second); const pending = settled(second.query(replaceSql,args));
    await waitForBlock(secondPid,firstPid); await first.query("commit");
    const result = await pending; expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("confirmationAlreadyExecuted");
    await second.query("rollback");
    expect(await totals()).toEqual({ payments: 1,ledger: 1,audit: 2,paid: 10000,receivable_paid: 10000 });
  });
  it("blocks an old-page confirmation after concurrent reprepare wins", async () => {
    const id = await pendingConfirmation(); const args = await replacementArgs(id);
    await beginCaller(first); const replacement = (await first.query(replaceSql,args)).rows[0].result;
    await beginCaller(second); const pending = settled(second.query("select public.confirm_operator_payment($1)",[id]));
    await waitForBlock(secondPid,firstPid); await first.query("commit");
    expect((await pending).ok).toBe(false); await second.query("rollback");
    expect(await totals()).toEqual({ payments: 0,ledger: 0,audit: 1,paid: 0,receivable_paid: 0 });
    await beginCaller(second); await second.query("select public.confirm_operator_payment($1)",[replacement.id]); await second.query("commit");
    expect(await totals()).toEqual({ payments: 1,ledger: 1,audit: 3,paid: 10000,receivable_paid: 10000 });
  });
  it("deduplicates concurrent reprepare attempts without extra history or audit", async () => {
    const id = await pendingConfirmation(); const args = await replacementArgs(id);
    await beginCaller(first); const replacement = (await first.query(replaceSql,args)).rows[0].result;
    await beginCaller(second); const pending = settled(second.query(replaceSql,args));
    await waitForBlock(secondPid,firstPid); await first.query("commit");
    const result = await pending; expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows[0].result).toEqual(replacement);
    await second.query("commit");
    expect((await owner.query("select count(*)::int n from private.operator_confirmation_history")).rows[0].n).toBe(1);
    expect(await totals()).toEqual({ payments: 0,ledger: 0,audit: 1,paid: 0,receivable_paid: 0 });
  });
  async function pendingConfirmation() {
    await beginCaller(first);
    const snapshot = (await first.query("select public.daily_booking_operation_snapshot($1) result", [ids.booking])).rows[0].result;
    const row = (await first.query("select public.create_operator_payment_confirmation($1,$2,clock_timestamp()+interval '5 minutes') result", [JSON.stringify(previewRequest()), JSON.stringify(snapshot)])).rows[0].result;
    await first.query("commit");
    return row.id;
  }
  it("serializes two account confirmations with only one payment and confirmation audit", async () => {
    const id = await pendingConfirmation();
    await beginCaller(first);
    await first.query("select public.confirm_operator_payment($1)", [id]);
    await beginCaller(second);
    const pending = settled(second.query("select public.confirm_operator_payment($1)", [id]));
    await waitForBlock(secondPid, firstPid);
    await first.query("commit");
    expect((await pending).ok).toBe(true);
    await second.query("commit");
    expect(await totals()).toEqual({ payments: 1, ledger: 1, audit: 2, paid: 10000, receivable_paid: 10000 });
  });
  it("rechecks the confirmation snapshot after waiting for another payment", async () => {
    const id = await pendingConfirmation();
    await beginCaller(first);
    await recordPayment(paymentAdapter(first), { requestId: ids.secondRequest });
    await beginCaller(second);
    const pending = settled(second.query("select public.confirm_operator_payment($1)", [id]));
    await waitForBlock(secondPid, firstPid);
    await first.query("commit");
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("confirmationSnapshotChanged");
    await second.query("rollback");
    expect(await totals()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000, receivable_paid: 10000 });
  });
  it("uses distinct real backends, loopback networking and non-owner business calls", async () => {
    expect(firstPid).not.toBe(secondPid);
    expect((await owner.query("show server_version")).rows[0].server_version).toMatch(/^17\./);
    expect((await owner.query("select inet_server_addr() = inet '127.0.0.1' loopback")).rows[0].loopback).toBe(true);
    await beginCaller(first);
    expect((await first.query("select current_user")).rows[0].current_user).toBe("authenticated");
  });
  it("serializes the same request across backends and creates one payment only", async () => {
    await beginCaller(first);
    await recordPayment(paymentAdapter(first));
    await beginCaller(second);
    const pending = settled(recordPayment(paymentAdapter(second)));
    await waitForBlock(secondPid, firstPid);
    const locks = (await owner.query<{ locktype: string }>("select locktype from pg_locks where pid=$1 and not granted", [secondPid])).rows;
    expect(locks.some((row) => row.locktype === "advisory")).toBe(true);
    await first.query("commit");
    expect((await pending).ok).toBe(true);
    await second.query("commit");
    expect(await totals()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000, receivable_paid: 10000 });
  });
  it.each(["amount", "actor"])("rejects a conflicting %s after waiting on an uncommitted request", async (change) => {
    await beginCaller(first);
    await recordPayment(paymentAdapter(first));
    await beginCaller(second, change === "actor" ? ids.otherActor : ids.actor);
    const pending = settled(recordPayment(paymentAdapter(second), { amount: change === "amount" ? 20000 : 10000 }));
    await waitForBlock(secondPid, firstPid);
    await first.query("commit");
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("requestIdConflict");
    await second.query("rollback");
    expect(await totals()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000, receivable_paid: 10000 });
  });
  it("rechecks outstanding balance after another payment commits", async () => {
    await beginCaller(first);
    await recordPayment(paymentAdapter(first), { amount: 20000 });
    await beginCaller(second, ids.otherActor);
    const pending = settled(recordPayment(paymentAdapter(second), { amount: 20000, requestId: ids.secondRequest }));
    await waitForBlock(secondPid, firstPid);
    await first.query("commit");
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("paymentExceedsOutstanding");
    await second.query("rollback");
    expect(await totals()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 20000, receivable_paid: 20000 });
  });
  it("accepts two affordable payments and preserves each real operator's audit", async () => {
    await beginCaller(first);
    await recordPayment(paymentAdapter(first));
    await beginCaller(second, ids.otherActor);
    const pending = settled(recordPayment(paymentAdapter(second), { amount: 20000, requestId: ids.secondRequest }));
    await waitForBlock(secondPid, firstPid);
    await first.query("commit");
    expect((await pending).ok).toBe(true);
    await second.query("commit");
    expect(await totals()).toEqual({ payments: 2, ledger: 2, audit: 2, paid: 30000, receivable_paid: 30000 });
    expect((await owner.query("select distinct actor_id from public.audit_logs order by actor_id")).rows).toEqual([{ actor_id: ids.actor }, { actor_id: ids.otherActor }]);
    await beginCaller(second, ids.otherActor);
    expect((await verifyPayment(paymentAdapter(second), ids.secondRequest)).verified).toBe(true);
  });
  it("lets the waiter take over the original request after the first transaction rolls back", async () => {
    await beginCaller(first);
    await recordPayment(paymentAdapter(first));
    await beginCaller(second, ids.otherActor);
    const pending = settled(recordPayment(paymentAdapter(second)));
    await waitForBlock(secondPid, firstPid);
    await first.query("rollback");
    expect((await pending).ok).toBe(true);
    await second.query("commit");
    expect(await totals()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000, receivable_paid: 10000 });
    expect((await owner.query("select actor_id from public.audit_logs")).rows).toEqual([{ actor_id: ids.otherActor }]);
  });
  it("leaves no second write after lock timeout and permits same-ID recovery", async () => {
    await beginCaller(first);
    await recordPayment(paymentAdapter(first));
    await beginCaller(second);
    await second.query("set local lock_timeout='500ms'");
    const pending = settled(recordPayment(paymentAdapter(second)));
    await waitForBlock(secondPid, firstPid);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("55P03");
    await second.query("rollback");
    await first.query("commit");
    await beginCaller(second);
    await recordPayment(paymentAdapter(second));
    await second.query("commit");
    expect(await totals()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000, receivable_paid: 10000 });
  });
  it("rolls back an interrupted backend and lets a waiting retry take over without a half-written payment", async () => {
    await beginCaller(first);
    await recordPayment(paymentAdapter(first));
    await beginCaller(second, ids.otherActor);
    const pending = settled(recordPayment(paymentAdapter(second)));
    await waitForBlock(secondPid, firstPid);
    // Only terminate the known first backend of this freshly created local cluster.
    expect((await owner.query("select pg_terminate_backend($1) stopped", [firstPid])).rows[0].stopped).toBe(true);
    try {
      expect((await pending).ok).toBe(true);
      await second.query("commit");
      expect(await totals()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000, receivable_paid: 10000 });
      expect((await owner.query("select actor_id from public.audit_logs")).rows).toEqual([{ actor_id: ids.otherActor }]);
    } finally {
      first = await cluster.connect();
      firstPid = (await first.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0].pid;
    }
  });
  it("rechecks available balance after a competing reversal commits", async () => {
    const paymentId = await initialPayment();
    await beginCaller(first);
    await reverse(first, paymentId);
    await beginCaller(second, ids.otherActor);
    const pending = settled(recordPayment(paymentAdapter(second), { amount: 30000, requestId: ids.secondRequest }));
    await waitForBlock(secondPid, firstPid);
    await first.query("commit");
    expect((await pending).ok).toBe(true);
    await second.query("commit");
    expect(await totals()).toEqual({ payments: 3, ledger: 3, audit: 3, paid: 30000, receivable_paid: 30000 });
  });
  it("keeps finance consistent when reversal waits behind a new payment", async () => {
    const paymentId = await initialPayment();
    await beginCaller(first);
    await recordPayment(paymentAdapter(first), { amount: 20000, requestId: ids.secondRequest });
    await beginCaller(second, ids.otherActor);
    const pending = settled(reverse(second, paymentId));
    await waitForBlock(secondPid, firstPid);
    await first.query("commit");
    expect((await pending).ok).toBe(true);
    await second.query("commit");
    expect(await totals()).toEqual({ payments: 3, ledger: 3, audit: 3, paid: 20000, receivable_paid: 20000 });
    await beginCaller(first);
    expect((await verifyPayment(paymentAdapter(first), ids.secondRequest)).verified).toBe(true);
  });
  it("allows only one reversal of the original payment across competing requests", async () => {
    const paymentId = await initialPayment();
    await beginCaller(first);
    await reverse(first, paymentId);
    await beginCaller(second, ids.otherActor);
    const pending = settled(reverse(second, paymentId, ids.secondRequest));
    await waitForBlock(secondPid, firstPid);
    await first.query("commit");
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("paymentAlreadyReversed");
    await second.query("rollback");
    expect(await totals()).toEqual({ payments: 2, ledger: 2, audit: 2, paid: 0, receivable_paid: 0 });
  });
});
