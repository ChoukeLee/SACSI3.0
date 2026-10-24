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
  cimac_adjustment?: CimacCollectionAdjustment;
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
export type CimacCollectionAdjustmentKind = "refund" | "reversal";
export interface CimacAdjustmentAllocationInput {
  receivableId: string;
  amount: CimacMoney;
  expectedRemaining: CimacMoney;
  expectedPaid: CimacMoney;
  expectedUpdatedAt: string;
}
export interface CimacCollectionAdjustmentInput {
  originalPaymentId: string;
  customerId: string;
  currency: "XOF";
  amount: CimacMoney;
  reason: string;
  expectedPositionToken: string;
  allocations: CimacAdjustmentAllocationInput[];
  notes?: string;
}
export interface CimacRefundInput extends CimacCollectionAdjustmentInput {
  /** Actual money already returned; this is a registration, not a bank transfer. */
  paymentDate: string;
  paymentMethod: "cash" | "check" | "bank_transfer" | "other";
  externalReceiptNo?: string;
}
/** Full erroneous-receipt correction, not an actual money-out transaction. */
export type CimacReversalInput = CimacCollectionAdjustmentInput;
export interface CimacCollectionAdjustment {
  id: string;
  requestId: string;
  paymentId: string;
  originalPaymentId: string;
  kind: CimacCollectionAdjustmentKind;
  paymentDate: string;
  effectiveDate: string;
  amount: CimacMoney;
  currency: "XOF";
  paymentMethod: CimacRefundInput["paymentMethod"] | "offset";
  reason: string;
  recordedBy: string;
  auditId: string;
  receiptNo: string | null;
  createdAt: string;
  allocations: Array<{ receivableId: string; amount: CimacMoney }>;
}
export interface CimacCollectionPosition {
  originalPaymentId: string;
  customerId: string;
  currency: "XOF";
  originalPaymentDate: string;
  originalPaymentMethod: CimacRefundInput["paymentMethod"];
  originalReceiptNo: string | null;
  originalAmount: CimacMoney;
  refundedAmount: CimacMoney;
  reversedAmount: CimacMoney;
  remainingAmount: CimacMoney;
  positionToken: string;
  canRefund: boolean;
  canReverse: boolean;
  allocations: Array<{
    receivableId: string;
    contractId: string;
    unitId: string;
    title: string;
    originalAmount: CimacMoney;
    refundedAmount: CimacMoney;
    reversedAmount: CimacMoney;
    remainingAmount: CimacMoney;
    paidAmount: CimacMoney;
    updatedAt: string;
  }>;
  adjustments: CimacCollectionAdjustment[];
}
export type CimacCollectionPositionResult =
  | { status: "available"; position: CimacCollectionPosition }
  | { status: "unavailable"; error: string };
export type CimacBillingWriteKind =
  "fee_terms" | "meter_reading" | "collection" | CimacCollectionAdjustmentKind;
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
  originalPaymentId?: string;
  remainingBefore?: CimacMoney;
  remainingAfter?: CimacMoney;
  paymentDate?: string;
  effectiveDate?: string;
  paymentMethod?: CimacRefundInput["paymentMethod"] | "offset";
  allocations?: CimacAccountAllocation[];
  record?: CimacFeeTerm | CimacMeterReading;
}
export type CimacBillingRequestResult =
  CimacBillingWriteResult | { status: "not_found"; requestId: string };
