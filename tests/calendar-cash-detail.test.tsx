// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CalendarCashDetail } from "@/features/daily-rentals/calendar-cash-detail";
import { receiptAnalysis, receiptLine } from "./fixtures/daily-receipt-analysis";
import { calendarBuilding } from "./fixtures/calendar-window";
let host: HTMLDivElement, root: Root;
const fetchMock = vi.fn(),
  onClose = vi.fn();
const read = (page = 1) =>
  receiptAnalysis({
    total: 51,
    summary: { gross: 51, refund: 0, adjustment: 0, net: 51, count: 51, excludedCount: 0 },
    rows: Array.from({ length: page === 1 ? 50 : 1 }, (_, i) =>
      receiptLine({
        id: `line-${(page - 1) * 50 + i}`,
        date: "2026-10-15",
        buildingId: calendarBuilding,
        amount: 1,
        amountXof: 1,
      }),
    ),
  });
beforeEach(() => {
  onClose.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () => read(Number(new URL(url, "https://example.test").searchParams.get("page"))),
    }),
  );
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
  await act(async () =>
    root.render(
      <CalendarCashDetail
        buildingId={calendarBuilding}
        today="2026-10-15"
        locale="zh"
        onClose={onClose}
      />,
    ),
  );
}
async function click(text: string) {
  await act(async () => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === text)!.click();
  });
}
it("reads exactly one current page on expansion, preserves full summary and gives the authorized complete export link", async () => {
  await render();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll("tbody tr")).toHaveLength(50);
  expect(host.textContent).toContain("51 笔计入");
  expect(fetchMock.mock.calls[0][0]).toContain("dateFrom=2026-10-01");
  expect(fetchMock.mock.calls[0][0]).toContain("dateTo=2026-10-15");
  expect(fetchMock.mock.calls[0][0]).not.toContain("export=");
  const link = host.querySelector("a")!;
  expect(link.href).toContain("export=1");
  expect(link.href).toContain("page=1");
  expect(link.href).toContain(`buildingId=${calendarBuilding}`);
  await click("下一页");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(host.textContent).toContain("51 笔计入");
  expect(host.textContent).toContain("2/2");
});
it.each(["truncated", "foreign", "permission"])(
  "keeps %s detail unknown, never showing an old page or a healthy zero",
  async (failure) => {
    await render();
    fetchMock.mockResolvedValue(
      failure === "permission"
        ? { ok: false, status: 403 }
        : {
            ok: true,
            json: async () =>
              failure === "foreign"
                ? { ...read(2), rows: [receiptLine({ buildingId: "foreign", date: "2026-10-15" })] }
                : { ...read(2), rows: [] },
          },
    );
    await click("下一页");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("金额未知");
    expect(host.querySelector("tbody")).toBeNull();
    expect(host.textContent).not.toContain("本月暂无记录");
    expect(host.querySelector("a")).toBeNull();
  },
);
it("shows excluded/real-refund/reversal evidence distinctly rather than blindly summing raw payments", async () => {
  const rows = [
    receiptLine({ date: "2026-10-15", buildingId: calendarBuilding, amount: 10, amountXof: 10 }),
    receiptLine({
      id: "refund",
      date: "2026-10-15",
      buildingId: calendarBuilding,
      kind: "refund",
      amount: -2,
      amountXof: -2,
    }),
    receiptLine({
      id: "reversal",
      date: "2026-10-15",
      buildingId: calendarBuilding,
      kind: "reversal",
      amount: -3,
      amountXof: -3,
      reversalOf: "prior",
    }),
    receiptLine({
      id: "excluded",
      date: "2026-10-15",
      buildingId: calendarBuilding,
      kind: "excluded",
      amount: 7,
      amountXof: null,
      paymentMethod: "offset",
      exclusionReason: "non_cash_offset",
    }),
  ];
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () =>
      receiptAnalysis({
        rows,
        total: 4,
        summary: { gross: 10, refund: 2, adjustment: -3, net: 5, count: 3, excludedCount: 1 },
      }),
  });
  await render();
  for (const label of ["实际退款", "录错冲正", "未纳入统计", "非现金抵扣，不计作实收"])
    expect(host.textContent).toContain(label);
});
it("resets pagination when the business-date scope changes and supplies modal keyboard semantics", async () => {
  await render();
  await click("下一页");
  await act(async () =>
    root.render(
      <CalendarCashDetail
        buildingId={calendarBuilding}
        today="2026-10-16"
        locale="zh"
        onClose={onClose}
      />,
    ),
  );
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("page=1");
  expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
  await act(async () =>
    host
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(onClose).toHaveBeenCalled();
});
it("notifies the owner when detail authorization is revoked, so a formerly verified parent cash snapshot can be invalidated", async () => {
  const revoked = vi.fn();
  fetchMock.mockResolvedValue({ ok: false, status: 403 });
  await act(async () =>
    root.render(
      <CalendarCashDetail
        buildingId={calendarBuilding}
        today="2026-10-15"
        locale="zh"
        onClose={onClose}
        onPermissionLost={revoked}
      />,
    ),
  );
  expect(revoked).toHaveBeenCalledTimes(1);
  expect(host.querySelector("tbody")).toBeNull();
});
