import type { CurrencyCode } from "@/types/domain";
import type {
  LeaseContractRow,
  SaleContractRow,
  ReceivableRow,
  PaymentRow,
  UnitRow,
} from "@/types/database";

/** Exact decimal strings cross the RPC boundary; native money never enters XOF totals. */
export type CimacMoney = string;
export type CimacFeeCategory =
  "lease_rent" | "lease_deposit" | "property_fee" | "water" | "electricity" | "management_fee";
export interface CimacCurrencyBalance {
  currency: CurrencyCode;
  receivable: CimacMoney;
  paid: CimacMoney;
  outstanding: CimacMoney;
  overdue: CimacMoney;
}
export interface CimacCustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  unitCount: number;
  contractCount: number;
  pendingCount: number;
  balances: CimacCurrencyBalance[];
}
export interface CimacAccountUnit extends UnitRow {
  building_label: string;
  building_code: string;
}
export interface CimacAccountContract {
  kind: "lease" | "sale";
  id: string;
  unitId: string;
  customerId: string;
  contractNo: string;
  status: string;
  data: LeaseContractRow | SaleContractRow;
}
export interface CimacAccountReceivable extends ReceivableRow {
  outstanding: CimacMoney;
  collectible: boolean;
  /** Derived at the read boundary; an unknown or inconsistent legacy balance is not zero. */
  reviewReason?: string;
}
export interface CimacAccountPayment extends PaymentRow {
  protected_collection: boolean;
}
export interface CimacAccountAllocation {
  paymentId: string;
  receivableId: string;
  currency: CurrencyCode;
  amount: CimacMoney;
}
export interface CimacFeeTerm {
  id: string;
  customerId: string;
  contractId: string;
  unitId: string;
  category: CimacFeeCategory;
  status: "pending_review";
  monthlyRate: CimacMoney | null;
  pricingBasis: "per_sqm" | "per_unit" | "pending";
  chargeableArea: CimacMoney | null;
  currency: CurrencyCode;
  startsOn: string | null;
  endsOn: string | null;
  annualStartsOn: string | null;
  annualEndsOn: string | null;
  proration: "daily_pending_convention" | "pending";
  source: string;
  notes: string | null;
  updatedAt: string;
  createdAt: string;
  recordedBy: string;
}
export interface CimacMeterReading {
  id: string;
  customerId: string;
  contractId: string;
  unitId: string;
  meterKind: "water" | "electricity";
  meterNo: string;
  serviceMonth: string;
  readOn: string;
  previousReading: CimacMoney | null;
  currentReading: CimacMoney;
  usage: CimacMoney | null;
  evidence: string | null;
  notes: string | null;
  status: "recorded_pending_rate";
  updatedAt: string;
  createdAt: string;
  recordedBy: string;
}
export interface CimacCustomerAccount {
  project: { id: string; code: "CIMAC"; display_name: string };
  canWrite: boolean;
  complete: true;
  customerPage: { rows: CimacCustomerSummary[]; total: number; page: number; pageSize: number };
  selectedCustomerId: string | null;
  customer: CimacCustomerSummary | null;
  units: CimacAccountUnit[];
  contracts: CimacAccountContract[];
  receivables: CimacAccountReceivable[];
  payments: CimacAccountPayment[];
  allocations: CimacAccountAllocation[];
  feeTerms: CimacFeeTerm[];
  meterReadings: CimacMeterReading[];
}
export interface CimacFeeTermInput {
  id?: string;
  customerId: string;
  contractId: string;
  unitId: string;
  category: CimacFeeCategory;
  currency: CurrencyCode;
  monthlyRate?: CimacMoney | null;
  pricingBasis: "per_sqm" | "per_unit" | "pending";
  chargeableArea?: CimacMoney | null;
  startsOn?: string | null;
  endsOn?: string | null;
  annualStartsOn?: string | null;
  annualEndsOn?: string | null;
  proration: "daily_pending_convention" | "pending";
  source: string;
  notes?: string | null;
  expectedUpdatedAt?: string;
}
export interface CimacMeterReadingInput {
  id?: string;
  customerId: string;
  contractId: string;
  unitId: string;
  meterKind: "water" | "electricity";
  meterNo: string;
  serviceMonth: string;
  readOn: string;
  previousReading?: CimacMoney | null;
  currentReading: CimacMoney;
  evidence?: string | null;
  notes?: string | null;
  expectedUpdatedAt?: string;
}
export interface CimacCollectionInput {
  customerId: string;
  paymentDate: string;
  currency: "XOF";
  amount: CimacMoney;
  paymentMethod: "cash" | "check" | "bank_transfer" | "other";
  externalReceiptNo?: string;
  actualCollector?: string;
  collectorBasis?: string;
  notes?: string;
  allocations: Array<{
    receivableId: string;
    amount: CimacMoney;
    expectedOutstanding: CimacMoney;
    expectedUpdatedAt: string;
  }>;
}
export type CimacBillingWriteKind = "fee_terms" | "meter_reading" | "collection";
export interface CimacBillingWriteResult {
  success: true;
  status: "completed";
  kind: CimacBillingWriteKind;
  requestId: string;
  actorId: string;
  customerId: string;
  entityId: string;
  auditId: string;
  idempotent: boolean;
  paymentId?: string;
  receiptNo?: string | null;
  amount?: CimacMoney;
  currency?: "XOF";
  allocations?: CimacAccountAllocation[];
  record?: CimacFeeTerm | CimacMeterReading;
}
export type CimacBillingRequestResult =
  CimacBillingWriteResult | { status: "not_found"; requestId: string };
