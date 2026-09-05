export type FinancialAllocationKind = "rent" | "property_fee" | "combined" | "needs_review";

export interface FinancialAllocationPlan {
  kind: FinancialAllocationKind;
  rentAmountXof: number;
  propertyAmountXof: number;
  confidence: number;
  warnings: string[];
}

interface FinancialAllocationInput {
  totalAmountXof: number;
  rentOutstandingXof: number;
  propertyOutstandingXof: number;
  hint?: "rent" | "property_fee" | null;
}

const sameAmount = (left: number, right: number) => Math.abs(left - right) < 1;

/**
 * Deterministic first-version allocator. It never invents a split: combined
 * payment is proposed only when the transfer exactly equals the two confirmed
 * outstanding balances. All other differences require human editing.
 */
export function planLeaseFinancialAllocation(input: FinancialAllocationInput): FinancialAllocationPlan {
  const total = Number(input.totalAmountXof);
  const rent = Math.max(0, Number(input.rentOutstandingXof));
  const property = Math.max(0, Number(input.propertyOutstandingXof));
  if (!Number.isFinite(total) || total <= 0) {
    return { kind: "needs_review", rentAmountXof: 0, propertyAmountXof: 0, confidence: 0, warnings: ["付款金额无效。"] };
  }

  if (rent > 0 && property > 0 && sameAmount(total, rent + property)) {
    return { kind: "combined", rentAmountXof: rent, propertyAmountXof: property, confidence: 0.99, warnings: [] };
  }
  if (input.hint === "rent" && rent > 0 && sameAmount(total, rent)) {
    return { kind: "rent", rentAmountXof: total, propertyAmountXof: 0, confidence: 0.99, warnings: [] };
  }
  if (input.hint === "property_fee" && property > 0 && sameAmount(total, property)) {
    return { kind: "property_fee", rentAmountXof: 0, propertyAmountXof: total, confidence: 0.99, warnings: [] };
  }
  if (rent > 0 && sameAmount(total, rent) && !sameAmount(total, property)) {
    return { kind: "rent", rentAmountXof: total, propertyAmountXof: 0, confidence: 0.97, warnings: [] };
  }
  if (property > 0 && sameAmount(total, property) && !sameAmount(total, rent)) {
    return { kind: "property_fee", rentAmountXof: 0, propertyAmountXof: total, confidence: 0.97, warnings: [] };
  }

  return {
    kind: "needs_review",
    rentAmountXof: 0,
    propertyAmountXof: 0,
    confidence: 0.35,
    warnings: [
      `付款 ${total} XOF 与已确认租金 ${rent} XOF、物业费 ${property} XOF 均不完全一致，系统不会自动拆分。`,
    ],
  };
}
