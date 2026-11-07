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

it("shows an empty asset and source-based rental facts without requiring a contract number or attachment", async () => {
  const value = rows();
  const select = await render(value);
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(2);
  const occupied = host.querySelector(`[data-room-id='${sourceUnit.id}']`)!;
  expect(occupied.textContent).toContain("Synthetic guest");
  expect(occupied.textContent).toContain("100");
  expect(occupied.textContent).toContain("2026-12-01");
  expect(occupied.textContent).toContain("租期待核");
  expect(occupied.textContent).not.toContain("资料待补");
  const empty = host.querySelector<HTMLButtonElement>("[data-room-id='empty']")!;
  expect(empty.textContent).toContain("暂无当前租赁");
  expect(empty.textContent).toContain("可用");
  await act(async () => empty.click());
  expect(select).toHaveBeenCalledWith(value.find((row) => row.unit.id === "empty"));
  expect(host.querySelector('[aria-label="Synthetic 11 一层"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Synthetic 11 二层"]')).not.toBeNull();
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
  await act(async () => button("缴费待核").click());
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(1);
  expect(host.querySelector("[data-room-id='review']")?.textContent).toContain("缴费待核");
});

it("hides stale cards on loading or a failed read and exposes an explicit retry", async () => {
  const retry = vi.fn();
  await render(rows(), vi.fn(), { loading: true });
  expect(host.querySelectorAll("[data-room-id]")).toHaveLength(0);
  expect(host.textContent).toContain("正在读取全部房源");
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
