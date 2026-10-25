import { describe, expect, it } from "vitest";
import { scopeCustomerProfile } from "@/features/customers/customer-profile-scope";
import type {
  CustomerProfileData,
  ProfileAttachmentRow,
  ProfileAuditRow,
} from "@/features/customers/customer-profile-service";
import type {
  CustomerRow,
  DailyBookingRow,
  LeaseContractRow,
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  UnitRow,
} from "@/types/database";

const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customer = id(1),
  sacsiBuilding = id(2),
  cimacBuilding = id(3),
  sacsiUnit = id(4),
  cimacUnit = id(5);
const stamp = "2026-10-25T10:00:00Z";
const identity: CustomerRow = {
  id: customer,
  name: "Shared Customer",
  phone: "+2251234",
  gender: null,
  document_type: "passport",
  encrypted_document_no: "stored-document",
  notes: "Shared identity notes",
  is_blacklisted: false,
  blacklist_reason: null,
  blacklist_operator_id: null,
  blacklist_date: null,
  blacklist_permanent: false,
  created_at: stamp,
  updated_at: stamp,
};
const unit = (n: number, building_id: string) =>
  ({ id: id(n), building_id, unit_no: String(n) }) as UnitRow;
const booking = (n: number, unit_id: string) =>
  ({ id: id(n), unit_id, customer_id: customer, guest_customer_id: customer }) as DailyBookingRow;
const lease = (n: number, unit_id: string) =>
  ({
    id: id(n),
    unit_id,
    customer_id: customer,
    contract_no: `L-${n}`,
    monthly_rent_xof: 0,
    rent_currency: "USD",
    monthly_rent_amount: 1500,
  }) as LeaseContractRow;
const sale = (n: number, unit_id: string) =>
  ({ id: id(n), unit_id, customer_id: customer, contract_no: `S-${n}` }) as SaleContractRow;
