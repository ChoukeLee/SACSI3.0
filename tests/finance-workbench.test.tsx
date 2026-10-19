// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceWorkbench, type FinanceWorkbenchProps } from "@/features/finance/finance-workbench";
import { parseFinanceRead } from "@/features/finance/finance-read";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/finance/finance-workbench-inspector", () => ({
  FinanceWorkbenchInspector: ({
    row,
    canWrite,
  }: {
    row: { id: string } | null;
    canWrite: boolean;
  }) => <aside aria-label="详情测试" data-record={row?.id || ""} data-can-write={canWrite} />,
}));
vi.mock("@/features/finance/finance-manual-entry", () => ({
  FinanceManualEntry: ({ canWrite }: { canWrite: boolean }) =>
    canWrite ? <button>手工记账</button> : null,
}));
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  building = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  entry_date: "2026-10-19",
  building_label: "第三栋",
  unit_label: "示例A",
  direction: "income",
  category: "lease_rent",
  amount_xof: 3600000,
  description: "租金，不是完整收款凭证",
};
const baseProps = (): FinanceWorkbenchProps => ({
  scopeKey: "scope-1",
  query: parseFinanceRead({ projectId: project, buildingId: building }),
  mode: "ledger",
  result: {
    kind: "ledger",
    page: 1,
    pageSize: 50,
    total: 80,
    summary: { income: 90000000, expense: 240000, liability_in: 900000, liability_out: 0 },
    rows: [row],
  },
  projects: [
    { id: project, code: "CIMAC", display_name: "科建建材城" },
    { id: other, code: "SACSI", display_name: "公寓项目" },
  ],
  buildings: [{ id: building, code: "B3", display_name: "第三栋", project_id: project }],
  reconciliation: null,
  locale: "zh",
  canWrite: true,
  today: "2026-10-19",
});
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(props: Partial<FinanceWorkbenchProps> = {}) {
  await act(async () => root.render(<FinanceWorkbench {...baseProps()} {...props} />));
}
async function click(button: Element) {
  await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
describe("finance checking workbench", () => {
  it("renders the checking workspace without fetching or auto-selecting the first record", async () => {
    await render();
    expect(host.querySelector("h1")?.textContent).toBe("财务工作台");
    expect(host.querySelector('[aria-label="详情测试"]')?.getAttribute("data-record")).toBe("");
    expect(host.textContent).toContain("90,000,000");
    expect(host.textContent).toContain("不含押金");
    expect(host.textContent).toContain("不是当前可退余额");
  });
  it("selects an explicit row then clears it on close or scope transition", async () => {
    await render();
    await click(host.querySelector('button[aria-label^="查看账目"]')!);
    expect(host.querySelector('[aria-label="详情测试"]')?.getAttribute("data-record")).toBe(row.id);
    await render({ scopeKey: "scope-2" });
    expect(host.querySelector('[aria-label="详情测试"]')?.getAttribute("data-record")).toBe("");
  });
  it("does not retain a selected detail after a refreshed rows snapshot", async () => {
    const result = baseProps().result!;
    await render({ result });
    await click(host.querySelector('button[aria-label^="查看账目"]')!);
    await render({ result: { ...result, rows: [{ ...row, amount_xof: 123 }] } });
    expect(host.querySelector('[aria-label="详情测试"]')?.getAttribute("data-record")).toBe("");
  });
  it("project navigation clears building and page, but preserves other active query filters", async () => {
    await render({
      query: parseFinanceRead({
        projectId: project,
        buildingId: building,
        page: "2",
        search: "租金",
        dateFrom: "2026-10-01",
      }),
    });
    const select = host.querySelector('select[name="projectId"]') as HTMLSelectElement;
    await act(async () => {
      select.value = other;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const url = new URL(navigation.push.mock.calls[0][0], "http://local");
    expect(url.searchParams.get("projectId")).toBe(other);
    expect(url.searchParams.has("buildingId")).toBe(false);
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.get("search")).toBe("租金");
    expect(url.searchParams.get("dateFrom")).toBe("2026-10-01");
  });
  it("exports the entire applied filter set, not a paged client sum", async () => {
    const query = parseFinanceRead({
      projectId: project,
      buildingId: building,
      search: "甲 & 50%_",
      direction: "income",
      category: "lease_rent",
      dateFrom: "2026-10-01",
      page: "2",
    });
    await render({ query });
    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "导出")!);
    const link = host.querySelector('a[href^="/api/finance/export"]') as HTMLAnchorElement;
    expect(Object.fromEntries(new URL(link.href).searchParams)).toEqual({
      ...query.filters,
      kind: "ledger",
    });
    expect(link.href).not.toContain("page=");
  });
  it("keeps form-associated search and advanced controls in the same GET request", async () => {
    await render();
    const form = host.querySelector("form")!;
    const input = host.querySelector('input[name="search"]') as HTMLInputElement;
    input.value = "原始说明";
    const data = new FormData(form);
    expect(data.get("search")).toBe("原始说明");
    expect(data.get("kind")).toBe("ledger");
    expect(data.get("projectId")).toBe(project);
    expect(data.get("category")).toBe("");
  });
  it("does not expose write entry to a read-only boss", async () => {
    await render({ canWrite: false });
    expect(
      Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "手工记账"),
    ).toBe(false);
    expect(host.querySelector('[aria-label="详情测试"]')?.getAttribute("data-can-write")).toBe(
      "false",
    );
  });
  it("renders real French captions and locale-preserving links", async () => {
    await render({ locale: "fr" });
    expect(host.querySelector("h1")?.textContent).toBe("Espace finance");
    expect(host.querySelector("form")?.getAttribute("action")).toBe("/fr/finance");
    expect(
      host.querySelector('nav[aria-label="Vues financières"] a')?.getAttribute("href"),
    ).toContain("/fr/finance?");
    expect(host.textContent).not.toContain("财务工作台");
  });
  it("makes global reconciliation independent from filtered ledger dates", async () => {
    await render({
      mode: "reconciliation",
      result: null,
      reconciliation: {
        available: true,
        count: 1,
        issues: [{ code: "duplicate_payment_ledger", entity_id: row.id }],
      },
    });
    expect(host.textContent).toContain("不随上方项目与日期筛选变化");
    expect(host.textContent).toContain("不一定重复");
    expect(host.querySelector('select[name="projectId"]')?.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector("table")).toBeNull();
    expect(host.textContent).not.toContain("90,000,000");
  });
  it("reconciliation errors are unavailable, never zero-issue success", async () => {
    await render({
      mode: "reconciliation",
      result: null,
      reconciliation: { available: false, count: null, issues: [] },
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("核对结果暂时无法读取");
    expect(host.textContent).not.toContain("当前检查范围内未发现");
    await click(
      Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "重新读取")!,
    );
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
  it("does not show cancelled/historical balances as current debt", async () => {
    const r = {
      ...row,
      due_date: "2026-01-01",
      status: "pending",
      management_status: "historical_pending",
      paid_amount_xof: 0,
      title: "待核历史",
    };
    await render({
      query: parseFinanceRead({ kind: "receivables", management: "historical_pending" }),
      mode: "receivables",
      result: {
        kind: "receivables",
        page: 1,
        pageSize: 50,
        total: 1,
        summary: { receivable: 0, paid: 0, outstanding: 0, overdue: 0 },
        rows: [r],
      },
    });
    expect(host.querySelector("tbody tr td:nth-child(3) > span")?.textContent).toBe("—");
    expect(host.querySelector("tbody")?.textContent).toContain("历史待核对");
    expect(host.querySelector("tbody")?.textContent).not.toContain("按到期日已逾期");
  });
  it("does not call a managed partial record unexpired merely because status is not overdue", async () => {
    const r = {
      ...row,
      due_date: "2026-10-01",
      status: "partial",
      management_status: "managed",
      paid_amount_xof: 1000000,
      title: "有效应收",
    };
    await render({
      query: parseFinanceRead({ kind: "receivables" }),
      mode: "receivables",
      result: {
        kind: "receivables",
        page: 1,
        pageSize: 50,
        total: 1,
        summary: { receivable: 3600000, paid: 1000000, outstanding: 2600000, overdue: 2600000 },
        rows: [r],
      },
    });
    expect(host.querySelector("tbody")?.textContent).toContain("按到期日已逾期");
    expect(host.querySelector("tbody")?.textContent).toContain("2,600,000");
  });
  it("out-of-range pages expose zero displayed rows without fictitious record positions", async () => {
    const result = { ...baseProps().result!, rows: [] };
    await render({ query: parseFinanceRead({ page: "5" }), result });
    expect(host.textContent).toContain("0 / 80");
    expect(host.textContent).not.toContain("200–200");
    expect(host.querySelector('a[aria-label="上一页"]')?.getAttribute("href")).toContain("page=4");
  });
});
