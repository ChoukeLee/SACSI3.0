export type ExportDataType =
  | "units" | "customers" | "daily_bookings" | "lease_contracts"
  | "sale_contracts" | "receivables" | "payments";

export type ImportDataType =
  | "customers" | "units" | "receivables" | "payments"
  | "lease_contracts" | "sale_contracts";

export type ImportRowStatus = "ok" | "warning" | "error";

export interface ImportRow {
  row: number;
  data: Record<string, string>;
  status: ImportRowStatus;
  message: string;
}

export interface ImportResult {
  rows: ImportRow[];
  okCount: number;
  warnCount: number;
  errCount: number;
  canSubmit: boolean;
}

export interface ImportSubmitResult {
  success: boolean;
  inserted: number;
  errors: number;
  messages: string[];
}

export const EXPORT_LABELS: Record<string, Record<ExportDataType, string>> = {
  zh: {
    units: "房源", customers: "客户", daily_bookings: "日租预订",
    lease_contracts: "长租合同", sale_contracts: "出售合同",
    receivables: "应收台账", payments: "收款记录",
  },
  fr: {
    units: "Logements", customers: "Clients", daily_bookings: "Reservations",
    lease_contracts: "Baux", sale_contracts: "Ventes",
    receivables: "Creances", payments: "Paiements",
  },
};

export const IMPORT_LABELS: Record<string, Record<ImportDataType, string>> = {
  zh: {
    customers: "客户", units: "房源", receivables: "应收台账",
    payments: "收款记录", lease_contracts: "长租合同", sale_contracts: "出售合同",
  },
  fr: {
    customers: "Clients", units: "Logements", receivables: "Creances",
    payments: "Paiements", lease_contracts: "Baux", sale_contracts: "Ventes",
  },
};

// Role-based permissions
export type DataExchangeRole = "admin" | "boss" | "finance" | "front_desk";

export const ROLE_EXPORT_TYPES: Record<DataExchangeRole, ExportDataType[]> = {
  admin: ["units","customers","daily_bookings","lease_contracts","sale_contracts","receivables","payments"],
  boss: ["units","customers","daily_bookings","lease_contracts","sale_contracts","receivables","payments"],
  finance: ["customers","receivables","payments"],
  front_desk: ["customers","daily_bookings"],
};

export const ROLE_IMPORT_TYPES: Record<DataExchangeRole, ImportDataType[]> = {
  admin: ["customers","units","receivables","payments","lease_contracts","sale_contracts"],
  boss: ["customers","units","receivables","payments","lease_contracts","sale_contracts"],
  finance: ["customers","receivables","payments"],
  front_desk: ["customers"],
};
