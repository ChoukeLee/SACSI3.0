// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LeaseWorkbenchInspector,
  type LeaseWorkbenchInspectorProps,
} from "@/features/leases/lease-workbench-inspector";
import type { LeaseContractRow, PaymentRow, ReceivableRow } from "@/types/database";

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
  const button = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (item) => item.textContent === name,
  );
  if (!button) throw new Error(`Missing tab: ${name}`);
  await act(async () => button.click());
  return button;
}
function fact(name: string) {
  return [...host.querySelectorAll("dt")].find((item) => item.textContent === name)
    ?.nextElementSibling?.textContent;
}

describe("LeaseWorkbenchInspector single contract dossier", () => {
  it("offers a separate exact-contract collection route only when a permitted caller supplies it", async () => {
    const href = "/leases/11111111-1111-4111-8111-111111111111/collect";
    await render({ collectionHref: href });
    const link = [...host.querySelectorAll("a")].find((item) =>
      item.textContent?.includes("登记实际收款"),
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
    expect(host.querySelector('aside[aria-label="合同预览"]')).not.toBeNull();
    expect(host.textContent).toContain("选一份合同");
    expect(host.textContent).not.toContain("XOF");
    expect(host.querySelector("button")).toBeNull();
  });

  it("withholds stale details and all business actions during loading or a failed read", async () => {
    await render({ loading: true, payments: [payment()] });
    expect(host.querySelector('aside[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("正在读取合同");
    expect(host.textContent).not.toContain(contract.contract_no);
    expect(host.textContent).not.toContain("XOF");
    expect(host.querySelector("button")).toBeNull();
    await render({ error: true, payments: [payment()] });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("无法核验");
    expect(host.textContent).not.toContain(contract.contract_no);
    expect(host.querySelector("button")).toBeNull();
  });

  it("shows the registered status instead of inferring a move-out from the end date", async () => {
    await render();
    expect(host.textContent).toContain("生效中");
    expect(host.textContent).not.toContain("已终止");
    expect(fact("预计到期")).toBe("2026-10-01");
    expect(host.textContent).toContain("合同到期不等于已退租");
    await render({ contract: { ...contract, expected_end_confirmed: false } });
    expect(fact("预计到期")).toBe("待确认");
    await render({ contract: { ...contract, expected_end_date: "2099-12-31" } });
    expect(fact("预计到期")).toBe("长期");
    expect(fact("原登记日期")).toBe("2099-12-31");
    await render({
      contract: { ...contract, expected_end_date: "2099-12-31", expected_end_confirmed: false },
    });
    expect(fact("预计到期")).toBe("待确认");
  });

  it("does not present an old coverage registration as proof of current arrears", async () => {
    await render({
      receivables: [receivable({ amount_xof: 100, paid_amount_xof: 100, status: "paid" })],
    });
    expect(fact("登记覆盖至")).toBe("2026-09-30");
    expect(host.textContent).toContain("登记覆盖日不等于当前欠款");
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
    await tab("账务");
    expect(fact("应收已核销")).toBe("140 XOF");
    expect(fact("其中已逾期")).toBe("0 XOF");
    expect(fact("最早未结到期")).toBe("2026-10-19");
    expect(host.textContent).toContain("60 XOF");
    expect(fact("已录经营收款")).toBe("100 XOF");
    expect(fact("已录押金实收")).toBe("300 XOF");
    expect(fact("已录押金实退")).toBe("50 XOF");
    expect(host.textContent).toContain("1 笔待核记录");
    expect(host.textContent).toContain("1 笔非现金变动");
    expect(host.textContent).not.toContain("999,999");
    expect(host.textContent).not.toContain("可退余额");
  });

  it("does not turn missing managed receivables or unverified deposits into zero balances", async () => {
    await render({
      payments: [
        payment({ source_type: "lease_deposit", currency: "CNY", exchange_rate_to_xof: 0 }),
      ],
      receivables: [receivable({ management_status: "historical_pending" })],
    });
    await tab("账务");
    expect(host.textContent).toContain("未有已核应收，不代表没有欠款");
    expect(fact("应收已核销")).toBe("—");
    expect(fact("已录押金实收")).toBe("暂无已核记录");
    expect(host.textContent).toContain("押金标记与已录收退记录存在待核差异");
    expect(host.textContent).not.toContain("0 XOF");
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
    await tab("账务");
    expect(host.textContent).toContain("400 XOF");
    expect(fact("其中已逾期")).toBe("300 XOF");
    expect(fact("应收已核销")).toBe("600 XOF");
    expect(fact("已录经营收款")).toBe("暂无已核记录");
  });

  it("labels payment records honestly and never guesses the collector from the recording account", async () => {
    await render({
      payments: [payment({ recorded_by: "admin-account-id", receipt_no: "TEST-RECEIPT" })],
    });
    await tab("记录");
    expect(host.textContent).toContain("不等于完整操作审计");
    expect(host.textContent).toContain("实收人: 待核对");
    expect(host.textContent).toContain("TEST-RECEIPT");
    expect(host.textContent).not.toContain("admin-account-id");
    await render({
      payments: [payment({ actual_collector: "已核实收人", recorded_by: "admin-account-id" })],
    });
    await tab("记录");
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
    await clickText("办理本合同");
    expect(manage).toHaveBeenCalledTimes(1);
    const contractTab = host.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    )!;
    await act(async () =>
      contractTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("账务");
    expect(document.activeElement?.textContent).toBe("账务");
    expect(host.textContent).not.toContain("打开完整财务记录");
    await clickText("合同 / 打印");
    expect(props.onPrint).toHaveBeenCalledTimes(1);
    await render({ contract: { ...contract, id: "lease-2", contract_no: "TEST-LEASE-002" } });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("合同");
  });

  it("localizes the French preview, missing data, and accessible labels", async () => {
    await render({ locale: "fr" });
    expect(host.querySelector('aside[aria-label="Aperçu du contrat"]')).not.toBeNull();
    expect(host.textContent).toContain("Actif");
    expect(host.textContent).toContain("Mensuel");
    await tab("Finances");
    expect(host.textContent).toContain("Aucune créance vérifiée");
    expect(host.textContent).not.toContain("0 XOF");
  });

  it("suggests verifying managed overdue receivables before draft or expiry follow-up", async () => {
    await render({
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

  it("suggests verifying draft or unknown contract dates instead of assuming expiry", async () => {
    await render({ contract: { ...contract, status: "draft" } });
    expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).toContain(
      "核实合同资料",
    );
    await render({ contract: { ...contract, expected_end_confirmed: false } });
    const suggestion = host.querySelector('section[aria-label="建议下一步"]');
    expect(suggestion?.textContent).toContain("核实合同资料");
    expect(suggestion?.textContent).not.toContain("确认续租");
  });

  it("suggests confirming arrangements for active confirmed expiries within 30 days, not long-term or later dates", async () => {
    await render({ contract: { ...contract, expected_end_date: "2026-11-18" } });
    expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).toContain(
      "确认续租 / 退租安排",
    );
    expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).toContain(
      "不代表已经退租",
    );
    for (const expected_end_date of ["2026-11-19", "2099-12-31"]) {
      await render({ contract: { ...contract, expected_end_date } });
      expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).toContain(
        "查看合同与账务",
      );
      expect(host.querySelector('section[aria-label="建议下一步"]')?.textContent).not.toContain(
        "确认续租",
      );
    }
  });

  it("keeps follow-up suggestions French and read-only without another full-detail link", async () => {
    await render({ locale: "fr" });
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
    expect(fact("免租天数")).toBe("15");
    expect(fact("签约人")).toBe("Test signer");
    expect(fact("约定付款日")).toContain("5");
    await tab("记录");
    expect(host.querySelectorAll("ol li")).toHaveLength(8);
    expect(host.textContent).toContain("RECEIPT-7");
    expect(host.textContent).toContain("$250");
    expect(host.textContent).not.toContain("仅显示最近 6 笔");
  });

  it("opens the requested finance section without an intermediate dossier", async () => {
    await render({ initialSection: "finance", financeTools: <button>更正租金账期</button> });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("账务");
    expect(host.querySelector('[aria-label="账务办理"]')?.textContent).toContain("更正租金账期");
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
    await tab("记录");
    const amounts = [...host.querySelectorAll("ol li")].map(
      (item) => item.querySelector(":scope > p")?.textContent,
    );
    expect(amounts).toContain("$50 USD");
    expect(amounts).toContain("200 XOF");
    expect(amounts).toContain("300 XOF");
    expect(amounts).toContain("+400 XOF");
    expect(amounts).toContain("−500 XOF");
    expect(host.textContent).toContain("原币结算");
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
      contract: { ...contract, id: contractId, customer_id: customerId },
      payments: [shared],
      initialSection: "finance",
    });
    expect(fact("已录经营收款")).toBe("600,000 XOF");
    await tab("记录");
    expect(host.querySelectorAll("ol li")).toHaveLength(1);
    expect(host.textContent).toContain("客户总账 · 本合同分配");
    expect(host.textContent).toContain("+600,000 XOF");
    expect(host.textContent).toContain("ONE-ACTUAL-RECEIPT");
    expect(host.textContent).toContain("不复制整笔实收");
    expect(host.textContent).not.toContain("640,000");
    expect(host.textContent).toContain("测试实收人");
  });
});
