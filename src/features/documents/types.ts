import type {
  LeaseContractRow, DailyBookingRow, SaleContractRow,
  ReceivableRow, PaymentRow, UnitRow, CustomerRow,
} from "@/types/database";

export type DocumentType =
  | "lease_contract"
  | "lease_receipt"
  | "lease_reminder"
  | "daily_booking"
  | "daily_receipt"
  | "daily_checkout"
  | "sale_contract"
  | "sale_receipt";

export type DocumentSource = "lease" | "daily" | "sale" | "finance";

export const DOC_TYPE_SOURCE: Record<DocumentType, DocumentSource> = {
  lease_contract: "lease",
  lease_receipt: "lease",
  lease_reminder: "lease",
  daily_booking: "daily",
  daily_receipt: "daily",
  daily_checkout: "daily",
  sale_contract: "sale",
  sale_receipt: "sale",
};

export const DOC_TYPE_LABELS: Record<Locale, Record<DocumentType, string>> = {
  zh: {
    lease_contract: "长租合同摘要单",
    lease_receipt: "长租收款收据",
    lease_reminder: "长租催款通知单",
    daily_booking: "日租入住/预订单",
    daily_receipt: "日租收款收据",
    daily_checkout: "日租退房结算单",
    sale_contract: "出售合同摘要单",
    sale_receipt: "出售收款收据",
  },
  fr: {
    lease_contract: "Resume contrat location",
    lease_receipt: "Recu loyer",
    lease_reminder: "Avis de retard loyer",
    daily_booking: "Reservation journaliere",
    daily_receipt: "Recu journalier",
    daily_checkout: "Decompte depart",
    sale_contract: "Resume contrat vente",
    sale_receipt: "Recu vente",
  },
};

export const SOURCE_LABELS: Record<Locale, Record<DocumentSource, string>> = {
  zh: { lease: "长租", daily: "日租", sale: "出售", finance: "财务" },
  fr: { lease: "Location", daily: "Journalier", sale: "Vente", finance: "Finance" },
};

export type Locale = "zh" | "fr";

/** Unified document record for listing/filtering. */
export interface DocumentRecord {
  id: string;          // unique: type + original id
  docType: DocumentType;
  source: DocumentSource;
  title: string;
  date: string;
  unitNo: string;
  customerName: string;
  customerPhone?: string;
  contractNo?: string;
  amountXof: number;
  paidAmountXof: number;
  status: string;
  raw: unknown;        // original data for template rendering
}

export interface DocumentTemplateProps {
  data: DocumentRecord;
  locale: Locale;
}
