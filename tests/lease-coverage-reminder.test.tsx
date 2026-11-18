// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LeaseList } from "@/features/leases/lease-list";
import {
  parseWorkspaceQuery,
  type WorkspaceData,
  type WorkspaceMode,
  type WorkspaceQuery,
} from "@/features/contracts/workspace-model";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";
import {
  workspaceBuilding,
  workspaceContract,
  workspaceCustomer,
  workspaceFixture,
  workspaceProject,
  workspaceUnit,
} from "./fixtures/contract-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/leases/actions", () => ({
  createLeaseContract: vi.fn(),
  activateContract: vi.fn(),
  terminateContract: vi.fn(),
  processMoveOut: vi.fn(),
  recordLeaseFinancialEntry: vi.fn(),
}));
vi.mock("@/features/print", () => ({ printLeaseContract: vi.fn(), printSaleContract: vi.fn() }));

let host: HTMLDivElement, root: Root;
let customizeData: (value: WorkspaceData) => void;
function data(
  mode: WorkspaceMode = "list",
  query: WorkspaceQuery = parseWorkspaceQuery({ projectId: workspaceProject }),
) {
  const value = workspaceFixture({ scopeCount: 1, total: 1 }, query, mode);
  value.today = "2026-10-20";
  value.contracts[0] = {
    ...value.contracts[0],
    paid_through_date: "2026-09-30",
    monthly_rent_xof: 600000,
  } as (typeof value.contracts)[number];
  value.summaries[workspaceContract] = {
    total: 600000,
    paid: 600000,
    outstanding: 0,
    overdue: 0,
    nextDue: null,
    count: 1,
    dueOutstanding: 0,
  };
  value.accruals[workspaceContract] = null;
  value.attentionDue[workspaceContract] = "2026-10-01";
  value.stats = {
    ...value.stats,
    active: 1,
    scopeCount: 1,
    currentDue: 0,
    outstanding: 0,
    overdue: 0,
    overdueContracts: 0,
    dueSoon: 0,
  };
  customizeData?.(value);
  return value;
}
beforeEach(() => {
  customizeData = () => undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://test.invalid");
      const mode = url.searchParams.get("mode") as WorkspaceMode;
      const roomOverview = url.searchParams.has("roomOverview");
      url.searchParams.delete("mode");
      url.searchParams.delete("roomOverview");
      const value = data(mode, parseWorkspaceQuery(Object.fromEntries(url.searchParams)));
      if (roomOverview) value.roomReceivables ??= [];
      return Response.json(value);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(value = data()) {
  await act(async () =>
    root.render(
      <LeaseList
        {...value}
        contracts={value.contracts as LeaseContractRow[]}
        workspace={value}
        initialProject={workspaceProject}
        locale="zh"
        canCreate={false}
        canRecordFinance={false}
        canActivate={false}
        canMoveOut={false}
      />,
    ),
  );
}
async function click(button: Element | undefined) {
  expect(button).toBeTruthy();
  await act(async () => {
    (button as HTMLButtonElement).click();
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
  });
}
it("keeps settled stale coverage as reachable verification work, without another payable or negative upcoming days", async () => {
  await render();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("roomOverview=1");
  expect(host.querySelector("[data-room-id]")?.textContent).toContain("缴费待核");
  await click(
    [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("收款跟进"),
    ),
  );
  const followup = host.querySelector('[aria-label="集中收款跟进"]');
  expect(followup).not.toBeNull();
  expect(followup?.textContent).toContain("缴费待核");
  expect(followup?.textContent).toContain("金额待核");
  expect(followup?.textContent).toContain("查看资料核对");
  expect(host.querySelector("[data-room-id]")?.textContent).toContain("2026-09-30");
  expect(followup?.textContent).not.toContain("-19天后应缴");
  expect(followup?.textContent).not.toMatch(/600,000 XOF|60\s*万西法/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not include the fully settled stale coverage in upcoming collectible reminders", async () => {
  await render();
  await click(
    [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("15天内应缴"),
    ),
  );
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(0);
  await click(
    [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("收款跟进"),
    ),
  );
  const followup = host.querySelector('[aria-label="集中收款跟进"]')!;
  expect(followup.querySelectorAll("[data-followup-record-id]")).toHaveLength(1);
  expect(followup.textContent).toContain("缴费待核");
  expect(followup.textContent).not.toContain("天内应缴");
  expect(followup.textContent).not.toMatch(/600,000 XOF|60\s*万西法/);
});

function currentPaidThrough(value: WorkspaceData, paidThrough: string) {
  Object.assign(value.contracts[0], {
    paid_through_date: paidThrough,
    commencement_state: "started",
  });
  const previousPaidBill = {
    id: "77777777-7777-4777-8777-777777777777",
    source_type: "lease_contract",
    source_id: workspaceContract,
    unit_id: workspaceUnit,
    building_id: workspaceBuilding,
    customer_id: workspaceCustomer,
    category: "lease_rent",
    currency: "XOF",
    amount_xof: 600000,
    paid_amount_xof: 600000,
    amount_native: null,
    paid_amount_native: null,
    due_date: "2026-09-01",
    status: "paid",
    management_status: "managed",
    service_period_start: null,
    service_period_end: null,
    title: "Synthetic settled previous rent",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  } as ReceivableRow;
  if (value.mode === "context") value.roomReceivables = [previousPaidBill];
  if (value.mode === "detail") {
    value.receivables = [previousPaidBill];
    value.receivableCount = 1;
  }
  return previousPaidBill;
}

it("shows a paid-through reminder on the room and collection follow-up when only settled old bills exist", async () => {
  customizeData = (value) => currentPaidThrough(value, "2026-10-31");
  await render(data());
  const card = host.querySelector("[data-room-id]");
  expect(card, host.textContent ?? "").not.toBeNull();
  expect(card?.textContent).toContain("2026-10-31");
  expect(card?.textContent).toContain("11天后缴租到期");
  expect(card?.textContent).not.toContain("应缴");

  await click(
    [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("收款跟进"),
    ),
  );
  const followup = host.querySelector('[aria-label="集中收款跟进"]')!;
  expect(followup.querySelectorAll("[data-followup-record-id]")).toHaveLength(1);
  expect(followup.textContent).toContain("11天后缴租到期");
  expect(followup.textContent).toContain("下期账单待核");
  expect(followup.textContent).toContain("2026-10-31");
  expect(followup.textContent).not.toContain("应缴");
  expect(followup.textContent).not.toMatch(/600,000|60\.00\s*万|0\.00\s*万|0\s*XOF/);
});

it("does not include a paid-through date 16 days away in the upcoming collection filter", async () => {
  customizeData = (value) => currentPaidThrough(value, "2026-11-05");
  await render(data());
  expect(host.querySelector("[data-room-id]"), host.textContent ?? "").not.toBeNull();
  expect(host.querySelector("[data-room-id]")?.textContent).toContain("2026-11-05");
  expect(host.querySelector("[data-room-id]")?.textContent).not.toContain("缴租到期");
  await click(
    [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("15天内应缴"),
    ),
  );
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(0);
  await click(
    [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("收款跟进"),
    ),
  );
  expect(host.querySelectorAll("[data-followup-record-id]")).toHaveLength(0);
});

it("uses the same apartment countdown with a real bill while retaining its amount and actual payment deadline", async () => {
  customizeData = (value) => {
    const previousPaidBill = currentPaidThrough(value, "2026-10-31");
    const upcomingBill = {
      ...previousPaidBill,
      id: "88888888-8888-4888-8888-888888888888",
      due_date: "2026-11-01",
      paid_amount_xof: 0,
      status: "pending",
      title: "Synthetic actual next rent bill",
    } as ReceivableRow;
    value.summaries[workspaceContract] = {
      total: 1200000,
      paid: 600000,
      outstanding: 600000,
      overdue: 0,
      nextDue: "2026-11-01",
      count: 2,
      dueOutstanding: 0,
    };
    value.attentionDue[workspaceContract] = "2026-11-01";
    Object.assign(value.stats, {
      total: 1200000,
      rent: 600000,
      received: 600000,
      outstanding: 600000,
      dueSoon: 1,
    });
    if (value.mode === "context") value.roomReceivables = [previousPaidBill, upcomingBill];
    if (value.mode === "detail") {
      value.receivables = [previousPaidBill, upcomingBill];
      value.receivableCount = 2;
    }
  };
  await render(data());
  const card = host.querySelector("[data-room-id]");
  expect(card, host.textContent ?? "").not.toBeNull();
  expect(card?.textContent).toContain("11天后缴租到期");
  expect(card?.textContent).not.toMatch(/12\s*天(?:内应缴|后应缴)/);

  await click(
    [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("收款跟进"),
    ),
  );
  const followup = host.querySelector('[aria-label="集中收款跟进"]')!;
  expect(followup.querySelectorAll("[data-followup-record-id]")).toHaveLength(1);
  expect(followup.textContent).toContain("11天后缴租到期");
  expect(followup.textContent).toContain("2026-11-01");
  expect(followup.textContent).toMatch(/600,000|60(?:\.00)?\s*万/);
  expect(followup.textContent).not.toContain("下期账单待核");
  expect(followup.textContent).not.toMatch(/12\s*天(?:内应缴|后应缴)/);
});
