import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.auth }));
vi.mock("@/features/business-actions/operator-inbox-read", () => ({
  readOperatorInbox: mocks.read,
}));
import { GET } from "@/app/api/operator/inbox/route";
beforeEach(() => {
  mocks.auth.mockReset();
  mocks.read.mockReset();
  mocks.auth.mockResolvedValue({ id: "own-account" });
  mocks.read.mockResolvedValue({ total: 0, items: [] });
});
it("requires a real browser login before reading the private inbox", async () => {
  mocks.auth.mockResolvedValue(null);
  const response = await GET(new NextRequest("https://test.invalid/api/operator/inbox"));
  expect(response.status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each(["actorId=other", "page=1&page=2", "search=%25", "dateFrom=2026-02-30"])(
  "rejects invalid or identity expanding query %s",
  async (query) => {
    const response = await GET(new NextRequest(`https://test.invalid/api/operator/inbox?${query}`));
    expect(response.status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it("sends only validated filters and never exposes an actor selector or write command", async () => {
  const response = await GET(
    new NextRequest(
      "https://test.invalid/api/operator/inbox?state=completed&kind=collections&page=2",
    ),
  );
  expect(response.status).toBe(200);
  expect(mocks.read).toHaveBeenCalledWith({
    state: "completed",
    kind: "collections",
    page: 2,
    search: "",
    dateFrom: "",
    dateTo: "",
  });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
});
it("returns read failures as503 without a false empty success or sensitive error", async () => {
  mocks.read.mockRejectedValue(new Error("sensitive SQL source"));
  const response = await GET(new NextRequest("https://test.invalid/api/operator/inbox"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "operator_inbox_unavailable" });
});
