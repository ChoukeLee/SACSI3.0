// Database row types mirroring the Supabase schema.
// Hand-written initially; replace with `supabase gen types` when available.

import type { BuildingCode, UnitKind, UnitStatus, ContractStatus, PaymentStatus, CurrencyCode, BusinessType } from "./domain";

// ── Buildings ──

export interface BuildingRow {
  id: string;
  code: BuildingCode;
  display_name: string;
  address: string | null;
  district: string | null;
  city: string | null;
  built_year: number | null;
  floors_above_ground: number;
  elevator_count: number;
  is_active: boolean;
  business_paused: boolean;
  created_at: string;
  updated_at: string;
}

export type BuildingInsert = Omit<BuildingRow, "id" | "created_at" | "updated_at">;
export type BuildingUpdate = Partial<BuildingInsert>;

// ── Units ──

export interface UnitRow {
  id: string;
  building_id: string;
  code: string;
  unit_no: string;
  floor_label: string;
  kind: UnitKind;
  status: UnitStatus;
  area_sqm: number | null;
  layout: string | null;
  furnishing: "none" | "basic" | "full" | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type UnitInsert = Omit<UnitRow, "id" | "created_at" | "updated_at">;
export type UnitUpdate = Partial<UnitInsert>;

// ── Unit Business Flags ──

export interface UnitBusinessFlagRow {
  unit_id: string;
  business_type: BusinessType;
  is_enabled: boolean;
  default_price_xof: number | null;
}

export type UnitBusinessFlagInsert = UnitBusinessFlagRow;
export type UnitBusinessFlagUpdate = Partial<UnitBusinessFlagRow>;

// ── Customers ──

export interface CustomerRow {
  id: string;
  name: string;
  gender: string | null;
  document_type: string | null;
  encrypted_document_no: string | null;
  phone: string | null;
  notes: string | null;
  is_blacklisted: boolean;
  blacklist_reason: string | null;
  blacklist_operator_id: string | null;
  blacklist_date: string | null;
  blacklist_permanent: boolean;
  created_at: string;
  updated_at: string;
}

export type CustomerInsert = Omit<CustomerRow, "id" | "created_at" | "updated_at">;
export type CustomerUpdate = Partial<CustomerInsert>;

// ── Daily Bookings ──

export interface DailyBookingRow {
  id: string;
  unit_id: string;
  customer_id: string;
  check_in: string;
  check_out: string | null;
  checkout_mode: "fixed" | "open";
  actual_check_out: string | null;
  nightly_price_xof: number;
  total_amount_xof: number;
  prepaid_amount_xof: number;
  billing_status: "prepaid" | "partially_paid" | "need_top_up" | "settled";
  manual_discount_amount_xof: number;
  manual_discount_reason: string | null;
  final_amount_xof: number | null;
  status: string;
  ota_source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type DailyBookingInsert = Omit<DailyBookingRow, "id" | "created_at" | "updated_at">;
export type DailyBookingUpdate = Partial<DailyBookingInsert>;

// ── Lease Contracts ──

export interface LeaseContractRow {
  id: string;
  unit_id: string;
  customer_id: string;
  contract_no: string;
  start_date: string;
  expected_end_date: string;
  actual_end_date: string | null;
  payment_cycle: string;
  payment_day: number;
  monthly_rent_xof: number;
  deposit_amount_xof: number;
  deposit_received: boolean;
  rent_free_days: number;
  signer_name: string | null;
  attachment_url: string | null;
  status: ContractStatus;
  created_at: string;
  updated_at: string;
}

export type LeaseContractInsert = Omit<LeaseContractRow, "id" | "created_at" | "updated_at">;
export type LeaseContractUpdate = Partial<LeaseContractInsert>;

// ── Sale Contracts ──

export interface SaleContractRow {
  id: string;
  unit_id: string;
  customer_id: string;
  contract_no: string;
  signed_date: string;
  transfer_date: string | null;
  transfer_status: string;
  title_certificate_no: string | null;
  agency_company: string | null;
  agent_name: string | null;
  agency_commission_amount_xof: number | null;
  agency_commission_paid: boolean;
  payment_plan_type: string;
  total_amount_xof: number;
  attachment_url: string | null;
  status: ContractStatus;
  created_at: string;
  updated_at: string;
}

export type SaleContractInsert = Omit<SaleContractRow, "id" | "created_at" | "updated_at">;
export type SaleContractUpdate = Partial<SaleContractInsert>;

// ── Sale Payment Schedule ──

export interface SalePaymentScheduleRow {
  id: string;
  sale_contract_id: string;
  installment_no: number;
  due_date: string;
  amount_xof: number;
  status: PaymentStatus;
  created_at: string;
}

export type SalePaymentScheduleInsert = Omit<SalePaymentScheduleRow, "id" | "created_at">;
export type SalePaymentScheduleUpdate = Partial<SalePaymentScheduleInsert>;

// ── Payments ──

export interface PaymentRow {
  id: string;
  customer_id: string | null;
  unit_id: string | null;
  source_type: string;
  source_id: string | null;
  payment_date: string;
  amount: number;
  currency: CurrencyCode;
  exchange_rate_to_xof: number;
  receipt_no: string | null;
  notes: string | null;
  created_at: string;
}

export type PaymentInsert = Omit<PaymentRow, "id" | "created_at">;
export type PaymentUpdate = Partial<PaymentInsert>;

// ── Ledger Entries ──

export interface LedgerEntryRow {
  id: string;
  building_id: string | null;
  unit_id: string | null;
  payment_id: string | null;
  entry_date: string;
  direction: "income" | "expense" | "liability_in" | "liability_out";
  category: string;
  amount_xof: number;
  amount_cny: number | null;
  description: string | null;
  created_at: string;
}

export type LedgerEntryInsert = Omit<LedgerEntryRow, "id" | "created_at">;
export type LedgerEntryUpdate = Partial<LedgerEntryInsert>;

// ── Cleaning Tasks ──

export interface CleaningTaskRow {
  id: string;
  unit_id: string;
  daily_booking_id: string | null;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
}

export type CleaningTaskInsert = Omit<CleaningTaskRow, "id" | "created_at">;
export type CleaningTaskUpdate = Partial<CleaningTaskInsert>;

// ── Receivables ──

export type ReceivableSourceType = "daily_booking" | "lease_contract" | "sale_contract" | "manual";
export type ReceivableCategory = "daily_rental" | "lease_rent" | "lease_deposit" | "sale_installment" | "sale_lump_sum" | "other";
export type ReceivableStatus = "pending" | "partial" | "paid" | "overdue" | "cancelled";

export interface ReceivableRow {
  id: string;
  building_id: string | null;
  unit_id: string | null;
  customer_id: string | null;
  source_type: ReceivableSourceType;
  source_id: string | null;
  category: ReceivableCategory;
  title: string;
  due_date: string;
  amount_xof: number;
  paid_amount_xof: number;
  status: ReceivableStatus;
  currency: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type ReceivableInsert = Omit<ReceivableRow, "id" | "created_at" | "updated_at">;
export type ReceivableUpdate = Partial<ReceivableInsert>;

// ── Lease Settlements ──

export interface LeaseSettlementRow {
  id: string;
  lease_contract_id: string;
  unit_id: string;
  customer_id: string;
  actual_end_date: string;
  unpaid_rent_xof: number;
  utility_cleared: boolean;
  deposit_amount_xof: number;
  deposit_deduction_xof: number;
  deposit_refund_xof: number;
  total_due_xof: number;
  total_refund_xof: number;
  notes: string | null;
  created_at: string;
}

export type LeaseSettlementInsert = Omit<LeaseSettlementRow, "id" | "created_at">;
export type LeaseSettlementUpdate = Partial<LeaseSettlementInsert>;
