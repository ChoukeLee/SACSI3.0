// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  LeaseWorkbenchTable,
  type LeaseWorkbenchTableProps,
} from "@/features/leases/lease-workbench-table";
import type { ContractTableRow } from "@/features/contracts/contract-list-model";

const rows: ContractTableRow[] = Array.from({ length: 27 }, (_, index) => ({
  id: String(index),
  contractNo: `SACSI-2026-${index}`,
  building: "11#公寓",
  unit: String(index + 1),
  customer: `完整客户名称 ${index}`,
  periodStart: "2026-10-01",
  periodLabel: "2026-10-01 → 2027-09-30",
  periodDetail: "每月缴付",
  amountXof: index ? index * 10000 : null,
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

function props(overrides: Partial<LeaseWorkbenchTableProps> = {}): LeaseWorkbenchTableProps {
  return {
    rows,
    locale: "zh",
    amountLabel: "月租金",
    periodLabel: "合同期限",
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onFinance: vi.fn(),
    onPrint: vi.fn(),
    ...overrides,
  };
}

function button(text: string) {
  const element = [...host.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!element) throw new Error(`Button not found: ${text}`);
  return element;
}

it("keeps preview, full details, finance and printing as distinct accessible actions", async () => {
  const options = props({ selectedId: "0" });
  await act(async () => root.render(<LeaseWorkbenchTable {...options} />));
  expect(host.querySelectorAll("tbody tr")).toHaveLength(25);
  expect(host.querySelector('tr[data-selected="true"]')?.textContent).toContain("完整客户名称 0");
  const preview = host.querySelector(
    'button[aria-label="预览合同 11#公寓 1"]',
  ) as HTMLButtonElement;
  expect(preview.getAttribute("aria-pressed")).toBe("true");
  await act(async () => preview.click());
  await act(async () =>
    (host.querySelector("tbody td:nth-child(2) button") as HTMLButtonElement).click(),
  );
  await act(async () =>
    (host.querySelector('button[aria-label="查看财务 · 1"]') as HTMLButtonElement).click(),
  );
  await act(async () =>
    (host.querySelector('button[aria-label="合同 / 打印 · 1"]') as HTMLButtonElement).click(),
  );
  expect(options.onSelect).toHaveBeenCalledWith("0");
  expect(options.onOpen).toHaveBeenCalledWith("0");
  expect(options.onFinance).toHaveBeenCalledWith("0");
  expect(options.onPrint).toHaveBeenCalledWith("0");
  expect(host.querySelector("tbody tr [data-col='amount']")?.textContent).toBe("未核");
  expect(host.querySelector("tbody tr [data-col='balance']")?.textContent).toContain("未核");
  expect(host.textContent).toContain("月租不是实收");
});

it("sorts local rows, leaves unknown amounts last, and reports only the visible page", async () => {
  const visibleIds = vi.fn();
  await act(async () =>
    root.render(<LeaseWorkbenchTable {...props({ onVisibleIdsChange: visibleIds })} />),
  );
  expect(visibleIds).toHaveBeenLastCalledWith(rows.slice(0, 25).map((row) => row.id));
  await act(async () => button("下一页").click());
  expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(host.textContent).toContain("26–27 / 27");
  expect(visibleIds).toHaveBeenLastCalledWith(["25", "26"]);
  await act(async () => button("月租金").click());
  expect(host.querySelectorAll("tbody tr")).toHaveLength(25);
  expect(host.textContent).toContain("1–25 / 27");
  expect(host.querySelector('th[aria-sort="ascending"]')?.textContent).toContain("月租金");
  expect(host.querySelector("tbody tr button")?.textContent).toBe("2");
  await act(async () => button("月租金").click());
  expect(host.querySelector("tbody tr button")?.textContent).toBe("27");
  await act(async () => button("下一页").click());
  expect(host.querySelector("tbody tr:last-child [data-col='amount']")?.textContent).toBe("未核");
});

it("does not locally reorder or truncate a server page and delegates all sort controls", async () => {
  const onPageChange = vi.fn();
  const onSortChange = vi.fn();
  const remoteRows = [rows[26], rows[3], rows[7]];
  const options = props({
    rows: remoteRows,
    pagination: {
      page: 2,
      total: 60,
      pageSize: 25,
      sort: { key: "unit", direction: "asc" },
      onPageChange,
      onSortChange,
    },
  });
  await act(async () => root.render(<LeaseWorkbenchTable {...options} />));
  expect(host.querySelectorAll("tbody tr")).toHaveLength(3);
  expect(host.querySelector("tbody tr button")?.textContent).toBe("27");
  await act(async () => button("客户").click());
  expect(onSortChange).toHaveBeenCalledWith("customer", "asc");
  const select = host.querySelector('select[aria-label="合同排序"]') as HTMLSelectElement;
  await act(async () => {
    select.value = "period:desc";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onSortChange).toHaveBeenLastCalledWith("period", "desc");
  await act(async () => button("下一页").click());
  expect(onPageChange).toHaveBeenCalledWith(3);
  expect(host.querySelector("tbody tr button")?.textContent).toBe("27");
});

it("only emits visible ids when the visible page changes, even with a fresh callback prop", async () => {
  const first = vi.fn();
  const next = vi.fn();
  await act(async () =>
    root.render(<LeaseWorkbenchTable {...props({ onVisibleIdsChange: first })} />),
  );
  expect(first).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(<LeaseWorkbenchTable {...props({ onVisibleIdsChange: next, selectedId: "1" })} />),
  );
  expect(first).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  await act(async () => button("下一页").click());
  expect(next).toHaveBeenNthCalledWith(1, []);
  expect(next).toHaveBeenNthCalledWith(2, ["25", "26"]);
});

it("renders French empty state and a width-adaptive table without an imposed minimum width", async () => {
  await act(async () =>
    root.render(<LeaseWorkbenchTable {...props({ rows: [], locale: "fr" })} />),
  );
  expect(host.textContent).toContain("Aucun contrat");
  expect(host.textContent).toContain("Créances restantes");
  expect(host.textContent).not.toContain("0 FCFA");
  expect(host.querySelector("table")?.className).not.toContain("min-w-");
  expect(host.querySelector("style")?.textContent).toContain("@container lease-contracts");
  expect(host.querySelectorAll("select option")).toHaveLength(12);
});
