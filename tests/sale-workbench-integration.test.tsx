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
import { saleFixture } from "./fixtures/sale-workbench";
import {
  workspaceContract,
  workspaceProject,
  workspaceBuilding,
} from "./fixtures/contract-workspace";
import { parseWorkspaceQuery, type WorkspaceData } from "@/features/contracts/workspace-model";
import type { SaleContractRow } from "@/types/database";

let host: HTMLDivElement, root: Root;
function requestInfo(input: RequestInfo | URL) {
  const url = new URL(String(input), "https://local.invalid"),
    mode = url.searchParams.get("mode") as WorkspaceData["mode"],
    id = url.searchParams.get("contractId");
  url.searchParams.delete("mode");
  url.searchParams.delete("contractId");
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
const buttons = () => [...host.querySelectorAll('tbody button[aria-label^="预览出售合同"]')];
const inspector = () => host.querySelector('aside[aria-label="出售合同履约详情"]');
const named = (name: string, within: ParentNode = host) =>
  [...within.querySelectorAll("button")].find((button) => button.textContent === name);

it("keeps initial rendering idle and fetches only an explicitly selected contract", async () => {
  await render();
  await settle();
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click(buttons()[0]);
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(requestInfo(vi.mocked(fetch).mock.calls[0][0])).toMatchObject({
    mode: "detail",
    id: workspaceContract,
  });
  expect(inspector()?.textContent).toContain("800,000 XOF");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(new URL(window.location.href).searchParams.get("contract")).toBe(workspaceContract);
});
it.each([false, true])(
  "focuses and reveals the narrow-screen inspector on explicit row selection, reduced motion=%s",
  async (reduced) => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches:
          query === "(max-width: 1199px)" ||
          (reduced && query === "(prefers-reduced-motion: reduce)"),
        media: query,
      })),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    await render();
    const scroll = vi.fn();
    const region = host.querySelector<HTMLElement>(
      '[role="region"][aria-label="选中出售合同详情"]',
    )!;
    Object.defineProperty(region, "scrollIntoView", { value: scroll, configurable: true });
    await click(buttons()[0]);
    expect(frames).toHaveLength(1);
    await act(async () => frames[0](0));
    expect(document.activeElement).toBe(region);
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: reduced ? "auto" : "smooth" });
    await settle();
    expect(frames).toHaveLength(1); // Detail responses do not move focus again.
  },
);
it("keeps direct deep links from stealing focus and exposes an explicit locator", async () => {
  const frame = vi.fn();
  vi.stubGlobal("requestAnimationFrame", frame);
  await render(saleFixture(), workspaceContract);
  await settle();
  expect(frame).not.toHaveBeenCalled();
  expect(named("查看选中合同 ↓")).toBeTruthy();
});
it("opens a stable ID deep link without loading all contracts, even outside the current page", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await render(saleFixture(), id);
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(requestInfo(vi.mocked(fetch).mock.calls[0][0]).id).toBe(id);
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
  expect(fetch).not.toHaveBeenCalled();
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
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
});
it("does not display previous selected balances while the next read is pending", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  expect(inspector()?.textContent).toContain("800,000 XOF");
  let resolveNext!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
  );
  await click(buttons()[1]);
  expect(host.querySelector("aside")?.textContent ?? "").not.toContain("800,000 XOF");
  const input = vi.mocked(fetch).mock.calls.at(-1)![0];
  await act(async () => resolveNext(Response.json(responseFor(input, 123456))));
  await settle();
  expect(inspector()?.textContent).toContain("123,456 XOF");
});
it("does not restore cached facts when closing then reopening the same record", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  await click(host.querySelector('[aria-label="关闭合同预览"]'));
  let resolveNext!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
  );
  await click(buttons()[0]);
  expect(host.querySelector("aside")?.textContent ?? "").not.toContain("800,000 XOF");
  expect(fetch).toHaveBeenCalledTimes(2);
  const input = vi.mocked(fetch).mock.calls.at(-1)![0];
  await act(async () => resolveNext(Response.json(responseFor(input, 654321))));
  await settle();
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
  expect(inspector()?.textContent).toContain("654,321 XOF");
  expect(inspector()?.textContent).not.toContain("123,456 XOF");
});
it("clears preview and drawer before a changed scope request returns", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  await click(named("全部"));
  expect(host.querySelector("aside")?.textContent ?? "").not.toContain("800,000 XOF");
  await settle();
  expect(inspector()).toBeNull();
  expect(new URL(window.location.href).searchParams.get("contract")).toBeNull();
});
it("clears selected facts before search debounce and empty result", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { query, mode } = requestInfo(input);
    return Response.json(saleFixture(query, mode, 0));
  });
  const input = host.querySelector('input[placeholder*="搜索"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "不存在",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector("aside")?.textContent ?? "").not.toContain("800,000 XOF");
  await settle(260);
  expect(host.querySelector("tbody")?.textContent).toContain("没有匹配的出售合同");
});
it("keeps row list available after isolated detail failure, without zero debt or operation actions", async () => {
  await render();
  vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
  await click(buttons()[0]);
  await settle();
  expect(host.textContent).toContain("本合同暂不可核验");
  expect(host.textContent).not.toContain("打开合同 / 办理");
  expect(buttons()).toHaveLength(2);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("keeps the complete read-only contract in one inspector with no second detail drawer", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  await click(named("付款事实"));
  expect(inspector()?.textContent).toContain("已录付款事实");
  expect(host.textContent).not.toContain("打开合同 / 办理");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it.each([
  ["登记收款", "登记出售收款", "确认收款"],
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
    await click(named(label));
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
    expect(document.querySelector('[role="dialog"]')).toBeNull();
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
  await click(named("终止合同"));
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
  await click(named("新增分期"));
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
  await click(named("更新过户"));
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
  await click(named("登记收款"));
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
  await click(named("更新过户"));
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
