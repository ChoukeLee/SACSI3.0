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
async function render(data = saleFixture(), initialContract?: string) {
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
it("retains the original read-only full contract drawer when explicitly opened", async () => {
  await render();
  await click(buttons()[0]);
  await settle();
  await click(named("打开合同 / 办理"));
  await settle();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Synthetic guest");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("财务记录");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("确认收款");
});
