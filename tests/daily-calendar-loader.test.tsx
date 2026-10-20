import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { calendarBuilding, calendarWindowFixture } from "./fixtures/calendar-window";

const deps = vi.hoisted(() => ({
  client: vi.fn(),
  read: vi.fn(),
  noStore: vi.fn(),
  query: {
    select: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_noStore: deps.noStore }));
vi.mock("@/lib/supabase/server", () => ({ createClient: deps.client }));
vi.mock("@/features/daily-rentals/receipt-analysis-query", () => ({
  businessDate: () => "2026-10-20",
}));
vi.mock("@/features/daily-rentals/calendar-window-service", () => ({
  readCalendarWindow: deps.read,
}));
vi.mock("@/features/daily-rentals/daily-workbench", () => ({
  DailyWorkbench: () => null,
}));

import { DailyRentalData } from "@/app/daily-rentals/daily-rental-data";

beforeEach(() => {
  vi.clearAllMocks();
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
  "matches the default seven-day %s calendar SSR window without an extra eighth day",
  async (locale) => {
    const result = (await DailyRentalData({
      userRole: "admin",
      locale,
      viewerId: "synthetic-viewer",
    })) as ReactElement<Record<string, unknown>>;
    expect(deps.noStore).toHaveBeenCalledTimes(1);
    expect(deps.read).toHaveBeenCalledWith(
      expect.anything(),
      { buildingId: calendarBuilding, from: "2026-10-20", to: "2026-10-27" },
      "admin",
    );
    expect(result.props.initialWindow).toMatchObject({
      from: "2026-10-20",
      to: "2026-10-27",
    });
    expect(result.props.locale).toBe(locale);
    expect(result.key).toBe("synthetic-viewer:admin");
  },
);

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
