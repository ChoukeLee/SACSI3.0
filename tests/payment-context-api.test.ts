import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
import { GET, POST } from "@/app/api/finance/payment-context/[paymentId]/route";
import { parsePaymentContextConfirmation } from "@/features/finance/payment-context";
const paymentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const context = { params: Promise.resolve({ paymentId }) };
const url = `https://sacsi.example/api/finance/payment-context/${paymentId}`;
const payload = {
  paymentId,
  paymentDate: "2026-10-15",
  amount: 100,
  currency: "CNY",
  recordedBy: null,
  recordedByName: null,
  actualCollector: null,
  collectorBasis: null,
  version: 0,
  token: "a".repeat(32),
  confirmedBy: null,
  confirmedAt: null,
  allocatedXof: 0,
  allocations: [],
};
const confirmation = {
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  input: { expectedToken: "a".repeat(32), collectorName: "振咏", collectorBasis: "明确收据" },
};
const post = (body: unknown = confirmation, origin = "https://sacsi.example") =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: paymentId, role: "admin" });
  mocks.rpc.mockResolvedValue({ data: payload, error: null });
});
describe("payment facts endpoint", () => {
  it("denies anonymous and low roles before SQL", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request(url), context)).status).toBe(401);
    for (const role of ["front_desk", "rental_sales"]) {
      mocks.user.mockResolvedValue({ role });
      expect((await GET(new Request(url), context)).status).toBe(403);
      expect((await POST(post(), context)).status).toBe(403);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("boss is read-only and original currency is retained", async () => {
    mocks.user.mockResolvedValue({ role: "boss" });
    const response = await GET(new Request(url), context);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      currency: "CNY",
      amount: 100,
      actualCollector: null,
    });
    expect((await POST(post(), context)).status).toBe(403);
  });
  it("only accepts explicit facts, never actor, amount or inferred dates", async () => {
    for (const field of ["amount", "currency", "recordedBy", "actorId", "paymentDate"]) {
      const body = { ...confirmation, input: { ...confirmation.input, [field]: "forged" } };
      expect((await POST(post(body), context)).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await POST(post(), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_payment_context_rpc", {
      p_payment_id: paymentId,
      p_request_id: confirmation.requestId,
      p_input: { ...confirmation.input, periods: [] },
    });
  });
  it("rejects cross-origin confirmation and stale snapshots without exposing SQL text", async () => {
    expect((await POST(post(confirmation, "https://unrelated.example"), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "paymentContextSnapshotChanged" },
    });
    expect((await POST(post(), context)).status).toBe(409);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "SQL internal detail" } });
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SQL internal detail");
  });
});
describe("explicit fact validation", () => {
  const period = {
    receivableId: paymentId,
    expectedToken: "a".repeat(32),
    start: "2026-08-26",
    end: "2027-02-25",
    source: "合同与收据原文",
  };
  it("supports explicit period-only confirmation with no invented collector", () => {
    const result = parsePaymentContextConfirmation({
      requestId: confirmation.requestId,
      input: { expectedToken: "a".repeat(32), periods: [period] },
    });
    expect(result.input).not.toHaveProperty("collectorName");
  });
  it.each([
    { start: "2026-02-30" },
    { end: "2026-08-01" },
    { source: "" },
    { source: undefined },
    { actorId: paymentId },
  ])("rejects incomplete, guessed or malformed period %j", (changes) => {
    expect(() =>
      parsePaymentContextConfirmation({
        ...confirmation,
        input: { ...confirmation.input, periods: [{ ...period, ...changes }] },
      }),
    ).toThrow("invalidPaymentContext");
  });
});
