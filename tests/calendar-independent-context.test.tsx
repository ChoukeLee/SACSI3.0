// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UnitRow } from "@/types/database";
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) =>
    loader.toString().includes("mobile-daily-cards")
      ? () => null
      : loader.toString().includes("booking-panel")
        ? () => <input aria-label="合成补录内容" defaultValue="" />
        : function Calendar(props: {
            financeSnapshot?: { cash: { net: number } | null };
            cashPending: boolean;
            cashAsOf?: string;
            onRetryCash: () => void;
            onVisibleRangeChange: (from: string, to: string) => void;
          }) {
            return (
              <div>
                <span data-cash>{props.financeSnapshot?.cash?.net ?? "unknown"}</span>
                <span data-asof>{props.cashAsOf}</span>
                <span data-cash-pending>{String(props.cashPending)}</span>
                <button onClick={() => props.onVisibleRangeChange("2020-01-01", "2020-01-09")}>
                  OLD RANGE
                </button>
                <button onClick={() => props.onVisibleRangeChange("2026-10-15", "2026-10-23")}>
                  TODAY RANGE
                </button>
                <button onClick={props.onRetryCash}>RETRY CASH</button>
              </div>
            );
          },
}));
import { DailyRentalsResponsiveView } from "@/features/daily-rentals/daily-rentals-responsive-view";
import { notifyDailyDataChanged } from "@/features/daily-rentals/daily-read-invalidation";
import {
  calendarBuilding,
  calendarOtherBuilding,
  calendarWindowFixture,
} from "./fixtures/calendar-window";

