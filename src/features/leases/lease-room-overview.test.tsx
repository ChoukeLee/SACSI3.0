// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";
import type { WorkspaceUnit } from "@/features/contracts/workspace-model";
import { workspaceFixture } from "../../../tests/fixtures/contract-workspace";
import { buildLeaseRoomOverview, type LeaseRoomOverviewRow } from "./lease-room-overview-model";
import { LeaseRoomOverview, leaseRoomFloorLabel } from "./lease-room-overview";

let host: HTMLDivElement;
let root: Root;
const fixture = workspaceFixture();
const record = fixture.contracts[0] as LeaseContractRow;
const sourceUnit = fixture.units[0];
const rows = (): LeaseRoomOverviewRow[] =>
  buildLeaseRoomOverview({
    units: [
      { ...sourceUnit, floor_label: "一层", occupancy_verified: true },
      {
        ...sourceUnit,
        id: "empty",
        unit_no: "201",
        floor_label: "二层",
        status: "available",
        occupancy_verified: true,
      },
    ],
    contracts: [
      {
        ...record,
        contract_no: "",
        attachment_url: null,
        expected_end_date: "2026-01-31",
        paid_through_date: "2026-12-01",
      },
    ],
    customers: fixture.customers,
    buildings: fixture.buildings,
    today: "2026-11-07",
    receivables: [
      {
        id: "paid-bill",
        source_type: "lease_contract",
        source_id: record.id,
        unit_id: sourceUnit.id,
        building_id: sourceUnit.building_id,
        customer_id: record.customer_id,
        category: "lease_rent",
        currency: "XOF",
        amount_xof: 100,
        paid_amount_xof: 100,
        amount_native: null,
        paid_amount_native: null,
        due_date: "2026-10-01",
        status: "paid",
        management_status: "managed",
      } as ReceivableRow,
    ],
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(
  value: LeaseRoomOverviewRow[],
  onSelect = vi.fn(),
  state: { loading?: boolean; error?: boolean; onRetry?: () => void } = {},
) {
  await act(async () =>
    root.render(
      <LeaseRoomOverview
        rows={value}
        locale="zh"
        loading={state.loading ?? false}
        error={state.error ?? false}
        onSelectUnit={onSelect}
        onRetry={state.onRetry ?? vi.fn()}
      />,
    ),
  );
  return onSelect;
}
function button(text: string) {
  const match = [...host.querySelectorAll("button")].find((element) =>
    element.textContent?.startsWith(text),
  );
  expect(match).toBeDefined();
  return match!;
}

it("shows source-based rental facts without requiring paperwork and leaves rooms without a current rental out", async () => {
  const value = rows();
  const select = await render(value);
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(1);
  const occupied = host.querySelector<HTMLButtonElement>(`[data-room-id='${sourceUnit.id}']`)!;
  expect(occupied.textContent).toContain("Synthetic guest");
  expect(occupied.textContent).toContain("100");
  expect(occupied.textContent).toContain("2026-12-01");
  expect(occupied.textContent).toContain("租期待核");
  expect(occupied.textContent).not.toContain("资料待补");
  expect(host.querySelector("[data-room-id='empty']")).toBeNull();
  await act(async () => occupied.click());
  expect(select).toHaveBeenCalledWith(value.find((row) => row.unit.id === sourceUnit.id));
  expect(host.querySelector('[aria-label="Synthetic 11 一层"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Synthetic 11 二层"]')).toBeNull();
});

it("keeps conflicting rental records in one asset card instead of picking a tenant or duplicating a room", async () => {
  const value = buildLeaseRoomOverview({
    units: [sourceUnit],
    contracts: [record, { ...record, id: "second-record" }],
    customers: fixture.customers,
    buildings: fixture.buildings,
    today: "2026-11-07",
    receivables: [],
  });
  const select = await render(value);
  const card = host.querySelector<HTMLButtonElement>("[data-room-id]")!;
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(1);
  expect(card.textContent).toContain("多条租赁记录待核");
  expect(card.textContent).not.toContain("Synthetic guest");
  expect(card.textContent).not.toContain("已逾期");
  await act(async () => card.click());
  expect(select.mock.calls[0][0].conflict).toBe(true);
});

it("uses one rental scope for cards, counts, search and follow-up while retaining drafts, future rentals and inconsistent ended records", async () => {
  const unit = (id: string, unit_no: string, status = "leased"): WorkspaceUnit =>
    ({
      ...sourceUnit,
      id,
      unit_no,
      status,
    }) as WorkspaceUnit;
  const rental = (id: string, unit_id: string, extra: Partial<LeaseContractRow> = {}) => ({
    ...record,
    id,
    unit_id,
    paid_through_date: null,
    ...extra,
  });
  const value = buildLeaseRoomOverview({
    units: [
      sourceUnit,
      unit("draft", "102"),
      unit("future", "103"),
      unit("history", "104"),
      unit("reserved", "105", "reserved"),
      unit("unknown", "106"),
      unit("ended", "107"),
      rows()[1].unit,
    ],
    contracts: [
      record,
      rental("draft-record", "draft", { status: "draft", start_date: "2026-12-01" }),
      rental("future-record", "future", { start_date: "2026-12-01" }),
      rental("history-record", "history", { status: "terminated", actual_end_date: "2026-10-01" }),
      rental("ended-record", "ended", { actual_end_date: "2026-10-31" }),
    ],
    customers: fixture.customers,
    buildings: fixture.buildings,
    today: "2026-11-07",
    receivables: [],
  });
  const select = await render(value);
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(4);
  expect(button("全部租赁").textContent).toBe("全部租赁4");
  expect(button("待核事项").textContent).toBe("待核事项4");
  expect(
    [...host.querySelectorAll("button")].some((element) =>
      element.textContent?.includes("可用房源"),
    ),
  ).toBe(false);
  expect(host.querySelector("[data-room-id='draft']")?.textContent).toContain("待起租");
  expect(host.querySelector("[data-room-id='future']")?.textContent).toContain("待起租");
  for (const id of ["history", "reserved", "unknown", "empty"])
    expect(host.querySelector(`[data-room-id='${id}']`)).toBeNull();
  const ended = host.querySelector<HTMLButtonElement>("[data-room-id='ended']")!;
  expect(ended.textContent).toContain("租赁待核");
  expect(ended.textContent).not.toMatch(/在租|已逾期/);
  await act(async () => ended.click());
  expect(select).toHaveBeenCalledWith(value.find((row) => row.unit.id === "ended"));
  expect(select.mock.calls[0][0].records[0].id).toBe("ended-record");
  await act(async () => button("收款跟进").click());
  const followup = host.querySelector('[aria-label="集中收款跟进"]')!;
  expect(followup.querySelectorAll("button")).toHaveLength(4);
  const endedFollowup = [...followup.querySelectorAll("button")].find((element) =>
    element.textContent?.includes("107"),
  )!;
  expect(endedFollowup.textContent).toContain("租赁资料待核");
  expect(endedFollowup.textContent).not.toMatch(/XOF|金额待核|已逾期/);

  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  const search = async (text: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await search("105");
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(0);
  expect(followup.querySelectorAll("button")).toHaveLength(0);
  await search("103");
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(1);
  expect(followup.querySelectorAll("button")).toHaveLength(1);
  expect(host.querySelector("[data-room-id='future']")).not.toBeNull();
});

it("filters payment attention and opens a same-scope follow-up list without turning unknown coverage into debt", async () => {
  const first = rows()[0];
  const value: LeaseRoomOverviewRow[] = [
    {
      ...first,
      attention: {
        kind: "overdue",
        dueDate: "2026-11-01",
        days: -6,
        amount: 100,
        amountIsEstimated: false,
        currency: "XOF",
      },
    },
    {
      ...first,
      unit: { ...first.unit, id: "today", unit_no: "102" },
      attention: {
        kind: "upcoming",
        dueDate: "2026-11-07",
        days: 0,
        amount: 200,
        amountIsEstimated: false,
        currency: "XOF",
      },
    },
    {
      ...first,
      unit: { ...first.unit, id: "review", unit_no: "103" },
      attention: {
        kind: "coverage",
        dueDate: "2026-10-31",
        days: null,
        amount: null,
        amountIsEstimated: false,
      },
    },
    rows()[1],
    {
      ...first,
      unit: { ...first.unit, id: "multi", unit_no: "104" },
      attention: {
        kind: "overdue",
        dueDate: "2026-11-05",
        days: -2,
        amount: null,
        amountIsEstimated: false,
      },
    },
  ];
  await render(value);
  await act(async () => button("15天内应缴").click());
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(1);
  expect(host.querySelector("[data-room-id='today']")?.textContent).toContain("今日应缴");
  await act(async () => button("收款跟进").click());
  const followup = host.querySelector('[aria-label="集中收款跟进"]')!;
  expect(followup.querySelectorAll("button")).toHaveLength(4);
  expect(followup.textContent).toContain("多币种 · 查看明细");
  expect(followup.textContent).toContain("金额待核");
  const coverage = [...followup.querySelectorAll("button")].find((element) =>
    element.textContent?.includes("103"),
  );
  expect(coverage?.textContent).not.toContain("XOF");
  await act(async () => button("待核事项").click());
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(1);
  expect(host.querySelector("[data-room-id='review']")?.textContent).toContain("缴费待核");
});

it("hides stale cards on loading or a failed read and exposes an explicit retry", async () => {
  const retry = vi.fn();
  await render(rows(), vi.fn(), { loading: true });
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(0);
  expect(host.textContent).toContain("正在读取长租房源");
  await render(rows(), vi.fn(), { error: true, onRetry: retry });
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(0);
  await act(async () => button("重试").click());
  expect(retry).toHaveBeenCalledTimes(1);
});

it("retains named floors and marks genuinely unknown floor labels explicitly", () => {
  expect(leaseRoomFloorLabel({ ...sourceUnit, floor_label: "一层" }, "zh")).toBe("一层");
  expect(leaseRoomFloorLabel({ ...sourceUnit, floor_label: "B1" }, "zh")).toBe("B1");
  expect(
    leaseRoomFloorLabel(
      { ...sourceUnit, floor_label: "", unit_no: "OFFICE" } as WorkspaceUnit,
      "zh",
    ),
  ).toBe("楼层待登记");
  expect(
    leaseRoomFloorLabel(
      { ...sourceUnit, floor_label: "", unit_no: "OFFICE" } as WorkspaceUnit,
      "fr",
    ),
  ).toBe("Étage à renseigner");
});
