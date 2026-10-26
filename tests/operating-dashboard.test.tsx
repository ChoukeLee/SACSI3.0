// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperatingDashboard } from "@/features/management/operating-dashboard";
import { operatingSnapshotFixture } from "./fixtures/operating-snapshot";
let root: Root;
let host: HTMLDivElement;
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
it("shows future leases separately from contracts whose start date has arrived", async () => {
  await act(async () =>
    root.render(
      <OperatingDashboard
        snapshot={{ ...operatingSnapshotFixture(), leaseCount: 7, pendingLeaseCount: 3 }}
        locale="zh"
      />,
    ),
  );
  const row = host.querySelector('tr[data-business="lease"]')!;
  expect(row.textContent).toContain("7 份已起租合同");
  expect(row.textContent).toContain("3 份待起租");
});
it("keeps daily rental in one final overview row, not a misleading occupancy hero", async () => {
  await act(async () =>
    root.render(<OperatingDashboard snapshot={operatingSnapshotFixture()} locale="zh" />),
  );
  expect(
    [...host.querySelectorAll("tr[data-business]")].map((row) => row.getAttribute("data-business")),
  ).toEqual(["lease", "sale", "asset", "daily"]);
  expect(host.textContent).toContain("本月已录净收款");
  expect(host.textContent).not.toContain("入住率");
  expect(host.textContent).not.toContain("180");
  expect(host.textContent).toContain("无记录不代表零经营");
  const cashLink = [...host.querySelectorAll("a")].find((link) =>
    link.textContent?.includes("查看收支与凭证"),
  )!;
  expect(new URL(cashLink.href).searchParams.get("projectId")).toBe(
    operatingSnapshotFixture().projectId,
  );
  expect(new URL(cashLink.href).searchParams.get("dateFrom")).toBe("2026-10-01");
});
it("keeps CIMAC free of sales/daily tiles and uses localized finance links and no invented zero bars", async () => {
  await act(async () =>
    root.render(
      <OperatingDashboard
        snapshot={operatingSnapshotFixture()}
        locale="fr"
        allowsSale={false}
        allowsDaily={false}
        financeMode
      />,
    ),
  );
  expect(
    [...host.querySelectorAll("tr[data-business]")].map((row) => row.getAttribute("data-business")),
  ).toEqual(["lease", "asset"]);
  expect(host.textContent).not.toContain("Courts séjours");
  expect(host.querySelectorAll('svg[role="img"] rect')).toHaveLength(1);
  expect(host.querySelector('a[href*="/fr/finance?"]')).toBeTruthy();
  expect(host.textContent).toContain("Sans écriture");
  expect(host.textContent).not.toContain("万");
});
it("keeps one collapsed native-currency detail after the main metrics and retains settled history", async () => {
  const snapshot = operatingSnapshotFixture();
  snapshot.nativeSummary = [
    {
      currency: "USD",
      income: 0,
      expense: 999,
      liability_in: 888,
      liability_out: 777,
      receivable: 19200,
      paid: 19200,
      outstanding: 0,
      overdue: 0,
    },
  ];
  await act(async () => root.render(<OperatingDashboard snapshot={snapshot} locale="zh" />));
  const panels = host.querySelectorAll<HTMLDetailsElement>("details[data-native-currency-summary]");
  expect(panels).toHaveLength(1);
  const panel = panels[0];
  expect(panel.dataset.nativeCurrencySummary).toBe("operating");
  expect(panel.open).toBe(false);
  expect(panel.previousElementSibling?.textContent).toContain("本月已录净收款");
  expect(panel.previousElementSibling?.textContent).toContain("到期未收余额");
  expect(panel.querySelector("summary")?.textContent).toContain("其他币种");
  expect(panel.querySelector("summary")?.textContent).toContain("USD");
  expect(panel.querySelector("summary")?.textContent).not.toContain("$0");
  expect(panel.querySelector("summary")?.textContent).not.toContain("19,200");
  expect(panel.querySelectorAll("dd")).toHaveLength(5);
  expect(panel.textContent).toContain("19,200");
  expect(panel.textContent).toContain("已核销");
  expect(panel.textContent).toContain("不代表完整原币现金流");
  expect(panel.textContent).not.toContain("费用");
  expect(panel.textContent).not.toContain("押金");
  expect(panel.textContent).not.toContain("999");
  expect(panel.textContent).not.toContain("888");
});
it("localizes the native operating detail and keeps negative native receipts outside XOF metrics", async () => {
  const snapshot = operatingSnapshotFixture();
  snapshot.nativeSummary = [
    {
      currency: "USD",
      income: -250,
      expense: 0,
      liability_in: 0,
      liability_out: 0,
      receivable: 0,
      paid: 0,
      outstanding: 0,
      overdue: 0,
    },
  ];
  await act(async () => root.render(<OperatingDashboard snapshot={snapshot} locale="fr" />));
  const panel = host.querySelector('details[aria-label="Totaux en devises séparées"]')!;
  const summary = panel.querySelector("summary");
  expect(summary?.textContent).toContain("Autres devises");
  expect(summary?.textContent).toContain("Ce mois");
  expect(panel.querySelector("dl")?.textContent).toContain("Encaissements en devise du mois");
  expect(summary?.textContent).toContain("-250");
  expect(panel.textContent).not.toContain("本月原币收款");
  expect(panel.previousElementSibling?.textContent).toContain("5");
  expect(panel.previousElementSibling?.textContent).not.toContain("-250");
  expect(host.querySelectorAll('svg[role="img"] rect')).toHaveLength(1);
});