it.each(["admin", "front_desk", "finance", "boss"])(
  "only exposes the backfill entry to administrators (%s)",
  async (role) => {
    await render(role);
    expect(host.textContent?.includes("补录已结束住宿")).toBe(role === "admin");
  },
);
let host: HTMLDivElement, root: Root;
const fetchMock = vi.fn();
const cashResult = (buildingId = calendarBuilding, net = 100) => ({
  buildingId,
  today: "2026-10-15",
  month: "2026-10",
  cash: { gross: net, refund: 0, adjustment: 0, net, count: 1, excludedCount: 0 },
  generatedAt: "2026-10-15T12:00:00Z",
});
const response = (data: unknown) => ({ ok: true, json: async () => data });
function calendarResponse(url: string) {
  const params = new URL(url, "https://example.test").searchParams;
  return response(
    calendarWindowFixture({
      buildingId: params.get("buildingId")!,
      from: params.get("from")!,
      to: params.get("to")!,
    }),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    url.includes("/cash?")
      ? Promise.resolve(
          response(
            cashResult(new URL(url, "https://example.test").searchParams.get("buildingId")!),
          ),
        )
      : Promise.resolve(calendarResponse(url)),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(role = "admin", initial = calendarWindowFixture()) {
  await act(async () =>
    root.render(
      <DailyRentalsResponsiveView
        dailyUnits={[]}
        bookings={[]}
        customers={[]}
        payments={[]}
        cleaningTasks={[]}
        locale="zh"
        userRole={role}
        buildings={[
          { id: calendarBuilding, code: "SACSI11", display_name: "11" },
          { id: calendarOtherBuilding, code: "SACSI5", display_name: "5" },
        ]}
        initialIsDesktop
        initialWindow={initial}
      />,
    ),
  );
}
async function click(text: string) {
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find(
        (button) =>
          button.textContent === text ||
          button.getAttribute("aria-label") === text ||
          (text === "5" && button.textContent?.startsWith("5")),
      )!
      .click();
  });
}
const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part));
it("keeps an open backfill and its entered values across focus refresh, including a failed window read", async () => {
  const unit = { id: "unit", building_id: calendarBuilding, unit_no: "204" } as UnitRow;
  await render("admin", calendarWindowFixture({ dailyUnits: [unit] }));
  await click("补录已结束住宿");
  const field = host.querySelector('[aria-label="合成补录内容"]') as HTMLInputElement;
  expect(field).not.toBeNull();
  field.value = "204，10月21日，现金80000";
  let rejectRead!: (error: Error) => void;
  fetchMock.mockImplementation((url: string) =>
    url.includes("/cash?")
      ? Promise.resolve(response(cashResult()))
      : new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
  );
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(host.querySelector('[aria-label="合成补录内容"]')).toBe(field);
  expect(field.value).toBe("204，10月21日，现金80000");
  await act(async () => {
    rejectRead(new Error("Synthetic window read failure"));
  });
  expect(host.querySelector('[aria-label="合成补录内容"]')).toBe(field);
  expect(field.value).toBe("204，10月21日，现金80000");
});
it("loads one scalar cash snapshot independently, with no receipt or customer detail during date changes", async () => {
  await render();
  expect(host.querySelector("[data-cash]")?.textContent).toBe("100");
  expect(host.querySelector("[data-asof]")?.textContent).toBe("2026-10-15T12:00:00Z");
  expect(calls("/cash?")).toHaveLength(1);
  expect(calls("/calendar?")).toHaveLength(0);
  await click("OLD RANGE");
  await click("TODAY RANGE");
  expect(calls("/cash?")).toHaveLength(1);
  expect(calls("/calendar?")).toHaveLength(2);
  expect(calls("/receipts")).toHaveLength(0);
  expect(calls("/customers")).toHaveLength(0);
  expect(fetchMock.mock.calls.every(([, options]) => options.cache === "no-store")).toBe(true);
});
it("switches cash scope with the building, aborting and ignoring a delayed previous building response", async () => {
  let old!: (value: unknown) => void;
  fetchMock.mockImplementation((url: string) =>
    url.includes("/cash?")
      ? url.includes(calendarBuilding)
        ? new Promise((resolve) => {
            old = resolve;
          })
        : Promise.resolve(response(cashResult(calendarOtherBuilding, 25)))
      : Promise.resolve(calendarResponse(url)),
  );
  await render();
  expect(host.querySelector("[data-cash]")?.textContent).toBe("unknown");
  await click("5");
  expect(host.querySelector("[data-cash]")?.textContent).toBe("25");
  expect(calls("/cash?")[0][1].signal.aborted).toBe(true);
  await act(async () => old(response(cashResult(calendarBuilding, 999))));
  expect(host.querySelector("[data-cash]")?.textContent).toBe("25");
});
it("invalidates after financial writes, never displaying old verified numbers while rechecking or after permission failure", async () => {
  await render();
  await act(async () => notifyDailyDataChanged(calendarOtherBuilding));
  expect(calls("/cash?")).toHaveLength(1);
  let complete!: (value: unknown) => void;
  fetchMock.mockImplementation((url: string) =>
    url.includes("/cash?")
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : Promise.resolve(calendarResponse(url)),
  );
  await act(async () => notifyDailyDataChanged(calendarBuilding));
  expect(host.querySelector("[data-cash]")?.textContent).toBe("unknown");
  expect(host.querySelector("[data-cash-pending]")?.textContent).toBe("true");
  await act(async () => complete({ ok: false, status: 403 }));
  expect(host.querySelector("[data-cash]")?.textContent).toBe("unknown");
  expect(host.querySelector("[data-cash-pending]")?.textContent).toBe("false");
  fetchMock.mockImplementation((url: string) =>
    url.includes("/cash?")
      ? Promise.resolve(response(cashResult(calendarBuilding, 50)))
      : Promise.resolve(calendarResponse(url)),
  );
  await click("RETRY CASH");
  expect(host.querySelector("[data-cash]")?.textContent).toBe("50");
});
it("rechecks external changes on focus, manual refresh and a new SSR revision, even if booking rows are unchanged", async () => {
  const initial = calendarWindowFixture();
  await render("admin", initial);
  expect(calls("/cash?")).toHaveLength(1);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(calls("/cash?")).toHaveLength(2);
  await click("刷新房态与收款快照");
  expect(calls("/cash?")).toHaveLength(3);
  await render("admin", { ...initial });
  expect(calls("/cash?")).toHaveLength(4);
});
it("does not fetch financial summaries for business-only roles", async () => {
  await render("front_desk");
  await click("OLD RANGE");
  expect(calls("/cash?")).toHaveLength(0);
  expect(host.querySelector("[data-cash]")?.textContent).toBe("unknown");
});