const payment = (n: number, patch: Partial<PaymentRow> = {}): PaymentRow => ({
  id: id(n),
  customer_id: customer,
  unit_id: null,
  source_type: "lease_rent",
  source_id: null,
  payment_date: "2026-10-25",
  amount: 1500,
  currency: "USD",
  exchange_rate_to_xof: null,
  native_settlement: true,
  receipt_no: `R-${n}`,
  notes: null,
  created_at: stamp,
  ...patch,
});
const receivable = (n: number, patch: Partial<ReceivableRow> = {}): ReceivableRow => ({
  id: id(n),
  customer_id: customer,
  unit_id: null,
  building_id: null,
  source_type: "lease_contract",
  source_id: null,
  category: "lease_rent",
  title: `Rent ${n}`,
  due_date: "2026-10-25",
  amount_xof: 0,
  paid_amount_xof: 0,
  amount_native: 1500,
  paid_amount_native: 300,
  currency: "USD",
  status: "partial",
  created_at: stamp,
  updated_at: stamp,
  ...patch,
});
const audit = (n: number, entity_type: string, entity_id: string): ProfileAuditRow => ({
  id: id(n),
  entity_type,
  entity_id,
  action: "update",
  created_at: stamp,
  actor_id: id(99),
  actor_email: "operator@example.com",
  metadata: { detail: `${entity_type}:${entity_id}` },
});
const attachment = (
  n: number,
  patch: Partial<ProfileAttachmentRow> & { linked_type?: string } = {},
): ProfileAttachmentRow => ({
  id: id(n),
  storage_path: `receipts/${n}`,
  file_type: "receipt_image",
  ocr_text: null,
  metadata: null,
  paper_archive_status: "archived",
  uploaded_at: stamp,
  ...patch,
});
function fixture(): CustomerProfileData {
  return {
    customer: { ...identity },
    units: [unit(4, sacsiBuilding), unit(5, cimacBuilding)],
    dailyBookings: [booking(10, sacsiUnit), booking(11, cimacUnit)],
    agentBookings: [booking(12, sacsiUnit), booking(13, cimacUnit)],
    unresolvedBookings: [booking(14, sacsiUnit), booking(15, cimacUnit)],
    leaseContracts: [lease(20, sacsiUnit), lease(21, cimacUnit)],
    saleContracts: [sale(22, sacsiUnit), sale(23, cimacUnit)],
    payments: [payment(30, { source_id: id(20) }), payment(31, { source_id: id(21) })],
    receivables: [receivable(40, { source_id: id(20) }), receivable(41, { source_id: id(21) })],
    auditLogs: [
      audit(50, "customer", customer),
      audit(51, "lease_contract", id(20)),
      audit(52, "lease_contract", id(21)),
      audit(53, "payment", id(31)),
    ],
    attachments: [
      attachment(60, { linked_id: id(30), linked_type: "payment" }),
      attachment(61, { linked_id: id(31), linked_type: "payment" }),
    ],
  };
}
const scope = (data = fixture()) => scopeCustomerProfile(data, [sacsiBuilding]);
const rowIds = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("shared customer dossiers keep SACSI business separate from CIMAC", () => {
  it("retains the shared identity without making a second customer or mutating the source", () => {
    const data = fixture(),
      before = structuredClone(data),
      result = scope(data);
    expect(result.customer).toBe(data.customer);
    expect(result.customer).toEqual(identity);
    expect(result.projectScope).toBe("SACSI");
    expect(data).toEqual(before);
  });
  it("retains only SACSI units and separately filters each confirmed or unresolved business role", () => {
    const result = scope();
    expect(rowIds(result.units)).toEqual([sacsiUnit]);
    expect(rowIds(result.dailyBookings)).toEqual([id(10)]);
    expect(rowIds(result.agentBookings)).toEqual([id(12)]);
    expect(rowIds(result.unresolvedBookings)).toEqual([id(14)]);
    expect(rowIds(result.leaseContracts)).toEqual([id(20)]);
    expect(rowIds(result.saleContracts)).toEqual([id(22)]);
    expect(rowIds(result.payments)).toEqual([id(30)]);
    expect(rowIds(result.receivables)).toEqual([id(40)]);
  });
  it("preserves native-currency rent, collection, amounts and missing exchange rates exactly", () => {
    const data = fixture();
    data.payments.push(
      payment(32, { unit_id: sacsiUnit, currency: "CNY", amount: 8400, source_id: null }),
    );
    const result = scope(data);
    expect(result.leaseContracts[0]).toBe(data.leaseContracts[0]);
    expect(result.payments[0]).toBe(data.payments[0]);
    expect(result.payments[0]).toMatchObject({
      amount: 1500,
      currency: "USD",
      exchange_rate_to_xof: null,
      native_settlement: true,
    });
    expect(result.payments[1]).toMatchObject({
      amount: 8400,
      currency: "CNY",
      exchange_rate_to_xof: null,
    });
    expect(result.receivables[0]).toMatchObject({
      currency: "USD",
      amount_xof: 0,
      amount_native: 1500,
      paid_amount_xof: 0,
      paid_amount_native: 300,
    });
  });
  it("does not attribute unlinked money by the shared customer, matching name, date or amount", () => {
    const data = fixture();
    data.payments = [
      payment(32, { source_type: "manual", notes: "SACSI rent" }),
      payment(33, { source_id: id(999) }),
    ];
    data.receivables = [
      receivable(42, { source_type: "manual", title: "SACSI rent" }),
      receivable(43, { source_id: id(999) }),
    ];
    expect(scope(data).payments).toEqual([]);
    expect(scope(data).receivables).toEqual([]);
  });
  it("keeps explicitly attributed unit or building money even without a contract source", () => {
    const data = fixture();
    data.payments = [payment(32, { unit_id: sacsiUnit, source_type: "manual" })];
    data.receivables = [receivable(42, { building_id: sacsiBuilding, source_type: "manual" })];
    expect(rowIds(scope(data).payments)).toEqual([id(32)]);
    expect(rowIds(scope(data).receivables)).toEqual([id(42)]);
  });
  it("rejects known CIMAC contract sources despite a contradictory SACSI unit or building", () => {
    const data = fixture();
    data.payments = [payment(32, { unit_id: sacsiUnit, source_id: id(21) })];
    data.receivables = [receivable(42, { building_id: sacsiBuilding, source_id: id(21) })];
    expect(scope(data).payments).toEqual([]);
    expect(scope(data).receivables).toEqual([]);
  });
  it("rejects a known foreign unit or building despite a matching SACSI source", () => {
    const data = fixture();
    data.payments = [payment(32, { unit_id: cimacUnit, source_id: id(20) })];
    data.receivables = [receivable(42, { building_id: cimacBuilding, source_id: id(20) })];
    expect(scope(data).payments).toEqual([]);
    expect(scope(data).receivables).toEqual([]);
  });
  it("keeps only SACSI attachment links and excludes an unassigned shared-identity document", () => {
    const data = fixture();
    data.attachments.push(
      attachment(62, { linked_id: customer, linked_type: "customer" }),
      attachment(63, { unit_id: sacsiUnit }),
      attachment(64, { unit_id: cimacUnit }),
    );
    expect(rowIds(scope(data).attachments)).toEqual([id(60), id(63)]);
  });
  it("rejects attachment unit/source conflicts in both directions", () => {
    const data = fixture();
    data.attachments = [
      attachment(62, { unit_id: sacsiUnit, linked_id: id(31), linked_type: "payment" }),
      attachment(63, { unit_id: cimacUnit, linked_id: id(30), linked_type: "payment" }),
    ];
    expect(scope(data).attachments).toEqual([]);
  });
  it("does not display CIMAC audit events and strips arbitrary shared-identity metadata", () => {
    const result = scope();
    expect(rowIds(result.auditLogs)).toEqual([id(50), id(51)]);
    expect(result.auditLogs[0].metadata).toBeNull();
    expect(result.auditLogs[1].metadata).not.toBeNull();
    expect(result.auditLogs[0].actor_id).toBe(id(99));
  });
  it("can show the shared identity with no SACSI relationship without inventing a zero account", () => {
    const result = scopeCustomerProfile(fixture(), []);
    expect(result.customer.id).toBe(customer);
    expect(result.units).toEqual([]);
    expect(result.payments).toEqual([]);
    expect(result.receivables).toEqual([]);
    expect(rowIds(result.auditLogs)).toEqual([id(50)]);
    expect(result.attachments).toEqual([]);
  });
  it("uses source_type rather than a coincident lease UUID to attribute a sale receivable", () => {
    const data = fixture();
    data.saleContracts = [sale(20, cimacUnit)];
    data.receivables = [receivable(42, { source_type: "sale_contract", source_id: id(20) })];
    data.payments = [payment(32, { source_type: "sale", source_id: id(20) })];
    expect(scope(data).receivables).toEqual([]);
    expect(scope(data).payments).toEqual([]);
  });
  it("does not lose a valid lease source because another domain has the same foreign UUID", () => {
    const data = fixture();
    data.saleContracts = [sale(20, cimacUnit)];
    data.payments = [payment(32, { source_type: "lease_rent", source_id: id(20) })];
    expect(rowIds(scope(data).payments)).toEqual([id(32)]);
  });
  it("uses audit entity_type rather than a coincident UUID belonging to another domain", () => {
    const data = fixture();
    data.saleContracts = [sale(20, cimacUnit)];
    data.auditLogs = [audit(54, "sale_contract", id(20)), audit(55, "lease_contract", id(20))];
    expect(rowIds(scope(data).auditLogs)).toEqual([id(55)]);
  });
  it("uses attachment linked_type when a foreign payment and a local lease share a UUID", () => {
    const data = fixture();
    data.payments = [payment(20, { source_id: id(21) })];
    data.attachments = [
      attachment(62, { linked_id: id(20), linked_type: "payment" }),
      attachment(63, { linked_id: id(20), linked_type: "lease_contract" }),
    ];
    expect(rowIds(scope(data).attachments)).toEqual([id(63)]);
  });
});
