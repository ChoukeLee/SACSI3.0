// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/features/sales/actions", () => ({
  createSaleContract: vi.fn(),
  recordSalePaymentAtomic: vi.fn(),
  addFlexibleInstallment: vi.fn(),
  updateTransferStatus: vi.fn(),
  terminateSaleContract: vi.fn(),
}));
vi.mock("@/features/print", () => ({ printSaleContract: vi.fn() }));
import { SaleList } from "@/features/sales/sale-list";
import {
  terminateSaleContract,
  recordSalePaymentAtomic,
  addFlexibleInstallment,
  updateTransferStatus,
} from "@/features/sales/actions";
import type { ComponentProps } from "react";
import { saleFixture as baseSaleFixture } from "./fixtures/sale-workbench";
import {
  workspaceContract,
  workspaceProject,
  workspaceBuilding,
} from "./fixtures/contract-workspace";
import {
  parseWorkspaceQuery,
  type WorkspaceData,
  type WorkspaceQuery,
  type WorkspaceMode,
} from "@/features/contracts/workspace-model";
import type {
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  SalePaymentScheduleRow,
} from "@/types/database";

let host: HTMLDivElement, root: Root;
const syntheticId = (number: number) =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`;
function saleFixture(
  query: WorkspaceQuery = parseWorkspaceQuery({ projectId: workspaceProject }),
  mode: WorkspaceMode = "list",
  total = 2,
  id = workspaceContract,
) {
  const data = baseSaleFixture(query, mode, total, id) as WorkspaceData & {
    roomReceivables?: ReceivableRow[];
    roomPayments?: PaymentRow[];
    roomSchedules?: SalePaymentScheduleRow[];
  };
  const templateUnit = data.units[0];
  data.units = data.contracts.map((contract) => {
    const suffix = contract.id.slice(-12);
    const position =
      contract.id === workspaceContract ? 0 : /^\d{12}$/.test(suffix) ? Number(suffix) : 999;
    return {
      ...templateUnit,
      id: syntheticId(position + 1),
      unit_no: String(position + 101),
      code: `SYNTHETIC-SALE-ROOM-${position}`,
    };
  });
  data.contracts = data.contracts.map((contract, index) => ({
    ...contract,
    unit_id: data.units[index].id,
  }));
  if (mode === "context") {
    data.roomReceivables = data.contracts.flatMap((contract, index) =>
      [0, 1].map((part): ReceivableRow => ({
        id: syntheticId(10000 + index * 2 + part),
        building_id: data.units[index].building_id,
        unit_id: contract.unit_id,
        customer_id: contract.customer_id,
        source_type: "sale_contract",
        source_id: contract.id,
        category: "sale_installment",
        title: `SYNTHETIC installment ${part + 1}`,
        due_date: part === 0 ? "2026-10-01" : "2027-01-01",
        amount_xof: 500000,
        paid_amount_xof: part === 0 ? 200000 : 0,
        currency: "XOF",
        amount_native: null,
        paid_amount_native: null,
        status: part === 0 ? "partial" : "pending",
        management_status: "managed",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      })),
    );
    data.roomPayments = [];
    data.roomSchedules = data.roomReceivables.map((row, index) => ({
      id: syntheticId(20000 + index),
      sale_contract_id: row.source_id!,
      installment_no: (index % 2) + 1,
      due_date: row.due_date,
      amount_xof: row.amount_xof,
      status: "pending",
      receivable_id: row.id,
      created_at: "2026-01-01T00:00:00Z",
    }));
    data.roomFinanceCounts = {
      payments: data.roomPayments.length,
      receivables: data.roomReceivables.length,
      schedules: data.roomSchedules.length,
    };
  }
  return data;
}
function requestInfo(input: RequestInfo | URL) {
  const url = new URL(String(input), "https://local.invalid"),
    mode = url.searchParams.get("mode") as WorkspaceData["mode"],
    id = url.searchParams.get("contractId");
  url.searchParams.delete("mode");
  url.searchParams.delete("contractId");
  url.searchParams.delete("roomOverview");
  url.searchParams.delete("workspace");
  return { mode, id, query: parseWorkspaceQuery(Object.fromEntries(url.searchParams)) };
}
function responseFor(input: RequestInfo | URL, balance = 800000) {
  const { mode, id, query } = requestInfo(input);
  const data = saleFixture(query, mode, mode === "detail" ? 1 : 2, id ?? workspaceContract);
  if (mode === "detail") {
    data.summaries[id!].outstanding = balance;
    data.summaries[id!].overdue = balance;
  }
  return data;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/sales");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => Response.json(responseFor(input))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render(
  data = saleFixture(),
  initialContract?: string,
  capabilities: Partial<
    Pick<ComponentProps<typeof SaleList>, "canRecordFinance" | "canManage" | "canTerminate">
  > = {},
) {
  await act(async () =>
    root.render(
      <SaleList
        {...data}
        contracts={data.contracts as SaleContractRow[]}
        workspace={data}
        initialProject={data.query.projectId}
        initialContract={initialContract}
        locale="zh"
        canCreate={false}
        canRecordFinance={false}
        canManage={false}
        canTerminate={false}
        {...capabilities}
      />,
    ),
  );
}
async function click(node: Element | null | undefined) {
  expect(node).toBeTruthy();
  await act(async () => (node as HTMLButtonElement).click());
}
async function settle(ms = 20) {
  await act(
    async () =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  );
}
const tableButtons = () => [...host.querySelectorAll('tbody button[aria-label^="预览出售合同"]')];
const buttons = () => [...host.querySelectorAll("[data-sale-room-id]")];
const inspector = () => document.querySelector('aside[aria-label="出售合同履约详情"]');
const named = (name: string, within: ParentNode = document) =>
  [...within.querySelectorAll("button")].find((button) => {
    const label = button.textContent ?? "";
    return (
      label === name || (label.startsWith(name) && /^\d+$/.test(label.slice(name.length).trim()))
    );
  });
async function openDisclosure(label: string, within: ParentNode = inspector()!) {
  const summary = [...within.querySelectorAll<HTMLElement>("summary")].find(
    (item) => item.textContent === label,
  );
  expect(summary).toBeTruthy();
  if (!(summary!.parentElement as HTMLDetailsElement).open) await click(summary);
  return summary!.parentElement as HTMLDetailsElement;
}
async function showFinance() {
  await click(named("收支明细", inspector()!));
}
async function clickAction(label: string) {
  await openDisclosure("更多操作");
  await click(named(label, inspector()!));
}
function recordRequests() {
  return vi.mocked(fetch).mock.calls.filter(([input]) => requestInfo(input).mode !== "context");
}
function operationDialog() {
  return (
    [...document.querySelectorAll('[role="dialog"]')].find(
      (item) => !item.querySelector('[role="region"][aria-label="选中出售合同详情"]'),
    ) ?? null
  );
}

it("keeps initial rendering idle and fetches only an explicitly selected contract", async () => {
  await render();
  await settle();
  expect(recordRequests()).toHaveLength(0);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click(buttons()[0]);
  await settle();
  expect(recordRequests()).toHaveLength(1);
  expect(requestInfo(recordRequests()[0][0])).toMatchObject({
    mode: "detail",
    id: workspaceContract,
  });
  await showFinance();
  expect(inspector()?.textContent).toContain("800,000 XOF");
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(inspector()?.querySelector('[aria-label="关闭合同预览"]')).toBeNull();
  expect(new URL(window.location.href).searchParams.get("contract")).toBe(workspaceContract);
});
it.each([false, true])(
  "opens one accessible drawer from a card and keeps focus inside it, reduced motion=%s",
  async (reduced) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches:
          query === "(max-width: 1199px)" ||
          (reduced && query === "(prefers-reduced-motion: reduce)"),
        media: query,
      })),
    );
    await render();
    await click(buttons()[0]);
    await settle();
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(
      drawer.querySelectorAll('button[aria-label="Close"], button[aria-label="关闭合同预览"]'),
    ).toHaveLength(1);
    const focused = document.activeElement;
    await showFinance();
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(focused?.isConnected).toBe(true);
  },
);
it("opens an explicit deep link into the single read-only drawer without another locator or automatic action", async () => {
  await render(saleFixture(), workspaceContract);
  await settle();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(named("查看选中合同 ↓")).toBeUndefined();
  expect(recordSalePaymentAtomic).not.toHaveBeenCalled();
  expect(updateTransferStatus).not.toHaveBeenCalled();
});
it("opens a stable ID deep link without loading all contracts, even outside the current page", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await render(saleFixture(), id);
  await settle();
  expect(recordRequests()).toHaveLength(1);
  expect(requestInfo(recordRequests()[0][0]).id).toBe(id);
  await openDisclosure("合同登记资料");
  expect(inspector()?.textContent).toContain("SYNTHETIC-SALE-0");
});
it("preserves explicit initial building, search, status, sort and page without resetting them to defaults", async () => {
  const query = parseWorkspaceQuery({
    projectId: workspaceProject,
    buildingId: workspaceBuilding,
    search: "Synthetic",
    status: "all",
    page: 2,
    sort: "balance",
    direction: "desc",
  });
  await render(saleFixture(query, "list", 26));
  await settle();
  expect(recordRequests()).toHaveLength(0);
  const params = new URL(window.location.href).searchParams;
  expect(Object.fromEntries(params)).toMatchObject({
    project: workspaceProject,
    building: workspaceBuilding,
    q: "Synthetic",
    status: "all",
    page: "2",
    sort: "balance",
    direction: "desc",
  });
  await openDisclosure("列表核对", host);
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
});
it("does not display previous selected balances while the next read is pending", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  await showFinance();
  expect(inspector()?.textContent).toContain("800,000 XOF");
  let resolveNext!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
  );
  await click(buttons()[1]);
  expect(inspector()?.textContent ?? "").not.toContain("800,000 XOF");
  const input = recordRequests().at(-1)![0];
  await act(async () => resolveNext(Response.json(responseFor(input, 123456))));
  await settle();
  await showFinance();
  expect(inspector()?.textContent).toContain("123,456 XOF");
});
it("does not restore cached facts when closing then reopening the same record", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  await click(inspector()?.closest('[role="dialog"]')?.querySelector('button[aria-label="Close"]'));
  let resolveNext!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
  );
  await click(buttons()[0]);
  expect(inspector()?.textContent ?? "").not.toContain("800,000 XOF");
  expect(recordRequests()).toHaveLength(2);
  const input = recordRequests().at(-1)![0];
  await act(async () => resolveNext(Response.json(responseFor(input, 654321))));
  await settle();
  await showFinance();
  expect(inspector()?.textContent).toContain("654,321 XOF");
});
it("ignores an aborted old detail response returned by the transport after a new selection", async () => {
  await render();
  const pending: { input: RequestInfo | URL; resolve: (response: Response) => void }[] = [];
  vi.mocked(fetch).mockImplementation(
    (input) =>
      new Promise((resolve) => {
        pending.push({ input, resolve });
      }),
  );
  await click(buttons()[0]);
  await click(buttons()[1]);
  await act(async () => pending[1].resolve(Response.json(responseFor(pending[1].input, 654321))));
  await settle();
  await act(async () => pending[0].resolve(Response.json(responseFor(pending[0].input, 123456))));
  await settle();
  await showFinance();
  expect(inspector()?.textContent).toContain("654,321 XOF");
  expect(inspector()?.textContent).not.toContain("123,456 XOF");
});
it("clears preview and drawer before a changed scope request returns", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  await render(
    saleFixture(
      parseWorkspaceQuery({
        projectId: workspaceProject,
        buildingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ),
  );
  expect(inspector()?.textContent ?? "").not.toContain("800,000 XOF");
  await settle();
  expect(inspector()).toBeNull();
  expect(new URL(window.location.href).searchParams.get("contract")).toBeNull();
});
it("clears selected facts before search debounce and empty result", async () => {
  await render();
  const audit = await openDisclosure("列表核对", host);
  await click(tableButtons()[0]);
  await settle();
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { query, mode } = requestInfo(input);
    return Response.json(saleFixture(query, mode, 0));
  });
  const input = audit.querySelector('input[placeholder*="搜索"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "不存在",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(inspector()?.textContent ?? "").not.toContain("800,000 XOF");
  await settle(260);
  expect(host.querySelector("tbody")?.textContent).toContain("没有匹配的出售合同");
});
it("keeps row list available after isolated detail failure, without zero debt or operation actions", async () => {
  await render();
  vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
  await click(buttons()[0]);
  await settle();
  expect(document.body.textContent).toContain("本合同暂不可核验");
  expect(host.textContent).not.toContain("打开合同 / 办理");
  expect(buttons()).toHaveLength(2);
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(operationDialog()).toBeNull();
});
it("keeps the complete read-only contract in one inspector with no second detail drawer", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  await showFinance();
  expect(inspector()?.textContent).toContain("已录付款事实");
  expect(host.textContent).not.toContain("打开合同 / 办理");
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(operationDialog()).toBeNull();
});
it.each([
  ["手工登记出售收款", "登记出售收款", "确认收款"],
  ["新增分期", "新增付款分期", "新增"],
  ["更新过户", "更新过户进度", "保存"],
  ["终止合同", "确认终止出售合同", "确认终止"],
])(
  "opens only the focused %s form, preserving selection on cancel",
  async (label, title, confirm) => {
    await render(saleFixture(), undefined, {
      canRecordFinance: true,
      canManage: true,
      canTerminate: true,
    });
    await click(buttons()[0]);
    await settle();
    await clickAction(label);
    await settle();
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs).toHaveLength(1);
    const dialog = dialogs[0];
    expect(dialog.textContent).toContain(title);
    expect(dialog.textContent).toContain("SYNTHETIC-SALE-0");
    expect(dialog.textContent).not.toContain("合同概览");
    expect(dialog.textContent).not.toContain("已录经营收款");
    expect(dialog.textContent).toContain(confirm);
    await click(named("取消", dialog));
    await settle();
    expect(operationDialog()).toBeNull();
    await openDisclosure("合同登记资料");
    expect(inspector()?.textContent).toContain("SYNTHETIC-SALE-0");
    expect(new URL(window.location.href).searchParams.get("contract")).toBe(workspaceContract);
  },
);
it("requires explicit termination confirmation and keeps the existing audited mutation signature", async () => {
  vi.mocked(terminateSaleContract).mockResolvedValue({
    success: false,
    error: "SYNTHETIC no write",
    rejected: true,
  });
  await render(saleFixture(), undefined, { canTerminate: true });
  await click(buttons()[0]);
  await settle();
  await clickAction("终止合同");
  await settle();
  expect(terminateSaleContract).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("不代表已退款或欠款已清");
  const input = dialog.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "SYNTHETIC reason",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(named("确认终止", dialog));
  await settle();
  expect(terminateSaleContract).toHaveBeenCalledWith(
    workspaceContract,
    "SYNTHETIC reason",
    expect.any(String),
    responseFor("/api/contracts/sale?mode=detail&contractId=" + workspaceContract).contracts[0]
      .updated_at,
  );
  expect(dialog.textContent).toContain("SYNTHETIC no write");
});
async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("preserves the existing installment mutation payload and optimistic concurrency", async () => {
  vi.mocked(addFlexibleInstallment).mockResolvedValue({
    success: false,
    rejected: true,
    error: "SYNTHETIC no write",
  });
  await render(saleFixture(), undefined, { canManage: true });
  await click(buttons()[0]);
  await settle();
  await clickAction("新增分期");
  await settle();
  const dialog = document.querySelector('[role="dialog"]')!;
  await click(dialog.querySelector("#sale-action-due-date"));
  await click(named("今天", dialog));
  await changeInput(dialog.querySelector("#sale-action-amount")!, "12345");
  await click(named("新增", dialog));
  expect(addFlexibleInstallment).toHaveBeenCalledWith({
    contractId: workspaceContract,
    installmentNo: 1,
    dueDate: new Date().toISOString().slice(0, 10),
    amountXof: 12345,
    expectedUpdatedAt: saleFixture().contracts[0].updated_at,
    requestId: expect.any(String),
  });
});
it("preserves the existing transfer mutation signature", async () => {
  vi.mocked(updateTransferStatus).mockResolvedValue({
    success: false,
    rejected: true,
    error: "SYNTHETIC no write",
  });
  await render(saleFixture(), undefined, { canManage: true });
  await click(buttons()[0]);
  await settle();
  await clickAction("更新过户");
  await settle();
  const dialog = document.querySelector('[role="dialog"]')!;
  const status = dialog.querySelector<HTMLSelectElement>("#sale-action-transfer-status")!;
  await act(async () => {
    status.value = "completed";
    status.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(dialog.querySelector("#sale-action-transfer-date"));
  await click(named("今天", dialog));
  await changeInput(dialog.querySelector("#sale-action-certificate")!, "SYNTHETIC-TITLE");
  await click(named("保存", dialog));
  expect(updateTransferStatus).toHaveBeenCalledWith(
    workspaceContract,
    "completed",
    new Date().toISOString().slice(0, 10),
    "SYNTHETIC-TITLE",
    expect.any(String),
    saleFixture().contracts[0].updated_at,
  );
});
it("preserves the atomic receipt payload without creating an automatic amount", async () => {
  vi.mocked(recordSalePaymentAtomic).mockResolvedValue({
    success: false,
    rejected: true,
    error: "SYNTHETIC no write",
  });
  const scheduleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  vi.mocked(fetch).mockImplementation(async (input) => {
    const data = responseFor(input);
    if (data.mode === "detail")
      data.schedules = [
        {
          id: scheduleId,
          sale_contract_id: workspaceContract,
          installment_no: 1,
          due_date: "2026-10-20",
          amount_xof: 1000000,
          status: "pending",
          created_at: "2026-10-01T00:00:00Z",
        },
      ];
    data.scheduleCount = data.schedules.length;
    return Response.json(data);
  });
  await render(saleFixture(), undefined, { canRecordFinance: true });
  await click(buttons()[0]);
  await settle();
  await clickAction("手工登记出售收款");
  await settle();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect((dialog.querySelector("#sale-action-amount") as HTMLInputElement).value).toBe("0");
  expect((named("确认收款", dialog) as HTMLButtonElement).disabled).toBe(true);
  await click(dialog.querySelector("#sale-action-payment-date"));
  await click(named("今天", dialog));
  await changeInput(dialog.querySelector("#sale-action-amount")!, "125000");
  await changeInput(dialog.querySelector("#sale-action-receipt")!, "SYNTHETIC-RECEIPT");
  await click(named("确认收款", dialog));
  expect(recordSalePaymentAtomic).toHaveBeenCalledWith({
    contractId: workspaceContract,
    scheduleId,
    amount: 125000,
    paymentDate: new Date().toISOString().slice(0, 10),
    receiptNo: "SYNTHETIC-RECEIPT",
    requestId: expect.any(String),
  });
});
it("does not revive a pending action after the workspace scope changes", async () => {
  await render(saleFixture(), undefined, { canManage: true });
  await click(buttons()[0]);
  await settle();
  let resolveAction!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
  );
  await clickAction("更新过户");
  await render(
    saleFixture(parseWorkspaceQuery({ buildingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })),
    undefined,
    { canManage: true },
  );
  const input = vi
    .mocked(fetch)
    .mock.calls.findLast(([request]) => requestInfo(request).mode === "detail")![0];
  await act(async () => resolveAction(Response.json(responseFor(input))));
  await settle(260);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(new URL(window.location.href).searchParams.get("contract")).toBeNull();
});

it("uses the complete 26-record context for cards rather than the initial 25-record table page", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { query, mode } = requestInfo(input);
    return Response.json(mode === "context" ? saleFixture(query, mode, 26) : responseFor(input));
  });
  await render(saleFixture(undefined, "list", 26));
  await settle();
  expect(buttons()).toHaveLength(26);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(recordRequests()).toHaveLength(0);
  const context = vi
    .mocked(fetch)
    .mock.calls.find(([input]) => requestInfo(input).mode === "context")![0];
  const url = new URL(String(context), "https://local.invalid");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    mode: "context",
    roomOverview: "1",
    status: "all",
    search: "",
    page: "1",
  });
});

it("keeps a former buyer's debt on its original record and never adds it to the next buyer's card", async () => {
  const initial = saleFixture();
  const oldId = initial.contracts[1].id;
  initial.units = [initial.units[0]];
  initial.customers[0].name = "Current buyer";
  initial.customers.push({
    ...initial.customers[0],
    id: syntheticId(800001),
    name: "Former buyer",
  });
  Object.assign(initial.contracts[1], {
    unit_id: initial.units[0].id,
    customer_id: initial.customers[1].id,
    status: "terminated",
    signed_date: "2024-01-01",
  });
  const bill = (historical: boolean): ReceivableRow => ({
    id: syntheticId(historical ? 30001 : 30000),
    source_id: historical ? oldId : workspaceContract,
    source_type: "sale_contract",
    unit_id: initial.units[0].id,
    building_id: workspaceBuilding,
    customer_id: initial.customers[historical ? 1 : 0].id,
    category: "sale_installment",
    title: "SYNTHETIC bill",
    due_date: historical ? "2024-01-01" : "2026-01-01",
    amount_xof: 100000,
    paid_amount_xof: historical ? 25000 : 100000,
    amount_native: null,
    paid_amount_native: null,
    currency: "XOF",
    status: historical ? "partial" : "paid",
    management_status: "managed",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  const receipt = (historical: boolean): PaymentRow => ({
    id: syntheticId(historical ? 40001 : 40000),
    source_id: historical ? oldId : workspaceContract,
    source_type: "sale",
    unit_id: initial.units[0].id,
    customer_id: initial.customers[historical ? 1 : 0].id,
    amount: historical ? 25000 : 100000,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    native_settlement: false,
    payment_method: "bank_transfer",
    payment_date: historical ? "2024-01-01" : "2026-01-01",
    request_kind: null,
    reversal_of_payment_id: null,
    receipt_no: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
  });
  const summary = (historical: boolean) => ({
    total: 100000,
    paid: historical ? 25000 : 100000,
    outstanding: historical ? 75000 : 0,
    overdue: historical ? 75000 : 0,
    count: 1,
    nextDue: historical ? "2024-01-01" : null,
    dueOutstanding: historical ? 75000 : 0,
  });
  initial.summaries = { [workspaceContract]: summary(false), [oldId]: summary(true) };
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { query, mode, id } = requestInfo(input);
    if (mode === "context")
      return Response.json({
        ...initial,
        query,
        page: query.page,
        mode,
        roomReceivables: [bill(false), bill(true)],
        roomPayments: [receipt(false), receipt(true)],
        roomSchedules: [],
        roomFinanceCounts: { receivables: 2, payments: 2, schedules: 0 },
      });
    const historical = id === oldId;
    const detail = saleFixture(query, "detail", 1, id!);
    detail.contracts = [initial.contracts[historical ? 1 : 0]];
    detail.units = initial.units;
    detail.customers = [initial.customers[historical ? 1 : 0]];
    detail.receivables = [bill(historical)];
    detail.payments = [receipt(historical)];
    detail.paymentCount = 1;
    detail.summaries = { [id!]: summary(historical) };
    return Response.json(detail);
  });
  await render(initial);
  expect(buttons()).toHaveLength(1);
  expect(buttons()[0].textContent).toContain("Current buyer");
  expect(buttons()[0].textContent).not.toContain("Former buyer");
  expect(buttons()[0].textContent).not.toContain("75,000");
  await click(named("出售款跟进", host));
  const oldFollowup = host.querySelector(`[data-sale-followup-record-id="${oldId}"]`);
  expect(oldFollowup?.textContent).toContain("Former buyer");
  expect(oldFollowup?.textContent).toContain("75,000");
  expect(host.querySelector(`[data-sale-followup-record-id="${workspaceContract}"]`)).toBeNull();
  await click(named("查看历史", host));
  expect(host.querySelector(`[data-sale-history-record-id="${oldId}"]`)).toBeTruthy();
  await click(oldFollowup);
  await settle();
  expect(requestInfo(recordRequests().at(-1)![0]).id).toBe(oldId);
  expect(inspector()?.textContent).toContain("Former buyer");
  await showFinance();
  expect(inspector()?.textContent).toContain("75,000 XOF");
  await openDisclosure("本房出售历史", document.querySelector('[role="dialog"]')!);
  await click(document.querySelector(`[data-sale-room-record-id="${workspaceContract}"]`));
  await settle();
  expect(requestInfo(recordRequests().at(-1)![0]).id).toBe(workspaceContract);
  await showFinance();
  expect(inspector()?.textContent).toContain("Current buyer");
  expect(inspector()?.textContent).not.toContain("75,000");
  expect(recordSalePaymentAtomic).not.toHaveBeenCalled();
});

it("does not repeat a successful sale mutation when its subsequent refresh fails", async () => {
  vi.mocked(updateTransferStatus).mockResolvedValue({ success: true, rejected: false });
  vi.mocked(fetch).mockImplementation(async (input) =>
    vi.mocked(updateTransferStatus).mock.calls.length
      ? new Response("", { status: 503 })
      : Response.json(responseFor(input)),
  );
  await render(saleFixture(), undefined, { canManage: true });
  await click(buttons()[0]);
  await settle();
  await clickAction("更新过户");
  await settle();
  const dialog = operationDialog()!;
  const status = dialog.querySelector<HTMLSelectElement>("#sale-action-transfer-status")!;
  await act(async () => {
    status.value = "completed";
    status.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(dialog.querySelector("#sale-action-transfer-date"));
  await click(named("今天", dialog));
  await changeInput(dialog.querySelector("#sale-action-certificate")!, "SYNTHETIC-TITLE");
  await click(named("保存", dialog));
  await settle();
  expect(updateTransferStatus).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("上一笔操作已确认成功");
  expect(operationDialog()).toBeNull();
  const retry = named("重试读取当前范围", host) ?? named("重试", host);
  expect(retry).toBeTruthy();
  await click(retry);
  await settle();
  expect(updateTransferStatus).toHaveBeenCalledTimes(1);
});

it.each(["手工登记出售收款", "新增分期"])(
  "refuses %s when fresh detail changes the previously XOF record to native currency",
  async (actionLabel) => {
    let detailReads = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const data = responseFor(input);
      if (data.mode === "detail" && ++detailReads >= 2) {
        Object.assign(data.contracts[0], {
          registration_basis: "source_record",
          source_reference: "sha256:synthetic|sheet:Source|cell:E65",
          signed_date: null,
          payment_plan_type: "unconfirmed",
          transfer_status: "unconfirmed",
          sale_currency: "CNY",
          total_amount_xof: 0,
          total_amount_native: 720000,
          source_balance_native: 0,
          source_balance_reference: "source:Source!K65",
        });
        data.receivables = [];
        data.receivableCount = 0;
        data.schedules = [];
        data.scheduleCount = 0;
        data.summaries[workspaceContract] = {
          total: 0,
          paid: 0,
          outstanding: 0,
          overdue: 0,
          nextDue: null,
          count: 0,
          dueOutstanding: 0,
        };
        data.attentionDue[workspaceContract] = null;
      }
      return Response.json(data);
    });
    await render(saleFixture(), undefined, { canRecordFinance: true, canManage: true });
    await click(buttons()[0]);
    await settle();
    await openDisclosure("更多操作");
    expect((named(actionLabel, inspector()!) as HTMLButtonElement).disabled).toBe(false);
    await click(named(actionLabel, inspector()!));
    await settle();
    expect(detailReads).toBeGreaterThanOrEqual(2);
    expect(operationDialog()).toBeNull();
    expect(document.querySelector("#sale-action-amount")).toBeNull();
    expect(document.body.textContent).toContain("不能在此手工录入西法收款或分期");
    expect(recordSalePaymentAtomic).not.toHaveBeenCalled();
    expect(addFlexibleInstallment).not.toHaveBeenCalled();
  },
);
