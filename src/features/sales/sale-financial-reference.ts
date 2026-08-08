import { contractReferenceToken } from "@/lib/contract-number";

function compactDate(date: string) {
  return date.replaceAll("-", "");
}

function buildingReferencePrefix(buildingCode: string) {
  const normalized = contractReferenceToken(buildingCode);
  const match = /^SACSI(.+)$/i.exec(normalized);
  return match ? `WB${match[1]}` : `WB-${normalized}`;
}

export function buildSaleFinancialReferencePrefix(
  buildingCode: string,
  unitNo: string,
  paymentDate: string,
  businessCode = "HOUSE",
) {
  return `${buildingReferencePrefix(buildingCode)}-SALE-${contractReferenceToken(unitNo)}-${compactDate(paymentDate)}-${contractReferenceToken(businessCode)}`;
}

export function getNextSaleFinancialSequence(referenceNos: Array<string | null>) {
  return referenceNos.reduce((highest, referenceNo) => {
    const match = referenceNo?.match(/^WB.+-(\d+)$/i);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}

export function appendSaleFinancialSequence(prefix: string, sequence: number) {
  return `${prefix}-${String(sequence).padStart(2, "0")}`;
}
