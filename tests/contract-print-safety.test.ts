// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  printLeaseContract,
  printSaleContract,
  reservePrintWindow,
  type SaleContractPrintData,
} from "../src/features/print/print-templates";
import type { LeaseContractRow } from "../src/types/database";
import { workspaceFixture } from "./fixtures/contract-workspace";
afterEach(() => vi.restoreAllMocks());
it.each(["zh", "fr"] as const)(
  "prints legal unknown draft dates as pending, never an inferred period (%s)",
  (locale) => {
    let html = "";
    const popup = {
      document: {
        write: (value: string) => {
          html = value;
        },
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
      onload: null,
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const data = workspaceFixture();
    Object.assign(data.contracts[0], {
      status: "draft",
      start_date: null,
      expected_end_date: null,
      expected_end_confirmed: true,
    });
    printLeaseContract(
      {
        contract: data.contracts[0] as LeaseContractRow,
        unit: data.units[0],
        customer: data.customers[0],
      },
      locale,
    );
    expect(html.match(new RegExp(locale === "zh" ? "待确认" : "À confirmer", "g"))).toHaveLength(2);
    expect(html).not.toMatch(/null|undefined|NaN|1970-01-01/);
  },
);
it.each(["zh", "fr"] as const)(
  "escapes all lease/sale business text without double-escaping constructed markup (%s)",
  (locale) => {
    let html = "";
    const popup = {
      document: {
        open: vi.fn(),
        write: (value: string) => {
          html = value;
        },
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
      onload: null,
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const d = workspaceFixture(),
      attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>&\'"';
    const contract = {
        ...d.contracts[0],
        contract_no: attack,
        signer_name: attack,
      } as LeaseContractRow,
      customer = { ...d.customers[0], name: attack, phone: attack };
    printLeaseContract({ contract, unit: d.units[0], customer, receivables: [] }, locale);
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("&amp;lt;");
    expect(html).toContain("<table");
    expect(html).toContain("100");
    const sale = {
      ...d.contracts[0],
      contract_no: attack,
      signed_date: "2026-10-15",
      total_amount_xof: 100,
      payment_plan_type: "lump_sum",
      agency_company: attack,
      agent_name: attack,
      agency_commission_xof: 0,
      agency_commission_paid: false,
      transfer_status: "not_started",
      transfer_date: null,
      title_certificate_no: attack,
    } as unknown as SaleContractPrintData["contract"];
    printSaleContract(
      {
        contract: sale,
        unit: d.units[0],
        customer,
        paidAmountXof: null,
        outstandingAmountXof: null,
      },
      locale,
    );
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("&amp;lt;");
    expect(html).toContain("100");
  },
);
it("reserves a non-financial loading document and safely closes it if the browser refuses document access", () => {
  const close = vi.fn(),
    write = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({
    document: { write, close: vi.fn() },
    close,
    opener: window,
  } as unknown as Window);
  expect(reservePrintWindow("zh")).not.toBeNull();
  expect(write.mock.calls[0][0]).toContain("尚未展示账务金额");
  write.mockImplementation(() => {
    throw new Error("synthetic blocked");
  });
  expect(reservePrintWindow("zh")).toBeNull();
  expect(close).toHaveBeenCalled();
});
