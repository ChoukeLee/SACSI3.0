// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/leases/actions", () => ({
  createLeaseContract: vi.fn(),
  activateContract: vi.fn(),
  terminateContract: vi.fn(),
  processMoveOut: vi.fn(),
  recordLeaseFinancialEntry: vi.fn(),
}));
vi.mock("@/features/print", () => ({ printLeaseContract: vi.fn(), printSaleContract: vi.fn() }));

import { LeaseList } from "@/features/leases/lease-list";
import { parseWorkspaceQuery, type WorkspaceData } from "@/features/contracts/workspace-model";
import type { LeaseContractRow } from "@/types/database";
import {
  workspaceBuilding,
  workspaceContract,
  workspaceFixture,
  workspaceProject,
} from "./fixtures/contract-workspace";

const secondBuilding = "88888888-8888-4888-8888-888888888888";
const otherProject = "99999999-9999-4999-8999-999999999999";
const otherBuilding = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let host: HTMLDivElement;
let root: Root;

function dataFor(query = parseWorkspaceQuery({ projectId: workspaceProject }), total = 2) {
  const data = workspaceFixture({ total }, query);
  const firstBuilding = data.buildings[0];
  data.buildings = [
    {
      ...firstBuilding,
      project_id: workspaceProject,
      project: { id: workspaceProject, code: "SACSI", display_name: "Synthetic SACSI" },
    },
    {
      ...firstBuilding,
      id: secondBuilding,
      code: "SACSI4",
      display_name: "Synthetic 4",
      project_id: workspaceProject,
      project: { id: workspaceProject, code: "SACSI", display_name: "Synthetic SACSI" },
    },
    {
      ...firstBuilding,
      id: otherBuilding,
      code: "CIMAC",
      display_name: "Synthetic CIMAC",
      project_id: otherProject,
      project: { id: otherProject, code: "CIMAC", display_name: "Synthetic CIMAC" },
    },
  ];
  data.units[0].building_id =
    query.buildingId || (query.projectId === otherProject ? otherBuilding : workspaceBuilding);
  data.contracts = data.contracts.map((contract, index) => ({
    ...contract,
    id:
      query.page === 1 && index === 0
        ? workspaceContract
        : `66666666-6666-4666-8666-${String((query.page - 1) * 25 + index).padStart(12, "0")}`,
    contract_no: `SYNTHETIC-${(query.page - 1) * 25 + index}`,
  }));
  data.summaries = Object.fromEntries(
    data.contracts.map((contract) => [
      contract.id,
      workspaceFixture().summaries[workspaceContract],
    ]),
  );
  data.accruals = Object.fromEntries(data.contracts.map((contract) => [contract.id, null]));
  data.attentionDue = Object.fromEntries(
    data.contracts.map((contract) => [contract.id, "2026-10-01"]),
  );
  return data;
}

function requestInfo(input: RequestInfo | URL) {
  const url = new URL(String(input), "http://local.invalid");
  const mode = url.searchParams.get("mode") as WorkspaceData["mode"];
  const contractId = url.searchParams.get("contractId");
  url.searchParams.delete("mode");
  url.searchParams.delete("contractId");
  return { mode, contractId, query: parseWorkspaceQuery(Object.fromEntries(url.searchParams)) };
}

function detailFor(input: RequestInfo | URL, balance = 123456) {
  const { query, contractId } = requestInfo(input);
  const data = dataFor({ ...query, page: 1 }, 1);
  data.query = query;
  data.page = query.page;
  data.mode = "detail";
  data.contracts[0].id = contractId!;
  data.summaries = {
    [contractId!]: {
      total: balance,
      paid: 0,
      outstanding: balance,
      overdue: balance,
      nextDue: "2026-10-01",
      count: 1,
      dueOutstanding: balance,
    },
  };
  data.accruals = { [contractId!]: null };
  data.attentionDue = { [contractId!]: "2026-10-01" };
  data.receivables = [
    {
      ...workspaceFixture({}, query, "detail").receivables[0],
      source_id: contractId!,
      amount_xof: balance,
    },
  ];
  data.receivableCount = 1;
  return data;
}

async function render(data = dataFor()) {
  await act(async () =>
    root.render(
      <LeaseList
        {...data}
        contracts={data.contracts as LeaseContractRow[]}
        workspace={data}
        initialProject={data.query.projectId}
        locale="zh"
        canCreate={false}
        canRecordFinance={false}
        canActivate={false}
        canMoveOut={false}
      />,
    ),
  );
}

async function settle(ms = 20) {
  await act(
    async () =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  );
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLButtonElement).click());
}

function previewButtons() {
  return [...host.querySelectorAll('tbody button[aria-label^="预览合同"]')];
}

function preview() {
  return host.querySelector('aside[aria-label="合同预览"]');
}

function namedButton(text: string, within: ParentNode = host) {
  return [...within.querySelectorAll("button")].find((button) => button.textContent === text);
}

async function showFinance() {
  const inspector = preview();
  expect(inspector).toBeTruthy();
  await click(namedButton("账务", inspector!));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const request = requestInfo(input);
      return Response.json(request.mode === "detail" ? detailFor(input) : dataFor(request.query));
    }),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps SSR idle, then fetches only the explicitly selected contract into a non-modal preview", async () => {
  await render();
  await settle();
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click(previewButtons()[0]);
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(requestInfo(vi.mocked(fetch).mock.calls[0][0]).mode).toBe("detail");
  expect(requestInfo(vi.mocked(fetch).mock.calls[0][0]).contractId).toBe(workspaceContract);
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
});

