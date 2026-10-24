// @vitest-environment jsdom
import React, { act } from "react";
import { webcrypto } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CimacCustomerWorkbench,
  type CimacCustomerWorkbenchProps,
} from "@/features/finance/cimac-customer-workbench";
import {
  billingMinor,
  billingMinorString,
  billingNumber,
} from "@/features/finance/cimac-billing-display";
import type {
  CimacAccountReceivable,
  CimacAccountUnit,
  CimacBillingWriteResult,
  CimacCustomerAccount,
  CimacFeeTerm,
} from "@/features/finance/cimac-billing-types";

const actions = vi.hoisted(() => ({
  collection: vi.fn(),
  terms: vi.fn(),
  meter: vi.fn(),
  receipt: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/finance/cimac-billing-actions", () => ({
  recordCimacCollection: actions.collection,
  saveCimacFeeTerms: actions.terms,
  saveCimacMeterReading: actions.meter,
  readCimacWriteReceipt: actions.receipt,
  readCimacCollectionPosition: vi.fn(),
  recordCimacRefund: vi.fn(),
  reverseCimacCollection: vi.fn(),
}));

const customerId = "10000000-0000-4000-8000-000000000001";
const viewerId = "20000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const contractId = "40000000-0000-4000-8000-000000000001";
const updatedAt = "2026-10-24T10:00:00Z";
function unit(id: string, kind: CimacAccountUnit["kind"], unitNo: string): CimacAccountUnit {
  return {
    id,
    kind,
    unit_no: unitNo,
    code: unitNo,
    building_id: projectId,
    floor_label: "1F",
    status: "available",
    area_sqm: 173,
    layout: null,
    furnishing: null,
    notes: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    building_code: "B1",
    building_label: "B1",
  };
}
const shop = unit("50000000-0000-4000-8000-000000000001", "storefront", "S-101");
const apartment = unit("50000000-0000-4000-8000-000000000002", "apartment", "A-201");
const warehouse = unit("50000000-0000-4000-8000-000000000003", "warehouse", "W-03");
function bill(index: number, patch: Partial<CimacAccountReceivable> = {}): CimacAccountReceivable {
  return {
    id: `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    building_id: projectId,
    unit_id: shop.id,
    customer_id: customerId,
    source_type: "lease_contract",
    source_id: contractId,
    category: "property_fee",
    title: `Bill ${index}`,
    due_date: "2026-10-01",
    amount_xof: 1000,
    paid_amount_xof: 0,
    currency: "XOF",
    status: "pending",
    management_status: "managed",
    outstanding: "1000",
    collectible: true,
    service_period_start: null,
    service_period_end: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    ...patch,
  };
}
function account(): CimacCustomerAccount {
  const customer = {
    id: customerId,
    name: "海岸商贸",
    phone: null,
    unitCount: 3,
    contractCount: 3,
    pendingCount: 2,
    balances: [
      {
        currency: "XOF" as const,
        receivable: "987654",
        paid: "1200",
        outstanding: "986454",
        overdue: "0",
      },
      {
        currency: "USD" as const,
        receivable: "250.5",
        paid: "10",
        outstanding: "240.5",
        overdue: "0",
      },
    ],
  };
  const contract = (id: string, unitId: string, native = false) => ({
    kind: "lease" as const,
    id,
    unitId,
    customerId,
    contractNo: `L-${unitId.slice(-2)}`,
    status: "active",
    data: {
      id,
      unit_id: unitId,
      customer_id: customerId,
      contract_no: `L-${unitId.slice(-2)}`,
      start_date: "2026-01-01",
      expected_end_date: "2029-03-31",
      actual_end_date: null,
      payment_cycle: "annual",
      payment_day: 1,
      monthly_rent_xof: native ? 0 : 1000,
      rent_currency: native ? ("USD" as const) : ("XOF" as const),
      monthly_rent_amount: native ? 250.5 : null,
      deposit_amount_xof: 0,
      deposit_received: false,
      rent_free_days: 0,
      signer_name: null,
      attachment_url: null,
      status: "active" as const,
      created_at: updatedAt,
      updated_at: updatedAt,
    },
  });
  return {
    project: { id: projectId, code: "CIMAC", display_name: "CIMAC" },
    canWrite: true,
    complete: true,
    customerPage: { rows: [customer], total: 1, page: 1, pageSize: 50 },
    selectedCustomerId: customerId,
    customer,
    units: [shop, apartment, warehouse],
    contracts: [
      contract(contractId, shop.id),
      contract("40000000-0000-4000-8000-000000000002", apartment.id, true),
      contract("40000000-0000-4000-8000-000000000003", warehouse.id),
    ],
    receivables: [
      bill(1),
      bill(2, {
        unit_id: warehouse.id,
        source_id: "40000000-0000-4000-8000-000000000003",
        category: "lease_rent",
        amount_xof: 2000,
        outstanding: "2000",
      }),
      bill(3, {
        unit_id: apartment.id,
        currency: "USD",
        amount_xof: 0,
        amount_native: 250.5,
        paid_amount_native: 10,
        outstanding: "240.5",
        collectible: false,
      }),
      bill(4, {
        management_status: "historical_pending",
        amount_xof: 777777,
        outstanding: "777777",
        collectible: false,
      }),
      bill(5, {
        category: "lease_deposit",
        amount_xof: 300,
        outstanding: "300",
        collectible: false,
      }),
    ],
    payments: [],
    allocations: [],
    feeTerms: [],
    meterReadings: [],
  };
}
function props(): CimacCustomerWorkbenchProps {
  return {
    data: account(),
    locale: "zh",
    canWrite: true,
    today: "2026-10-24",
    viewerId,
    query: { search: "", customerPage: 1, tab: "bills" },
  };
}
function proof(
  input: Record<string, unknown>,
  kind: CimacBillingWriteResult["kind"],
): CimacBillingWriteResult {
  return {
    success: true,
    status: "completed",
    kind,
    requestId: String(input.requestId),
    actorId: viewerId,
    customerId,
    entityId: "70000000-0000-4000-8000-000000000001",
    auditId: "80000000-0000-4000-8000-000000000001",
    idempotent: false,
    receiptNo: "R-001",
  };
}
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  Element.prototype.scrollIntoView = vi.fn();
  sessionStorage.clear();
  vi.clearAllMocks();
  actions.collection.mockImplementation(async (input) => proof(input, "collection"));
  actions.terms.mockImplementation(async (input) => proof(input, "fee_terms"));
  actions.meter.mockImplementation(async (input) => proof(input, "meter_reading"));
  actions.receipt.mockResolvedValue({ status: "not_found" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(patch: Partial<CimacCustomerWorkbenchProps> = {}) {
  await act(async () => root.render(<CimacCustomerWorkbench {...props()} {...patch} />));
}
function findButton(label: string) {
  const item = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  );
  if (!item) throw new Error(`Missing button ${label}`);
  return item;
}
async function click(element: Element) {
  await writeInteraction(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function writeInteraction(dispatch: () => unknown) {
  const writes = [actions.collection, actions.terms, actions.meter];
  const before = writes.map((action) => action.mock.calls.length);
  await act(async () => {
    dispatch();
  });
  await act(async () => {
    // A native WebCrypto digest may resolve after act's first queue flush.
    // Wait for the submitted action and its result, not a fixed number of ticks.
    const submitting = [...host.querySelectorAll('button[type="submit"]')].some((control) =>
      /^(?:正在核验并入账…|正在保存…|Vérification et enregistrement…|Enregistrement…)$/.test(
        control.textContent ?? "",
      ),
    );
    if (submitting)
      await vi.waitFor(() => {
        expect(writes.some((action, index) => action.mock.calls.length > before[index])).toBe(true);
      });
    await Promise.allSettled(
      writes.flatMap((action, index) =>
        action.mock.results
          .slice(before[index])
          .filter((result) => result.type === "return")
          .map((result) => result.value),
      ),
    );
  });
}
async function input(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
      "value",
    )!;
    descriptor.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
function field(label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const wrapper = Array.from(host.querySelectorAll("label")).find(
    (item) => item.querySelector("span")?.textContent === label,
  );
  const control = wrapper?.querySelector("input,select,textarea");
  if (!control) throw new Error(`Missing field ${label}`);
  return control as HTMLInputElement;
}
async function submit(form: HTMLFormElement) {
  await writeInteraction(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function openCollection() {
  await click(findButton("登记收款与分账"));
  return host.querySelector('section[aria-label="一笔收款分配到多份合同"]')!;
}
async function fillCollection(panel: Element, amount = "1000", allocation = "1000") {
  await input(field("实际收到 · XOF"), amount);
  await input(field("实际收款方式"), "cash");
  await input(panel.querySelector('input[max="1000"]') as HTMLInputElement, allocation);
}

describe("CIMAC customer-first finance workspace", () => {
  it("uses the full server customer summary, not the sum of visible bills, and separates native totals", async () => {
    await render();
    const summary = host.querySelector('[aria-label="客户账户汇总"]')!;
    expect(summary.textContent).toContain("987,654");
    expect(summary.textContent).toContain("不等于现金实收");
    expect(summary.querySelector("details")?.open).toBe(false);
    expect(summary.querySelector("details")?.textContent).toContain("250.5");
    expect(summary.querySelector('[class*="stats"]')?.textContent).not.toContain("250.5");
  });
  it("groups shops, apartments and warehouses under one customer, and filters without merging contracts", async () => {
    await render();
    expect(host.textContent).toContain("S-101");
    expect(host.textContent).toContain("A-201");
    expect(host.textContent).toContain("W-03");
    const warehouses = host.querySelector('[aria-label="客户关联物业类型"] button:nth-child(3)')!;
    await click(warehouses);
    expect(host.querySelector("tbody")?.textContent).toContain("W-03");
    expect(host.querySelector("tbody")?.textContent).not.toContain("S-101");
    await click(warehouses);
    expect(host.querySelector("tbody")?.textContent).toContain("S-101");
  });
  it("does not derive a service period from due dates or include historical balances as effective debt", async () => {
    await render();
    const rows = host.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("期间待核");
    expect(rows[3].textContent).toContain("历史待核");
    expect(rows[3].children[4].textContent).toBe("—");
    expect(rows[3].textContent).not.toContain("按到期日已逾期");
  });
  it("keeps inconsistent legacy amounts visible but labels them for review without a zero or collectible balance", async () => {
    const data = account();
    data.receivables[0] = {
      ...data.receivables[0],
      paid_amount_xof: 1200,
      outstanding: "0",
      collectible: false,
      reviewReason: "paidExceedsAmount",
    };
    await render({ data });
    const row = host.querySelector("tbody tr")!;
    expect(row.textContent).toContain("金额待核");
    expect(row.children[4].textContent).toBe("—");
    await click(host.querySelector('button[aria-label="查看账单 Bill 1"]')!);
    expect(host.querySelector('[aria-label="所选账单详情"]')?.textContent).toContain(
      "不纳入有效欠款",
    );
  });
  it("supports keyboard navigation of the four customer work views", async () => {
    await render();
    const first = host.querySelector('[role="tab"]') as HTMLButtonElement;
    first.focus();
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "规则与约定",
    );
    expect(document.activeElement?.textContent).toBe("规则与约定");
  });
  it("keeps existing operations as links and never nests the legacy page", async () => {
    await render();
    const links = Array.from(host.querySelectorAll("a")).map((link) => link.getAttribute("href"));
    expect(links).toContain(`/finance?kind=ledger&projectId=${projectId}`);
    expect(links).toContain(`/finance?kind=receivables&projectId=${projectId}`);
    expect(links).toContain("/finance?view=reconciliation");
    expect(links).toContain("/finance?kind=ledger");
    expect(host.querySelectorAll("h1")).toHaveLength(1);
  });
  it("clears selected detail on a refreshed snapshot", async () => {
    const data = account();
    await render({ data });
    await click(host.querySelector('button[aria-label="查看账单 Bill 1"]')!);
    expect(host.querySelector('[aria-label="所选账单详情"]')).not.toBeNull();
    await render({ data: { ...data, receivables: data.receivables.map((row) => ({ ...row })) } });
    expect(host.querySelector('[aria-label="所选账单详情"]')).toBeNull();
  });
  it.each([{ canWrite: false }, { data: { ...account(), canWrite: false } }])(
    "requires both permission signals for write affordances",
    async (patch) => {
      await render(patch);
      expect(host.textContent).not.toContain("登记收款与分账");
      await click(findButton("水电抄表"));
      expect(
        Array.from(host.querySelectorAll("button")).some(
          (button) => button.textContent === "登记抄表",
        ),
      ).toBe(false);
      await click(findButton("规则与约定"));
      expect(host.textContent).not.toContain("登记待核约定");
    },
  );
  it("retains locale in account and legacy links and translates the actual working views", async () => {
    await render({ locale: "fr" });
    expect(host.querySelector("h1")?.textContent).toBe("CIMAC · Comptes clients");
    expect(host.querySelector("form")?.getAttribute("action")).toBe("/fr/finance");
    expect(
      host.querySelector('[aria-label="Liste des comptes clients"] a')?.getAttribute("href"),
    ).toContain("/fr/finance?view=customers");
    expect(host.textContent).not.toContain("物业费");
    await click(findButton("Conventions"));
    expect(host.textContent).toContain("900 XOF");
    expect(host.textContent).toContain("Dénominateur");
    expect(host.textContent).not.toContain("待核");
  });
  it("preserves search on customer pagination and clears the selected customer", async () => {
    const data = account();
    data.customerPage.total = 80;
    await render({ data, query: { search: "A & B", customerPage: 1, tab: "bills" } });
    const link = host.querySelector('[aria-label="客户分页"] a') as HTMLAnchorElement;
    const url = new URL(link.href);
    expect(url.searchParams.get("search")).toBe("A & B");
    expect(url.searchParams.get("customerPage")).toBe("2");
    expect(url.searchParams.has("customerId")).toBe(false);
  });
  it("keeps an unknown XOF summary unknown rather than displaying native amounts or zero", async () => {
    const data = account();
    data.customer!.balances = data.customer!.balances.filter(
      (balance) => balance.currency !== "XOF",
    );
    await render({ data });
    const summary = host.querySelector('[aria-label="客户账户汇总"]')!;
    expect(summary.querySelector("p[class*='statValue']")?.textContent).toBe("—XOF");
  });
  it("records actual collector and recording account separately and preserves native collection links", async () => {
    const data = account();
    data.payments = [
      {
        id: "90000000-0000-4000-8000-000000000001",
        customer_id: customerId,
        unit_id: shop.id,
        source_type: "lease_contract",
        source_id: contractId,
        payment_date: "2026-10-20",
        amount: 1000,
        currency: "XOF",
        exchange_rate_to_xof: 1,
        receipt_no: "R-001",
        external_receipt_no: "Original-10",
        notes: null,
        actual_collector: "黄姐",
        collector_basis: "收据签名",
        recorded_by: viewerId,
        created_at: updatedAt,
        protected_collection: false,
      },
    ];
    await render({ data });
    await click(findButton("收款核销"));
    expect(host.textContent).toContain("实际收款人：黄姐");
    expect(host.textContent).toContain(`录入账号标识：${viewerId}`);
    expect(host.textContent).toContain("Original-10");
    expect(
      host.querySelector('a[href*="/leases/40000000-0000-4000-8000-000000000002/collect"]'),
    ).not.toBeNull();
  });
  it("does not direct a protected customer collection to unsupported single-unit corrections", async () => {
    const data = account();
    data.payments = [
      {
        id: "90000000-0000-4000-8000-000000000001",
        customer_id: customerId,
        unit_id: null,
        source_type: "cimac_customer_collection",
        source_id: customerId,
        payment_date: "2026-10-20",
        amount: 1000,
        currency: "XOF",
        exchange_rate_to_xof: 1,
        receipt_no: "CIMAC-1",
        notes: null,
        recorded_by: viewerId,
        created_at: updatedAt,
        protected_collection: true,
      },
    ];
    await render({ data });
    await click(findButton("收款核销"));
    expect(host.textContent).toContain("客户总账收款");
    expect(host.textContent).toContain("不能使用旧单房修改、退款或冲正入口");
    expect(
      Array.from(host.querySelectorAll("a")).some((link) =>
        link.textContent?.includes("流水、凭证与原处理入口"),
      ),
    ).toBe(false);
  });
});

describe("CIMAC collection safety", () => {
  it("waits across a gated real WebCrypto digest and preserves the original request on unknown retry", async () => {
    actions.collection.mockResolvedValue({ success: false, rejected: false, error: "unknown" });
    await render();
    const panel = await openCollection();
    await fillCollection(panel);
    const nativeDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
    const digestSpy = vi.spyOn(webcrypto.subtle, "digest");
    const releases: Array<() => void> = [];
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        let release!: () => void;
        let started!: () => void;
        const blocked = new Promise<void>((resolve) => {
          release = resolve;
        });
        const entered = new Promise<void>((resolve) => {
          started = resolve;
        });
        releases.push(release);
        digestSpy.mockImplementationOnce(async (...args) => {
          started();
          await blocked;
          return nativeDigest(...args);
        });
        let settled = false;
        const interaction = (
          attempt === 0
            ? submit(panel.querySelector("form")!)
            : click(findButton("按原内容同号重试"))
        ).then(() => {
          settled = true;
        });
        await entered;
        // An independent real worker completion is an event-loop boundary,
        // not a delay or a guessed number of Promise flushes. The write's
        // own digest is still gated, so its interaction cannot be finished.
        await nativeDigest("SHA-256", new TextEncoder().encode("worker-boundary"));
        expect(settled).toBe(false);
        expect(actions.collection).toHaveBeenCalledTimes(attempt);
        release();
        await interaction;
        expect(actions.collection).toHaveBeenCalledTimes(attempt + 1);
        expect(panel.querySelector("fieldset")?.disabled).toBe(true);
        expect(findButton("按原内容同号重试")).toBeDefined();
      }
      expect(actions.collection.mock.calls[1][0]).toEqual(actions.collection.mock.calls[0][0]);
      const { requestId, ...payload } = actions.collection.mock.calls[0][0];
      const stored = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
      expect(stored.requestId).toBe(requestId);
      expect(stored.fingerprint).toBe(
        Buffer.from(
          await nativeDigest("SHA-256", new TextEncoder().encode(JSON.stringify(payload))),
        ).toString("hex"),
      );
    } finally {
      releases.forEach((release) => release());
      digestSpy.mockRestore();
    }
  });
  it("offers only existing collectible XOF non-deposit bills, with blank allocations", async () => {
    await render();
    const panel = await openCollection();
    expect(panel.querySelectorAll("input[max]")).toHaveLength(3); // payment date + two existing bills
    expect(panel.textContent).not.toContain("A-201");
    expect(
      Array.from(panel.querySelectorAll('input[type="number"]')).every(
        (element) => (element as HTMLInputElement).value === "",
      ),
    ).toBe(true);
    expect(actions.collection).not.toHaveBeenCalled();
  });
  it("writes explicit allocations, snapshot guards, original currency and operator-safe collector facts", async () => {
    await render();
    const panel = await openCollection();
    await fillCollection(panel);
    await submit(panel.querySelector("form")!);
    expect(actions.collection).toHaveBeenCalledOnce();
    expect(actions.collection.mock.calls[0][0]).toMatchObject({
      customerId,
      amount: "1000",
      currency: "XOF",
      paymentDate: "2026-10-24",
      paymentMethod: "cash",
      allocations: [
        {
          receivableId: bill(1).id,
          amount: "1000",
          expectedOutstanding: "1000",
          expectedUpdatedAt: updatedAt,
        },
      ],
    });
    expect(actions.collection.mock.calls[0][0].actualCollector).toBeUndefined();
    expect(actions.collection.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(actions.refresh).toHaveBeenCalledOnce();
  });
  it.each([
    ["1200", "1200"],
    ["1000", "500"],
    ["1000.5", "1000.5"],
  ])("rejects overbalance, unmatched or fractional XOF: %s / %s", async (amount, allocation) => {
    await render();
    const panel = await openCollection();
    await fillCollection(panel, amount, allocation);
    await submit(panel.querySelector("form")!);
    expect(actions.collection).not.toHaveBeenCalled();
    expect(panel.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("requires collector and verification basis together, never silently uses the recorder", async () => {
    await render();
    const panel = await openCollection();
    await fillCollection(panel);
    await input(field("实际收款人，不知道可留空"), "黄姐");
    await submit(panel.querySelector("form")!);
    expect(actions.collection).not.toHaveBeenCalled();
    await input(field("收款人核实依据"), "收据签名");
    await submit(panel.querySelector("form")!);
    expect(actions.collection.mock.calls[0][0]).toMatchObject({
      actualCollector: "黄姐",
      collectorBasis: "收据签名",
    });
  });
  it("freezes unknown results and retries the exact original payload with the same identity", async () => {
    actions.collection.mockResolvedValue({ success: false, rejected: false, error: "unknown" });
    await render();
    const panel = await openCollection();
    await fillCollection(panel);
    await submit(panel.querySelector("form")!);
    expect(panel.querySelector("fieldset")?.disabled).toBe(true);
    const first = actions.collection.mock.calls[0][0];
    await click(findButton("按原内容同号重试"));
    expect(actions.collection).toHaveBeenCalledTimes(2);
    expect(actions.collection.mock.calls[1][0]).toEqual(first);
    expect(sessionStorage.length).toBe(1);
  });
  it("does not unlock on not_found or on a mismatching receipt", async () => {
    actions.collection.mockResolvedValue({ success: false, rejected: false, error: "unknown" });
    await render();
    const panel = await openCollection();
    await fillCollection(panel);
    await submit(panel.querySelector("form")!);
    await click(findButton("查询原操作回执"));
    expect(panel.querySelector("fieldset")?.disabled).toBe(true);
    expect(host.textContent).toContain("不代表未入账");
    actions.receipt.mockResolvedValue({
      status: "found",
      receipt: { ...proof(actions.collection.mock.calls[0][0], "collection"), actorId: customerId },
    });
    await click(findButton("查询原操作回执"));
    expect(panel.querySelector("fieldset")?.disabled).toBe(true);
    expect(sessionStorage.length).toBe(1);
  });
  it("recovers only the original actor/customer/kind/id proof and clears only its matching identity", async () => {
    actions.collection.mockResolvedValue({ success: false, rejected: false, error: "unknown" });
    await render();
    const panel = await openCollection();
    await fillCollection(panel);
    await submit(panel.querySelector("form")!);
    actions.receipt.mockResolvedValue({
      status: "found",
      receipt: proof(actions.collection.mock.calls[0][0], "collection"),
    });
    await click(findButton("查询原操作回执"));
    expect(host.textContent).toContain("已保存，审计与操作号可追溯");
    expect(sessionStorage.length).toBe(0);
  });
  it("detects pending identity when reopened and cannot start an edited or new request", async () => {
    actions.collection.mockResolvedValue({ success: false, rejected: false, error: "unknown" });
    await render();
    let panel = await openCollection();
    await fillCollection(panel);
    await submit(panel.querySelector("form")!);
    await click(findButton("收起，保留未核操作号"));
    panel = await openCollection();
    expect(panel.querySelector("fieldset")?.disabled).toBe(true);
    expect(host.textContent).toContain("检测到未核实的操作结果");
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent === "按原内容同号重试",
      ),
    ).toBe(false);
    expect(actions.collection).toHaveBeenCalledOnce();
  });
});

describe("CIMAC pending facts, never invented bills", () => {
  it("does not offer sale contracts to lease-only meter or pending-terms writes", async () => {
    const data = account();
    data.contracts = [];
    await render({ data });
    await click(findButton("水电抄表"));
    expect(findButton("登记抄表").disabled).toBe(true);
    expect(host.textContent).toContain("没有已关联的租赁合同");
    await click(findButton("规则与约定"));
    expect(findButton("登记待核约定").disabled).toBe(true);
    expect(actions.meter).not.toHaveBeenCalled();
    expect(actions.terms).not.toHaveBeenCalled();
  });
  it("saves a genuine zero meter reading, with unknown previous reading omitted and no money", async () => {
    await render();
    await click(findButton("水电抄表"));
    await click(findButton("登记抄表"));
    await input(field("房屋 / 合同"), contractId);
    await input(field("表号"), "WATER-1");
    await input(field("服务月份"), "2026-10");
    await input(field("本期读数"), "0");
    expect(host.textContent).toContain("待核，不按零计算");
    await submit(field("本期读数").closest("form")!);
    expect(actions.meter.mock.calls[0][0]).toMatchObject({
      customerId,
      contractId,
      unitId: shop.id,
      currentReading: "0",
      serviceMonth: "2026-10-01",
      readOn: "2026-10-24",
      meterKind: "water",
    });
    expect(actions.meter.mock.calls[0][0].previousReading).toBeUndefined();
    expect(actions.collection).not.toHaveBeenCalled();
  });
  it("calculates usage exactly, rejects a backwards meter and keeps three decimal places", async () => {
    await render();
    await click(findButton("水电抄表"));
    await click(findButton("登记抄表"));
    await input(field("房屋 / 合同"), contractId);
    await input(field("表号"), "WATER-1");
    await input(field("服务月份"), "2026-10");
    await input(field("上期读数 · 不知道留空"), "10.125");
    await input(field("本期读数"), "9");
    await submit(field("本期读数").closest("form")!);
    expect(actions.meter).not.toHaveBeenCalled();
    await input(field("本期读数"), "10.326");
    expect(host.textContent).toContain("0.201 m³");
    await submit(field("本期读数").closest("form")!);
    expect(actions.meter.mock.calls[0][0]).toMatchObject({
      previousReading: "10.125",
      currentReading: "10.326",
    });
  });
  it("saves pending terms without defaulting rate, area, charge start or bill creation", async () => {
    await render();
    await click(findButton("规则与约定"));
    await click(findButton("登记待核约定"));
    await input(field("房屋 / 合同"), contractId);
    await input(field("约定来源 · 必填"), "合同第3页，物业费起算日待核");
    await submit(field("约定来源 · 必填").closest("form")!);
    const saved = actions.terms.mock.calls[0][0];
    expect(saved).toMatchObject({
      customerId,
      contractId,
      unitId: shop.id,
      category: "property_fee",
      pricingBasis: "pending",
      proration: "daily_pending_convention",
    });
    for (const key of [
      "startsOn",
      "endsOn",
      "monthlyRate",
      "chargeableArea",
      "annualStartsOn",
      "annualEndsOn",
    ])
      expect(saved[key]).toBeUndefined();
    expect(actions.collection).not.toHaveBeenCalled();
    expect(host.textContent).toContain("不生成应收");
  });
  it("updates a saved term with optimistic revision without changing its target", async () => {
    const data = account();
    const term: CimacFeeTerm = {
      id: "a0000000-0000-4000-8000-000000000001",
      customerId,
      contractId,
      unitId: shop.id,
      category: "property_fee",
      status: "pending_review",
      monthlyRate: "900",
      pricingBasis: "per_sqm",
      chargeableArea: "173",
      currency: "XOF",
      startsOn: null,
      endsOn: null,
      annualStartsOn: null,
      annualEndsOn: null,
      proration: "daily_pending_convention",
      source: "合同第3页",
      notes: null,
      createdAt: updatedAt,
      updatedAt,
      recordedBy: viewerId,
    };
    data.feeTerms = [term];
    await render({ data });
    await click(findButton("规则与约定"));
    await click(findButton("补充 / 更正"));
    expect((field("房屋 / 合同") as HTMLSelectElement).disabled).toBe(true);
    await input(field("待核事项 / 特殊减免条件"), "起算日另核");
    await submit(field("约定来源 · 必填").closest("form")!);
    expect(actions.terms.mock.calls[0][0]).toMatchObject({
      id: term.id,
      expectedUpdatedAt: updatedAt,
      contractId,
      unitId: shop.id,
      monthlyRate: "900",
      chargeableArea: "173",
      notes: "起算日另核",
    });
  });
});

describe("exact billing display helpers", () => {
  it("does not silently coerce unknown values or lose precision to floating point", () => {
    expect(billingNumber(null, "zh")).toBe("—");
    expect(billingNumber(undefined, "fr")).toBe("—");
    expect(billingNumber("9007199254740993.12", "zh")).toBe("9,007,199,254,740,993.12");
    expect(billingMinorString(billingMinor("0.1")! + billingMinor("0.2")!)).toBe("0.3");
    expect(billingMinor("1e3")).toBeNull();
    expect(billingMinor("-1")).toBeNull();
    expect(billingMinor("1.001")).toBeNull();
  });
});
