// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { UnifiedLeaseCollections } from "./unified-lease-collections";
import type { UnifiedLeaseCollectionRow } from "./unified-lease-collections-model";

it("separates a confirmed balance without a payment date from records awaiting verification", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const review: UnifiedLeaseCollectionRow = {
    id: "review",
    category: "apartment",
    name: "示例房源",
    keywords: [],
    href: "/leases?contract=review",
    status: "needs_evidence",
    reason: "租赁与账单资料待核",
    dueDate: null,
    paidThrough: null,
    amount: null,
    amountLabel: "未收金额",
  };
  const balance: UnifiedLeaseCollectionRow = {
    ...review,
    id: "balance",
    category: "whole",
    name: "示例厂房",
    href: "/leases?assetCategory=whole&operatingAsset=balance",
    reason: "付款日未登记",
    paidThrough: "2026-09-30",
    amount: "450 万西法",
    amountLabel: "原表余款",
  };
  const statusButton = (label: string) =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === label)!;
  try {
    await act(async () =>
      root.render(
        <UnifiedLeaseCollections
          rows={[review, balance]}
          locale="zh"
          initialCategory="all"
          unavailable={{ apartments: false, operatingAssets: false }}
        />,
      ),
    );
    expect(host.querySelectorAll("ul a")).toHaveLength(2);
    await act(async () => statusButton("待收 · 付款日待补 1").click());
    expect(host.querySelectorAll("ul a")).toHaveLength(1);
    expect(host.querySelector("ul a")?.getAttribute("href")).toBe(balance.href);
    expect(host.querySelector("ul a")?.textContent).toContain("450 万西法");
    expect(host.querySelector("ul a")?.textContent).toContain("付款日未登记");

    const scope = host.querySelector("select")!;
    await act(async () => {
      scope.value = "apartment";
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector("ul a")).toBeNull();
    await act(async () => statusButton("资料待补 1").click());
    expect(host.querySelector("ul a")?.getAttribute("href")).toBe(review.href);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("labels an apartment coverage date without presenting it as an agreed payment date or payable amount", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const row: UnifiedLeaseCollectionRow = {
    id: "coverage-expiry",
    category: "apartment",
    name: "702",
    keywords: [],
    href: "/leases?contract=coverage-expiry",
    status: "upcoming",
    statusLabel: "12天后缴租到期",
    dueDate: "2026-11-30",
    dueDateLabel: "缴租到期日",
    dueSource: "租赁资料中的已交至日期；下期账单待核",
    paidThrough: "2026-11-30",
    paidThroughSource: "租赁资料登记的租金已交至日期",
    amount: null,
    amountLabel: "下期账单待核",
  };
  try {
    await act(async () =>
      root.render(
        <UnifiedLeaseCollections
          rows={[row]}
          locale="zh"
          initialCategory="apartment"
          unavailable={{ apartments: false, operatingAssets: false }}
        />,
      ),
    );
    const link = host.querySelector(`a[href="${row.href}"]`)!;
    expect(link.textContent).toContain("缴租到期日2026-11-30");
    expect(link.textContent).toContain("12天后缴租到期");
    expect(link.textContent).toContain("下期账单待核");
    expect(link.textContent).not.toMatch(/约定付款日|多币种|0\s*(?:XOF|万西法)/);
    expect(link.querySelector('[title="租赁资料中的已交至日期；下期账单待核"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
