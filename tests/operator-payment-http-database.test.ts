import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asCaller, createPaymentDatabase, ids, recordPayment, seedPaymentDatabase, verifyPayment } from "./helpers/operator-payment-database";

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/features/business-actions/operator-request-auth", () => ({ authenticateOperatorRequest: authenticate }));
import { POST } from "@/app/api/operator/v1/actions/route";

let db: PGlite;
let loseWriteResponse: boolean;
beforeAll(async () => { db = await createPaymentDatabase(); }, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role; truncate public.ledger_entries, public.payments, public.receivables, public.audit_logs,
    public.daily_bookings, public.units, public.customers, public.buildings,
    private.operator_action_grants, public.user_profiles, auth.users cascade;`);
  await seedPaymentDatabase(db);
  loseWriteResponse = false;
  // Only Auth and the transport are replaced. All business RPCs execute the
  // actual migration SQL as an authenticated (non-owner) Postgres role.
  authenticate.mockResolvedValue({ authenticated: true, mode: "bearer",
    user: { id: ids.actor, role: "admin", displayName: "Synthetic operator" },
    supabase: { rpc: async (name: string, args: Record<string, unknown> = {}) => {
      let data: unknown;
      try {
        data = await asCaller(db, async () => {
          switch (name) {
            case "can_execute_operator_action":
              return (await db.query<{ result: boolean }>("select public.can_execute_operator_action($1,$2) result", [args.p_action_name, args.p_risk_level])).rows[0].result;
            case "operator_daily_payment_protocol_version":
              return (await db.query<{ result: number }>("select public.operator_daily_payment_protocol_version() result")).rows[0].result;
            case "daily_record_payment_rpc":
              return (await recordPayment(db, { bookingId: args.p_booking_id as string, amount: args.p_amount as number,
                date: args.p_payment_date as string, receipt: args.p_receipt_no as string | null,
                requestId: args.p_request_id as string, actor: args.p_actor as Record<string, unknown> })).rows[0].result;
            case "verify_operator_daily_payment":
              return verifyPayment(db, args.p_request_id as string);
            default: throw new Error(`Unexpected RPC ${name}`);
          }
        });
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : "Unknown SQL error" } };
      }
      // The transaction has committed. Simulate only its response being lost.
      if (name === "daily_record_payment_rpc" && loseWriteResponse) {
        loseWriteResponse = false;
        throw new Error("Simulated connection loss after commit");
      }
      return { data, error: null };
    } },
  });
});

function request(amount = 10000, requestId = ids.request) {
  return new Request("http://localhost/api/operator/v1/actions", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: "1.0", connectorVersion: "0.1.0", actionName: "record_daily_payment",
      inputSource: "natural_language", originalInstruction: "Synthetic end-to-end payment", requestId,
      input: { bookingId: ids.booking, amountXof: amount, paymentDate: "2026-09-15" } }) });
}
async function paymentCount() {
  return (await db.query<{ count: number }>("select count(*)::int count from public.payments")).rows[0].count;
}

describe("HTTP handler to actual isolated payment SQL", () => {
  it("completes a payment with versioned financial and audit evidence", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed", requestId: ids.request,
      result: { verification: { verified: true, evidenceVersion: 2 } } });
    expect(await paymentCount()).toBe(1);
  });
  it("recovers a committed-but-lost response with the original request ID and no duplicate", async () => {
    loseWriteResponse = true;
    const first = await POST(request());
    expect(first.status).toBe(503);
    expect(await first.json()).toMatchObject({ status: "execution_unknown", requestId: ids.request,
      retryPolicy: "recheck_same_request_id_only" });
    expect(await paymentCount()).toBe(1);
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    expect((await retry.json()).status).toBe("completed");
    expect(await paymentCount()).toBe(1);
    expect((await db.query<{ count: number }>("select count(*)::int count from public.audit_logs")).rows[0].count).toBe(1);
  });
  it("rejects changed-amount replay inside SQL with HTTP 409", async () => {
    expect((await POST(request())).status).toBe(200);
    const retry = await POST(request(20000));
    expect(retry.status).toBe(409);
    expect((await retry.json()).code).toBe("requestIdConflict");
    expect(await paymentCount()).toBe(1);
  });
  it("does not write when the database release gate is absent", async () => {
    await db.exec("alter function public.operator_daily_payment_protocol_version() rename to test_hidden_payment_version");
    try {
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("database_upgrade_required");
      expect(await paymentCount()).toBe(0);
    } finally {
      await db.exec("alter function public.test_hidden_payment_version() rename to operator_daily_payment_protocol_version");
    }
  });
  it("reports inconsistent receivables as a blocked transaction, not a completed payment", async () => {
    await db.exec("update public.receivables set customer_id=null");
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("bookingFinanceInconsistent");
    expect(await paymentCount()).toBe(0);
  });
});
