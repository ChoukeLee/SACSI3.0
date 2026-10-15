import { afterEach, describe, expect, it, vi } from "vitest";
import { printSaleContract } from "@/features/print/print-templates";
import type { SaleContractRow } from "@/types/database";

const contract = {
  id: "c",
  contract_no: "SALE-2026",
  total_amount_xof: 1000000,
  signed_date: "2026-10-01",
  payment_plan_type: "lump_sum",
  transfer_status: "not_started",
} as SaleContractRow;
afterEach(() => vi.unstubAllGlobals());
function capturePrint() {
  const write = vi.fn();
  vi.stubGlobal("window", {
    open: vi.fn(() => ({ document: { write, close: vi.fn() }, focus: vi.fn(), print: vi.fn() })),
  });
  return write;
}
describe("sale print obligation balance", () => {
  it("preserves unknown obligation state instead of printing zero collected and the contract total as debt", () => {
    const write = capturePrint();
    printSaleContract(
      { contract, unit: null, customer: null, paidAmountXof: null, outstandingAmountXof: null },
      "fr",
    );
    const html = write.mock.calls[0][0] as string;
    expect(html).toContain("Créances réglées");
    expect(html.match(/Aucune créance vérifiée/g)).toHaveLength(2);
    expect(html).not.toContain("万");
  });
  it("prints the supplied per-obligation balance without contract minus payment reconciliation guesses", () => {
    const write = capturePrint();
    printSaleContract(
      {
        contract,
        unit: null,
        customer: null,
        paidAmountXof: 1200000,
        outstandingAmountXof: 200000,
      },
      "zh",
    );
    const html = write.mock.calls[0][0] as string;
    expect(html).toContain("1,200,000 XOF");
    expect(html).toContain("200,000 XOF");
  });
  it("retains the two-decimal XOF precision in printed obligation balances", () => {
    const write = capturePrint();
    printSaleContract(
      { contract, unit: null, customer: null, paidAmountXof: 181.4, outstandingAmountXof: 362.8 },
      "fr",
    );
    const html = write.mock.calls[0][0] as string;
    expect(html).toContain("181,4 XOF");
    expect(html).toContain("362,8 XOF");
  });
});
