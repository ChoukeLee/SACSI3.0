// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceActualCashWorkbench } from "@/features/finance/finance-actual-cash-workbench";
import { buildFinanceActualCash } from "@/features/finance/finance-actual-cash-model";
import { parseFinanceRead } from "@/features/finance/finance-read";
import type { FinanceWorkbenchProps } from "@/features/finance/finance-workbench";
import type { PaymentRow } from "@/types/database";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ui/operational", () => ({
  RightDrawer: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <aside>{children}</aside> : null,
}));
vi.mock("@/features/finance/finance-workbench-inspector", () => ({
  FinanceWorkbenchInspector: () => <div>已保留付款核对</div>,
}));
vi.mock("@/features/finance/finance-manual-entry", () => ({
  FinanceManualEntry: () => <button>手工录入</button>,
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function props(nativeSettlement = false): FinanceWorkbenchProps {
  const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  return {
    scopeKey: "cash",
    query: parseFinanceRead({ projectId, dateFrom: "2026-11-01", dateTo: "2026-11-11" }),
    mode: "ledger",
    result: null,
    projects: [],
    buildings: [],
    reconciliation: null,
    locale: "zh",
    canWrite: false,
    today: "2026-11-11",
    cashView: true,
    actualCash: buildFinanceActualCash({
      projectId,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-11",
      ledger: [
        {
          id: "l1",
          payment_id: "p1",
          entry_date: "2026-11-03",
          category: "lease_rent",
          direction: "income",
          amount_xof: nativeSettlement ? 0 : 1200,
          amount_native: nativeSettlement ? 100 : null,
          currency: nativeSettlement ? "CNY" : "XOF",
          building_label: "11#",
          unit_label: "103",
        },
      ],
      payments: [
        {
          id: "p1",
          payment_date: "2026-11-03",
          source_type: "lease_rent",
          amount: 100,
          currency: "CNY",
          exchange_rate_to_xof: 12,
          native_settlement: nativeSettlement,
          payment_method: "bank_transfer",
        } as PaymentRow,
      ],
    }),
  };
}
it("separates original cash from recorded XOF and preserves the record proof on explicit selection", async () => {
  await act(async () => root.render(<FinanceActualCashWorkbench {...props()} />));
  expect(host.querySelector("tbody")?.textContent).toContain("¥100");
  expect(host.querySelector("tbody")?.textContent).toContain("0.12 万西法");
  expect(host.textContent).toContain("暂无已确认支出");
  expect(host.textContent).toContain("费用资料未齐");
  expect(host.textContent).not.toContain("手工录入");
  await act(async () => host.querySelector<HTMLButtonElement>("tbody button")!.click());
  expect(host.querySelector("aside")?.textContent).toContain("已保留付款核对");
});
it("never renders a missing XOF booking as zero XOF income", async () => {
  await act(async () => root.render(<FinanceActualCashWorkbench {...props(true)} />));
  const summary = host.querySelector('[aria-label="已录实际收支汇总"]')!;
  expect(summary.textContent).toContain("原币另列，西法未齐");
  expect(summary.textContent).not.toContain("0 万西法");
  expect(host.querySelector("tbody")?.textContent).toContain("原币结算 / 待补折算");
});
it("keeps cash failure unavailable and retains the original all-date ledger route", async () => {
  await act(async () =>
    root.render(
      <FinanceActualCashWorkbench {...props()} actualCash={null} actualCashUnavailable />,
    ),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("未显示为零收支");
  expect(host.querySelector("table")).toBeNull();
  const links = [...host.querySelectorAll<HTMLAnchorElement>("a")];
  const history = links.find((link) => link.textContent?.includes("全部日期"))!;
  expect(history.getAttribute("href")).toContain("kind=ledger");
  expect(history.getAttribute("href")).not.toContain("dateFrom");
});
it.each([
  ["zh", "deposit_in", "押金收入"],
  ["zh", "deposit_out", "退还押金"],
  ["fr", "deposit_in", "Dépôt reçu"],
  ["fr", "deposit_out", "Dépôt remboursé"],
] as const)(
  "labels operating deposits and keeps the source fingerprint collapsed in %s %s",
  async (locale, kind, expectedLabel) => {
    const source = props();
    const description =
      "B05 已收到两个月押金；sha256:" +
      "a".repeat(64) +
      ":file:租金截止表.xlsx:sheet:孵化园:cell:D35";
    source.actualCash!.rows = [
      {
        ...source.actualCash!.rows[0],
        id: "operation:b05",
        category: "deposit",
        kind,
        cashDirection: kind === "deposit_in" ? "in" : "out",
        assetLabel: "孵化园 B05",
        amountNative: 63840,
        currency: "CNY",
        ledgerId: null,
        paymentId: null,
        operatingAssetId: "b05",
        description,
      },
    ];
    await act(async () => root.render(<FinanceActualCashWorkbench {...source} locale={locale} />));
    expect(host.querySelector("tbody")?.textContent).toContain(expectedLabel);
    expect(host.querySelector("tbody")?.textContent).not.toContain("其他业务");
    await act(async () => host.querySelector<HTMLButtonElement>("tbody button")!.click());
    const aside = host.querySelector("aside")!;
    const proof = [...aside.querySelectorAll<HTMLDetailsElement>("details")].find(
      (detail) =>
        detail.querySelector("summary")?.textContent ===
        (locale === "zh" ? "来源与原文" : "Source et texte intégral"),
    )!;
    expect(proof.open).toBe(false);
    expect(proof.textContent).toContain(description);
    expect(
      [...aside.querySelectorAll("p")]
        .filter((note) => !note.closest("details"))
        .map((note) => note.textContent),
    ).toContain("B05 已收到两个月押金");
    expect(
      [...aside.querySelectorAll("p")]
        .filter((note) => !note.closest("details"))
        .some((note) => note.textContent?.includes("sha256")),
    ).toBe(false);
  },
);
