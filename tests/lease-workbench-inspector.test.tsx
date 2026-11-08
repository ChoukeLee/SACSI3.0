// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LeaseWorkbenchInspector,
  type LeaseWorkbenchInspectorProps,
} from "@/features/leases/lease-workbench-inspector";
import type { CustomerRow, LeaseContractRow, PaymentRow, ReceivableRow } from "@/types/database";

const contract: LeaseContractRow = {
  id: "lease-1",
  unit_id: "unit-1",
  customer_id: "customer-1",
  contract_no: "TEST-LEASE-001",
  start_date: "2026-01-01",
  expected_end_date: "2026-10-01",
  expected_end_confirmed: true,
  paid_through_date: "2026-09-30",
  actual_end_date: null,
  payment_cycle: "monthly",
  payment_day: 1,
  monthly_rent_xof: 120000,
  deposit_amount_xof: 300000,
  deposit_received: true,
  rent_free_days: 0,
  signer_name: null,
  attachment_url: null,
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const payment = (overrides: Partial<PaymentRow> = {}): PaymentRow => ({
  id: "payment-1",
  customer_id: "customer-1",
  unit_id: "unit-1",
  source_id: contract.id,
  source_type: "lease_rent",
  payment_date: "2026-10-01",
  amount: 100,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  payment_method: "cash",
  receipt_no: null,
  notes: null,
  created_at: "2026-10-01T12:00:00Z",
  ...overrides,
});
const receivable = (overrides: Partial<ReceivableRow> = {}): ReceivableRow => ({
  id: "receivable-1",
  building_id: "building-1",
  unit_id: "unit-1",
  customer_id: "customer-1",
  source_type: "lease_contract",
  source_id: contract.id,
  category: "lease_rent",
  title: "Test rent",
  due_date: "2026-10-19",
  amount_xof: 100,
  paid_amount_xof: 40,
  currency: "XOF",
  status: "partial",
  management_status: "managed",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...overrides,
});

let host: HTMLDivElement;
let root: Root;
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
async function render(overrides: Partial<LeaseWorkbenchInspectorProps> = {}) {
  const props: LeaseWorkbenchInspectorProps = {
    contract,
    payments: [],
    receivables: [],
    locale: "zh",
    today: "2026-10-19",
    buildingLabel: "测试楼栋",
    onPrint: vi.fn(),
    ...overrides,
  };
  await act(async () => root.render(<LeaseWorkbenchInspector {...props} />));
  return props;
}
async function tab(name: string) {
  if (
    name === "收付款" &&
    ![...host.querySelectorAll('[role="tab"]')].some((el) => el.textContent === name)
  )
    name = "记录";
  const button = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (item) => item.textContent === name,
  );
  if (!button) throw new Error(`Missing tab: ${name}`);
  await act(async () => button.click());
  return button;
}
async function viewPayment(paymentId: string) {
  const button = host.querySelector<HTMLButtonElement>(
    'tr[data-lease-payment-id="' + paymentId + '"] button',
  );
  expect(button).toBeTruthy();
  if (button!.getAttribute("aria-expanded") !== "true") await act(async () => button!.click());
}
function fact(name: string) {
  return [...host.querySelectorAll("dt")].find((item) => item.textContent === name)
    ?.nextElementSibling?.textContent;
}

function disclosure(label: string) {
  return [...host.querySelectorAll("details")].find(
    (item) => item.querySelector(":scope > summary")?.textContent === label,
  );
}

async function openDisclosure(label: string) {
  if (label === "租期与登记资料") {
    await tab("资料");
    return;
  }
  const details = disclosure(label);
  expect(details).toBeTruthy();
  if (!details!.open) await act(async () => details!.querySelector("summary")!.click());
  return details!;
}

function isVisibleByDisclosure(element: Element) {
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    if (
      parent instanceof HTMLDetailsElement &&
      !parent.open &&
      !parent.querySelector(":scope > summary")?.contains(element)
    )
      return false;
  }
  return true;
}

