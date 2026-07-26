export const LEASE_FINANCIAL_BUSINESS_TYPES = [
  "rent_income",
  "deposit_income",
  "agency_income",
  "agency_expense",
  "property_fee_income",
  "furniture_income",
  "deposit_refund",
  "other_income",
  "other_expense",
] as const;

export type LeaseFinancialBusinessType = typeof LEASE_FINANCIAL_BUSINESS_TYPES[number];

export interface LeaseFinancialBusinessConfig {
  code: string;
  labelZh: string;
  labelFr: string;
  sourceType: string;
  ledgerDirection: "income" | "expense" | "liability_in" | "liability_out";
  ledgerCategory: string;
  requiresPaidThrough: boolean;
}

export const LEASE_FINANCIAL_BUSINESS_CONFIG: Record<LeaseFinancialBusinessType, LeaseFinancialBusinessConfig> = {
  rent_income: {
    code: "RENT",
    labelZh: "租金收入",
    labelFr: "Revenu de loyer",
    sourceType: "lease_rent",
    ledgerDirection: "income",
    ledgerCategory: "lease_rent",
    requiresPaidThrough: true,
  },
  deposit_income: {
    code: "DEP",
    labelZh: "押金收入",
    labelFr: "Dépôt reçu",
    sourceType: "lease_deposit",
    ledgerDirection: "liability_in",
    ledgerCategory: "lease_deposit",
    requiresPaidThrough: false,
  },
  agency_income: {
    code: "AGI",
    labelZh: "中介费收入",
    labelFr: "Revenu de commission",
    sourceType: "lease_agency_income",
    ledgerDirection: "income",
    ledgerCategory: "lease_agency_income",
    requiresPaidThrough: false,
  },
  agency_expense: {
    code: "AGE",
    labelZh: "中介费支出",
    labelFr: "Dépense de commission",
    sourceType: "lease_agency_expense",
    ledgerDirection: "expense",
    ledgerCategory: "lease_agency_expense",
    requiresPaidThrough: false,
  },
  property_fee_income: {
    code: "PROP",
    labelZh: "物业费收入",
    labelFr: "Charges locatives reçues",
    sourceType: "property_fee",
    ledgerDirection: "income",
    ledgerCategory: "property_fee",
    requiresPaidThrough: false,
  },
  furniture_income: {
    code: "FURN",
    labelZh: "家具费收入",
    labelFr: "Revenu mobilier",
    sourceType: "lease_furniture_income",
    ledgerDirection: "income",
    ledgerCategory: "furniture_fee",
    requiresPaidThrough: false,
  },
  deposit_refund: {
    code: "DEPREF",
    labelZh: "押金退还",
    labelFr: "Remboursement de dépôt",
    sourceType: "lease_deposit_refund",
    ledgerDirection: "liability_out",
    ledgerCategory: "lease_deposit",
    requiresPaidThrough: false,
  },
  other_income: {
    code: "OIN",
    labelZh: "其他收入",
    labelFr: "Autre revenu",
    sourceType: "lease_other_income",
    ledgerDirection: "income",
    ledgerCategory: "other_income",
    requiresPaidThrough: false,
  },
  other_expense: {
    code: "OEX",
    labelZh: "其他支出（代垫/维修/网络等）",
    labelFr: "Autre dépense",
    sourceType: "lease_other_expense",
    ledgerDirection: "expense",
    ledgerCategory: "other_expense",
    requiresPaidThrough: false,
  },
};

export const LEASE_FINANCIAL_SOURCE_TYPES = Array.from(new Set(
  Object.values(LEASE_FINANCIAL_BUSINESS_CONFIG).map((config) => config.sourceType),
));

export function getLeaseFinancialConfig(type: LeaseFinancialBusinessType) {
  return LEASE_FINANCIAL_BUSINESS_CONFIG[type];
}

export function getLeaseFinancialConfigBySourceType(sourceType: string) {
  return Object.values(LEASE_FINANCIAL_BUSINESS_CONFIG).find((config) => config.sourceType === sourceType);
}

export function isLeaseFinancialExpenseSourceType(sourceType: string) {
  if (sourceType === "lease_deposit_deduction" || sourceType === "lease_rent_refund") return true;
  const direction = getLeaseFinancialConfigBySourceType(sourceType)?.ledgerDirection;
  return direction === "expense" || direction === "liability_out";
}

function compactDate(date: string) {
  return date.replaceAll("-", "");
}

export function buildLeaseContractNumber(buildingCode: string, unitNo: string, startDate: string) {
  if (!buildingCode || !unitNo || !startDate) return "";
  return `LEASE-${buildingCode}-${unitNo}-${compactDate(startDate)}`;
}

export function buildLeaseFinancialReferencePrefix(
  contractNo: string,
  type: LeaseFinancialBusinessType,
  paymentDate: string,
) {
  return `${contractNo}-${getLeaseFinancialConfig(type).code}-${compactDate(paymentDate)}`;
}
