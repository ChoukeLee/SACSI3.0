import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asCaller, createPaymentDatabase, ids, recordPayment, seedPaymentDatabase } from "./helpers/operator-payment-database";
import { previewRequest, previewSecret } from "./fixtures/operator-preview";
const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({ authenticateOperatorRequest: authenticate }));
import { POST } from "@/app/api/operator/v1/confirmations/prepare/route";
import { verifyPreviewProof } from "@/features/business-actions/operator-preview-proof";
import { buildPaymentPreview } from "@/features/business-actions/operator-payment-preview";
let db: PGlite;
beforeAll(async () => { db = await createPaymentDatabase(); await seedPaymentDatabase(db); }, 30000);
afterAll(async () => { await db?.close(); });
afterEach(() => vi.unstubAllEnvs());
describe("preparation against actual migration SQL", () => {
  it("does not write and invalidates preview evidence after a later payment", async () => {
    vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET", previewSecret);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.invalid"); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "synthetic");
    const snapshots: unknown[] = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => asCaller(db, async () => {
      let result;
      if (name === "can_execute_operator_action") result = await db.query<{ result: unknown }>("select public.can_execute_operator_action($1,$2) as result", [args.p_action_name, args.p_risk_level]);
      else if (name === "operator_daily_payment_protocol_version") result = await db.query<{ result: unknown }>("select public.operator_daily_payment_protocol_version() as result");
      else if (name === "daily_booking_operation_snapshot") {
        result = await db.query<{ result: unknown }>("select public.daily_booking_operation_snapshot($1) as result", [args.p_booking_id]);
        snapshots.push(result.rows[0].result);
      } else throw new Error("Unexpected write RPC");
      return { data: result.rows[0].result, error: null };
    }));
    authenticate.mockResolvedValue({ authenticated: true, mode: "bearer", user: { id: ids.actor, role: "admin", displayName: "Test" }, supabase: { rpc } });
    const body = previewRequest();
    const response = await POST(new Request("http://localhost/prepare", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    const prepared = await response.json();
    expect(prepared.preview).toMatchObject({ paidBeforeXof: 0, paidAfterXof: 10000, outstandingAfterXof: 20000 });
    const counts = await db.query("select (select count(*)::int from public.payments) as payments,(select count(*)::int from public.audit_logs) as audits");
    expect(counts.rows[0]).toEqual({ payments: 0, audits: 0 });
    const preview = buildPaymentPreview(body, snapshots[0]);
    if (!preview.success) throw new Error("missing preview");
    const binding = { actorId: ids.actor, request: preview.normalizedRequest, snapshot: snapshots[0], deployment: "https://test.invalid|synthetic" };
    expect(verifyPreviewProof(prepared.previewProof, binding, previewSecret).valid).toBe(true);
    await asCaller(db, () => recordPayment(db, { requestId: ids.secondRequest }));
    const changed = await asCaller(db, () => db.query<{ result: unknown }>("select public.daily_booking_operation_snapshot($1) result", [ids.booking]));
    expect(verifyPreviewProof(prepared.previewProof, { ...binding, snapshot: changed.rows[0].result }, previewSecret)).toEqual({ valid: false, code: "preview_changed" });
  });
});