describe("LeaseWorkbenchInspector single contract dossier", () => {
  it("restores upcoming payment reminders only for explicit managed unsettled bills within fifteen days", async () => {
    for (const [due_date, label] of [
      ["2026-10-19", "今日应缴"],
      ["2026-11-03", "15天内应缴"],
      ["2026-11-04", null],
    ] as const) {
      await render({ receivables: [receivable({ due_date })] });
      if (label) expect(host.textContent).toContain(label + " · " + due_date);
      else expect(host.textContent).not.toMatch(/今日应缴|15天内应缴/);
    }
    for (const row of [
      receivable({ management_status: "historical_pending" }),
      receivable({ management_status: "excluded" }),
      receivable({ status: "cancelled" }),
      receivable({ status: "paid", paid_amount_xof: 100 }),
    ]) {
      await render({ receivables: [row] });
      expect(host.textContent).not.toMatch(/今日应缴|15天内应缴/);
    }
    await render({
      contract: { ...contract, paid_through_date: "2020-01-01" },
      receivables: [],
      summary: {
        total: 100,
        paid: 40,
        outstanding: 60,
        overdue: 0,
        nextDue: "2026-10-19",
        count: 1,
      },
    });
    expect(host.textContent).not.toMatch(/今日应缴|15天内应缴/);
    await render({
      receivables: [receivable({ id: "overdue", due_date: "2026-10-18" }), receivable()],
    });
    expect(host.textContent).toContain("已核应收逾期");
    expect(host.textContent).not.toMatch(/今日应缴|15天内应缴/);
  });

  it("bases native upcoming reminders on known original-currency bills without using the XOF placeholder", async () => {
    const nativeContract = {
      ...contract,
      rent_currency: "USD" as const,
      monthly_rent_amount: 3200,
      monthly_rent_xof: 0,
    };
    const bill = receivable({
      currency: "USD",
      amount_xof: 0,
      paid_amount_xof: 0,
      amount_native: 3200,
      paid_amount_native: 1000,
      due_date: "2026-11-03",
    });
    await render({
      contract: nativeContract,
      receivables: [
        bill,
        receivable({ id: "foreign", currency: "CNY", amount_native: 50, paid_amount_native: 0 }),
      ],
    });
    expect(host.textContent).toContain("15天内应缴 · 2026-11-03");
    expect(host.textContent).not.toContain("今日应缴");
    await render({
      contract: nativeContract,
      receivables: [{ ...bill, paid_amount_native: null }],
    });
    expect(host.textContent).not.toMatch(/今日应缴|15天内应缴/);
    await render({
      contract: { ...nativeContract, status: "terminated", actual_end_date: "2026-10-01" },
      receivables: [bill],
    });
    expect(host.textContent).not.toMatch(/今日应缴|15天内应缴/);
  });

  it("keeps same-room history inside its section and navigates all four tabs by keyboard", async () => {
    const choose = vi.fn();
    await render({
      historyContent: (
        <section>
          <h3>本房租赁历史</h3>
          <button onClick={choose}>选择另一登记租赁</button>
        </section>
      ),
    });
    expect(host.textContent).not.toContain("本房租赁历史");
    const overview = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
    await act(async () =>
      overview.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    expect(document.activeElement?.textContent).toBe("历史");
    expect(host.textContent).toContain("本房租赁历史");
    expect(host.querySelectorAll("details")).toHaveLength(1);
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((el) => el.textContent === "选择另一登记租赁")!
        .click(),
    );
    expect(choose).toHaveBeenCalledTimes(1);
    await act(async () =>
      (document.activeElement as HTMLButtonElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      ),
    );
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("概览");
    expect(host.textContent).not.toContain("本房租赁历史");
  });

  it("reveals one payment source at a time without invoking any operation", async () => {
    const manage = vi.fn();
    await render({
      initialSection: "finance",
      actions: <button onClick={manage}>办理租赁</button>,
      payments: [
        payment({ id: "first", notes: "FIRST-SOURCE" }),
        payment({ id: "second", notes: "SECOND-SOURCE" }),
      ],
    });
    expect(host.querySelectorAll("tr[data-lease-payment-id]")).toHaveLength(2);
    expect(host.textContent).not.toContain("FIRST-SOURCE");
    await viewPayment("first");
    expect(host.textContent).toContain("FIRST-SOURCE");
    await viewPayment("second");
    expect(host.textContent).toContain("SECOND-SOURCE");
    expect(host.textContent).not.toContain("FIRST-SOURCE");
    expect(manage).not.toHaveBeenCalled();
  });

  it("keeps the default overview read-only and requires explicit disclosure for permitted operations", async () => {
    const manage = vi.fn();
    const correct = vi.fn();
    const props = await render({
      actions: <button onClick={manage}>办理本租赁</button>,
      financeTools: <button onClick={correct}>更正租金账期</button>,
      collectionHref: "/leases/lease-1/collect",
    });
    expect([...host.querySelectorAll('[role="tab"]')].map((item) => item.textContent)).toEqual([
      "概览",
      "收付款",
      "资料",
      "历史",
    ]);
    const more = disclosure("更多操作")!;
    expect(more.open).toBe(false);
    for (const action of more.querySelectorAll("button, a")) {
      expect(isVisibleByDisclosure(action)).toBe(false);
    }
    const view = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "查看收付款",
    );
    expect(view).toBeTruthy();
    expect(
      [...host.querySelectorAll("button")]
        .filter(isVisibleByDisclosure)
        .every((item) => item.getAttribute("role") === "tab" || item.textContent === "查看收付款"),
    ).toBe(true);
    await tab("收付款");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("收付款");
    expect(manage).not.toHaveBeenCalled();
    expect(correct).not.toHaveBeenCalled();
    expect(props.onPrint).not.toHaveBeenCalled();
    expect(more.open).toBe(false);
    await openDisclosure("更多操作");
    const operation = [...more.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "办理本租赁",
    )!;
    expect(isVisibleByDisclosure(operation)).toBe(true);
    await act(async () => operation.click());
    expect(manage).toHaveBeenCalledTimes(1);
    await render({
      contract: { ...contract, id: "other-rental" },
      actions: undefined,
      financeTools: undefined,
    });
    expect(host.textContent).not.toContain("办理本租赁");
    expect(host.textContent).not.toContain("更正租金账期");
    expect(host.querySelector('a[href*="/collect"]')).toBeNull();
  });

  it("keeps native rental accounting out of the overview and renders it once in the merged detail tab", async () => {
    await render({
      contract: {
        ...contract,
        rent_currency: "USD",
        monthly_rent_amount: 3200,
        monthly_rent_xof: 0,
      },
      payments: [payment({ currency: "USD", amount: 1000, native_settlement: true })],
      receivables: [
        receivable({
          currency: "USD",
          amount_xof: 0,
          paid_amount_xof: 0,
          amount_native: 3200,
          paid_amount_native: 1000,
        }),
      ],
    });
    expect(host.querySelectorAll('[aria-label="原币租金账务"]')).toHaveLength(0);
    await tab("收付款");
    expect(host.querySelectorAll('[aria-label="原币租金账务"]')).toHaveLength(1);
    expect(host.querySelectorAll("tr[data-lease-payment-id], ol li")).toHaveLength(1);
    expect(host.textContent).toContain("2,200");
    expect(host.textContent).toContain("USD");
    await tab("概览");
    expect(host.querySelectorAll('[aria-label="原币租金账务"]')).toHaveLength(0);
  });

  it("shows rent-only receipts in the overview while keeping deposits, fees and refunds separate", async () => {
    await render({
      payments: [
        payment({ id: "rent", amount: 5200000 }),
        payment({ id: "agency", source_type: "lease_agency_income", amount: 650000 }),
        payment({ id: "deposit", source_type: "lease_deposit", amount: 1300000 }),
        payment({ id: "deposit-return", source_type: "lease_deposit_refund", amount: 260000 }),
        payment({ id: "agency-paid", source_type: "lease_agency_expense", amount: 65000 }),
        payment({ id: "other", source_type: "lease_other_income", amount: 250000 }),
        payment({ id: "other-paid", source_type: "lease_other_expense", amount: 25000 }),
        payment({ id: "rent-refund", source_type: "lease_rent_refund", amount: 100000 }),
        payment({ id: "offset", payment_method: "offset", amount: 9000000 }),
        payment({ id: "another-contract", source_id: "another-contract", amount: 99000000 }),
      ],
    });
    expect(fact("已收租金")).toBe("520 万西法");
    expect(fact("另收押金")).toBe("130 万西法");
    expect(fact("已退押金")).toBe("26 万西法");
    expect(fact("另收中介费")).toBe("65 万西法");
    expect(fact("中介费支出")).toBe("6.5 万西法");
    expect(fact("其他收款")).toBe("25 万西法");
    expect(fact("其他支出")).toBe("2.5 万西法");
    expect(fact("租金退款")).toBe("10 万西法");
    expect(fact("已录经营收款")).toBeUndefined();
    expect(host.textContent).not.toContain("9,900 万西法");
    await tab("收付款");
    expect(fact("已录经营收款")).toBe("610 万西法");
    expect(fact("已录经营支出")).toBe("19 万西法");
    expect(fact("经营现金净额")).toBe("591 万西法");
    expect(fact("已录押金实收")).toBe("130 万西法");
    expect(fact("已录押金实退")).toBe("26 万西法");
    expect(host.querySelectorAll("tr[data-lease-payment-id]")).toHaveLength(9);
  });

  it("derives rent-only totals from fresh records and never carries them to another rental or read failure", async () => {
    await render({ payments: [payment({ amount: 5200000 })] });
    expect(fact("已收租金")).toBe("520 万西法");
    await render({ payments: [payment({ amount: 5100000 })] });
    expect(fact("已收租金")).toBe("510 万西法");
    expect(host.textContent).not.toContain("520 万西法");
    await render({
      contract: { ...contract, id: "next-rental" },
      payments: [
        payment({ amount: 5200000 }),
        payment({
          id: "next-fee",
          source_id: "next-rental",
          source_type: "lease_agency_income",
          amount: 650000,
        }),
      ],
    });
    expect(fact("已收租金")).toBe("未见记录");
    expect(fact("另收中介费")).toBe("65 万西法");
    expect(host.textContent).not.toContain("520 万西法");
    await render({ error: true, payments: [payment({ amount: 5200000 })] });
    expect(fact("已收租金")).toBeUndefined();
    expect(host.textContent).not.toContain("520 万西法");
  });

  it("keeps original-currency rent gross, separates its refunds and distinguishes unknown from no recorded rent", async () => {
    const nativeContract = {
      ...contract,
      rent_currency: "USD" as const,
      monthly_rent_amount: 3200,
      monthly_rent_xof: 0,
    };
    const nativePayment = (overrides: Partial<PaymentRow> = {}) =>
      payment({
        currency: "USD",
        native_settlement: true,
        exchange_rate_to_xof: null,
        ...overrides,
      });
    await render({
      contract: nativeContract,
      payments: [
        nativePayment({ id: "native-rent", amount: 1000 }),
        nativePayment({ id: "native-deposit", source_type: "lease_deposit", amount: 300 }),
        nativePayment({ id: "native-fee", source_type: "lease_agency_income", amount: 200 }),
        nativePayment({ id: "native-refund", source_type: "lease_rent_refund", amount: 50 }),
        nativePayment({ id: "native-offset", amount: 900, payment_method: "offset" }),
      ],
    });
    expect(fact("已收租金")).toBe("$1,000 USD");
    expect(fact("另收押金")).toBe("$300 USD");
    expect(fact("另收中介费")).toBe("$200 USD");
    expect(fact("租金退款")).toBe("$50 USD");
    expect(fact("已核应收未收")).toBe("暂无已核应收");
    expect(fact("已收租金")).not.toMatch(/万西法|950|1,200|1,500|1,900/);
    await render({ contract: nativeContract, payments: [] });
    expect(fact("已收租金")).toBe("未见记录");
    expect(fact("另收押金")).toBeUndefined();
    await render({
      contract: nativeContract,
      payments: [
        nativePayment({ amount: 80, payment_method: "invalid" as PaymentRow["payment_method"] }),
      ],
    });
    expect(fact("已收租金")).toBe("待核");
    expect(host.textContent).toContain("收付款分类有待核事项");
    expect(host.textContent).not.toContain("$0 USD");
  });

  it("suppresses the inner title and close action only for the embedded SACSI dossier", async () => {
    const onClose = vi.fn();
    await render({ embedded: true, onClose });
    expect(host.querySelector('button[aria-label="关闭预览"]')).toBeNull();
    expect([...host.querySelectorAll("h2")].some((item) => item.textContent === "租赁资料")).toBe(
      false,
    );
    await render({ embedded: false, onClose });
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="关闭预览"]')!;
    expect(close).toBeTruthy();
    await act(async () => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await render({ workArea: "cimac", embedded: true, onClose });
    expect(host.querySelector('button[aria-label="关闭预览"]')).toBeTruthy();
    expect([...host.querySelectorAll('[role="tab"]')].map((item) => item.textContent)).toEqual([
      "合同",
      "账务",
      "记录",
    ]);
  });

  it("prevents every disclosed operation while busy and removes stale operations on loading or error", async () => {
    const manage = vi.fn();
    const correct = vi.fn();
    const props = await render({
      busy: true,
      actions: <button onClick={manage}>办理本租赁</button>,
      financeTools: <button onClick={correct}>更正租金账期</button>,
      collectionHref: "/leases/lease-1/collect",
      operationError: "该笔登记仍待核验",
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("该笔登记仍待核验");
    expect(isVisibleByDisclosure(host.querySelector('[role="alert"]')!)).toBe(true);
    if (disclosure("更多操作")) await openDisclosure("更多操作");
    for (const button of host.querySelectorAll<HTMLButtonElement>("details button")) {
      await act(async () => button.click());
    }
    const link = host.querySelector('a[href*="/collect"]');
    if (link) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      await act(async () => link.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    }
    expect(manage).not.toHaveBeenCalled();
    expect(correct).not.toHaveBeenCalled();
    expect(props.onPrint).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("该笔登记仍待核验");
    for (const state of [{ loading: true }, { error: true }]) {
      await render({
        ...state,
        actions: <button onClick={manage}>旧办理动作</button>,
        financeTools: <button onClick={correct}>旧更正动作</button>,
        collectionHref: "/leases/lease-1/collect",
      });
      expect(host.textContent).not.toContain("旧办理动作");
      expect(host.textContent).not.toContain("旧更正动作");
      expect(host.querySelector('a[href*="/collect"]')).toBeNull();
    }
  });

  it("keeps a historical tenant's contact and unsettled finances separate from the next rental", async () => {
    await render({
      contract: { ...contract, status: "terminated", actual_end_date: "2026-10-01" },
      customer: { id: "customer-1", name: "历史租客示例", phone: "TEST-PHONE" } as CustomerRow,
      receivables: [
        receivable({ due_date: "2026-10-01" }),
        receivable({ id: "next-bill", source_id: "next-rental", amount_xof: 999999 }),
      ],
      payments: [
        payment({ amount: 40 }),
        payment({ id: "next-payment", source_id: "next-rental", amount: 999999 }),
      ],
    });
    expect(host.textContent).toContain("TEST-PHONE");
    await openDisclosure("租期与登记资料");
    expect(fact("实际结束")).toBe("2026-10-01");
    await tab("收付款");
    expect(host.textContent).toContain("不与后续租客合并");
    expect(fact("其中已逾期")).toBe("0.006 万西法");
    expect(fact("已录经营收款")).toBe("0.004 万西法");
    expect(host.textContent).not.toMatch(/999,999|99\.9999\s*万西法/);
    await tab("收付款");
    expect(host.querySelectorAll("tr[data-lease-payment-id], ol li")).toHaveLength(1);
    expect(host.textContent).toContain("以下为这次租赁的已登记收付款");
  });

  it("does not require a paper contract or number to read a registered rental and collect", async () => {
    const href = "/leases/11111111-1111-4111-8111-111111111111/collect";
    await render({
      contract: {
        ...contract,
        contract_no: "",
        attachment_url: null,
        signer_name: null,
        expected_end_confirmed: false,
      },
      collectionHref: href,
      payments: [payment({ amount: 120000 })],
    });
    await tab("概览");
    expect(fact("月租金")).toContain("12 万西法");
    expect(fact("租金已交至（登记）")).toBe("2026-09-30");
    expect(host.textContent).not.toContain("纸质合同不影响");
    await tab("资料");
    expect(host.textContent).toContain("纸质合同不影响");
    const collection = host.querySelector('a[href="' + href + '"]')!;
    expect(isVisibleByDisclosure(collection)).toBe(false);
    await openDisclosure("更多操作");
    expect(host.querySelector('a[href="' + href + '"]')).not.toBeNull();
    expect(isVisibleByDisclosure(collection)).toBe(true);
    await tab("收付款");
    expect(fact("已录经营收款")).toContain("12 万西法");
  });

  it("preserves the CIMAC contract-oriented dossier and incomplete-date follow-up", async () => {
    await render({ workArea: "cimac", contract: { ...contract, expected_end_confirmed: false } });
    expect(host.querySelector('aside[aria-label="合同预览"]')).not.toBeNull();
    expect([...host.querySelectorAll('[role="tab"]')].map((item) => item.textContent)).toContain(
      "合同",
    );
    expect([...host.querySelectorAll('[role="tab"]')].map((item) => item.textContent)).toEqual([
      "合同",
      "账务",
      "记录",
    ]);
    expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).toContain(
      "核实合同资料",
    );
  });

  it("does not turn an empty XOF deposit slot on a native rental into an exemption", async () => {
    await render({
      contract: {
        ...contract,
        rent_currency: "USD",
        monthly_rent_amount: 3200,
        monthly_rent_xof: 0,
        deposit_amount_xof: 0,
        attachment_url: null,
      },
    });
    await tab("概览");
    expect(fact("月租金")).toContain("USD");
    await openDisclosure("租期与登记资料");
    expect(fact("登记押金")).toBe("原币押金待核");
    expect(host.textContent).not.toContain("免押");
  });

  it("offers a separate exact-contract collection route only when a permitted caller supplies it", async () => {
    const href = "/leases/11111111-1111-4111-8111-111111111111/collect";
    await render({ collectionHref: href });
    await openDisclosure("更多操作");
    const link = [...host.querySelectorAll("a")].find((item) =>
      item.textContent?.includes("手工登记租金/物业费"),
    );
    expect(link?.getAttribute("href")).toBe(href);
    await render({ collectionHref: undefined });
    expect(host.querySelector(`a[href="${href}"]`)).toBeNull();
    await render({ collectionHref: href, contract: { ...contract, status: "terminated" } });
    expect(host.querySelector(`a[href="${href}"]`)).toBeNull();
    await render({ collectionHref: href, loading: true });
    expect(host.querySelector(`a[href="${href}"]`)).toBeNull();
    await render({ collectionHref: href, error: true });
    expect(host.querySelector(`a[href="${href}"]`)).toBeNull();
  });

  it("keeps the empty preview useful without phantom amounts or business actions", async () => {
    await render({ contract: null });
    expect(host.querySelector('aside[aria-label="租赁资料"]')).not.toBeNull();
    expect(host.textContent).toContain("选择房间");
    expect(host.textContent).not.toContain("XOF");
    expect(host.querySelector("button")).toBeNull();
  });

  it("withholds stale details and all business actions during loading or a failed read", async () => {
    await render({ loading: true, payments: [payment()] });
    expect(host.querySelector('aside[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("正在读取租赁资料");
    expect(host.textContent).not.toContain(contract.contract_no);
    expect(host.textContent).not.toContain("XOF");
    expect(host.querySelector("button")).toBeNull();
    await render({ error: true, payments: [payment()] });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("无法读取");
    expect(host.textContent).not.toContain(contract.contract_no);
    expect(host.querySelector("button")).toBeNull();
  });

  it("keeps the CIMAC registered status and formal end-date details without inferring a move-out", async () => {
    await render({ workArea: "cimac" });
    expect(host.textContent).toContain("生效中");
    expect(host.textContent).not.toContain("已终止");
    expect(fact("预计到期")).toBe("2026-10-01");
    expect(host.textContent).toContain("合同到期不等于已退租");
    await render({ workArea: "cimac", contract: { ...contract, expected_end_confirmed: false } });
    expect(fact("预计到期")).toBe("待确认");
    await render({ workArea: "cimac", contract: { ...contract, expected_end_date: "2099-12-31" } });
    expect(fact("预计到期")).toBe("长期");
    expect(fact("原登记日期")).toBe("2099-12-31");
    await render({
      workArea: "cimac",
      contract: { ...contract, expected_end_date: "2099-12-31", expected_end_confirmed: false },
    });
    expect(fact("预计到期")).toBe("待确认");
  });

  it.each([
    ["2026-10-01", true, "2026-10-01"],
    ["2099-12-31", true, "长期"],
    ["2099-12-31", false, "待确认"],
  ])(
    "keeps the SACSI overview period factual without inventing a move-out (%s)",
    async (end, confirmed, label) => {
      await render({
        contract: {
          ...contract,
          expected_end_date: end,
          expected_end_confirmed: confirmed,
          actual_end_date: null,
        },
      });
      expect(host.textContent).toContain("生效中");
      expect(host.textContent).not.toContain("已终止");
      await tab("资料");
      expect(fact("登记租期")).toBe(`2026-01-01 → ${label}`);
      expect(fact("实际结束")).toBeUndefined();
    },
  );

  it("does not present an old coverage registration as proof of current arrears", async () => {
    await render({
      receivables: [receivable({ amount_xof: 100, paid_amount_xof: 100, status: "paid" })],
    });
    expect(fact("租金已交至（登记）")).toBe("2026-09-30");
    await tab("收付款");
    expect(fact("其中已逾期")).toBe("0 万西法");
    expect(fact("应收已核销")).toBe("0.01 万西法");
  });

  it("separates managed receivable applications, operating cash, and deposit movements", async () => {
    await render({
      payments: [
        payment(),
        payment({ id: "deposit", source_type: "lease_deposit", amount: 300 }),
        payment({ id: "refund", source_type: "lease_deposit_refund", amount: 50 }),
        payment({ id: "offset", payment_method: "offset", amount: 900 }),
        payment({ id: "fx-missing", currency: "CNY", exchange_rate_to_xof: 0, amount: 800 }),
        payment({ id: "foreign-contract", source_id: "another-contract", amount: 999999 }),
      ],
      receivables: [
        receivable(),
        receivable({ id: "overpaid", amount_xof: 50, paid_amount_xof: 100, status: "paid" }),
        receivable({ id: "history", amount_xof: 10000, management_status: "historical_pending" }),
        receivable({ id: "excluded", amount_xof: 10000, management_status: "excluded" }),
        receivable({ id: "cancelled", amount_xof: 10000, status: "cancelled" }),
        receivable({ id: "unrelated", source_id: "another-contract", amount_xof: 999999 }),
      ],
    });
    await tab("收付款");
    expect(fact("应收已核销")).toBe("0.014 万西法");
    expect(fact("其中已逾期")).toBe("0 万西法");
    expect(fact("最早未结到期")).toBe("2026-10-19");
    expect(host.textContent).toContain("0.006 万西法");
    expect(fact("已录经营收款")).toBe("0.01 万西法");
    expect(fact("已录押金实收")).toBe("0.03 万西法");
    expect(fact("已录押金实退")).toBe("0.005 万西法");
    expect(host.textContent).toContain("1 笔待核记录");
    expect(host.textContent).toContain("1 笔非现金变动");
    expect(host.textContent).not.toMatch(/999,999|99\.9999\s*万西法/);
    expect(host.textContent).not.toContain("可退余额");
  });

  it("does not turn missing managed receivables or unverified deposits into zero balances", async () => {
    await render({
      payments: [
        payment({ source_type: "lease_deposit", currency: "CNY", exchange_rate_to_xof: 0 }),
      ],
      receivables: [receivable({ management_status: "historical_pending" })],
    });
    await tab("收付款");
    expect(host.textContent).toContain("未有已核应收，不代表没有欠款");
    expect(fact("应收已核销")).toBe("—");
    expect(fact("已录押金实收")).toBe("暂无已核记录");
    expect(host.textContent).toContain("押金标记与已录收退记录存在待核差异");
    expect(host.textContent).not.toContain("0 万西法");
  });

  it("uses the supplied complete receivable summary without reconstructing cash from it", async () => {
    await render({
      summary: {
        total: 1000,
        paid: 600,
        outstanding: 400,
        overdue: 300,
        nextDue: "2026-10-01",
        count: 4,
      },
    });
    await tab("收付款");
    expect(host.textContent).toContain("0.04 万西法");
    expect(fact("其中已逾期")).toBe("0.03 万西法");
    expect(fact("应收已核销")).toBe("0.06 万西法");
    expect(fact("已录经营收款")).toBe("暂无已核记录");
  });

  it("labels payment records honestly and never guesses the collector from the recording account", async () => {
    await render({
      payments: [payment({ recorded_by: "admin-account-id", receipt_no: "TEST-RECEIPT" })],
    });
    await tab("收付款");
    expect(host.textContent).toContain("以下为这次租赁的已登记收付款");
    await viewPayment("payment-1");
    expect(host.textContent).toContain("实收人: 待核对");
    expect(host.textContent).toContain("TEST-RECEIPT");
    expect(host.textContent).not.toContain("admin-account-id");
    await render({
      payments: [payment({ actual_collector: "已核实收人", recorded_by: "admin-account-id" })],
    });
    await tab("收付款");
    await viewPayment("payment-1");
    expect(host.textContent).toContain("实收人: 已核实收人");
  });

  it("keeps focused operations in the dossier and supports keyboard tab navigation", async () => {
    const manage = vi.fn();
    const props = await render({ actions: <button onClick={manage}>办理本合同</button> });
    const clickText = async (label: string) => {
      const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === label,
      );
      if (!button) throw new Error(`Missing action ${label}`);
      await act(async () => button.click());
    };
    expect(host.textContent).not.toContain("打开合同详情 / 办理");
    expect(
      isVisibleByDisclosure(
        [...host.querySelectorAll("button")].find((item) => item.textContent === "办理本合同")!,
      ),
    ).toBe(false);
    await openDisclosure("更多操作");
    await clickText("办理本合同");
    expect(manage).toHaveBeenCalledTimes(1);
    const contractTab = host.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    )!;
    await act(async () =>
      contractTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("收付款");
    expect(document.activeElement?.textContent).toBe("收付款");
    expect(host.textContent).not.toContain("打开完整财务记录");
    await openDisclosure("更多操作");
    await clickText("打印登记合同");
    expect(props.onPrint).toHaveBeenCalledTimes(1);
    await render({ contract: { ...contract, id: "lease-2", contract_no: "TEST-LEASE-002" } });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("概览");
  });

  it("localizes the French preview, missing data, and accessible labels", async () => {
    await render({ locale: "fr" });
    expect(host.querySelector('aside[aria-label="Dossier de location"]')).not.toBeNull();
    expect(host.textContent).toContain("Actif");
    await tab("Informations");
    expect(host.textContent).toContain("Mensuel");
    await tab("Paiements");
    expect(host.textContent).toContain("Aucune créance vérifiée");
    expect(host.textContent).not.toContain("0 万西法");
  });

  it("suggests verifying managed overdue receivables before draft or expiry follow-up", async () => {
    await render({
      workArea: "cimac",
      contract: { ...contract, status: "draft" },
      summary: {
        total: 100,
        paid: 0,
        outstanding: 100,
        overdue: 100,
        nextDue: "2026-10-01",
        count: 1,
      },
    });
    const suggestion = host.querySelector('section[aria-label="建议下一步"]');
    expect(suggestion?.textContent).toContain("核对逾期应收与实收");
    expect(suggestion?.textContent).not.toContain("核实合同资料");
    expect(suggestion?.querySelector("button")).toBeNull();
  });

  it("keeps Excel rental records readable when formal contract dates are incomplete", async () => {
    await render({ contract: { ...contract, status: "draft", attachment_url: null } });
    await tab("概览");
    expect(fact("月租金")).toContain("12 万西法");
    expect(fact("租金已交至（登记）")).toBe("2026-09-30");
    await tab("资料");
    expect(fact("登记租期")).toBe("2026-01-01 → 2026-10-01");
    await openDisclosure("租期与登记资料");
    expect(host.textContent).toContain("未附纸质合同不影响查看已登记资料");
    await render({ contract: { ...contract, expected_end_confirmed: false } });
    await tab("概览");
    expect(fact("月租金")).toContain("12 万西法");
    expect(fact("租金已交至（登记）")).toBe("2026-09-30");
    await tab("资料");
    expect(fact("登记租期")).toBe("2026-01-01 → 待确认");
    expect(host.textContent).not.toContain("确认续租");
  });

  it("suggests confirming arrangements for active confirmed expiries within 30 days, not long-term or later dates", async () => {
    await render({ workArea: "cimac", contract: { ...contract, expected_end_date: "2026-11-18" } });
    expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).toContain(
      "确认续租 / 退租安排",
    );
    expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).toContain(
      "不代表已经退租",
    );
    for (const expected_end_date of ["2026-11-19", "2099-12-31"]) {
      await render({ workArea: "cimac", contract: { ...contract, expected_end_date } });
      expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).toContain(
        "查看合同与账务",
      );
      expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).not.toContain(
        "确认续租",
      );
    }
  });

  it("keeps follow-up suggestions French and read-only without another full-detail link", async () => {
    await render({ workArea: "cimac", locale: "fr" });
    const suggestion = host.querySelector('section[aria-label="Prochaine étape suggérée"]');
    expect(suggestion?.textContent).toContain("Confirmer la suite du bail");
    expect(suggestion?.querySelector("button")).toBeNull();
    expect(host.textContent).not.toContain("Ouvrir le dossier / Gérer");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("preserves the complete record history, original currency evidence and contract terms", async () => {
    await render({
      contract: { ...contract, rent_free_days: 15, signer_name: "Test signer", payment_day: 5 },
      payments: Array.from({ length: 8 }, (_, index) =>
        payment({
          id: `history-${index}`,
          receipt_no: `RECEIPT-${index}`,
          notes:
            index === 7
              ? "original_currency=USD;original_amount=250;original_period_months=1"
              : null,
        }),
      ),
    });
    await openDisclosure("租期与登记资料");
    expect(fact("免租天数")).toBe("15");
    expect(fact("签约人")).toBe("Test signer");
    expect(fact("约定付款日")).toContain("5");
    await tab("收付款");
    expect(host.querySelectorAll("tr[data-lease-payment-id], ol li")).toHaveLength(8);
    await viewPayment("history-7");
    expect(host.textContent).toContain("RECEIPT-7");
    expect(host.textContent).toContain("$250");
    expect(host.textContent).not.toContain("仅显示最近 6 笔");
  });

  it("opens the requested finance section without an intermediate dossier", async () => {
    await render({ initialSection: "finance", financeTools: <button>更正租金账期</button> });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("收付款");
    await openDisclosure("更多操作");
    expect(disclosure("更多操作")?.textContent).toContain("更正租金账期");
    const correction = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "更正租金账期",
    )!;
    expect(isVisibleByDisclosure(correction)).toBe(true);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not mark native refunds, reversals or non-cash offsets as positive cash receipts", async () => {
    await render({
      payments: [
        payment({
          id: "native-refund",
          source_type: "lease_rent_refund",
          currency: "USD",
          amount: 50,
          native_settlement: true,
        }),
        payment({
          id: "offset",
          source_type: "lease_deposit_deduction",
          payment_method: "offset",
          amount: 200,
        }),
        payment({ id: "reversal", reversal_of_payment_id: "original", amount: 300 }),
        payment({ id: "receipt", amount: 400 }),
        payment({ id: "refund", source_type: "lease_rent_refund", amount: 500 }),
      ],
    });
    await tab("收付款");
    const amounts = [...host.querySelectorAll("tr[data-lease-payment-id], ol li")].map((item) =>
      item.matches("tr")
        ? item.querySelector("td:nth-child(3)")?.textContent
        : item.querySelector(":scope > p")?.textContent,
    );
    expect(amounts).toContain("$50 USD");
    expect(amounts).toContain("0.02 万西法");
    expect(amounts).toContain("0.03 万西法");
    expect(amounts).toContain("+0.04 万西法");
    expect(amounts).toContain("−0.05 万西法");
    await viewPayment("native-refund");
    expect(host.textContent).toContain("原币结算");
    await viewPayment("offset");
    expect(host.textContent).toContain("非现金抵扣");
  });

  it("shows only this contract's allocation of a shared customer receipt in cash and record history", async () => {
    const contractId = "33333333-3333-4333-8333-333333333333";
    const customerId = "55555555-5555-4555-8555-555555555555";
    const shared = {
      ...payment(),
      id: "11111111-1111-4111-8111-111111111111",
      customer_id: customerId,
      unit_id: null,
      source_id: customerId,
      source_type: "cimac_customer_collection",
      amount: 640000,
      exchange_rate_to_xof: 1,
      native_settlement: false,
      request_kind: "cimac_customer_collection",
      request_id: "22222222-2222-4222-8222-222222222222",
      reversal_of_payment_id: null,
      receipt_no: "ONE-ACTUAL-RECEIPT",
      actual_collector: "测试实收人",
      cimac_contract_allocation: {
        contractId,
        amount: "600000",
        currency: "XOF",
        receivableIds: ["77777777-7777-4777-8777-777777777777"],
      },
    };
    await render({
      workArea: "cimac",
      contract: { ...contract, id: contractId, customer_id: customerId },
      payments: [shared],
      initialSection: "finance",
    });
    expect(fact("已录经营收款")).toBe("600,000 XOF");
    await tab("收付款");
    expect(host.querySelectorAll("tr[data-lease-payment-id], ol li")).toHaveLength(1);
    expect(host.textContent).toContain("客户总账 · 本合同分配");
    expect(host.textContent).toContain("+600,000 XOF");
    expect(host.textContent).toContain("ONE-ACTUAL-RECEIPT");
    expect(host.textContent).toContain("不复制整笔实收");
    expect(host.textContent).not.toContain("640,000");
    expect(host.textContent).toContain("测试实收人");
  });

  it.each(["refund", "reversal"] as const)(
    "shows %s as a separate negative contract share, preserving the original receipt without a doubled minus",
    async (kind) => {
      const contractId = "33333333-3333-4333-8333-333333333333";
      const customerId = "55555555-5555-4555-8555-555555555555";
      const originalId = "11111111-1111-4111-8111-111111111111";
      const original = {
        ...payment(),
        id: originalId,
        customer_id: customerId,
        unit_id: null,
        source_id: customerId,
        source_type: "cimac_customer_collection",
        amount: 640000,
        native_settlement: false,
        request_kind: "cimac_customer_collection",
        request_id: "22222222-2222-4222-8222-222222222222",
        reversal_of_payment_id: null,
        receipt_no: "ORIGINAL-RECEIPT",
        cimac_contract_allocation: {
          contractId,
          amount: "600000",
          currency: "XOF",
          receivableIds: ["77777777-7777-4777-8777-777777777777"],
        },
      };
      const child = {
        ...original,
        id: "88888888-8888-4888-8888-888888888888",
        source_type: `cimac_customer_${kind}`,
        source_id: originalId,
        request_kind: `cimac_customer_${kind}`,
        request_id: "99999999-9999-4999-8999-999999999999",
        amount: kind === "refund" ? 24000 : -640000,
        payment_method: kind === "refund" ? ("cash" as const) : ("offset" as const),
        reversal_of_payment_id: kind === "reversal" ? originalId : null,
        receipt_no: "CHILD-CORRECTION",
        recorded_by: "TEST-OPERATOR",
        cimac_contract_allocation: {
          ...original.cimac_contract_allocation,
          amount: kind === "refund" ? "-20000" : "-600000",
          adjustmentKind: kind,
          originalPaymentId: originalId,
        },
      };
      await render({
        workArea: "cimac",
        contract: { ...contract, id: contractId, customer_id: customerId },
        payments: [original, child],
        initialSection: "finance",
      });
      expect(fact("已录经营收款")).toBe(kind === "refund" ? "600,000 XOF" : "0 XOF");
      if (kind === "refund") expect(fact("已录经营支出")).toBe("20,000 XOF");
      await tab("收付款");
      expect(host.textContent).toContain("+600,000 XOF");
      expect(host.textContent).toContain(kind === "refund" ? "−20,000 XOF" : "−600,000 XOF");
      expect(host.textContent).not.toMatch(/\+[-−]|−-/);
      expect(host.textContent).toContain(
        kind === "refund" ? "本合同实际退款" : "错误收款冲正（非现金）",
      );
      expect(host.textContent).toContain("ORIGINAL-RECEIPT");
      expect(host.textContent).toContain("CHILD-CORRECTION");
      expect(host.textContent).not.toContain("640,000");
      expect(
        host.querySelector(`a[href*="#cimac-payment-${originalId}"]`)?.getAttribute("href"),
      ).toContain(`/cimac/customers/${customerId}?`);
    },
  );
});
