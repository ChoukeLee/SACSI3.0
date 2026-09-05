// Database row types mirroring the Supabase schema.
// Hand-written initially; replace with `supabase gen types` when available.

import type {
  AssetSubtype,
  BuildingCode,
  BusinessType,
  ContractStatus,
  CurrencyCode,
  LocationGrade,
  PaymentStatus,
  ProjectConstructionStatus,
  UnitConstructionStatus,
  UnitKind,
  UnitStatus,
} from "./domain";

// ── Projects ──

export interface ProjectRow {
  id: string;
  code: string;
  display_name: string;
  brand_name: string | null;
  project_kind: string;
  construction_status: ProjectConstructionStatus;
  allows_daily_rental: boolean;
  allows_long_lease: boolean;
  allows_sale: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectInsert = Omit<ProjectRow, "id" | "created_at" | "updated_at">;
export type ProjectUpdate = Partial<ProjectInsert>;

// ── Buildings ──

export interface BuildingRow {
  id: string;
  project_id?: string;
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
  construction_status?: ProjectConstructionStatus;
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
  asset_subtype?: AssetSubtype;
  construction_status?: UnitConstructionStatus;
  location_grade?: LocationGrade | null;
  zone_label?: string | null;
  occupancy_verified?: boolean;
  reservation_holder_name?: string | null;
  reservation_main_business?: string | null;
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
  /** Legacy compatibility identity; use booking_agent_id for new workflows. */
  customer_id: string;
  booking_agent_id?: string;
  guest_customer_id?: string | null;
  guest_name?: string | null;
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
  start_date: string | null;
  expected_end_date: string | null;
  expected_end_confirmed?: boolean;
  paid_through_date?: string | null;
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
  agreement_group_no?: string | null;
  signing_state?: "signed" | "unsigned" | "pending_confirmation";
  signed_date?: string | null;
  commencement_state?: "started" | "pending_project_opening" | "cancelled_before_start";
  billable_months?: number | null;
  free_months?: number;
  term_months?: number | null;
  deposit_months?: number | null;
  source_reference?: string | null;
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
  total_amount_xof: number | null;
  total_amount_confirmed: boolean;
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
  payment_method?: "cash" | "check" | "bank_transfer" | "offset" | "other" | null;
  notes: string | null;
  request_id?: string | null;
  request_kind?: string | null;
  reversal_of_payment_id?: string | null;
  reversal_reason?: string | null;
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
export type ReceivableManagementStatus = "managed" | "historical_pending" | "excluded";

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
  management_status?: ReceivableManagementStatus;
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

// ── AI draft infrastructure ──

export type AiJobStatus = "input_received" | "analyzing" | "awaiting_confirmation" | "executing" | "completed" | "failed" | "cancelled";
export type AiProposalStatus = "awaiting_clarification" | "proposed" | "confirmed" | "executing" | "executed" | "rejected" | "expired" | "failed";

export interface AiJobRow {
  id: string;
  actor_id: string;
  actor_role: string;
  project_id: string | null;
  request_id: string;
  input_mode: "text" | "image" | "file" | "mixed";
  locale: "zh" | "fr";
  timezone: string;
  status: AiJobStatus;
  failure_code: string | null;
  failure_message: string | null;
  retention_until: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface AiInputRow {
  id: string;
  job_id: string;
  sequence_no: number;
  input_type: "text" | "image" | "pdf" | "spreadsheet" | "csv";
  raw_text: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  extracted_text: string | null;
  extraction_result: Record<string, unknown>;
  contains_sensitive_data: boolean;
  retention_until: string;
  redacted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiProposedActionRow {
  id: string;
  job_id: string;
  sequence_no: number;
  action_name: string;
  risk_level: "L1" | "L2" | "L3";
  status: AiProposalStatus;
  target: Record<string, unknown>;
  action_input: Record<string, unknown>;
  before_snapshot: Record<string, unknown>;
  before_versions: Record<string, string>;
  expected_effects: Array<Record<string, unknown>>;
  warnings: string[];
  confidence: number;
  requires_clarification: boolean;
  version: number;
  expires_at: string;
  confirmation_request_id: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  execution_request_id: string | null;
  execution_result: Record<string, unknown> | null;
  execution_error: string | null;
  executed_at: string | null;
  verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiActionEventRow {
  id: number;
  job_id: string;
  proposed_action_id: string | null;
  actor_id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  created_at: string;
}
