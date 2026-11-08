// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saleFixture } from "../../../tests/fixtures/sale-workbench";
import type { SaleContractRow } from "@/types/database";
import type { SaleRecordOverviewRow, SaleRoomOverviewRow } from "./sale-room-overview-model";
import { SaleRoomOverview } from "./sale-room-overview";

const fixture = saleFixture(undefined, "detail", 1);
const current: SaleRecordOverviewRow = {
  id: "current",
  contract: { ...fixture.contracts[0], id: "current" } as SaleContractRow,
  unit: { ...fixture.units[0], floor_label: "一层" },
  building: fixture.buildings[0],
  customer: { ...fixture.customers[0], name: "Current buyer" },
  historical: false,
  conflict: false,
  reviewReasons: [],
  priceXof: 1000000,
  receivedNative: [
    { currency: "USD", amount: 10 },
    { currency: "CNY", amount: 20 },
  ],
  outstandingNative: [{ currency: "XOF", amount: 900 }],
  nextDue: "2026-11-12",
  attention: {
    kind: "upcoming",
    dueDate: "2026-11-12",
    days: 5,
    amounts: [{ currency: "XOF", amount: 100 }],
  },
};
const old: SaleRecordOverviewRow = {
  ...current,
  id: "old",
  contract: { ...current.contract, id: "old", status: "terminated", signed_date: "2025-01-01" },
  customer: { ...current.customer!, id: "old-customer", name: "Old buyer" },
  historical: true,
  receivedNative: [],
  outstandingNative: [{ currency: "USD", amount: 40 }],
  attention: {
    kind: "overdue",
    dueDate: "2025-12-01",
    days: -341,
    amounts: [{ currency: "USD", amount: 40 }],
  },
};
const cleared = {
  ...old,
  id: "cleared",
  contract: { ...old.contract, id: "cleared", signed_date: "2024-01-01" },
  attention: null,
};
const room: SaleRoomOverviewRow = {
  unit: current.unit,
  building: current.building,
  record: current,
  records: [current, old, cleared],
  conflict: false,
  reviewReasons: [],
};
const empty: SaleRoomOverviewRow = {
  ...room,
  unit: { ...room.unit, id: "empty", unit_no: "201", floor_label: "二层", status: "available" },
  record: null,
  records: [],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(
  rows = [room, empty],
  records = [current, old, cleared],
  state: {
    loading?: boolean;
    error?: boolean;
    onRetry?: () => void;
    selected?: (record: SaleRecordOverviewRow) => void;
  } = {},
) {
  const selected = state.selected ?? vi.fn();
  await act(async () =>
    root.render(
      <SaleRoomOverview
        rows={rows}
        records={records}
        locale="zh"
        loading={state.loading ?? false}
        error={state.error ?? false}
        onSelectRecord={selected}
        onRetry={state.onRetry ?? vi.fn()}
      />,
    ),
  );
  return selected;
}
function button(text: string) {
  const value = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.startsWith(text),
  );
  expect(value).toBeTruthy();
  return value!;
}

it("keeps current cards separate from historical balances and opens the exact old record", async () => {
  const selected = await render();
  expect(host.querySelectorAll("[data-sale-room-id]")).toHaveLength(1);
  const card = host.querySelector("[data-sale-room-id]")!;
  expect(card.textContent).toContain("Current buyer");
  expect(card.textContent).not.toContain("Old buyer");
  expect(card.textContent).toContain("10 USD");
  expect(card.textContent).toContain("20 CNY");
  expect(card.textContent).toContain("2026-11-12");
  expect(card.textContent).not.toContain("月租");
  expect(button("全部出售").textContent).toContain("1");
  await act(async () => button("已逾期").click());
  expect(host.querySelectorAll("[data-sale-room-id]")).toHaveLength(0);
  await act(async () => button("出售款跟进").click());
  const followup = host.querySelector('[aria-label="集中出售款跟进"]')!;
  expect(followup.querySelectorAll("[data-sale-followup-record-id]")).toHaveLength(2);
  expect(followup.querySelector("[data-sale-followup-record-id='old']")?.textContent).toContain(
    "40 USD",
  );
  expect(followup.querySelector("[data-sale-followup-record-id='old']")?.textContent).toContain(
    "2025-12-01",
  );
  await act(async () =>
    followup.querySelector<HTMLButtonElement>("[data-sale-followup-record-id='old']")!.click(),
  );
  expect(selected).toHaveBeenLastCalledWith(old);
  await act(async () => button("查看历史").click());
  const history = host.querySelector('[aria-label="出售记录查询"]')!;
  expect(history.querySelectorAll("[data-sale-history-record-id]")).toHaveLength(2);
  const search = history.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "2024-01-01",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(history.querySelectorAll("[data-sale-history-record-id]")).toHaveLength(1);
  await act(async () =>
    history.querySelector<HTMLButtonElement>("[data-sale-history-record-id='cleared']")!.click(),
  );
  expect(selected).toHaveBeenLastCalledWith(cleared);
});

