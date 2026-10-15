import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
import { GET as cashGET } from "@/app/api/daily-rentals/calendar/cash/route";
import { GET as customerGET } from "@/app/api/daily-rentals/calendar/customers/route";
import { calendarBuilding } from "./fixtures/calendar-window";
import { DAILY_BOOKING_AGENT_NAMES } from "@/features/daily-rentals/daily-booking-agents";
const cash = {
  buildingId: calendarBuilding,
  today: "2026-10-15",
  month: "2026-10",
  cash: { gross: 100, refund: 20, adjustment: -10, net: 70, count: 3, excludedCount: 1 },
  generatedAt: "2026-10-15T12:00:00Z",
};
const request = (kind: string, extra = "") =>
  new Request(
    `https://sacsi.example/api/daily-rentals/calendar/${kind}?buildingId=${calendarBuilding}${extra}`,
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ role: "admin", id: "actor" });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
});
afterEach(() => vi.useRealTimers());
it("cash API returns only a complete scalar snapshot with private timings, never all-month rows or payment IDs", async () => {
  mocks.rpc.mockResolvedValue({ data: cash, error: null });
  const response = await cashGET(request("cash"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(cash);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("server-timing")).toMatch(/authorization;dur=.*database;dur=/);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("daily_calendar_cash_summary_rpc", {
    p_building_id: calendarBuilding,
  });
});
it.each(["front_desk", "rental_sales"])(
  "rejects cash under %s without querying financial data",
  async (role) => {
    mocks.user.mockResolvedValue({ role });
    expect((await cashGET(request("cash"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it("rejects anonymous/invalid filters and malformed, foreign or old cash rather than a zero or stale snapshot", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await cashGET(request("cash"))).status).toBe(401);
  mocks.user.mockResolvedValue({ role: "admin" });
  for (const extra of ["&buildingId=bad", "&query=unsupported"]) {
    expect((await cashGET(request("cash", extra))).status).toBe(400);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
  for (const value of [
    null,
    { ...cash, buildingId: "foreign" },
    { ...cash, today: "2026-10-14" },
    { ...cash, cash: { ...cash.cash, net: 999 } },
  ]) {
    mocks.rpc.mockResolvedValue({ data: value, error: null });
    expect((await cashGET(request("cash"))).status).toBe(503);
  }
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { code: "42501", message: "sensitive customer SQL" },
  });
  const denied = await cashGET(request("cash"));
  expect(denied.status).toBe(403);
  expect(JSON.stringify(await denied.json())).not.toContain("sensitive");
});
it.each(["admin", "boss", "finance", "front_desk", "rental_sales"])(
  "reads bounded candidate identities/active flags as %s, with original agent eligibility",
  async (role) => {
    mocks.user.mockResolvedValue({ role });
    const result = {
      buildingId: calendarBuilding,
      query: "颖",
      page: 1,
      hasMore: false,
      rows: [
        {
          id: "agent",
          name: "颖",
          phone: null,
          is_blacklisted: false,
          has_active_lease_contract: true,
          has_active_sale_contract: false,
        },
      ],
    };
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    const response = await customerGET(request("customers", "&query=%E9%A2%96&page=1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("daily_customer_candidates_rpc", {
      p_building_id: calendarBuilding,
      p_query: "颖",
      p_page: 1,
      p_names: [...DAILY_BOOKING_AGENT_NAMES],
    });
  },
);
it("candidate validation is bounded and incomplete flags/counts remain unavailable", async () => {
  for (const extra of [
    "&query=" + "x".repeat(81),
    "&page=0",
    "&page=2001",
    "&extra=x",
    "&query=x&query=y",
  ])
    expect((await customerGET(request("customers", extra))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  for (const rows of [
    [{ id: "agent", name: "颖", phone: null, is_blacklisted: false }],
    Array.from({ length: 51 }, (_, i) => ({
      id: String(i),
      name: "颖",
      phone: null,
      is_blacklisted: false,
      has_active_lease_contract: false,
      has_active_sale_contract: false,
    })),
  ]) {
    mocks.rpc.mockResolvedValue({
      data: { buildingId: calendarBuilding, query: "", page: 1, hasMore: false, rows },
      error: null,
    });
    expect((await customerGET(request("customers"))).status).toBe(503);
  }
});
it.each([
  ["cash", cashGET],
  ["customers", customerGET],
] as const)(
  "%s catches authorization transport/client creation errors as safe timed no-store 500, not false 401",
  async (kind, GET) => {
    mocks.user.mockRejectedValue(new Error("sensitive SDK connection and account details"));
    let response = await GET(request(kind));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("server-timing")).toMatch(
      /authorization;dur=.*response;dur=.*total;dur=/,
    );
    expect(JSON.stringify(await response.json())).not.toContain("sensitive");
    mocks.user.mockResolvedValue({ role: "admin" });
    mocks.client.mockRejectedValue(new Error("sensitive database credentials"));
    response = await GET(request(kind));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("server-timing")).toMatch(
      /authorization;dur=.*database;dur=.*response;dur=.*total;dur=/,
    );
    expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  },
);
