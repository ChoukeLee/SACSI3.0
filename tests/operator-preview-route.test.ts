import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, authenticate } = vi.hoisted(() => ({ rpc: vi.fn(), authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({ authenticateOperatorRequest: authenticate }));
import { POST } from "@/app/api/operator/v1/confirmations/prepare/route";
import { POST as execute } from "@/app/api/operator/v1/actions/route";
import { previewActor, previewRequest, previewSecret, previewSnapshot } from "./fixtures/operator-preview";

const request = (body: unknown = previewRequest()) => new Request("http://localhost/api/operator/v1/confirmations/prepare", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET", previewSecret);
  authenticate.mockResolvedValue({ authenticated: true, mode: "bearer", user: { id: previewActor, role: "admin", displayName: "Test" }, supabase: { rpc } });
  rpc.mockImplementation(async name => {
    if (name === "can_execute_operator_action") return { data: true, error: null };
    if (name === "operator_daily_payment_protocol_version") return { data: 2, error: null };
    if (name === "daily_booking_operation_snapshot") return { data: previewSnapshot(), error: null };
    throw new Error("Unexpected RPC");
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("read-only screenshot preparation endpoint", () => {
  it("ignores a forged client snapshot and emits a non-executable preview", async () => {
    const result = await POST(request({ ...previewRequest(), actorId: "spoofed", snapshot: { amount: 1 }, confirmed: true }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ executionAvailable: false, actor: { id: previewActor }, preview: { amountXof: 10000, totalXof: 30000 } });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["can_execute_operator_action", "operator_daily_payment_protocol_version", "daily_booking_operation_snapshot"]);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not let a preview proof authorize a screenshot payment", async () => {
    const prepared = await (await POST(request())).json(); rpc.mockClear();
    const result = await execute(request({ ...previewRequest(), previewProof: prepared.previewProof, confirmed: true }));
    expect(result.status).toBe(202);
    expect((await result.json()).status).toBe("confirmation_required");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["can_execute_operator_action"]);
  });
  it("requires the server key without falling back to a database key", async () => {
    vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET", "");
    expect((await POST(request())).status).toBe(503); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["missing_or_invalid_session", "account_not_configured", "authentication_unavailable"])("stops before queries for %s", reason => {
    authenticate.mockResolvedValue({ authenticated: false, reason });
    return POST(request()).then(async response => {
      expect((await response.json()).code).toBe(reason); expect(rpc).not.toHaveBeenCalled();
    });
  });
  it("requires exact permission even for admin", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await POST(request())).status).toBe(403); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("stops on an old database version", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: 1, error: null });
    expect((await POST(request())).status).toBe(503); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("contains network errors without disclosing raw diagnostics", async () => {
    rpc.mockRejectedValue(new Error("sensitive detail"));
    const result = await POST(request()); expect(result.status).toBe(503); expect(await result.text()).not.toContain("sensitive detail");
  });
  it("rejects unsupported batches before querying", async () => {
    expect((await POST(request({ ...previewRequest(), inputSource: "structured_batch" }))).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("validates payment fields before querying", async () => {
    expect((await POST(request({ ...previewRequest(), input: { amountXof: -1 } }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("limits the actual body even without content-length", async () => {
    expect((await POST(request({ ...previewRequest(), extra: "x".repeat(65536) }))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
});
