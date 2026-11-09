// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saleFixture } from "../../../tests/fixtures/sale-workbench";
import type { SaleContractRow } from "@/types/database";
import type { SaleRecordOverviewRow, SaleRoomOverviewRow } from "./sale-room-overview-model";
import { SaleRoomOverview } from "./sale-room-overview";
import styles from "./sale-room-overview.module.css";

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
const cleared: SaleRecordOverviewRow = {
  ...old,
  id: "cleared",
  contract: { ...old.contract, id: "cleared", signed_date: "2024-01-01" },
  attention: null,
  outstandingNative: [],
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
    search?: string;
    onSearchChange?: (value: string) => void;
    recordStatus?: string;
    initialRecordsOpen?: boolean;
    onBrowseChange?: () => void;
    locale?: "zh" | "fr";
  } = {},
) {
  const selected = state.selected ?? vi.fn();
  await act(async () =>
    root.render(
      <SaleRoomOverview
        rows={rows}
        records={records}
        locale={state.locale ?? "zh"}
        loading={state.loading ?? false}
        error={state.error ?? false}
        onSelectRecord={selected}
        onRetry={state.onRetry ?? vi.fn()}
        search={state.search}
        onSearchChange={state.onSearchChange}
        recordStatus={state.recordStatus}
        initialRecordsOpen={state.initialRecordsOpen}
        onBrowseChange={state.onBrowseChange}
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
function fact(card: Element, label: string) {
  return [...card.querySelectorAll("span")].find((item) => item.textContent === label)
    ?.nextElementSibling?.textContent;
}

it("keeps current cards separate from historical balances and opens the exact old record", async () => {
  const selected = await render();
  expect(host.querySelectorAll("[data-sale-room-id]")).toHaveLength(1);
  const card = host.querySelector("[data-sale-room-id]")!;
  expect(card.textContent).toContain("Current buyer");
  expect(card.textContent).not.toContain("Old buyer");
  expect(card.textContent).toContain("10 USD");
  expect(card.textContent).toContain("20 CNY");
  expect(card.textContent).not.toContain("2026-11-12");
  expect(card.textContent).toContain("15天内应付");
  expect(fact(card, "未收")).toBe("0.09 万西法（账单）");
  expect(card.textContent).not.toContain("过户");
  expect(card.textContent).not.toContain("下一到期");
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
  await act(async () => button("出售记录").click());
  const history = host.querySelector('[aria-label="出售记录查询"]')!;
  expect(history.querySelectorAll("[data-sale-history-record-id]")).toHaveLength(3);
  const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
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

it("uses one visible search for room cards, history and collection follow-up", async () => {
  const browse = vi.fn();
  await render(undefined, undefined, { search: "Old buyer", onBrowseChange: browse });
  expect(host.querySelectorAll('input[type="search"]')).toHaveLength(1);
  expect(host.querySelectorAll("[data-sale-room-id]")).toHaveLength(0);
  await act(async () => button("查看 2 条匹配的历史记录").click());
  expect(browse).toHaveBeenCalledOnce();
  const records = host.querySelector('[aria-label="出售记录查询"]')!;
  expect(records.querySelectorAll("[data-sale-history-record-id]")).toHaveLength(2);
  expect(records.textContent).toContain("登记价");
  expect(records.textContent).toContain("40 USD");
  expect(records.textContent).toContain("已建应收已结清");
  await act(async () => button("出售款跟进").click());
  expect(host.querySelectorAll("[data-sale-followup-record-id]")).toHaveLength(1);
  expect(host.querySelector('[data-sale-followup-record-id="old"]')).toBeTruthy();
});

it("shows draft and status deep links in the same record query without a second search", async () => {
  const draft: SaleRecordOverviewRow = {
    ...current,
    id: "draft",
    contract: { ...current.contract, id: "draft", contract_no: "DRAFT-321", status: "draft" },
    customer: { ...current.customer!, name: "Draft buyer" },
  };
  const changed = vi.fn(),
    browse = vi.fn();
  await render([{ ...room, record: draft, records: [draft] }], [current, draft, old], {
    recordStatus: "draft",
    initialRecordsOpen: true,
    onSearchChange: changed,
    onBrowseChange: browse,
  });
  const records = host.querySelector('[aria-label="出售记录查询"]')!;
  expect(records.querySelector("select")?.value).toBe("draft");
  expect(records.querySelectorAll("[data-sale-history-record-id]")).toHaveLength(1);
  expect(records.textContent).toContain("Draft buyer");
  expect(host.querySelectorAll('input[type="search"]')).toHaveLength(1);
  const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "DRAFT-321",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(changed).toHaveBeenCalledWith("DRAFT-321");
  expect(browse).toHaveBeenCalledOnce();
  expect(host.querySelectorAll("[data-sale-room-id]")).toHaveLength(1);
  expect(records.querySelectorAll("[data-sale-history-record-id]")).toHaveLength(1);
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
  expect(fact(host.querySelector("[data-sale-room-id]")!, "已收")).toBe("待核");
  expect(fact(host.querySelector("[data-sale-room-id]")!, "未收")).toBe("待核");
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
  expect(card.textContent).not.toContain("初始登记");
  expect(card.textContent).toContain("720,000 CNY");
  expect(fact(card, "未收")).toContain("0 CNY（登记）");
  expect(card.textContent).toContain("0 CNY");
  expect(card.textContent).not.toMatch(/(?<![\d.,])0\s万西法/);
  expect(card.textContent).not.toContain("已建应收已结清");
  expect(card.querySelector("strong[title]")?.getAttribute("title")).toContain("workbook!K5");
  await act(async () => button("出售记录").click());
  expect(host.querySelector("[data-sale-history-record-id]")?.textContent).toContain("初始登记");
});

it.each([
  { kind: "overdue" as const, label: "已逾期", filter: "已逾期", className: styles.overdueCard },
  { kind: "review" as const, label: "待核", filter: "待核事项", className: styles.reviewCard },
])(
  "retains one visible $label warning on the compact card",
  async ({ kind, label, filter, className }) => {
    const flagged: SaleRecordOverviewRow = {
      ...current,
      attention: {
        kind,
        dueDate: "2026-11-01",
        days: -1,
        amounts: [{ currency: "XOF", amount: 100 }],
      },
    };
    await render([{ ...room, record: flagged, records: [flagged] }], [flagged]);
    await act(async () => button(filter).click());
    const cards = host.querySelectorAll("[data-sale-room-id]");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent?.split(label)).toHaveLength(2);
    expect(cards[0].classList.contains(className)).toBe(true);
    expect(cards[0].textContent).not.toContain("2026-11-01");
    expect(fact(cards[0], "未收")).toBe("0.09 万西法（账单）");
  },
);

it.each(["zh", "fr"] as const)(
  "keeps four readable financial fields and a simple detail footer without transfer or next-date rows (%s)",
  async (locale) => {
    const normal: SaleRecordOverviewRow = {
      ...current,
      attention: null,
      nextDue: "2031-12-31",
      outstandingNative: [],
      contract: { ...current.contract, transfer_status: "completed", transfer_date: "2032-11-30" },
    };
    const selected = await render([{ ...room, record: normal, records: [normal] }], [normal], {
      locale,
      initialRecordsOpen: true,
    });
    const card = host.querySelector<HTMLButtonElement>("[data-sale-room-id]")!;
    for (const label of locale === "zh"
      ? ["买方", "总价", "已收", "未收"]
      : ["Acquéreur", "Prix enregistré", "Encaissé", "Restant"])
      expect(fact(card, label)).toBeTruthy();
    expect(fact(card, locale === "zh" ? "未收" : "Restant")).toBe(
      locale === "zh" ? "账单结清" : "Factures soldées",
    );
    expect(card.textContent).toContain(locale === "zh" ? "查看详情" : "Voir les détails");
    expect(card.textContent).not.toMatch(
      /过户|Transf|下一到期|Prochaine échéance|2031-12-31|2032-11-30/,
    );
    expect(host.querySelector("[data-sale-history-record-id]")).toBeTruthy();
    expect(host.querySelector("[data-sale-history-record-id]")?.textContent).not.toMatch(
      /过户|Transf|2032-11-30/,
    );
    await act(async () => card.click());
    expect(selected).toHaveBeenCalledWith(normal);
    await render([{ ...room, record: normal, records: [normal] }], [normal], {
      locale,
      search: "2032-11-30",
      initialRecordsOpen: true,
    });
    expect(host.querySelector("[data-sale-room-id]")).toBeNull();
    expect(host.querySelector("[data-sale-history-record-id]")).toBeNull();
  },
);