it("uses one conflict card and requires an explicit record choice without inventing missing receipts", async () => {
  const second = {
    ...current,
    id: "second",
    contract: { ...current.contract, id: "second" },
    customer: { ...current.customer!, name: "Another buyer" },
    conflict: true,
  };
  const conflicted = {
    ...room,
    record: null,
    records: [{ ...current, conflict: true }, second],
    conflict: true,
  };
  const selected = await render([conflicted], conflicted.records);
  const card = host.querySelector<HTMLButtonElement>("[data-sale-room-id]")!;
  expect(host.querySelectorAll("[data-sale-room-id]")).toHaveLength(1);
  expect(card.textContent).toContain("多条出售记录待核");
  expect(card.textContent).toContain("按记录核对");
  expect(card.textContent).not.toContain("未有已核实收");
  await act(async () => card.click());
  expect(selected).not.toHaveBeenCalled();
  expect(host.querySelectorAll("[data-sale-conflict-record-id]")).toHaveLength(2);
  await act(async () =>
    host.querySelector<HTMLButtonElement>("[data-sale-conflict-record-id='second']")!.click(),
  );
  expect(selected).toHaveBeenCalledWith(second);
});

it("hides all stale cards and record lists while the full scoped context is loading or unavailable", async () => {
  await render();
  await act(async () => button("出售款跟进").click());
  await render(undefined, undefined, { loading: true });
  expect(host.querySelectorAll("[data-sale-room-id], [data-sale-followup-record-id]")).toHaveLength(
    0,
  );
  const retry = vi.fn();
  await render(undefined, undefined, { error: true, onRetry: retry });
  expect(host.textContent).not.toContain("Current buyer");
  expect(host.textContent).not.toContain("USD");
  await act(async () => button("重试").click());
  expect(retry).toHaveBeenCalledOnce();
});

it("keeps missing price and bill coverage reviewable without inventing a settled balance or collection work", async () => {
  const unverified = {
    ...current,
    priceXof: null,
    receivedNative: [],
    outstandingNative: null,
    attention: null,
    nextDue: null,
    reviewReasons: ["price_requires_review"],
  };
  await render([{ ...room, record: unverified, records: [unverified] }], [unverified]);
  expect(button("待核事项").textContent).toContain("1");
  await act(async () => button("待核事项").click());
  expect(host.querySelectorAll("[data-sale-room-id]")).toHaveLength(1);
  expect(host.querySelector("[data-sale-room-id]")?.textContent).not.toContain("已建应收已结清");
  expect(host.querySelector("[data-sale-room-id]")?.textContent).toContain("未有已核实收");
  await act(async () => button("出售款跟进").click());
  expect(host.querySelectorAll("[data-sale-followup-record-id]")).toHaveLength(0);
});

it("shows a source registration's native price, receipts and explicit source balance without a paper signing date or XOF placeholder", async () => {
  const source: SaleRecordOverviewRow = {
    ...current,
    contract: {
      ...current.contract,
      registration_basis: "source_record",
      source_reference: "workbook!H5",
      signed_date: null,
      sale_currency: "CNY",
      total_amount_native: 720000,
      total_amount_xof: 0,
    },
    priceXof: null,
    priceNative: { currency: "CNY", amount: 720000 },
    receivedNative: [{ currency: "CNY", amount: 720000 }],
    registeredBalance: { currency: "CNY", amount: 0, sourceRef: "workbook!K5" },
    outstandingNative: null,
    attention: null,
    nextDue: null,
  };
  await render([{ ...room, record: source, records: [source] }], [source]);
  const card = host.querySelector("[data-sale-room-id]")!;
  expect(card.textContent).toContain("初始登记");
  expect(card.textContent).toContain("720,000 CNY");
  expect(card.textContent).toContain("登记余款（Excel）");
  expect(card.textContent).toContain("0 CNY");
  expect(card.textContent).not.toContain("0 XOF");
  expect(card.textContent).not.toContain("已建应收已结清");
});
