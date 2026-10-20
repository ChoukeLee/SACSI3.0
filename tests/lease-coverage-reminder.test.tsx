// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LeaseList } from "@/features/leases/lease-list";
import {
  parseWorkspaceQuery,
  type WorkspaceMode,
  type WorkspaceQuery,
} from "@/features/contracts/workspace-model";
import type { LeaseContractRow } from "@/types/database";
import {
  workspaceContract,
  workspaceFixture,
  workspaceProject,
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
  return value;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://test.invalid");
      const mode = url.searchParams.get("mode") as WorkspaceMode;
      url.searchParams.delete("mode");
      return Response.json(data(mode, parseWorkspaceQuery(Object.fromEntries(url.searchParams))));
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
async function render() {
  const value = data();
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
  expect(fetch).not.toHaveBeenCalled();
  await click(
    [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("覆盖核对")),
  );
  const drawer = document.querySelector('[role="dialog"]');
  expect(drawer).not.toBeNull();
  expect(drawer?.textContent).toContain("覆盖待确认 · 非欠款判定");
  expect(drawer?.textContent).toContain("金额不推算");
  expect(drawer?.textContent).toContain("登记覆盖至");
  expect(drawer?.textContent).not.toContain("-19天后应缴");
  expect(drawer?.textContent).not.toContain("600,000 XOF");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not include the fully settled stale coverage in upcoming collectible reminders", async () => {
  await render();
  await click(
    [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("覆盖核对")),
  );
  const drawer = document.querySelector('[role="dialog"]')!;
  await click(
    [...drawer.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("15天内应缴"),
    ),
  );
  expect(drawer.textContent).toContain("当前没有需要跟进的合同");
  expect(drawer.textContent).not.toContain("600,000 XOF");
});