it("preserves the customer's full contract dialog instead of changing it into the read-only preview", async () => {
  await render();
  await click(host.querySelector("tbody td:nth-child(2) button"));
  await settle();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Synthetic guest");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not reuse the preceding contract balance while the next selected preview is loading", async () => {
  await render();
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  let resolveNext!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveNext = resolve;
      }),
  );
  await click(previewButtons()[1]);
  expect(preview()?.textContent).not.toContain("123,456");
  const input = vi.mocked(fetch).mock.calls.at(-1)![0];
  await act(async () => resolveNext(Response.json(detailFor(input, 654321))));
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("654,321");
  expect(preview()?.textContent).not.toContain("123,456");
});

it("reads a fresh result after closing and reopening the same contract instead of restoring its old balance", async () => {
  await render();
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  await click(host.querySelector('button[aria-label="关闭预览"]'));
  expect(preview()?.textContent).not.toContain("123,456");
  let resolveReopened!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveReopened = resolve;
      }),
  );
  await click(previewButtons()[0]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(preview()?.getAttribute("aria-busy")).toBe("true");
  expect(preview()?.textContent).toContain("正在读取合同");
  expect(preview()?.textContent).not.toContain("123,456");
  const input = vi.mocked(fetch).mock.calls.at(-1)![0];
  await act(async () => resolveReopened(Response.json(detailFor(input, 654321))));
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("654,321");
  expect(preview()?.textContent).not.toContain("123,456");
});

it("ignores an aborted old contract response even when the transport still returns it late", async () => {
  await render();
  const pending: { input: RequestInfo | URL; resolve: (response: Response) => void }[] = [];
  vi.mocked(fetch).mockImplementation(
    (input) =>
      new Promise<Response>((resolve) => {
        pending.push({ input, resolve });
      }),
  );
  await click(previewButtons()[0]);
  await click(previewButtons()[1]);
  expect(pending).toHaveLength(2);
  await act(async () => pending[1].resolve(Response.json(detailFor(pending[1].input, 654321))));
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("654,321");
  await act(async () => pending[0].resolve(Response.json(detailFor(pending[0].input, 123456))));
  await settle();
  expect(preview()?.textContent).toContain("654,321");
  expect(preview()?.textContent).not.toContain("123,456");
});

it.each([
  ["project", "项目切换", "科建建材城"],
  ["building", "楼栋切换", "Synthetic 4"],
  ["status", "合同状态筛选", "全部"],
] as const)("hides the old preview immediately on %s changes", async (_kind, nav, label) => {
  await render();
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  const scopeNav = host.querySelector(`nav[aria-label="${nav}"]`);
  await click(namedButton(label, scopeNav ?? host));
  expect(preview()?.textContent).not.toContain("123,456");
  await settle();
  expect(preview()?.textContent).not.toContain("123,456");
});

it("hides a selected preview before the debounced empty search response returns", async () => {
  await render();
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { query } = requestInfo(input);
    return Response.json(dataFor(query, 0));
  });
  const input = host.querySelector('input[placeholder*="搜索"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Synthetic missing customer",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(preview()?.textContent).not.toContain("123,456");
  await settle(260);
  expect(previewButtons()).toHaveLength(0);
  expect(host.querySelector("tbody")?.textContent).toContain("没有匹配的合同");
  expect(preview()?.textContent).not.toContain("123,456");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("clears the old preview before changing the server-side contract page", async () => {
  await render(dataFor(undefined, 26));
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { mode, query } = requestInfo(input);
    return Response.json(mode === "detail" ? detailFor(input) : dataFor(query, 26));
  });
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  await click(namedButton("下一页"));
  expect(preview()?.textContent).not.toContain("123,456");
  await settle();
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(host.textContent).toContain("26–26 / 26");
  expect(preview()?.textContent).not.toContain("123,456");
});

it("clears a local page selection when its contract is no longer on the visible page", async () => {
  const initial = dataFor(undefined, 26);
  const last = dataFor(parseWorkspaceQuery({ projectId: workspaceProject, page: 2 }), 26);
  await act(async () =>
    root.render(
      <LeaseList
        {...initial}
        contracts={[...initial.contracts, ...last.contracts] as LeaseContractRow[]}
        locale="zh"
        canCreate={false}
        canRecordFinance={false}
      />,
    ),
  );
  await click(previewButtons()[0]);
  expect(preview()?.textContent).toContain("SYNTHETIC-0");
  await click(namedButton("下一页"));
  expect(preview()?.textContent).not.toContain("SYNTHETIC-0");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("hides the preview when entering the floor view, without an initial all-scope read", async () => {
  await render();
  expect(fetch).not.toHaveBeenCalled();
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  let resolveScope!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveScope = resolve;
      }),
  );
  await click(namedButton("楼层房源"));
  expect(preview()?.textContent).not.toContain("123,456");
  const input = vi.mocked(fetch).mock.calls.at(-1)![0];
  const { mode, query } = requestInfo(input);
  expect(mode).toBe("scope");
  const scope = dataFor(query);
  scope.mode = "scope";
  await act(async () => resolveScope(Response.json(scope)));
  await settle();
  expect(preview()).toBeNull();
});

it("fails closed after a preview read error without keeping an old balance or mutation actions", async () => {
  await render();
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
  await click(previewButtons()[1]);
  await settle();
  expect(preview()?.textContent).not.toContain("123,456");
  expect(preview()?.textContent).not.toContain("654,321");
  expect(preview()?.textContent).toMatch(/无法|失败|不可|重试/);
  expect(preview()?.textContent).not.toContain("打开合同详情 / 办理");
  expect(preview()?.textContent).not.toContain("打开完整财务记录");
  expect(preview()?.textContent).not.toContain("合同 / 打印");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
});
