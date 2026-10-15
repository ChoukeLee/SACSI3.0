export type ReceiptKind = "collection" | "refund" | "reversal" | "excluded";
export type ReceiptMethod =
  "all" | "cash" | "check" | "bank_transfer" | "offset" | "other" | "unknown";
export interface ReceiptFilters {
  month: string;
  dateFrom: string;
  dateTo: string;
  buildingId: string;
  query: string;
  method: ReceiptMethod;
  kind: "all" | ReceiptKind;
  page: number;
}
export interface ReceiptPeriod {
  from: string;
  to: string;
}
export interface ReceiptPeriods {
  current: ReceiptPeriod;
  previous: ReceiptPeriod;
  year: ReceiptPeriod;
  trend: ReceiptPeriod;
  partial: boolean;
  custom: boolean;
}
export interface ReceiptSummary {
  gross: number;
  refund: number;
  adjustment: number;
  net: number;
  count: number;
  excludedCount: number;
}
export interface ReceiptLine {
  id: string;
  date: string;
  createdAt: string;
  bookingId: string | null;
  unitId: string | null;
  room: string | null;
  buildingId: string | null;
  buildingName: string | null;
  guestName: string | null;
  bookingAgentName: string | null;
  receiptNo: string | null;
  paymentMethod: string | null;
  amount: number | null;
  currency: string;
  amountXof: number | null;
  kind: ReceiptKind;
  exclusionReason: string | null;
  reversalOf: string | null;
  notes: string | null;
}
export interface ReceiptTrend extends ReceiptSummary {
  month: string;
}
export interface ReceiptReadResult {
  rows: ReceiptLine[];
  total: number;
  summary: ReceiptSummary;
  previous: ReceiptSummary;
  year: ReceiptSummary;
  trend: ReceiptTrend[];
  coverage: { firstDate: string | null; lastDate: string | null };
  buildings: { id: string; code: string; name: string }[];
  generatedAt: string;
}
export interface ReceiptComparison {
  status:
    | "available"
    | "insufficient_history"
    | "non_positive_baseline"
    | "excluded_records"
    | "unequal_period";
  amount: number | null;
  percent: number | null;
  period: ReceiptPeriod;
}
export interface ReceiptAnalysis extends ReceiptReadResult {
  filters: ReceiptFilters;
  periods: ReceiptPeriods;
  comparisons: { previous: ReceiptComparison; year: ReceiptComparison };
  pageSize: number;
}
export interface ReceiptDetailData {
  booking: { checkIn: string; checkOut: string | null; status: string } | null;
  attachments: { id: string; url: string | null; fileType: string; archiveStatus: string | null }[];
  audit: {
    id: string;
    createdAt: string;
    action: string;
    actorId: string | null;
    actorName: string | null;
  }[];
  auditAllowed: boolean;
  attachmentsUnavailable: boolean;
  auditUnavailable: boolean;
}
