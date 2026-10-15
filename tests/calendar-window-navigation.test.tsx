// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) =>
    loader.toString().includes("mobile-daily-cards")
      ? function Mobile() {
          return <button type="button">MOBILE MUTATION</button>;
        }
      : function Calendar(props: {
          onVisibleRangeChange?: (from: string, to: string) => void;
          financeSnapshot?: { currentOutstanding: number };
          windowError: boolean;
          windowPending: boolean;
        }) {
          return (
            <div>
              <span data-balance>{props.financeSnapshot?.currentOutstanding}</span>
              <span data-error>{String(props.windowError)}</span>
              <span data-pending>{String(props.windowPending)}</span>
              <button onClick={() => props.onVisibleRangeChange?.("2020-01-01", "2020-01-09")}>
                OLD RANGE
              </button>
              <button onClick={() => props.onVisibleRangeChange?.("2026-10-15", "2026-10-23")}>
                TODAY RANGE
              </button>
            </div>
          );
        },
}));
import { DailyRentalsResponsiveView } from "@/features/daily-rentals/daily-rentals-responsive-view";
import {
  calendarBuilding,
  calendarOtherBuilding,
  calendarWindowFixture,
} from "./fixtures/calendar-window";
let root: Root, host: HTMLDivElement;
let media: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  const initial = calendarWindowFixture();
  await act(async () =>
    root.render(
      <DailyRentalsResponsiveView
        dailyUnits={[]}
        bookings={[]}
        customers={[]}
        payments={[]}
        cleaningTasks={[]}
        locale="zh"
        userRole="front_desk"
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
async function click(label: string) {
  await act(async () => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click();
  });
}
function response(from: string, to: string, balance: number) {
  return {
    ok: true,
    json: async () =>
      calendarWindowFixture({
        from,
        to,
        currentOutstanding: balance,
        financeSnapshot: {
          today: "2026-10-15",
          month: "2026-10",
          cash: null,
          includedPaymentIds: [],
          currentOutstanding: balance,
          monthSettled: 0,
        },
      }),
  };
}

it("fetches a changed date and refetches when returning to the initial period instead of reverting to stale SSR balances", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response("2020-01-01", "2020-01-09", 50))
    .mockResolvedValueOnce(response("2026-10-15", "2026-10-23", 40));
  vi.stubGlobal("fetch", fetch);
  await render();
  expect(fetch).not.toHaveBeenCalled();
  expect(host.querySelector("[data-balance]")?.textContent).toBe("100");
  await click("OLD RANGE");
  expect(host.querySelector("[data-balance]")?.textContent).toBe("50");
  await click("TODAY RANGE");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(host.querySelector("[data-balance]")?.textContent).toBe("40");
  expect(fetch.mock.calls[1][0]).toContain("from=2026-10-15");
  expect(fetch.mock.calls[1][1]).toMatchObject({ cache: "no-store" });
});
it("ignores a late response from an abandoned window", async () => {
  let completeOld!: (value: ReturnType<typeof response>) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOld = resolve;
        }),
    )
    .mockResolvedValueOnce(response("2026-10-15", "2026-10-23", 25));
  vi.stubGlobal("fetch", fetch);
  await render();
  await click("OLD RANGE");
  await click("TODAY RANGE");
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    completeOld(response("2020-01-01", "2020-01-09", 999));
  });
  expect(host.querySelector("[data-balance]")?.textContent).toBe("25");
});
it("keeps failed date windows unknown and hides mobile mutation actions rather than using an old same-building window", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
  await render();
  await click("OLD RANGE");
  expect(host.querySelector("[data-error]")?.textContent).toBe("true");
  await act(async () => {
    media.matches = false;
    media.addEventListener.mock.calls[0][1]();
  });
  expect(host.textContent).toContain("房态未知");
  expect(host.textContent).not.toContain("MOBILE MUTATION");
  expect(host.querySelector('[role="alert"]')).toBeTruthy();
});
