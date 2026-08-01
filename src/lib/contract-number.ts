const UNIT_REFERENCE_ALIASES: Record<string, string> = {
  "大门面房": "STOREFRONT-L",
  "小门面房": "STOREFRONT-S",
  "门面房": "STOREFRONT",
  "大仓库": "WAREHOUSE-LARGE",
  "小车库": "GARAGE-SMALL",
  "车库1": "GARAGE01",
  "6F前楼": "6F-FRONT",
};

function compactDate(date: string) {
  return date.replaceAll("-", "");
}

export function contractReferenceToken(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "-");
  return UNIT_REFERENCE_ALIASES[normalized] ?? normalized;
}

function buildContractNumber(type: "LEASE" | "SALE", buildingCode: string, unitNo: string, date: string) {
  if (!buildingCode || !unitNo || !date) return "";
  return `WB-${type}-${contractReferenceToken(buildingCode)}-${contractReferenceToken(unitNo)}-${compactDate(date)}`;
}

export function buildLeaseContractNumber(buildingCode: string, unitNo: string, startDate: string) {
  return buildContractNumber("LEASE", buildingCode, unitNo, startDate);
}

export function buildSaleContractNumber(buildingCode: string, unitNo: string, signedDate: string) {
  return buildContractNumber("SALE", buildingCode, unitNo, signedDate);
}
