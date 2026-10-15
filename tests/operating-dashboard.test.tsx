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
