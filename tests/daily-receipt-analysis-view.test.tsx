// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptAnalysisView } from "@/features/daily-rentals/receipt-analysis-view";
import { DailyReceiptsNav } from "@/features/daily-rentals/daily-receipts-nav";
import type { ReceiptAnalysis } from "@/features/daily-rentals/receipt-analysis-types";
import { receiptAnalysis, receiptLine } from "./fixtures/daily-receipt-analysis";

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(
  data: ReceiptAnalysis | null = receiptAnalysis(),
  locale: "zh" | "fr" = "zh",
  initialError?: string,
) {
  await act(async () =>
    root.render(
      <ReceiptAnalysisView locale={locale} initialData={data} initialError={initialError} />,
    ),
  );
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text))!;
}
async function click(element: Element) {
  await act(async () => (element as HTMLElement).click());
}
async function select(label: string, value: string) {
  const element = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function response(data = receiptAnalysis()) {
  return { ok: true, json: async () => data };
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("daily receipt history UI", () => {
  it("renders trend-first exact XOF, full result count and clear accounting scope without refetching SSR data", async () => {
    await render();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector("h1")?.textContent).toBe("日租收款分析");
    expect(host.textContent).toContain("6,240,000");
    expect(host.textContent).toContain("共 123 笔");
    expect(host.textContent).toContain("2026/08/01 – 2026/08/31");
    expect(host.textContent).toContain("不等同于营业收入或利润");
    expect(host.textContent).toContain("历史完整性尚未人工验收");
    expect(host.textContent).toContain("1 笔记录未纳入");
    const sections = host.querySelectorAll("section");
    expect(sections[0].textContent).toContain("最近 12 个完整月");
    expect(sections[1].textContent).toContain("收款流水");
  });

  it("renders unavailable comparisons without fabricating 0 percent growth", async () => {
    const data = receiptAnalysis();
    data.comparisons.previous = {
      ...data.comparisons.previous,
      status: "non_positive_baseline",
      amount: 6240000,
      percent: null,
    };
    data.comparisons.year = {
      ...data.comparisons.year,
      status: "insufficient_history",
      amount: null,
      percent: null,
    };
    await render(data);
    expect(host.textContent).toContain("基期为零或负数，不计算增长率");
    expect(host.textContent).toContain("无可比历史数据");
    expect(host.querySelector("dl")?.textContent).not.toContain("0 %");
  });

  it("localizes French controls and CSV with identical filters, not only current page", async () => {
    const data = receiptAnalysis();
    data.filters.page = 2;
    data.filters.query = "Kouamé";
    data.filters.method = "cash";
    await render(data, "fr");
    expect(host.querySelector("h1")?.textContent).toContain("Encaissements");
    const url = new URL(
      host.querySelector("a[download]")!.getAttribute("href")!,
      "https://example.invalid",
    );
    expect(url.searchParams.get("locale")).toBe("fr");
    expect(url.searchParams.get("query")).toBe("Kouamé");
    expect(url.searchParams.get("method")).toBe("cash");
    expect(url.searchParams.get("export")).toBe("1");
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("opens a focus-trapped detail, labels the agent honestly and renders markup as text", async () => {
    const row = receiptLine({ notes: '<img src=x onerror="alert(1)">', paymentMethod: null });
    await render(receiptAnalysis({ rows: [row] }));
    const trigger = host.querySelector('button[aria-label^="查看"]')!;
    await click(trigger);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("订单经办人");
    expect(dialog.textContent).toContain("不等同于实际收款人");
    expect(dialog.textContent).toContain("方式未记录");
    expect(dialog.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(dialog.querySelector("img")).toBeNull();
    await click(dialog.querySelector('button[aria-label="关闭详情"]')!);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("resets page and keeps filter controls usable when a filtered read fails", async () => {
    const data = receiptAnalysis();
    data.filters.page = 2;
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "receiptHistoryUnavailable" }),
    });
    await render(data);
    await select("收款方式", "cash");
    const params = new URL(fetchMock.mock.calls[0][0], "https://example.invalid").searchParams;
    expect(params.get("method")).toBe("cash");
    expect(params.get("page")).toBe("1");
    expect(host.textContent).toContain("读取失败不代表收款为零");
    expect(host.textContent).not.toContain("6,240,000");
    expect(host.querySelector('select[aria-label="收款方式"]')).not.toBeNull();
    expect(host.querySelector("a[download]")).toBeNull();
  });

  it("aborts outdated requests and ignores late stale successful responses", async () => {
    let resolveFirst!: (value: ReturnType<typeof response>) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const next = receiptAnalysis();
    next.filters.method = "check";
    next.summary.net = 99000;
    fetchMock.mockResolvedValueOnce(response(next));
    await render();
    await select("收款方式", "cash");
    const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await select("收款方式", "check");
    expect(firstSignal.aborted).toBe(true);
    expect(host.textContent).toContain("99,000");
    await act(async () => resolveFirst(response(receiptAnalysis())));
    expect(host.textContent).toContain("99,000");
    expect(host.textContent).not.toContain("6,240,000");
  });

  it("debounces search while preserving its DOM input and disables stale export immediately", async () => {
    fetchMock.mockResolvedValue(response());
    await render();
    const search = host.querySelector('input[type="search"]') as HTMLInputElement;
    search.focus();
    await input(search, "EX-09");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector("a[download]")).toBeNull();
    expect(host.querySelector('input[type="search"]')).toBe(search);
    await act(
      async () =>
        new Promise((resolve) => {
          setTimeout(resolve, 400);
        }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new URL(fetchMock.mock.calls[0][0], "https://example.invalid").searchParams.get("query"),
    ).toBe("EX-09");
    expect(document.activeElement).toBe(search);
  });

  it("loads a chosen month from accessible keyboard chart controls", async () => {
    fetchMock.mockResolvedValue(response());
    await render();
    const bar = host.querySelector('[role="button"][aria-label^="2025-10"]')!;
    await act(async () =>
      bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(
      new URL(fetchMock.mock.calls[0][0], "https://example.invalid").searchParams.get("month"),
    ).toBe("2025-10");
    expect(host.querySelector('input[type="month"]')?.getAttribute("value")).toBe("2025-10");
  });

  it("measures narrow chart width so axis fonts do not shrink with a desktop viewBox", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
    await render();
    const chart = host.querySelector('svg[aria-label="最近十二个完整月净收款，单位万 XOF"]')!;
    expect(chart.getAttribute("viewBox")).toBe("0 0 320 220");
    expect(chart.querySelectorAll('[role="button"]')).toHaveLength(12);
    const monthLabels = [...chart.querySelectorAll("text")].filter((item) =>
      item.textContent?.endsWith("月"),
    );
    expect(monthLabels).toHaveLength(5);
  });

  it("marks a month without records as unknown activity rather than zero takings", async () => {
    const data = receiptAnalysis();
    data.trend[0] = {
      ...data.trend[0],
      gross: 0,
      refund: 0,
      adjustment: 0,
      net: 0,
      count: 0,
      excludedCount: 0,
    };
    await render(data);
    const month = host.querySelector('[role="button"][aria-label^="2025-10"]')!;
    expect(month.getAttribute("aria-label")).toContain("无记录，不代表零经营");
    expect(month.getAttribute("aria-label")).not.toContain("0 XOF");
    expect(month.querySelectorAll("rect")).toHaveLength(1);
  });

  it("rejects unequal periods as a percentage comparison instead of forcing a growth rate", async () => {
    const data = receiptAnalysis();
    data.comparisons.previous = {
      ...data.comparisons.previous,
      status: "unequal_period",
      amount: null,
      percent: null,
    };
    await render(data);
    expect(host.textContent).toContain("同期天数不同，不计算增长率");
  });

  it("never turns an initial read failure into a zero summary and retries explicitly", async () => {
    await render(null, "zh", "receiptPermissionDenied");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("当前账号没有查看日租收款的权限");
    expect(host.querySelector("dl")).toBeNull();
    fetchMock.mockResolvedValue(response());
    await click(button("重新读取"));
    expect(host.textContent).toContain("6,240,000");
  });

  it("preserves an explicit original non-XOF amount as excluded instead of displaying XOF zero", async () => {
    await render(
      receiptAnalysis({
        rows: [
          receiptLine({
            kind: "excluded",
            amount: 15,
            currency: "EUR",
            amountXof: null,
            exclusionReason: "non_xof",
          }),
        ],
      }),
    );
    expect(host.querySelector("tbody")?.textContent).toContain("15 EUR");
    expect(host.querySelector("tbody")?.textContent).toContain("未计入 XOF");
    expect(host.querySelector("tbody")?.textContent).not.toContain("0 XOF");
  });

  it("disables over-limit exports instead of silently downloading a truncated result", async () => {
    await render(receiptAnalysis({ total: 10001 }));
    expect(host.querySelector("a[download]")).toBeNull();
    expect(button("导出 CSV").disabled).toBe(true);
    expect(button("导出 CSV").title).toContain("最多 10,000 笔");
  });

  it("displays invalid original amounts as missing, not zero", async () => {
    await render(
      receiptAnalysis({
        rows: [
          receiptLine({
            amount: null,
            amountXof: null,
            kind: "excluded",
            exclusionReason: "invalid_amount",
          }),
        ],
      }),
    );
    expect(host.querySelector("tbody")?.textContent).toContain("— XOF");
    await click(host.querySelector('button[aria-label^="查看"]')!);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "金额无效，请核对原始记录",
    );
  });

  it("drills into real stay, original evidence and authenticated audit accounts without agent impersonation", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        booking: { checkIn: "2026-09-20", checkOut: "2026-09-25", status: "checked_out" },
        attachments: [
          {
            id: "file-safe",
            url: "https://storage.example.invalid/receipt?token=example",
            fileType: "image/jpeg",
            archiveStatus: "archived",
          },
          {
            id: "file-unsafe",
            url: "javascript:alert(1)",
            fileType: "image/jpeg",
            archiveStatus: "archived",
          },
        ],
        audit: [
          {
            id: "audit-one",
            createdAt: "2026-09-28T15:30:00Z",
            action: "CREATE_PAYMENT",
            actorId: "actor-01",
            actorName: "黄姐",
          },
          {
            id: "audit-two",
            createdAt: "2026-09-28T15:31:00Z",
            action: "UPDATE_PAYMENT",
            actorId: null,
            actorName: "Not authenticated",
          },
        ],
        auditAllowed: true,
        attachmentsUnavailable: false,
        auditUnavailable: false,
      }),
    });
    await render();
    await click(host.querySelector('button[aria-label^="查看"]')!);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/daily-rentals/receipts/example-payment-01");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("2026/09/20 – 2026/09/25");
    expect(dialog.textContent).toContain("已退房");
    expect(dialog.querySelectorAll("a")).toHaveLength(1);
    expect(dialog.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(dialog.textContent).toContain("黄姐");
    expect(dialog.textContent).toContain("无登录账号记录");
    expect(dialog.textContent).not.toContain("Not authenticated");
  });

  it("keeps main totals intact when detail cannot load and does not call missing data absent", async () => {
    fetchMock.mockRejectedValue(new Error("network unavailable"));
    await render();
    await click(host.querySelector('button[aria-label^="查看"]')!);
    expect(host.textContent).toContain("6,240,000");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "不代表没有凭证或审计记录",
    );
  });

  it("does not show audit records for an account lacking audit permission", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        booking: null,
        attachments: [],
        audit: [],
        auditAllowed: false,
        attachmentsUnavailable: false,
        auditUnavailable: false,
      }),
    });
    await render();
    await click(host.querySelector('button[aria-label^="查看"]')!);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "当前账号没有查看审计日志的权限",
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "收据编号不代表原件已归档",
    );
  });

  it("retains a valid month when changing from a custom period back to monthly mode", async () => {
    const data = receiptAnalysis();
    data.periods.custom = true;
    data.filters.month = "";
    fetchMock.mockResolvedValue(response());
    await render(data);
    const mode = host.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      mode.value = "month";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const params = new URL(fetchMock.mock.calls[0][0], "https://example.invalid").searchParams;
    expect(params.get("month")).toBe("2026-09");
    expect(params.has("dateFrom")).toBe(false);
    expect(host.querySelector('input[type="month"]')?.getAttribute("value")).toBe("2026-09");
  });

  it("only offers analysis navigation to existing finance-capable daily roles", async () => {
    await act(async () =>
      root.render(<DailyReceiptsNav locale="zh" active="calendar" userRole="front_desk" />),
    );
    expect(host.querySelector("nav")).toBeNull();
    await act(async () =>
      root.render(<DailyReceiptsNav locale="fr" active="receipts" userRole="finance" />),
    );
    expect(host.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
      "/fr/daily-rentals/receipts",
    );
    expect(host.textContent).toContain("Encaissements");
  });
});
