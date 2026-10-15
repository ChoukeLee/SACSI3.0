// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContractTable } from "@/features/contracts/contract-table";
import type { ContractTableRow } from "@/features/contracts/contract-list-model";

const rows: ContractTableRow[] = Array.from({ length: 27 }, (_, index) => ({
  id: String(index),
  contractNo: `SACSI-2026-${index}`,
  building: "11#公寓",
  unit: String(index + 1),
  customer: `完整客户名称 ${index}`,
  periodStart: "2026-10-01",
  periodLabel: "2026-10-01 → 2027-09-30",
  amountXof: index * 10000,
  balanceXof: index ? 0 : null,
  balanceDetail: index ? "已建应收已结清" : "暂无已核应收",
  status: "active",
  statusLabel: "生效",
}));
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

it("keeps full text, accessible sortable columns, distinct actions, and bounded pagination", async () => {
  const open = vi.fn(),
    finance = vi.fn(),
    print = vi.fn();
  await act(async () =>
    root.render(
      <ContractTable
        rows={rows}
        locale="zh"
        amountLabel="月租金"
        periodLabel="合同期限"
        onOpen={open}
        onFinance={finance}
        onPrint={print}
      />,
    ),
  );
  expect(host.querySelectorAll("tbody tr")).toHaveLength(25);
  expect(host.textContent).toContain("完整客户名称 0");
  expect(host.textContent).toContain("SACSI-2026-0");
  expect(host.textContent).toContain("暂无已核应收");
  expect(host.querySelector('th[aria-sort="ascending"]')?.textContent).toContain("房源");
  await act(async () =>
    (host.querySelector('button[aria-label="查看财务 · 1"]') as HTMLButtonElement).click(),
  );
  await act(async () =>
    (host.querySelector('button[aria-label="合同 / 打印 · 1"]') as HTMLButtonElement).click(),
  );
  await act(async () =>
    (host.querySelector("tbody td:nth-child(2) button") as HTMLButtonElement).click(),
  );
  expect(open).toHaveBeenCalledWith("0");
  expect(finance).toHaveBeenCalledWith("0");
  expect(print).toHaveBeenCalledWith("0");
  await act(async () =>
    (
      [...host.querySelectorAll("thead button")].find((button) =>
        button.textContent?.includes("月租金"),
      ) as HTMLButtonElement
    ).click(),
  );
  expect(host.querySelector('th[aria-sort="ascending"]')?.textContent).toContain("月租金");
  await act(async () =>
    (
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "下一页",
      ) as HTMLButtonElement
    ).click(),
  );
  expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(host.textContent).toContain("26–27 / 27");
});

it("renders localized French empty state without raw status or phantom zero amounts", async () => {
  await act(async () =>
    root.render(
      <ContractTable
        rows={[]}
        locale="fr"
        amountLabel="Loyer mensuel"
        periodLabel="Période"
        onOpen={vi.fn()}
        onFinance={vi.fn()}
        onPrint={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain("Aucun contrat");
  expect(host.textContent).toContain("Créances restantes");
  expect(host.textContent).not.toContain("0 FCFA");
});
