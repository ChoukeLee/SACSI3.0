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
import {
  activateContract,
  recordLeaseFinancialEntry,
  createLeaseContract,
} from "@/features/leases/actions";
import { parseWorkspaceQuery, type WorkspaceData } from "@/features/contracts/workspace-model";
import type { LeaseContractRow } from "@/types/database";
import {
  workspaceBuilding,
  workspaceContract,
  workspaceFixture,
  workspaceProject,
  workspaceCustomer,
} from "./fixtures/contract-workspace";

const secondBuilding = "88888888-8888-4888-8888-888888888888";
const otherProject = "99999999-9999-4999-8999-999999999999";
const otherBuilding = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let host: HTMLDivElement;
let root: Root;

const unitIdentity = (index: number) =>
  index === 0
    ? "44444444-4444-4444-8444-444444444444"
    : `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;

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
  const templateUnit = data.units[0];
  data.units = data.contracts.map((_, index) => {
    const position = (query.page - 1) * 25 + index;
    return {
      ...templateUnit,
      id: unitIdentity(position),
      code: `SYNTHETIC-ROOM-${position}`,
      unit_no: String(101 + position),
    };
  });
  data.contracts = data.contracts.map((contract, index) => ({
    ...contract,
    unit_id: data.units[index].id,
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

function parkData(total = 2, page = 1) {
  const data = dataFor(parseWorkspaceQuery({ projectId: otherProject, page }), total);
  data.buildings = data.buildings.filter((building) => building.project_id === otherProject);
  return data;
}

function requestInfo(input: RequestInfo | URL) {
  const url = new URL(String(input), "http://local.invalid");
  const mode = url.searchParams.get("mode") as WorkspaceData["mode"];
  const contractId = url.searchParams.get("contractId");
  url.searchParams.delete("mode");
  url.searchParams.delete("contractId");
  url.searchParams.delete("workspace");
  url.searchParams.delete("roomOverview");
  return { mode, contractId, query: parseWorkspaceQuery(Object.fromEntries(url.searchParams)) };
}

function detailFor(input: RequestInfo | URL, balance = 123456) {
  const { query, contractId } = requestInfo(input);
  const data = dataFor({ ...query, page: 1 }, 1);
  data.query = query;
  data.page = query.page;
  data.mode = "detail";
  data.contracts[0].id = contractId!;
  const position = contractId === workspaceContract ? 0 : Number(contractId?.slice(-12)) || 0;
  data.units[0].id = unitIdentity(position);
  data.units[0].unit_no = String(101 + position);
  data.contracts[0].unit_id = data.units[0].id;
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

async function render(
  data = dataFor(),
  linked: {
    initialContract?: string;
    initialCustomer?: string;
    initialCustomerName?: string;
    returnTo?: string;
    workArea?: "sacsi" | "cimac";
  } = {},
  permissions: Partial<{
    canCreate: boolean;
    canRecordFinance: boolean;
    canActivate: boolean;
    canMoveOut: boolean;
    canCorrectRentPeriod: boolean;
  }> = {},
) {
  await act(async () =>
    root.render(
      <LeaseList
        {...data}
        contracts={data.contracts as LeaseContractRow[]}
        workspace={data}
        initialProject={data.query.projectId}
        {...linked}
        locale="zh"
        canCreate={false}
        canRecordFinance={false}
        canActivate={false}
        canMoveOut={false}
        {...permissions}
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
  return [...host.querySelectorAll('[data-room-id], tbody button[aria-label^="预览合同"]')];
}

function preview() {
  return document.querySelector('aside[aria-label="租赁资料"], aside[aria-label="合同预览"]');
}

// A SACSI dossier is now a portal drawer. It is not a financial operation form.
function operationDialog() {
  return (
    [...document.querySelectorAll('[role="dialog"]')].find(
      (dialog) => !dialog.querySelector('aside[aria-label="租赁资料"]'),
    ) ?? null
  );
}
function recordRequests() {
  return vi.mocked(fetch).mock.calls.filter(([input]) => requestInfo(input).mode !== "context");
}
function namedButton(text: string, within: ParentNode = host) {
  return [...within.querySelectorAll("button")].find((button) => {
    const label = button.textContent ?? "";
    return label === text || (label.startsWith(text) && /^\d+$/.test(label.slice(text.length)));
  });
}

async function showFinance() {
  const inspector = preview();
  expect(inspector).toBeTruthy();
  await click(namedButton("收付款", inspector!) ?? namedButton("账务", inspector!));
}

async function openDossierDisclosure(label: string, within: ParentNode = preview()!) {
  if (label === "租期与登记资料" || label === "本房租赁历史") {
    await click(namedButton(label === "本房租赁历史" ? "历史" : "资料", preview()!));
    return;
  }
  const summary = [...within.querySelectorAll<HTMLElement>("summary")].find(
    (item) => item.textContent === label,
  );
  expect(summary).toBeTruthy();
  if (!(summary!.parentElement as HTMLDetailsElement).open) await click(summary);
  return summary!.parentElement as HTMLDetailsElement;
}

async function openFinancialAction() {
  await openDossierDisclosure("更多操作");
  await click(namedButton("登记押金/其他收支", preview()!));
}

function closeDossierButton() {
  return (
    preview()?.closest('[role="dialog"]')?.querySelector('button[aria-label="Close"]') ??
    preview()?.querySelector('button[aria-label="关闭预览"]')
  );
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
      if (request.mode === "detail") return Response.json(detailFor(input));
      const value = dataFor(request.query);
      value.mode = request.mode;
      if (request.mode === "context") value.roomReceivables = [];
      return Response.json(value);
    }),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("reads only the selected room's contract into a dossier drawer", async () => {
  await render();
  await settle();
  expect(recordRequests()).toHaveLength(0);
  expect(operationDialog()).toBeNull();
  await click(previewButtons()[0]);
  await settle();
  expect(recordRequests()).toHaveLength(1);
  expect(requestInfo(recordRequests()[0][0]).mode).toBe("detail");
  expect(requestInfo(recordRequests()[0][0]).contractId).toBe(workspaceContract);
  const drawer = preview()!.closest('[role="dialog"]')!;
  expect(drawer).toBeTruthy();
  expect(
    drawer.querySelectorAll('button[aria-label="Close"], button[aria-label="关闭预览"]'),
  ).toHaveLength(1);
  expect(preview()!.querySelector('button[aria-label="关闭预览"]')).toBeNull();
  expect(drawer.querySelector("h2")?.textContent).toContain("101");
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  expect(operationDialog()).toBeNull();
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(2);
  expect(host.querySelector("table")).toBeNull();
});

it("keeps park previews, focused actions, collection links and refresh reads in the park without project switching", async () => {
  const data = dataFor(parseWorkspaceQuery({ projectId: otherProject }));
  data.buildings = data.buildings.filter((building) => building.project_id === otherProject);
  await render(data, { workArea: "cimac" }, { canRecordFinance: true });
  await settle();
  expect(host.querySelector('[aria-label="项目切换"]')).toBeNull();
  expect(host.textContent).toContain("合同与履约");
  expect(recordRequests()).toHaveLength(0);
  await click(previewButtons()[0]);
  await settle();
  expect(recordRequests()).toHaveLength(1);
  const url = new URL(String(recordRequests()[0][0]), "https://local.invalid");
  expect(url.searchParams.get("workspace")).toBe("cimac");
  expect(url.searchParams.get("projectId")).toBe(otherProject);
  await showFinance();
  const collect = Array.from(host.querySelectorAll("a")).find((link) =>
    link.getAttribute("href")?.includes("/collect"),
  );
  expect(collect?.getAttribute("href")).toMatch(/^\/cimac\/contracts\//);
});

it("prefills the selected visible shared customer only when the user explicitly opens a new park contract", async () => {
  const data = dataFor(parseWorkspaceQuery({ projectId: otherProject }));
  data.buildings = data.buildings.filter((building) => building.project_id === otherProject);
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { query, mode } = requestInfo(input);
    const context = dataFor(query);
    context.mode = mode;
    return Response.json(context);
  });
  await render(
    data,
    {
      workArea: "cimac",
      initialCustomer: workspaceCustomer,
      initialCustomerName: "Shared pre-contract customer",
    },
    { canCreate: true },
  );
  await settle();
  expect(recordRequests()).toHaveLength(0);
  expect(host.textContent).toContain("Shared pre-contract customer");
  expect(host.textContent).toContain("点击“新建合同”继续");
  expect(operationDialog()).toBeNull();
  const create = Array.from(host.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("新建合同"),
  );
  await click(create);
  await settle();
  const customerOption = document.querySelector<HTMLOptionElement>(
    `[role="dialog"] option[value="${workspaceCustomer}"]`,
  );
  expect(customerOption?.selected).toBe(true);
  expect(
    new URL(String(vi.mocked(fetch).mock.calls[0][0]), "https://local.invalid").searchParams.get(
      "workspace",
    ),
  ).toBe("cimac");
  expect(createLeaseContract).not.toHaveBeenCalled();
  expect(recordLeaseFinancialEntry).not.toHaveBeenCalled();
});

it("does not open a new park contract with a silently substituted customer when fresh context no longer contains the selected identity", async () => {
  const data = dataFor(parseWorkspaceQuery({ projectId: otherProject }));
  data.buildings = data.buildings.filter((building) => building.project_id === otherProject);
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { query, mode } = requestInfo(input);
    const context = dataFor(query, 0);
    context.mode = mode;
    context.customers = [];
    return Response.json(context);
  });
  await render(
    data,
    { workArea: "cimac", initialCustomer: workspaceCustomer },
    { canCreate: true },
  );
  await click(
    Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("新建合同"),
    ),
  );
  await settle();
  expect(operationDialog()).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("所选客户暂不可核验");
  expect(createLeaseContract).not.toHaveBeenCalled();
  expect(recordLeaseFinancialEntry).not.toHaveBeenCalled();
});
it("shows finance a shared-customer handoff without a new-contract button, form, or automatic write", async () => {
  const data = dataFor(parseWorkspaceQuery({ projectId: otherProject }));
  data.buildings = data.buildings.filter((building) => building.project_id === otherProject);
  await render(
    data,
    {
      workArea: "cimac",
      initialCustomer: workspaceCustomer,
      initialCustomerName: "Shared customer handoff",
    },
    { canCreate: false, canRecordFinance: true },
  );
  await settle();
  expect(host.textContent).toContain("Shared customer handoff");
  expect(host.textContent).toContain("当前账号没有建约权限，请交由租售账号或管理员继续");
  expect(
    Array.from(host.querySelectorAll("button")).some((button) =>
      button.textContent?.includes("新建合同"),
    ),
  ).toBe(false);
  expect(operationDialog()).toBeNull();
  expect(recordRequests()).toHaveLength(0);
  expect(createLeaseContract).not.toHaveBeenCalled();
  expect(recordLeaseFinancialEntry).not.toHaveBeenCalled();
});

it("opens an exact linked contract outside the visible list without loading every contract", async () => {
  const linkedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await render(dataFor(), {
    initialContract: linkedId,
    returnTo: "/customers?project=" + workspaceProject + "&q=Synthetic&page=2",
  });
  await settle();
  expect(recordRequests()).toHaveLength(1);
  expect(requestInfo(recordRequests()[0][0])).toMatchObject({
    mode: "detail",
    contractId: linkedId,
    query: { projectId: workspaceProject, buildingId: "" },
  });
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
  expect(host.querySelector('a[href^="/customers?"]')?.getAttribute("href")).toContain("page=2");
  await click(closeDossierButton());
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  await settle();
  expect(recordRequests()).toHaveLength(1);
});

it("drops a linked contract immediately when changing project and rejects an external return URL", async () => {
  await render(dataFor(), {
    initialContract: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    returnTo: "https://external.invalid/customers",
  });
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  expect(host.querySelector('a[href^="https://external.invalid"]')).toBeNull();
  const nav = host.querySelector('nav[aria-label="项目切换"]');
  await click(namedButton("科建建材城", nav!));
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  await settle();
  expect(preview()?.textContent ?? "").not.toContain("123,456");
});

it("opens the complete dossier drawer from the rental room card", async () => {
  await render();
  await click(previewButtons()[0]);
  await settle();
  expect(preview()?.textContent).toContain("Synthetic guest");
  await openDossierDisclosure("租期与登记资料");
  expect(preview()?.textContent).toContain("约定付款日");
  expect(operationDialog()).toBeNull();
  expect(recordRequests()).toHaveLength(1);
});

it("opens focused deposit and move-out forms directly and returns to the same dossier", async () => {
  await render(dataFor(), {}, { canRecordFinance: true, canMoveOut: true });
  await click(previewButtons()[0]);
  await settle();
  const dossier = preview();
  expect(dossier?.querySelector('a[href*="/collect"]')?.textContent).toContain(
    "手工登记租金/物业费",
  );
  expect(dossier?.querySelector('a[href*="/collect"]')?.closest("details")?.open).toBe(false);
  expect(dossier?.textContent).not.toContain("打开合同详情 / 办理");
  await openFinancialAction();
  await settle();
  expect(recordRequests()).toHaveLength(2);
  const depositForm = operationDialog()!;
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(depositForm.textContent).toContain("新增长租财务记录");
  expect(depositForm.textContent).toContain("SYNTHETIC-0");
  expect(depositForm.textContent).toContain("业务类型");
  expect(depositForm.textContent).not.toContain("风险概览");
  await click(depositForm.querySelector('button[aria-label="Close"]'));
  await settle();
  expect(operationDialog()).toBeNull();
  await click(namedButton("资料", preview()!));
  expect(preview()?.textContent).toContain("SYNTHETIC-0");
  await openDossierDisclosure("更多操作");
  const moveOut = [...preview()!.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("退租"),
  );
  await click(moveOut);
  await settle();
  const moveOutForm = operationDialog()!;
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(moveOutForm.textContent).toContain("本次已实际补收租金");
  expect(moveOutForm.textContent).toContain("本次实际退还押金");
  expect(moveOutForm.textContent).not.toContain("打开完整财务记录");
});

it("hides all mutation controls for viewers while retaining the full contract and financial records", async () => {
  await render();
  await click(previewButtons()[0]);
  await settle();
  await openDossierDisclosure("更多操作");
  expect(preview()?.textContent ?? "").not.toContain("登记押金/其他收支");
  expect(preview()?.querySelector('a[href*="/collect"]')).toBeNull();
  expect(
    [...preview()!.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("退租"),
    ),
  ).toBe(false);
  await showFinance();
  expect(preview()?.textContent ?? "").not.toContain("更正租金账期");
  expect(preview()?.textContent).toContain("以下为这次租赁的已登记收付款");
});

it("does not open an operation form if its exact-contract fresh read fails", async () => {
  await render(dataFor(), {}, { canRecordFinance: true, canMoveOut: true });
  await click(previewButtons()[0]);
  await settle();
  vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
  await openFinancialAction();
  await settle();
  expect(operationDialog()).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("长租房源暂时无法读取");
  expect(preview()?.textContent ?? "").not.toContain("登记押金/其他收支");
});

it("discards an in-flight operation read after changing the project", async () => {
  await render(dataFor(), {}, { canRecordFinance: true });
  await click(previewButtons()[0]);
  await settle();
  let complete!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  await openFinancialAction();
  const pendingInput = recordRequests().at(-1)![0];
  const nav = host.querySelector('nav[aria-label="项目切换"]')!;
  await click(namedButton("科建建材城", nav));
  await settle();
  await act(async () => complete(Response.json(detailFor(pendingInput))));
  await settle();
  expect(operationDialog()).toBeNull();
  expect(preview()?.textContent ?? "").not.toContain("SYNTHETIC-0");
});

it("requires the latest active status before opening a move-out form", async () => {
  await render(dataFor(), {}, { canMoveOut: true });
  await click(previewButtons()[0]);
  await settle();
  vi.mocked(fetch).mockImplementationOnce(async (input) => {
    const value = detailFor(input);
    value.contracts[0].status = "terminated";
    return Response.json(value);
  });
  await openDossierDisclosure("更多操作");
  const moveOut = [...preview()!.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("退租"),
  );
  await click(moveOut);
  await settle();
  expect(operationDialog()).toBeNull();
  expect(document.body.textContent).toContain("合同状态已变化");
});

it.each([
  ["finance", "select"],
  ["finance", "close"],
  ["moveout", "select"],
  ["moveout", "close"],
  ["activate", "select"],
  ["activate", "close"],
] as const)(
  "cancels delayed %s preparation when the same-scope dossier is %s",
  async (operation, navigation) => {
    await render(dataFor(), {}, { canRecordFinance: true, canMoveOut: true, canActivate: true });
    if (operation === "activate") {
      vi.mocked(fetch).mockImplementationOnce(async (input) => {
        const detail = detailFor(input);
        detail.contracts[0].status = "draft";
        return Response.json(detail);
      });
    }
    await click(previewButtons()[0]);
    await settle();
    await openDossierDisclosure("更多操作");
    const action =
      operation === "finance"
        ? namedButton("登记押金/其他收支", preview()!)
        : operation === "activate"
          ? namedButton("激活合同", preview()!)
          : [...preview()!.querySelectorAll("button")].find((button) =>
              button.textContent?.includes("退租"),
            );
    const navigationButton = navigation === "select" ? previewButtons()[1] : closeDossierButton();
    let complete!: (value: Response) => void;
    let pendingInput!: RequestInfo | URL;
    vi.mocked(fetch).mockImplementationOnce((input) => {
      pendingInput = input;
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    });
    // These events may be queued before the fresh-read loading render commits.
    await act(async () => {
      (action as HTMLButtonElement).click();
      (navigationButton as HTMLButtonElement).click();
    });
    expect(requestInfo(pendingInput).contractId).toBe(workspaceContract);
    const delayed = detailFor(pendingInput);
    if (operation === "activate") delayed.contracts[0].status = "draft";
    await act(async () => complete(Response.json(delayed)));
    await settle();
    expect(operationDialog()).toBeNull();
    expect(activateContract).not.toHaveBeenCalled();
    expect(recordLeaseFinancialEntry).not.toHaveBeenCalled();
    if (navigation === "close") expect(preview()?.textContent ?? "").not.toContain("SYNTHETIC-0");
    else {
      expect(preview()?.textContent ?? "").not.toContain("新增长租财务记录");
      expect(host.querySelectorAll('[data-room-id][aria-pressed="true"]')).toHaveLength(1);
      expect(requestInfo(recordRequests().at(-1)![0]).contractId).toBe(dataFor().contracts[1].id);
    }
  },
);

it("keeps the focused financial form open and prevents duplicate submits while a write is pending", async () => {
  await render(dataFor(), {}, { canRecordFinance: true });
  await click(previewButtons()[0]);
  await settle();
  await openFinancialAction();
  await settle();
  const form = operationDialog()!;
  const amount = form.querySelector<HTMLInputElement>('input[type="number"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(amount, "1");
    amount.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let complete!: (value: { success: boolean; error: string }) => void;
  vi.mocked(recordLeaseFinancialEntry).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const submit = namedButton("确认保存财务记录", form)!;
  await act(async () => {
    submit.click();
    submit.click();
  });
  expect(recordLeaseFinancialEntry).toHaveBeenCalledTimes(1);
  expect(form.querySelector("fieldset")?.disabled).toBe(true);
  await click(form.querySelector('button[aria-label="Close"]'));
  expect(operationDialog()).toBe(form);
  await act(async () => complete({ success: false, error: "Synthetic rejection" }));
  expect(form.querySelector("fieldset")?.disabled).toBe(false);
  expect(form.textContent).toContain("Synthetic rejection");
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
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  const input = recordRequests().at(-1)![0];
  await act(async () => resolveNext(Response.json(detailFor(input, 654321))));
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("654,321");
  expect(preview()?.textContent ?? "").not.toContain("123,456");
});

it("reads a fresh result after closing and reopening the same contract instead of restoring its old balance", async () => {
  await render();
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  await click(closeDossierButton());
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  let resolveReopened!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveReopened = resolve;
      }),
  );
  await click(previewButtons()[0]);
  expect(recordRequests()).toHaveLength(2);
  expect(preview()?.getAttribute("aria-busy")).toBe("true");
  expect(preview()?.textContent).toContain("正在读取租赁资料");
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  const input = recordRequests().at(-1)![0];
  await act(async () => resolveReopened(Response.json(detailFor(input, 654321))));
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("654,321");
  expect(preview()?.textContent ?? "").not.toContain("123,456");
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
  expect(preview()?.textContent ?? "").not.toContain("123,456");
});

it.each([
  ["project", "项目切换", "科建建材城"],
  ["building", "楼栋切换", "Synthetic 4"],
  ["status", "合同状态筛选", "全部"],
] as const)("hides the old preview immediately on %s changes", async (_kind, nav, label) => {
  await render(
    _kind === "status" ? parkData() : dataFor(),
    _kind === "status" ? { workArea: "cimac" } : {},
  );
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  expect(preview()?.textContent).toContain("123,456");
  if (_kind === "building") {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="选择楼栋"]')!;
    await act(async () => {
      select.value = secondBuilding;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  } else {
    const scopeNav = host.querySelector(`nav[aria-label="${nav}"]`);
    await click(namedButton(label, scopeNav ?? host));
  }
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  await settle();
  expect(preview()?.textContent ?? "").not.toContain("123,456");
});

it("hides a selected CIMAC table preview before the debounced empty search response returns", async () => {
  await render(parkData(), { workArea: "cimac" });
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
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  await settle(260);
  expect(previewButtons()).toHaveLength(0);
  expect(host.querySelector("tbody")?.textContent).toContain("没有匹配的合同");
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  expect(operationDialog()).toBeNull();
});

it("clears the old CIMAC table preview before changing the server-side contract page", async () => {
  await render(parkData(26), { workArea: "cimac" });
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { mode, query } = requestInfo(input);
    return Response.json(mode === "detail" ? detailFor(input) : dataFor(query, 26));
  });
  await click(previewButtons()[0]);
  await settle();
  await showFinance();
  await click(namedButton("下一页"));
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  await settle();
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(host.textContent).toContain("26–26 / 26");
  expect(preview()?.textContent ?? "").not.toContain("123,456");
});

it("clears a local CIMAC table selection when its contract is no longer on the visible page", async () => {
  const initial = parkData(26);
  const last = parkData(26, 2);
  await act(async () =>
    root.render(
      <LeaseList
        {...initial}
        workArea="cimac"
        contracts={[...initial.contracts, ...last.contracts] as LeaseContractRow[]}
        units={[...initial.units, ...last.units]}
        locale="zh"
        canCreate={false}
        canRecordFinance={false}
      />,
    ),
  );
  await click(previewButtons()[0]);
  expect(preview()?.textContent).toContain("SYNTHETIC-0");
  await click(namedButton("下一页"));
  expect(preview()?.textContent ?? "").not.toContain("SYNTHETIC-0");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(recordRequests()).toHaveLength(0);
});

it("keeps the room catalogue and a lightweight history entry without a separate contract table", async () => {
  await render();
  expect(recordRequests()).toHaveLength(0);
  await click(namedButton("查看历史"));
  expect(preview()).toBeNull();
  await settle();
  expect(host.querySelector('[aria-label="楼栋长租房源"]')).toBeTruthy();
  expect(host.querySelector('[aria-label="租赁记录查询"]')).toBeTruthy();
  expect(
    host.querySelector('select[aria-label="租赁记录状态"]')?.getAttribute("value") ??
      (host.querySelector('select[aria-label="租赁记录状态"]') as HTMLSelectElement)?.value,
  ).toBe("historical");
  expect(host.querySelector("table")).toBeNull();
  expect(namedButton("明细核对")).toBeUndefined();
  expect(recordRequests()).toHaveLength(0);
});

it("opens a former tenant's partial USD debt by the old record without changing the new tenant's balance", async () => {
  const initial = dataFor();
  const oldId = initial.contracts[1].id;
  const oldCustomer = {
    ...initial.customers[0],
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Former tenant",
  };
  initial.customers[0].name = "Current tenant";
  initial.customers.push(oldCustomer);
  initial.units = [initial.units[0]];
  Object.assign(initial.contracts[0], { paid_through_date: "2027-01-01" });
  Object.assign(initial.contracts[1], {
    unit_id: initial.units[0].id,
    customer_id: oldCustomer.id,
    status: "terminated",
    start_date: "2024-01-01",
    expected_end_date: "2024-12-31",
    actual_end_date: "2024-12-31",
    paid_through_date: "2024-12-31",
    rent_currency: "USD",
    monthly_rent_xof: 0,
    monthly_rent_amount: 3200,
  });
  const currentSummary = {
    total: 100,
    paid: 100,
    outstanding: 0,
    overdue: 0,
    nextDue: null,
    count: 1,
    dueOutstanding: 0,
  };
  const oldSummary = { ...currentSummary, total: 0, paid: 0 };
  initial.summaries = { [workspaceContract]: currentSummary, [oldId]: oldSummary };
  const currentBill = {
    ...workspaceFixture({}, initial.query, "detail").receivables[0],
    id: "77777777-7777-4777-8777-777777777771",
    building_id: workspaceBuilding,
    unit_id: initial.units[0].id,
    customer_id: initial.customers[0].id,
    source_id: workspaceContract,
    currency: "XOF" as const,
    amount_xof: 100,
    paid_amount_xof: 100,
    amount_native: null,
    paid_amount_native: null,
    status: "paid" as const,
  };
  const oldBill = {
    ...currentBill,
    id: "77777777-7777-4777-8777-777777777772",
    source_id: oldId,
    customer_id: oldCustomer.id,
    due_date: "2024-12-01",
    currency: "USD" as const,
    amount_xof: 0,
    paid_amount_xof: 0,
    amount_native: 3200,
    paid_amount_native: 1000,
    status: "partial" as const,
  };
  vi.mocked(fetch).mockImplementation(async (input) => {
    const { query, mode, contractId } = requestInfo(input);
    if (mode === "context")
      return Response.json({
        ...initial,
        query,
        page: query.page,
        mode,
        roomReceivables: [currentBill, oldBill],
      });
    const historical = contractId === oldId;
    const detail = detailFor(input, historical ? 0 : 100);
    detail.contracts = [initial.contracts[historical ? 1 : 0]];
    detail.units = initial.units;
    detail.customers = [initial.customers[historical ? 1 : 0]];
    detail.receivables = [historical ? oldBill : currentBill];
    detail.summaries = { [contractId!]: historical ? oldSummary : currentSummary };
    return Response.json(detail);
  });
  await render(initial);
  expect(previewButtons()).toHaveLength(1);
  expect(previewButtons()[0].textContent).toContain("Current tenant");
  expect(previewButtons()[0].textContent).not.toContain("Former tenant");
  await click(namedButton("收款跟进"));
  const followup = host.querySelector(`[data-followup-record-id="${oldId}"]`);
  expect(followup?.textContent).toContain("Former tenant");
  expect(followup?.textContent).toContain("2,200");
  expect(followup?.textContent).toContain("USD");
  expect(host.querySelector(`[data-followup-record-id="${workspaceContract}"]`)).toBeNull();
  await click(namedButton("查看历史"));
  expect(host.querySelector(`[data-history-record-id="${oldId}"]`)).toBeTruthy();
  expect(host.querySelector(`[data-history-record-id="${workspaceContract}"]`)).toBeNull();
  await click(followup);
  await settle();
  expect(requestInfo(recordRequests().at(-1)![0]).contractId).toBe(oldId);
  expect(preview()?.textContent).toContain("Former tenant");
  await openDossierDisclosure("本房租赁历史", document.querySelector('[role="dialog"]')!);
  await click(document.querySelector(`[data-room-record-id="${workspaceContract}"]`));
  await settle();
  expect(requestInfo(recordRequests().at(-1)![0]).contractId).toBe(workspaceContract);
  expect(preview()?.textContent).toContain("Current tenant");
  await showFinance();
  expect(preview()?.textContent).not.toContain("2,200");
  expect(activateContract).not.toHaveBeenCalled();
  expect(recordLeaseFinancialEntry).not.toHaveBeenCalled();
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
  expect(preview()?.textContent ?? "").not.toContain("123,456");
  expect(preview()?.textContent ?? "").not.toContain("654,321");
  expect(preview()?.textContent).toMatch(/无法|失败|不可|重试/);
  expect(preview()?.textContent ?? "").not.toContain("打开合同详情 / 办理");
  expect(preview()?.textContent ?? "").not.toContain("打开完整财务记录");
  expect(preview()?.textContent ?? "").not.toContain("合同 / 打印");
  expect(operationDialog()).toBeNull();
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(2);
});
