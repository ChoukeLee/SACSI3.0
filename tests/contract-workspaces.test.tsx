// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/sales/actions", () => ({
  createSaleContract: vi.fn(),
  recordSalePaymentAtomic: vi.fn(),
  addFlexibleInstallment: vi.fn(),
  updateTransferStatus: vi.fn(),
  terminateSaleContract: vi.fn(),
}));
vi.mock("@/features/leases/actions", () => ({
  createLeaseContract: vi.fn(),
  activateContract: vi.fn(),
  terminateContract: vi.fn(),
  processMoveOut: vi.fn(),
  recordLeaseFinancialEntry: vi.fn(),
}));
vi.mock("@/features/print", () => ({ printLeaseContract: vi.fn(), printSaleContract: vi.fn() }));
import { SaleList } from "@/features/sales/sale-list";
import { LeaseList } from "@/features/leases/lease-list";
import type {
  CustomerRow,
  LeaseContractRow,
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  UnitRow,
} from "@/types/database";

const buildings = [
  {
    id: "b",
    code: "SACSI11",
    display_name: "11#公寓",
    project_id: "p",
    project: { id: "p", code: "SACSI", display_name: "SACSI" },
  },
];
const units = [
  { id: "u", building_id: "b", unit_no: "503", floor_label: "5", status: "leased" },
] as UnitRow[];
const customers = [
  { id: "c", name: "完整客户 Émilie Dupont", phone: "01020304", is_blacklisted: false },
] as CustomerRow[];
const sale = {
  id: "sale",
  unit_id: "u",
  customer_id: "c",
  contract_no: "SACSI11-503-SALE-20260101",
  signed_date: "2026-01-01",
  status: "active",
  transfer_status: "not_started",
  payment_plan_type: "lump_sum",
  total_amount_xof: 1000000,
  total_amount_confirmed: true,
  agency_commission_paid: true,
  agency_commission_amount_xof: 300000,
} as SaleContractRow;
const lease = {
  id: "lease",
  unit_id: "u",
  customer_id: "c",
  contract_no: "SACSI11-503-LEASE-20260101",
  start_date: "2026-01-01",
  expected_end_date: "2029-01-01",
  paid_through_date: "2028-12-31",
  monthly_rent_xof: 1000000,
  deposit_amount_xof: 3000000,
  status: "active",
  payment_cycle: "monthly",
} as LeaseContractRow;
const receivable = (source_type: string, source_id: string) =>
  ({
    id: "r",
    source_type,
    source_id,
    amount_xof: 1000000,
    paid_amount_xof: 200000,
    due_date: "2026-01-01",
    status: "partial",
    management_status: "managed",
  }) as ReceivableRow;
const payment = (source_id: string, source_type: string, amount = 1200000) =>
  ({
    id: source_type,
    source_id,
    source_type,
    amount,
    payment_date: "2026-01-01",
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_method: "cash",
  }) as PaymentRow;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function summaryValue(label: string) {
  const card = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith(label),
  );
  return card?.textContent;
}
async function openCustomer() {
  await act(async () =>
    (host.querySelector("tbody td:nth-child(2) button") as HTMLButtonElement).click(),
  );
  // A table selection opens the authoritative Inspector, not another full-detail dialog.
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const inspector = host.querySelector(
    '[aria-label="出售合同履约详情"], [aria-label="Détails du contrat de vente"], [aria-label="合同预览"]',
  )!;
  expect(inspector).not.toBeNull();
  return inspector;
}
async function openFinance(inspector: Element) {
  const finance = [...inspector.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => /^(账务|Finances|付款事实|Paiements)$/.test(button.textContent ?? ""),
  );
  expect(finance).toBeTruthy();
  await act(async () => finance!.click());
}

it("sale default table keeps full identity and separates allocated receivables from recorded cash", async () => {
  await act(async () =>
    root.render(
      <SaleList
        contracts={[sale]}
        schedules={[]}
        units={units}
        customers={customers}
        payments={[payment("sale", "sale_contract")]}
        receivables={[receivable("sale_contract", "sale")]}
        buildings={buildings}
        locale="zh"
        canCreate={false}
        canRecordFinance={false}
        canManage={false}
        canTerminate={false}
      />,
    ),
  );
  expect(host.querySelector("table")).toBeTruthy();
  expect(summaryValue("到期未收")).toContain("800,000 XOF");
  expect(host.querySelector("tbody")?.textContent).toContain("应收未收 800,000 XOF");
  expect(host.textContent).toContain(sale.contract_no);
  const dialog = await openCustomer();
  expect(dialog.textContent).toContain("应收已核销200,000 XOF");
  await openFinance(dialog);
  expect(dialog.textContent).toContain("经营收款1,200,000 XOF");
  expect(dialog.querySelector('[role="tabpanel"]')?.textContent).not.toContain("300,000 XOF"); // Contract commission flags are not cash evidence.
});

it("sale missing managed obligations remains unknown instead of treating cash or contract total as allocation", async () => {
  await act(async () =>
    root.render(
      <SaleList
        contracts={[sale]}
        schedules={[]}
        units={units}
        customers={customers}
        payments={[payment("sale", "sale_contract")]}
        receivables={[]}
        buildings={buildings}
        locale="fr"
        canCreate={false}
      />,
    ),
  );
  expect(summaryValue("Dû impayé")).toContain("—");
  expect(host.textContent).toContain("Aucune créance vérifiée");
  expect(host.textContent).not.toContain("万");
  const dialog = await openCustomer();
  expect(dialog.textContent).toContain("Aucune créance vérifiée");
});

it("lease financial details keep refundable deposits outside operating income", async () => {
  await act(async () =>
    root.render(
      <LeaseList
        contracts={[lease]}
        units={units}
        customers={customers}
        payments={[payment("lease", "lease_rent"), payment("lease", "lease_deposit", 3000000)]}
        receivables={[receivable("lease_contract", "lease")]}
        buildings={buildings}
        locale="zh"
        canCreate={false}
        canRecordFinance={false}
      />,
    ),
  );
  const dialog = await openCustomer();
  await openFinance(dialog);
  expect(dialog.textContent).toContain("已录经营收款1,200,000 XOF");
  expect(dialog.textContent).toContain("已录押金实收3,000,000 XOF");
  expect(dialog.textContent).not.toContain("已录经营收款4,200,000 XOF");
});
