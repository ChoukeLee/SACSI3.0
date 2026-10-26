type LeaseTimingInput = {
  status: string;
  start_date?: string | null;
};

/** Derive display timing from the business date without changing the recorded lifecycle status. */
export function isFutureLease(contract: LeaseTimingInput, asOf: string): boolean {
  return contract.status === "active" && !!contract.start_date && contract.start_date > asOf;
}

/** An expected end date alone never confirms that an active tenant has moved out. */
export function isCurrentLease(contract: LeaseTimingInput, asOf: string): boolean {
  return contract.status === "active" && !!contract.start_date && contract.start_date <= asOf;
}

export function leaseStatusLabel(
  contract: LeaseTimingInput,
  asOf: string,
  locale: "zh" | "fr",
  fallback: string,
): string {
  return isFutureLease(contract, asOf) ? (locale === "zh" ? "待起租" : "À venir") : fallback;
}
