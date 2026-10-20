import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { financeRowMoney, decodeNativeSummary, leaseRentLabel, nativeReceivableSummary } from "@/lib/native-money";
import { paymentDisplay } from "@/lib/currency";
import { paymentAmountXof } from "@/features/finance/metrics";
import { NativeLeaseFinance } from "@/features/leases/native-lease-finance";
import { summarizeContractCash } from "@/features/contracts/contract-cash-model";
import { financeCsv } from "@/features/finance/finance-read";
import { reportCsv } from "@/features/reports/report-read";
import type { LeaseContractRow, PaymentRow, ReceivableRow } from "@/types/database";

const contract = { id: "native", rent_currency: "USD", monthly_rent_amount: 3200, monthly_rent_xof: 0, paid_through_date: "2026-11-30" } as LeaseContractRow;
const payment = { source_id: "native", source_type: "lease_rent", amount: 19200, currency: "USD", native_settlement: true, exchange_rate_to_xof: null } as PaymentRow;
const row = { id: "r", source_id: "native", source_type: "lease_contract", category: "lease_rent", due_date: "2026-06-22", status: "paid", amount_xof: 0, paid_amount_xof: 0, currency: "USD", amount_native: 19200, paid_amount_native: 19200 } as ReceivableRow;
describe("native rent is never an XOF amount", () => {
  it("keeps USD contractual rent and receipt labels without invented FX", () => {
    expect(leaseRentLabel(contract)).toBe("$3,200 USD");
    expect(paymentDisplay(payment)).toEqual({ primary: "$19,200 USD", secondary: "原币结算 · 不折算 XOF" });
    expect(paymentAmountXof(payment)).toBe(0);
    expect(paymentAmountXof({ ...payment, native_settlement: false, currency: "XOF", amount: 100, exchange_rate_to_xof: 1 })).toBe(100);
    expect(summarizeContractCash([payment]).excludedCount).toBe(0);
  });
  it("separates native receivables and never adds another currency", () => {
    expect(nativeReceivableSummary([row, { ...row, currency: "CNY", amount_native: 999 }], "USD", "2026-10-20")).toEqual({ total: 19200, paid: 19200, outstanding: 0, overdue: 0 });
    expect(financeRowMoney({ ...row })).toEqual({ currency: "USD", amount: 19200 });
  });
  it("renders monthly rent, history, coverage and zero USD debt", () => {
    const html = renderToStaticMarkup(<NativeLeaseFinance contract={contract} payments={[payment]} receivables={[row]} today="2026-10-20" locale="zh" />);
    expect(html).toContain("$19,200 USD");
    expect(html).toContain("$3,200 USD");
    expect(html).toContain("2026-11-30");
    expect(html).toContain("$0 USD");
    expect(html).not.toContain("历史汇率未核验");
  });
  it("rejects malformed aggregate currency and amounts", () => {
    expect(() => decodeNativeSummary([{ currency: "XOF" }])).toThrow();
    expect(() => decodeNativeSummary([{ currency: "USD", income: NaN }])).toThrow();
  });
  it("exports explicit original currency columns in both financial exports", () => {
    const result = { kind: "receivables" as const, page: 1, pageSize: 50, total: 1, summary: {}, rows: [{ ...row }] };
    expect(financeCsv(result)).toContain("currency,amount_native,paid_amount_native");
    expect(reportCsv(result)).toContain("原币金额（不并入XOF）");
    expect(reportCsv(result)).toContain('"USD","19200","19200"');
  });
});
