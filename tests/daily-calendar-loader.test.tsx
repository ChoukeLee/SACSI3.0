import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { calendarBuilding, calendarWindowFixture } from "./fixtures/calendar-window";

const deps = vi.hoisted(() => ({
  client: vi.fn(),
  read: vi.fn(),
  noStore: vi.fn(),
  headers: vi.fn(),
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  query: {
    select: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_noStore: deps.noStore }));
vi.mock("next/headers", () => ({ headers: deps.headers }));
vi.mock("@/lib/supabase/server", () => ({ createClient: deps.client }));
vi.mock("@/features/daily-rentals/receipt-analysis-query", () => ({
  businessDate: () => "2026-10-20",
}));
vi.mock("@/features/daily-rentals/calendar-window-service", () => ({
  readCalendarWindow: deps.read,
}));
vi.mock("@/features/daily-rentals/daily-rentals-responsive-view", () => ({
  DailyRentalsResponsiveView: () => null,
}));

import { DailyRentalData } from "@/app/daily-rentals/daily-rental-data";
import { DailyRentalsResponsiveView } from "@/features/daily-rentals/daily-rentals-responsive-view";

beforeEach(() => {
  vi.clearAllMocks();
  deps.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
  deps.headers.mockResolvedValue({ get: () => deps.userAgent });
  deps.client.mockResolvedValue({ from: () => deps.query });
  deps.query.select.mockReturnValue(deps.query);
  deps.query.in.mockReturnValue(deps.query);
  deps.query.eq.mockReturnValue(deps.query);
  deps.query.order.mockResolvedValue({
    data: [{ id: calendarBuilding, code: "SACSI11", display_name: "11#" }],
    error: null,
  });
  deps.read.mockImplementation(async (_client, query) =>
    calendarWindowFixture({ ...query, today: "2026-10-20" }),
  );
});

it.each(["zh", "fr"] as const)(
  "restores the original %s responsive calendar with its exact eight-day SSR window",
  async (locale) => {
    const result = (await DailyRentalData({
      userRole: "admin",
      locale,
      viewerId: "synthetic-viewer",
    })) as ReactElement<Record<string, unknown>>;
    expect(deps.noStore).toHaveBeenCalledTimes(1);
    expect(deps.read).toHaveBeenCalledWith(
      expect.anything(),
      { buildingId: calendarBuilding, from: "2026-10-20", to: "2026-10-28" },
      "admin",
    );
    expect(result.props.initialWindow).toMatchObject({
      from: "2026-10-20",
      to: "2026-10-28",
    });
    expect(result.type).toBe(DailyRentalsResponsiveView);
    expect(result.props.initialIsDesktop).toBe(true);
    expect(result.props.locale).toBe(locale);
    expect(result.key).toBe("synthetic-viewer:admin");
  },
);

it.each([
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", true],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile", false],
  ["Mozilla/5.0 (Linux; Android 15) Mobile", false],
  ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", false],
  ["", true],
] as const)(
  "seeds the original responsive surface from user-agent %s",
  async (userAgent, desktop) => {
    deps.userAgent = userAgent;
    const result = (await DailyRentalData({
      userRole: "front_desk",
      locale: "fr",
    })) as ReactElement<Record<string, unknown>>;
    expect(result.props.initialIsDesktop).toBe(desktop);
    expect(result.props.userRole).toBe("front_desk");
    expect(result.key).toBe("viewer:front_desk");
  },
);

it("preserves every scoped window row and caller identity instead of rebuilding legacy props from unrelated records", async () => {
  const initial = calendarWindowFixture({ today: "2026-10-20" });
  deps.read.mockResolvedValue(initial);
  const result = (await DailyRentalData({
    userRole: "finance",
    locale: "zh",
    viewerId: "finance-viewer",
  })) as ReactElement<Record<string, unknown>>;
  expect(result.key).toBe("finance-viewer:finance");
  expect(result.props.initialWindow).toBe(initial);
  for (const field of [
    "dailyUnits",
    "unitLookupUnits",
    "bookings",
    "customers",
    "payments",
    "cleaningTasks",
  ] as const)
    expect(result.props[field]).toBe(initial[field]);
  expect(result.props.financeSnapshots).toEqual({ [initial.buildingId]: initial.financeSnapshot });
  expect(deps.read).toHaveBeenCalledWith(expect.anything(), expect.anything(), "finance");
});

it("keeps a failed calendar RPC from rendering a partially trusted legacy screen", async () => {
  deps.read.mockRejectedValue(new Error("calendar read failed"));
  await expect(DailyRentalData({ userRole: "admin", locale: "zh" })).rejects.toThrow(
    "calendar read failed",
  );
});

it("does not turn a failed building read into an empty calendar or call the data RPC", async () => {
  deps.query.order.mockResolvedValue({ data: null, error: { message: "offline" } });
  await expect(DailyRentalData({ userRole: "admin", locale: "zh" })).rejects.toThrow(
    "Daily calendar data unavailable",
  );
  expect(deps.read).not.toHaveBeenCalled();
});

it.each(["zh", "fr"] as const)(
  "keeps an account with no accessible buildings out of the %s calendar read",
  async (locale) => {
    deps.query.order.mockResolvedValue({ data: [], error: null });
    const result = await DailyRentalData({ userRole: "front_desk", locale });
    expect(renderToStaticMarkup(result)).toContain(
      locale === "zh" ? "没有可访问" : "Aucun bâtiment",
    );
    expect(deps.read).not.toHaveBeenCalled();
  },
);
