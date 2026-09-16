import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, authenticate } = vi.hoisted(() => ({ rpc: vi.fn(), authenticate: vi.fn() }));
vi.mock("@/features/business-actions/operator-request-auth", () => ({ authenticateOperatorRequest: authenticate }));
import { POST } from "@/app/api/operator/v1/actions/route";

const bookingId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
function request(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/operator/v1/actions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: "1.0", connectorVersion: "0.1.0", requestId,
      actionName: "record_daily_payment", inputSource: "natural_language", originalInstruction: "登记收款 10000 西法",
      input: { bookingId, amountXof: 10000, paymentDate: "2026-09-15" }, ...overrides }),
  });
}
function evidence() {
  return { verified: true, evidenceVersion: 2,
    checks: { payment: true, bookingFinance: true, receivables: true, ledger: true, audit: true },
    payment: { id: "payment", source_type: "daily_booking", source_id: bookingId, request_kind: "daily_payment", request_id: requestId, amount: 10000, payment_date: "2026-09-15", receipt_no: null, currency: "XOF", exchange_rate_to_xof: 1 },
    booking: { id: bookingId, prepaidAmountXof: 10000, finalAmountXof: 10000 },
    audit: { id: "audit", actorId, action: "supplementary_payment" },
    receivables: [{ id: "receivable", amountXof: 10000, paidAmountXof: 10000, status: "paid" }] };
}

beforeEach(() => {
  vi.resetAllMocks();
  authenticate.mockResolvedValue({ authenticated: true, mode: "bearer", user: { id: actorId, displayName: "颖", role: "admin" }, supabase: { rpc } });
  rpc.mockImplementation(async (name: string) => {
    if (name === "can_execute_operator_action") return { data: true, error: null };
    if (name === "operator_daily_payment_protocol_version") return { data: 2, error: null };
    if (name === "daily_record_payment_rpc") return { data: { booking: { id: bookingId } }, error: null };
    if (name === "verify_operator_daily_payment") return { data: evidence(), error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
});

describe("payment HTTP behavior (isolated RPC doubles, no database writes)", () => {
  it("returns completed only after matching evidence and uses authenticated actor context", async () => {
    const response = await POST(request({ actorId: "spoofed" }));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("completed");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["can_execute_operator_action", "operator_daily_payment_protocol_version", "daily_record_payment_rpc", "verify_operator_daily_payment"]);
    expect(rpc.mock.calls[2][1].p_actor).not.toHaveProperty("actorId");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not treat a changed-amount replay as successful even if the old RPC returns success", async () => {
    const response = await POST(request({ input: { bookingId, amountXof: 20000, paymentDate: "2026-09-15" } }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ status: "verification_failed", requestId, issues: ["payment_request_mismatch"], retryPolicy: "recheck_same_request_id_only" });
    expect(rpc).toHaveBeenCalledTimes(4);
  });
  it("does not write for screenshot input even with a forged confirmation", async () => {
    const response = await POST(request({ inputSource: "excel_screenshot", confirmed: true }));
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("stops before write when authorization is denied", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await POST(request())).status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("preserves the request ID and never auto-retries when verification is unavailable", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ requestId, issues: ["verification_unavailable"], retryPolicy: "recheck_same_request_id_only" });
    expect(rpc).toHaveBeenCalledTimes(4);
  });
  it("returns conflict without verification or retry when the atomic writer rejects the request", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "requestIdConflict" } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("requestIdConflict");
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it.each([1, null, "2"])("refuses writes when the database protocol is %j", async (version) => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: version, error: null });
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect((await result.json()).code).toBe("database_upgrade_required");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("does not write if the readiness lookup throws", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockRejectedValueOnce(new Error("network"));
    const result = await POST(request());
    expect((await result.json()).code).toBe("database_readiness_unavailable");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])("treats a lost write response as unknown (throws=%s), not as not-recorded", async (throws) => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: 2, error: null });
    if (throws) rpc.mockRejectedValueOnce(new Error("network disconnected"));
    else rpc.mockResolvedValueOnce({ data: null, error: { message: "TypeError: fetch failed" } });
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ status: "execution_unknown", requestId, retryPolicy: "recheck_same_request_id_only" });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it("retains committed-state uncertainty when post-write verification throws", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: {}, error: null }).mockRejectedValueOnce(new Error("network"));
    const result = await POST(request());
    expect(result.status).toBe(500);
    expect(await result.json()).toMatchObject({ status: "verification_failed", requestId, retryPolicy: "recheck_same_request_id_only" });
    expect(rpc).toHaveBeenCalledTimes(4);
  });
});
