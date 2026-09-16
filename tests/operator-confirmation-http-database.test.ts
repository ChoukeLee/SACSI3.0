import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asCaller, createPaymentDatabase, ids, recordPayment, seedPaymentDatabase } from "./helpers/operator-payment-database";
import { previewRequest, previewSecret } from "./fixtures/operator-preview";
const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({ authenticateOperatorRequest: authenticate }));
import { POST as prepare } from "@/app/api/operator/v1/confirmations/prepare/route";
import { POST as create } from "@/app/api/operator/v1/confirmations/drafts/route";
import { POST as confirm } from "@/app/api/operator/v1/confirmations/[id]/route";
let db: PGlite;
let actor: string;
let loseResponse: boolean;
const request = (body?: unknown) => new Request("http://localhost/api/operator/v1/confirmations/test", {
  method: "POST", headers: { origin: "http://localhost" }, ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeAll(async () => {
  db = await createPaymentDatabase();
  await db.exec(readFileSync("supabase/migrations/20260915162247_add_operator_payment_confirmations.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20260915222405_add_operator_confirmation_reprepare.sql", "utf8"));
},30000);
afterAll(async () => { await db?.close(); });
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  await db.exec("truncate private.operator_payment_confirmations,public.ledger_entries,public.payments,public.receivables,public.audit_logs,public.daily_bookings,public.units,public.customers,public.buildings,private.operator_action_grants,public.user_profiles,auth.users cascade");
  await seedPaymentDatabase(db); actor = ids.actor; loseResponse = false;
  vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED","true"); vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET",previewSecret);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://synthetic.invalid"); vi.stubEnv("VERCEL_GIT_COMMIT_SHA","synthetic");
  authenticate.mockImplementation(async () => ({ authenticated: true, mode: "cookie", user: { id: actor, role: "admin" }, supabase: { rpc } }));
});
async function rpc(name: string, args: Record<string,unknown> = {}) {
  const calls: Record<string,[string,unknown[]]> = {
    can_execute_operator_action: ["select public.can_execute_operator_action($1,$2) result",[args.p_action_name,args.p_risk_level]],
    operator_daily_payment_protocol_version: ["select public.operator_daily_payment_protocol_version() result",[]],
    daily_booking_operation_snapshot: ["select public.daily_booking_operation_snapshot($1) result",[args.p_booking_id]],
    create_operator_payment_confirmation: ["select public.create_operator_payment_confirmation($1,$2,$3) result",[JSON.stringify(args.p_request),JSON.stringify(args.p_snapshot),args.p_expires_at]],
    reprepare_operator_payment_confirmation: ["select public.reprepare_operator_payment_confirmation($1,$2,$3,$4) result",[args.p_previous_id,JSON.stringify(args.p_request),JSON.stringify(args.p_snapshot),args.p_expires_at]],
    get_operator_payment_confirmation: ["select public.get_operator_payment_confirmation($1) result",[args.p_id]],
    confirm_operator_payment: ["select public.confirm_operator_payment($1) result",[args.p_id]],
  };
  const call = calls[name]; if (!call) throw new Error("Unexpected RPC");
  let data;
  try { data = (await asCaller(db, () => db.query<{ result: unknown }>(...call), { actor })).rows[0].result; }
  catch (error) { return { data: null, error: { message: (error as Error).message } }; }
  // Drop the response only after asCaller has committed the real SQL transaction.
  if (name === "confirm_operator_payment" && loseResponse) { loseResponse = false; throw new Error("synthetic lost response"); }
  return { data, error: null };
}
async function draft() {
  const response = await prepare(request(previewRequest())); expect(response.status).toBe(200);
  const preview = await response.json();
  const created = await create(request({ request: previewRequest(), previewProof: preview.previewProof })); expect(created.status).toBe(200);
  return (await created.json()).confirmation.id as string;
}
const execute = (id: string) => confirm(request(),{ params: Promise.resolve({ id }) });
async function counts() {
  return (await db.query("select (select count(*)::int from public.payments) payments,(select count(*)::int from public.audit_logs) audits,(select count(*)::int from private.operator_payment_confirmations where status='completed') completed")).rows[0];
}
it("runs actual prepare, draft, confirmation and evidence verification without double entry", async () => {
  const id = await draft(); expect(await counts()).toEqual({ payments: 0,audits: 0,completed: 0 });
  expect(await (await execute(id)).json()).toEqual({ status: "completed",requestId: ids.request });
  expect((await execute(id)).status).toBe(200);
  expect(await counts()).toEqual({ payments: 1,audits: 2,completed: 1 });
});
it("recovers a committed payment after response loss using the same confirmation", async () => {
  const id = await draft(); loseResponse = true;
  expect(await (await execute(id)).json()).toMatchObject({ code: "confirmation_outcome_unknown" });
  expect(await counts()).toEqual({ payments: 1,audits: 2,completed: 1 });
  expect((await execute(id)).status).toBe(200);
  expect(await counts()).toEqual({ payments: 1,audits: 2,completed: 1 });
});
it("returns a safe ownership error with no entry for a different account", async () => {
  const id = await draft(); actor = ids.otherActor;
  expect((await execute(id)).status).toBe(404); expect(await counts()).toEqual({ payments: 0,audits: 0,completed: 0 });
});
it("refuses stale data through the real HTTP to SQL path", async () => {
  const id = await draft(); await asCaller(db, () => recordPayment(db,{ requestId: ids.secondRequest }));
  expect(await (await execute(id)).json()).toMatchObject({ code: "confirmationSnapshotChanged" });
  expect(await counts()).toEqual({ payments: 1,audits: 1,completed: 0 });
});
it("refuses expiry through the real HTTP to SQL path", async () => {
  const id = await draft(); await db.query("update private.operator_payment_confirmations set expires_at=clock_timestamp()-interval '1 second' where id=$1",[id]);
  expect(await (await execute(id)).json()).toMatchObject({ code: "confirmationExpired" });
  expect(await counts()).toEqual({ payments: 0,audits: 0,completed: 0 });
});
async function replace(id: string, amount = 10000) {
  const body = previewRequest(); body.input.amountXof = amount;
  const prepared = await prepare(request(body)); expect(prepared.status).toBe(200);
  const proof = await prepared.json();
  return create(request({ request: body,previewProof: proof.previewProof,replacesConfirmationId: id }));
}
it("reprepares an expired proposal using the same payment request, preserving the old record", async () => {
  const id = await draft(); await db.query("update private.operator_payment_confirmations set expires_at=clock_timestamp()-interval '1 second' where id=$1",[id]);
  const changed = await replace(id,12000); expect(changed.status).toBe(200);
  const successor = (await changed.json()).confirmation.id; expect(successor).not.toBe(id);
  expect(await (await execute(id)).json()).toMatchObject({ code: "confirmationSuperseded" });
  expect((await execute(successor)).status).toBe(200);
  expect(await counts()).toEqual({ payments: 1,audits: 3,completed: 1 });
  const history = (await db.query<{previous_record: {request_data: {input: {amountXof: number}}}}>("select previous_record from private.operator_confirmation_history where id=$1",[id])).rows[0];
  expect(history.previous_record.request_data.input.amountXof).toBe(10000);
  expect((await db.query("select request_id,amount::int from public.payments")).rows[0]).toEqual({ request_id: ids.request,amount: 12000 });
});
it("deduplicates reprepare retries and does not extend the new proposal's expiry", async () => {
  const id = await draft(); const first = await (await replace(id)).json(); const second = await (await replace(id)).json();
  expect(second.confirmation).toEqual(first.confirmation);
  expect(await counts()).toEqual({ payments: 0,audits: 1,completed: 0 });
});
it("will not replace another account's proposal", async () => {
  const id = await draft(); actor = ids.otherActor;
  expect((await replace(id)).status).toBe(404);
  expect(await counts()).toEqual({ payments: 0,audits: 0,completed: 0 });
});
it("rejects changing an already replaced proposal a second time", async () => {
  const id = await draft(); expect((await replace(id,12000)).status).toBe(200);
  expect((await replace(id,15000)).status).toBe(409);
  expect(await counts()).toEqual({ payments: 0,audits: 1,completed: 0 });
});
it("does not expose historical proposals to another account or direct table reads", async () => {
  const id = await draft(); await replace(id);
  await expect(asCaller(db, () => db.query("select * from private.operator_confirmation_history"))).rejects.toThrow(/permission denied/);
  await expect(asCaller(db, () => db.query("select public.reprepare_operator_payment_confirmation($1,'{}','{}',now())",[id]), { actor: null,role: "anon" })).rejects.toThrow(/permission denied/);
  actor = ids.otherActor; expect((await execute(id)).status).toBe(404);
});
it("rolls reprepare history and identity back if audit insertion fails", async () => {
  const id = await draft();
  await db.exec(`create or replace function public.synthetic_reprepare_failure() returns trigger language plpgsql as $$
    begin if new.action='reprepare_operator_payment' then raise exception 'syntheticFailure'; end if; return new; end $$;
    create trigger synthetic_reprepare_failure before insert on public.audit_logs for each row execute function public.synthetic_reprepare_failure();`);
  try {
    expect((await replace(id)).status).toBe(503);
    expect((await db.query("select count(*)::int n from private.operator_confirmation_history")).rows[0]).toEqual({ n: 0 });
    expect((await execute(id)).status).toBe(200);
    expect(await counts()).toEqual({ payments: 1,audits: 2,completed: 1 });
  } finally { await db.exec("drop trigger synthetic_reprepare_failure on public.audit_logs"); }
});
