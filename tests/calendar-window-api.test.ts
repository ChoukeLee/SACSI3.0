import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  receipts: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/reports/daily-receipt-report-service", () => ({
  readDailyReceiptReport: mocks.receipts,
}));
import { GET } from "@/app/api/daily-rentals/calendar/route";
import { calendarBuilding, calendarWindowFixture } from "./fixtures/calendar-window";
const request = (extra = "") =>
  new Request(
    `https://sacsi.example/api/daily-rentals/calendar?buildingId=${calendarBuilding}&from=2026-10-15&to=2026-10-23${extra}`,
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ role: "admin", id: "actor" });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: calendarWindowFixture(), error: null });
  mocks.receipts.mockResolvedValue({ summary: { net: 500 }, rows: [] });
});
afterEach(() => vi.useRealTimers());
it("denies anonymous and invalid filters before querying data", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  mocks.user.mockResolvedValue({ role: "admin" });
  for (const extra of ["&from=2026-01-01", "&extra=bad", "&to=2027-01-01"])
    expect((await GET(request(extra))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["admin", "boss", "finance", "front_desk", "rental_sales"])(
  "returns a private uncached window under %s's own identity",
  async (role) => {
    mocks.user.mockResolvedValue({ role });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("daily_calendar_context_rpc", {
      p_building_id: calendarBuilding,
      p_from: "2026-10-15",
      p_to: "2026-10-23",
    });
    expect(mocks.receipts).not.toHaveBeenCalled();
    expect(response.headers.get("Server-Timing")).toContain("database;dur=");
  },
);
it("rejects scope/shape/count mismatches instead of returning a healthy empty window", async () => {
  for (const data of [
    null,
    calendarWindowFixture({ bookingCount: 1 }),
    calendarWindowFixture({ buildingId: "foreign" }),
  ]) {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await GET(request())).status).toBe(503);
  }
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { code: "42501", message: "sensitive SQL details" },
  });
  const denied = await GET(request());
  expect(denied.status).toBe(403);
  expect(JSON.stringify(await denied.json())).not.toContain("sensitive");
});
it("date windows do not read any cash detail or aggregate; independent summary stays unknown until its own request", async () => {
  mocks.receipts.mockRejectedValue(new Error("receipt unavailable"));
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect((await response.json()).financeSnapshot.cash).toBeNull();
  expect(mocks.receipts).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("catches SDK authorization and client failures as a private timed fixed 500, not a missing identity", async () => {
  mocks.user.mockRejectedValue(new Error("sensitive account transport details"));
  let response = await GET(request());
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("server-timing")).toMatch(
    /authorization;dur=.*response;dur=.*total;dur=/,
  );
  expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  mocks.user.mockResolvedValue({ role: "admin" });
  mocks.client.mockRejectedValue(new Error("sensitive client secret"));
  response = await GET(request());
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("server-timing")).toMatch(
    /authorization;dur=.*database;dur=.*response;dur=.*total;dur=/,
  );
  expect(JSON.stringify(await response.json())).not.toContain("sensitive");
});
