// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NativeCurrencySummaryPanel } from "@/components/native-currency-summary";
import type { NativeCurrencySummary } from "@/lib/native-money";

const settled: NativeCurrencySummary = {
  currency: "USD",
  income: 0,
  expense: 0,
  liability_in: 0,
  liability_out: 0,
  receivable: 19200,
  paid: 19200,
  outstanding: 0,
  overdue: 0,
};

function render(
  kind: "operating" | "ledger" | "receivables",
  rows?: NativeCurrencySummary[],
  locale: "zh" | "fr" = "zh",
) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <NativeCurrencySummaryPanel rows={rows} kind={kind} locale={locale} />,
  );
  return host;
}

describe("compact independent currency summary", () => {
  it("does not add an empty affordance when the legacy response has no currencies", () => {
    expect(render("operating").innerHTML).toBe("");
    expect(render("ledger", []).innerHTML).toBe("");
  });

  it("collapses by default and retains settled history without zero-filled banners", () => {
    const host = render("operating", [settled]);
    const details = host.querySelector("details")!;
    const summary = details.querySelector("summary")!;
    expect(details.open).toBe(false);
    expect(details.getAttribute("aria-label")).toBe("原币独立统计");
    expect(summary.textContent).toContain("其他币种");
    expect(summary.textContent).toContain("USD");
    expect(summary.textContent).not.toContain("$0");
    expect(summary.textContent).not.toContain("19,200");
    expect(details.querySelector("dl")?.textContent).toContain("已核销$19,200");
    expect(details.querySelector("dl")?.textContent).toContain("未收$0");
    expect(host.textContent).toContain("不折算或并入 XOF 合计");
  });

  it("keeps every supplied currency independently accessible even when all current values are zero", () => {
    const zero = { ...settled, receivable: 0, paid: 0 };
    const host = render("ledger", [zero, { ...zero, currency: "CNY" }]);
    expect(host.querySelectorAll("h3")).toHaveLength(2);
    expect(host.querySelector("summary")?.textContent).toContain("USD");
    expect(host.querySelector("summary")?.textContent).toContain("CNY");
    expect(host.querySelector("summary")?.textContent).not.toMatch(/[$¥]0/);
    expect(host.querySelectorAll("dd")).toHaveLength(8);
  });

  it("shows negative corrections instead of dropping them as inactive", () => {
    const host = render("ledger", [{ ...settled, income: -80.5, expense: -12.25 }]);
    expect(host.querySelector("summary")?.textContent).toContain("收入分录 $-80.5");
    expect(host.querySelector("summary")?.textContent).toContain("费用 $-12.25");
    expect(host.querySelector("dl")?.textContent).not.toContain("已核销");
  });

  it("keeps deposit-only movements in the ledger preview without treating them as income", () => {
    const host = render("ledger", [{ ...settled, liability_out: -200 }]);
    expect(host.querySelector("summary")?.textContent).toContain("押金流出 $-200");
    expect(host.querySelector("summary")?.textContent).not.toContain("收入分录");
  });

  it("shows outstanding and overdue first, but retains paid history in details", () => {
    const host = render("receivables", [{ ...settled, outstanding: 3200, overdue: 1600 }]);
    expect(host.querySelector("summary")?.textContent).toContain("未收 $3,200");
    expect(host.querySelector("summary")?.textContent).toContain("其中逾期 $1,600");
    expect(host.querySelector("summary")?.textContent).not.toContain("19,200");
    expect(host.querySelector("dl")?.textContent).toContain("已核销$19,200");
    expect(render("receivables", [settled]).querySelector("summary")?.textContent).toContain(
      "已核销 $19,200",
    );
  });

  it("does not present the operating snapshot's placeholder expenses as full native cashflow", () => {
    const host = render("operating", [
      { ...settled, income: -100, expense: 250, liability_in: 500 },
    ]);
    expect(host.querySelector("summary")?.textContent).toContain("本月收款 $-100");
    expect(host.querySelectorAll("dt")).toHaveLength(5);
    expect(host.querySelector("dl")?.textContent).not.toMatch(/费用|押金/);
    expect(host.textContent).toContain("应收与核销为截至今日已到期记录的当前状态");
    expect(host.textContent).toContain("不代表完整原币现金流");
  });

  it("localizes labels and numbers while keeping currency buckets separate", () => {
    const host = render(
      "receivables",
      [
        { ...settled, outstanding: 3200.25 },
        { ...settled, currency: "CNY", outstanding: 900.5 },
      ],
      "fr",
    );
    expect(host.querySelector("details")?.getAttribute("aria-label")).toBe(
      "Totaux en devises séparées",
    );
    expect(host.querySelector("summary")?.textContent).toContain("Autres devises");
    expect(host.querySelector("summary")?.textContent).toContain("Restant $3\u202f200,25");
    expect(host.querySelector("summary")?.textContent).toContain("Restant ¥900,5");
    expect(host.querySelector("summary")?.textContent).not.toMatch(/4\s?100/);
    expect(host.textContent).toContain("sans conversion");
    expect(host.textContent).not.toMatch(/其他币种|未收|查看明细/);
  });
});
