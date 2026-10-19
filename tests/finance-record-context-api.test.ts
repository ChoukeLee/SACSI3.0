import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), read: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/features/finance/finance-record-context-read", async (original) => ({
  ...(await original<typeof import("@/features/finance/finance-record-context-read")>()),
  readFinanceRecordContext: mocks.read,
}));
import { GET } from "@/app/api/finance/record-context/route";
import { FinanceRecordContextReadError } from "@/features/finance/finance-record-context-read";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const url = `https://sacsi.example/api/finance/record-context?kind=ledger&id=${id}`;
const client = { from: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ role: "admin" });
  mocks.createClient.mockResolvedValue(client);
  mocks.read.mockResolvedValue({ kind: "ledger", id, amountXof: 10 });
});
describe("finance selected-record GET", () => {
  it("requires the verified current finance-read user before database reads", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request(url))).status).toBe(401);
    for (const role of ["front_desk", "rental_sales"]) {
      mocks.user.mockResolvedValue({ role });
      expect((await GET(new Request(url))).status).toBe(403);
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(["admin", "boss", "finance"])(
    "allows %s read using only the authenticated RLS client and private no-store",
    async (role) => {
      mocks.user.mockResolvedValue({ role });
      const response = await GET(new Request(url));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.json()).toEqual({ kind: "ledger", id, amountXof: 10 });
      expect(mocks.read).toHaveBeenCalledWith(client, { kind: "ledger", id });
    },
  );
  it.each([
    `kind=ledger&id=${id}&id=${id}`,
    `kind=ledger&kind=receivables&id=${id}`,
    `kind=ledger&id=${id}&scope=all`,
    `kind=payments&id=${id}`,
    "kind=ledger&id=bad",
    "kind=ledger",
  ])("rejects malformed, duplicate, or extended query %s", async (search) => {
    const response = await GET(
      new Request(`https://sacsi.example/api/finance/record-context?${search}`),
    );
    expect(response.status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each([403, 404, 503] as const)(
    "preserves controlled %s errors without leaking SQL details",
    async (status) => {
      mocks.read.mockRejectedValue(new FinanceRecordContextReadError(status));
      const response = await GET(new Request(url));
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toContain("SQL");
    },
  );
  it("handles unexpected database or authentication exceptions as unavailable, not an empty detail", async () => {
    mocks.read.mockRejectedValue(new Error("private SQL detail"));
    const response = await GET(new Request(url));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "financeRecordContextUnavailable" });
    mocks.user.mockRejectedValue(new Error("refresh transport failure"));
    expect((await GET(new Request(url))).status).toBe(503);
  });
});
