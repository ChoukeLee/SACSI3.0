/** Actual collection against explicitly selected, existing lease receivables. */
export interface LeaseCollectionAllocation {
  receivableId: string;
  amount: number;
  /** Exact remaining amount seen by the user, not merely a sufficient balance. */
  expectedOutstanding: number;
  expectedUpdatedAt?: string;
}

/** Opt-in confirmation of an already documented, fully paid contiguous range. */
export interface LeaseCollectionCoverage {
  expectedPaidThroughDate: string;
  expectedContractUpdatedAt: string;
  throughDate: string;
  receivableIds: string[];
}

export interface LeaseCollectionInput {
  contractId: string;
  paymentDate: string;
  currency: "XOF" | "USD" | "CNY";
  amount: number;
  paymentMethod: "cash" | "check" | "bank_transfer" | "other";
  externalReceiptNo?: string;
  actualCollector?: string;
  collectorBasis?: string;
  notes?: string;
  allocations: LeaseCollectionAllocation[];
  coverage?: LeaseCollectionCoverage;
  requestId: string;
}

export interface LeaseCollectionSuccess {
  success: true;
  requestId: string;
  referenceNos: string[];
  paymentIds: string[];
  allocations: Array<{
    receivableId: string;
    amount: number;
    paymentId?: string;
    currency?: LeaseCollectionInput["currency"];
  }>;
  currency: LeaseCollectionInput["currency"];
  totalAmount: number;
  paidThroughBefore: string | null;
  paidThroughAfter: string | null;
  coverage?: { throughDate: string; receivableIds: string[] };
  idempotent?: boolean;
}

export interface LeaseCollectionFailure {
  success: false;
  error: string;
  /** True only when this attempt is known not to have committed. */
  rejected: boolean;
}

export type LeaseCollectionResult = LeaseCollectionSuccess | LeaseCollectionFailure;

export type LeaseCollectionReceiptResult =
  | { status: "found"; contractId: string; receipt: LeaseCollectionSuccess }
  | { status: "not_found" }
  | { status: "unavailable"; error: string };
