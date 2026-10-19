export interface LeaseRentPeriodInput {
  expectedToken: string;
  paymentId: string;
  receivableId: string;
  paidThroughDate: string;
  reason: string;
}
export interface LeaseRentPeriodReview {
  contractId: string;
  token: string;
  paidThroughDate: string | null;
  payments: {
    id: string;
    paymentDate: string;
    amount: number;
    currency: string;
    receiptNo: string | null;
  }[];
  receivables: { id: string; title: string; amountXof: number; periodEnd: string | null }[];
}
export function parseLeaseRentPeriodInput(value: LeaseRentPeriodInput) {
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) =>
        !["expectedToken", "paymentId", "receivableId", "paidThroughDate", "reason"].includes(k),
    ) ||
    !/^[0-9a-f]{32}$/.test(value.expectedToken) ||
    !uuid.test(value.paymentId) ||
    !uuid.test(value.receivableId) ||
    typeof value.reason !== "string" ||
    !value.reason.trim() ||
    value.reason.length > 1000 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.paidThroughDate) ||
    !Number.isFinite(Date.parse(value.paidThroughDate + "T00:00:00Z")) ||
    new Date(value.paidThroughDate + "T00:00:00Z").toISOString().slice(0, 10) !==
      value.paidThroughDate
  ) {
    throw new Error("invalidLeasePeriodCorrection");
  }
  return value;
}
