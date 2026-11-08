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
    building_id: "b",
    unit_id: "u",
    customer_id: "c",
    source_type,
    source_id,
    category: source_type === "sale_contract" ? "sale_lump_sum" : "lease_rent",
    amount_xof: 1000000,
    paid_amount_xof: 200000,
    due_date: "2026-01-01",
    status: "partial",
    management_status: "managed",
    currency: "XOF",
    amount_native: null,
    paid_amount_native: null,
  }) as ReceivableRow;
const payment = (source_id: string, source_type: string, amount = 1200000) =>
  ({
    id: source_type,
    unit_id: "u",
    customer_id: "c",
    source_id,
    source_type,
    amount,
    payment_date: "2026-01-01",
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_method: "cash",
    native_settlement: false,
    request_kind: null,
    reversal_of_payment_id: null,
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
async function openCustomer() {
  const room = host.querySelector<HTMLButtonElement>("[data-room-id], [data-sale-room-id]");
  expect(room).toBeTruthy();
  await act(async () => room!.click());
  const inspector = document.querySelector(
    'aside[aria-label="租赁资料"], aside[aria-label="出售合同履约详情"], aside[aria-label="Détails du contrat de vente"]',
  );
  expect(inspector).not.toBeNull();
  return inspector!;
}
async function openFinance(inspector: Element) {
  const finance = [...inspector.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) =>
      /^(收支明细|Encaissements et dépenses|账务|Finances|付款事实|Paiements)$/.test(
        button.textContent ?? "",
      ),
  );
  expect(finance).toBeTruthy();
  await act(async () => finance!.click());
}

it("sale default cards and their detail keep full identity and separate allocated receivables from recorded cash", async () => {
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
  const room = host.querySelector("[data-sale-room-id]");
  expect(room?.textContent).toContain("503");
  expect(room?.textContent).toContain(customers[0].name);
  expect(room?.textContent).toContain("800,000 XOF");
  expect(host.querySelector("table")).toBeNull();
  expect(host.textContent).not.toContain("列表核对");
  const dialog = await openCustomer();
  expect(dialog.textContent).toContain(customers[0].name);
  const registration = [...dialog.querySelectorAll("summary")].find(
    (item) => item.textContent === "合同登记资料",
  )!;
  await act(async () => registration.click());
  expect(dialog.textContent).toContain(sale.contract_no);
  expect(dialog.textContent).toContain("2026-01-01");
  await openFinance(dialog);
  expect(dialog.textContent).toContain("已建应收未收800,000 XOF");
  expect(dialog.textContent).toContain("应收已核销200,000 XOF");
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
  expect(host.querySelector("table")).toBeNull();
  expect(host.querySelector("[data-sale-room-id]")?.textContent).toContain(
    "Créances restantesÀ vérifier",
  );
  expect(host.textContent).not.toContain("万");
  const dialog = await openCustomer();
  await openFinance(dialog);
  expect(dialog.textContent).toContain("Aucune créance vérifiée");
});

it("keeps a no-sale CIMAC project read-only even when sale action capabilities are present", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await act(async () =>
    root.render(
      <SaleList
        contracts={[sale]}
        schedules={[]}
        units={units}
        customers={customers}
        payments={[]}
        receivables={[]}
        buildings={[
          {
            ...buildings[0],
            code: "CIMAC1",
            project_id: projectId,
            project: { id: projectId, code: "CIMAC", display_name: "CIMAC", allows_sale: false },
          },
        ]}
        initialProject={projectId}
        noSaleProject
        locale="zh"
        canCreate
        canRecordFinance
        canManage
        canTerminate
      />,
    ),
  );
  expect(host.textContent).toContain("当前项目不开展出售业务");
  expect(host.textContent).toContain("CIMAC 只租不卖");
  expect(host.querySelector("[data-sale-room-id], table")).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).not.toContain("登记收款");
  expect(host.textContent).not.toContain("新增分期");
  expect(fetch).not.toHaveBeenCalled();
  const links = [...host.querySelectorAll<HTMLAnchorElement>("a")];
  expect(links.some((link) => link.getAttribute("href") === `/units?project=${projectId}`)).toBe(
    true,
  );
  expect(links.some((link) => link.getAttribute("href") === `/leases?project=${projectId}`)).toBe(
    true,
  );
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
