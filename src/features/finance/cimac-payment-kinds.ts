export const cimacProtectedPaymentTypes = [
  "cimac_customer_collection",
  "cimac_customer_refund",
  "cimac_customer_reversal",
] as const;
export function isCimacProtectedPayment(value: string): boolean {
  return (cimacProtectedPaymentTypes as readonly string[]).includes(value);
}
export function cimacAdjustmentKind(value: string): "refund" | "reversal" | null {
  return value === "cimac_customer_refund"
    ? "refund"
    : value === "cimac_customer_reversal"
      ? "reversal"
      : null;
}
