import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  financeRowMoney,
  decodeNativeSummary,
  leaseRentLabel,
  nativeReceivableSummary,
} from "@/lib/native-money";
import { paymentDisplay } from "@/lib/currency";
import { paymentAmountXof } from "@/features/finance/metrics";
import { NativeLeaseFinance } from "@/features/leases/native-lease-finance";
import { summarizeContractCash } from "@/features/contracts/contract-cash-model";
import { financeCsv } from "@/features/finance/finance-read";
import { reportCsv } from "@/features/reports/report-read";
import type { LeaseContractRow, PaymentRow, ReceivableRow } from "@/types/database";

const contract = {
  id: "native",
  rent_currency: "USD",
  monthly_rent_amount: 3200,
  monthly_rent_xof: 0,
  paid_through_date: "2026-11-30",
} as LeaseContractRow;
const payment = {
  source_id: "native",
  source_type: "lease_rent",
  amount: 19200,
  currency: "USD",
  native_settlement: true,
  exchange_rate_to_xof: null,
  payment_method: "bank_transfer",
} as PaymentRow;
const row = {
  id: "r",
  source_id: "native",
  source_type: "lease_contract",
  category: "lease_rent",
  due_date: "2026-06-22",
  status: "paid",
  amount_xof: 0,
  paid_amount_xof: 0,
  currency: "USD",
  amount_native: 19200,
  paid_amount_native: 19200,
} as ReceivableRow;
describe("native rent is never an XOF amount", () => {
  it("keeps USD contractual rent and receipt labels without invented FX", () => {
    expect(leaseRentLabel(contract)).toBe("$3,200 USD");
    expect(paymentDisplay(payment)).toEqual({
      primary: "$19,200 USD",
      secondary: "原币结算 · 不折算 XOF",
    });
    expect(paymentAmountXof(payment)).toBe(0);
    expect(
      paymentAmountXof({
        ...payment,
        native_settlement: false,
        currency: "XOF",
        amount: 100,
        exchange_rate_to_xof: 1,
      }),
    ).toBe(100);
    expect(summarizeContractCash([payment]).excludedCount).toBe(0);
  });
  it("separates native receivables and never adds another currency", () => {
    expect(
      nativeReceivableSummary(
        [row, { ...row, currency: "CNY", amount_native: 999 }],
        "USD",
        "2026-10-20",
      ),
    ).toEqual({ total: 19200, paid: 19200, outstanding: 0, overdue: 0 });
    expect(financeRowMoney({ ...row })).toEqual({ currency: "USD", amount: 19200 });
  });
  it("renders monthly rent, history, coverage and zero USD debt", () => {
    const html = renderToStaticMarkup(
      <NativeLeaseFinance
        contract={contract}
        payments={[payment]}
        receivables={[row]}
        today="2026-10-20"
        locale="zh"
      />,
    );
    expect(html).toContain("$19,200 USD");
    expect(html).toContain("$3,200 USD");
    expect(html).toContain("2026-11-30");
    expect(html).toContain("$0 USD");
    expect(html).not.toContain("历史汇率未核验");
  });
  it.each(["USD", "CNY"] as const)(
    "keeps %s gross rent separate from deposits, refunds and non-cash or unverified events",
    (currency) => {
      const original = { ...payment, currency, amount: 100.25 };
      const unrelated: Partial<PaymentRow>[] = [
        { source_type: "lease_deposit", amount: 2000, request_kind: "cimac_maintenance" },
        { source_type: "lease_deposit_refund", amount: 1500, request_kind: "cimac_maintenance" },
        { source_type: "lease_rent_refund", amount: 80 },
        { source_type: "lease_other_income", amount: 700 },
        { source_id: "another-contract", amount: 800 },
        { currency: currency === "USD" ? "CNY" : "USD", amount: 900 },
        { payment_method: "offset", amount: 1000 },
        { reversal_of_payment_id: "original", amount: 1100 },
        { request_kind: "payment_reversal", amount: 1200 },
        { native_settlement: false, exchange_rate_to_xof: 400, amount: 1300 },
        { exchange_rate_to_xof: 400, amount: 1400 },
      ];
      const html = renderToStaticMarkup(
        <NativeLeaseFinance
          contract={{ ...contract, rent_currency: currency }}
          payments={[original, ...unrelated.map((overrides) => ({ ...original, ...overrides }))]}
          receivables={[]}
          today="2026-10-20"
          locale="zh"
        />,
      );
      const received = html.match(/已录租金收款：([^<]*)/)?.[1];
      expect(received).toBe(`${currency === "USD" ? "$" : "¥"}100.25 ${currency}`);
    },
  );
  it("excludes invalid amounts and unknown payment methods without losing cents from valid rent", () => {
    const amounts = [0, -10, NaN, Infinity, 10.001, Number.MAX_SAFE_INTEGER];
    const html = renderToStaticMarkup(
      <NativeLeaseFinance
        contract={contract}
        payments={[
          { ...payment, amount: 0.1 },
          { ...payment, amount: 0.2, payment_method: "cash" },
          ...amounts.map((amount) => ({ ...payment, amount })),
          { ...payment, amount: 600, payment_method: null },
          { ...payment, amount: 700, payment_method: "invalid" as PaymentRow["payment_method"] },
        ]}
        receivables={[]}
        today="2026-10-20"
        locale="zh"
      />,
    );
    expect(html.match(/已录租金收款：([^<]*)/)?.[1]).toBe("$0.3 USD");
  });
  it("limits the rent-bill block to this contract's rental receivables", () => {
    const html = renderToStaticMarkup(
      <NativeLeaseFinance
        contract={contract}
        payments={[]}
        receivables={[
          { ...row, amount_native: 100, paid_amount_native: 25, status: "partial" },
          { ...row, source_id: "other", amount_native: 500 },
          { ...row, source_type: "sale_contract", amount_native: 600 },
          { ...row, category: "lease_deposit", amount_native: 700 },
          { ...row, category: "property_fee", amount_native: 800 },
        ]}
        today="2026-10-20"
        locale="zh"
      />,
    );
    expect(html).toContain("已建应收 / 已核销：$100 USD / $25 USD");
    expect(html).toContain("当前到期未收 / 逾期：$75 USD / $75 USD");
  });
  it("rejects malformed aggregate currency and amounts", () => {
    expect(() => decodeNativeSummary([{ currency: "XOF" }])).toThrow();
    expect(() => decodeNativeSummary([{ currency: "USD", income: NaN }])).toThrow();
  });
  it("exports explicit original currency columns in both financial exports", () => {
    const result = {
      kind: "receivables" as const,
      page: 1,
      pageSize: 50,
      total: 1,
      summary: {},
      rows: [{ ...row }],
    };
    expect(financeCsv(result)).toContain("currency,amount_native,paid_amount_native");
    expect(reportCsv(result)).toContain("原币金额（不并入XOF）");
    expect(reportCsv(result)).toContain('"USD","19200","19200"');
  });
});
