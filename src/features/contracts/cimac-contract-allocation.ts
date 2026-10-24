import type { PaymentRow } from "@/types/database";
import {
  cimacAdjustmentKind,
  isCimacProtectedPayment,
} from "@/features/finance/cimac-payment-kinds";

export interface CimacContractAllocation {
  contractId: string;
  amount: string;
  currency: "XOF";
  receivableIds: string[];
  adjustmentKind?: "refund" | "reversal";
  originalPaymentId?: string;
}
export type CimacContractPayment = PaymentRow & {
  /** Read-only attribution; the actual receipt's amount and customer source stay unchanged. */
  cimac_contract_allocation: CimacContractAllocation;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new Error("CimacContractAllocationUnavailable");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw invalid();
  return value.toLowerCase();
}
function integerAmount(value: unknown): bigint {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.0{1,2})?$/.test(raw)) throw invalid();
  const result = BigInt(raw.split(".")[0]);
  if (result <= BigInt(0)) throw invalid();
  return result;
}

/** Only explicit, scoped allocations can make a customer-level receipt contract cash. */
export function readCimacContractAllocation(
  payment: PaymentRow,
  expectedContractId?: string,
  expectedCustomerId?: string | null,
): CimacContractAllocation | null {
  if (!isCimacProtectedPayment(payment.source_type)) return null;
  try {
    identifier(payment.id);
    const customerId = identifier(payment.customer_id);
    identifier(payment.request_id);
    const adjustmentKind = cimacAdjustmentKind(payment.source_type);
    if (
      (!adjustmentKind && identifier(payment.source_id) !== customerId) ||
      payment.unit_id !== null ||
      (expectedCustomerId !== undefined && customerId !== expectedCustomerId) ||
      payment.currency !== "XOF" ||
      Number(payment.exchange_rate_to_xof) !== 1 ||
      payment.native_settlement !== false ||
      payment.request_kind !== payment.source_type ||
      (adjustmentKind === "reversal"
        ? payment.reversal_of_payment_id !== payment.source_id
        : payment.reversal_of_payment_id !== null) ||
      (adjustmentKind === "reversal"
        ? payment.payment_method !== "offset"
        : !["cash", "check", "bank_transfer", "other"].includes(payment.payment_method ?? ""))
    )
      throw invalid();
    const allocation = object((payment as CimacContractPayment).cimac_contract_allocation);
    if (
      Object.keys(allocation).some(
        (key) =>
          ![
            "contractId",
            "amount",
            "currency",
            "receivableIds",
            ...(adjustmentKind ? ["adjustmentKind", "originalPaymentId"] : []),
          ].includes(key),
      )
    )
      throw invalid();
    const contractId = identifier(allocation.contractId);
    const signedAmount = typeof allocation.amount === "string" ? allocation.amount : "";
    const headerAmount = String(payment.amount);
    const allocationAmount =
      adjustmentKind && signedAmount.startsWith("-") ? signedAmount.slice(1) : signedAmount;
    const originalPaymentId = adjustmentKind ? identifier(allocation.originalPaymentId) : undefined;
    if (
      (expectedContractId !== undefined && contractId !== expectedContractId) ||
      allocation.currency !== "XOF" ||
      typeof allocation.amount !== "string" ||
      (adjustmentKind
        ? !signedAmount.startsWith("-") ||
          allocation.adjustmentKind !== adjustmentKind ||
          originalPaymentId !== payment.source_id
        : signedAmount.startsWith("-")) ||
      (adjustmentKind === "reversal" && !headerAmount.startsWith("-")) ||
      integerAmount(allocationAmount) >
        integerAmount(adjustmentKind === "reversal" ? headerAmount.slice(1) : payment.amount) ||
      !Array.isArray(allocation.receivableIds) ||
      !allocation.receivableIds.length ||
      allocation.receivableIds.length > 100
    )
      throw invalid();
    const receivableIds = allocation.receivableIds.map(identifier);
    if (new Set(receivableIds).size !== receivableIds.length) throw invalid();
    return {
      contractId,
      amount: `${adjustmentKind ? "-" : ""}${integerAmount(allocationAmount)}`,
      currency: "XOF",
      receivableIds,
      ...(adjustmentKind ? { adjustmentKind, originalPaymentId } : {}),
    };
  } catch {
    return null;
  }
}

export function paymentBelongsToContract(payment: PaymentRow, contractId: string): boolean {
  return isCimacProtectedPayment(payment.source_type)
    ? readCimacContractAllocation(payment, contractId) !== null
    : payment.source_id === contractId;
}

export function decodeCimacLeaseCollectionProjection(
  value: unknown,
  contractId: string,
  customerId: string | null,
): CimacContractPayment[] {
  const result = object(value);
  if (
    result.contractId !== identifier(contractId) ||
    !Array.isArray(result.payments) ||
    result.payments.length > 10000 ||
    result.paymentCount !== result.payments.length
  )
    throw invalid();
  const seen = new Set<string>();
  const payments = result.payments.map((raw) => {
    const payment = object(raw) as unknown as PaymentRow;
    const allocation = readCimacContractAllocation(payment, contractId, customerId);
    if (!allocation || seen.has(payment.id)) throw invalid();
    seen.add(payment.id);
    return { ...payment, cimac_contract_allocation: allocation };
  });
  for (const original of payments.filter((p) => p.source_type === "cimac_customer_collection")) {
    const children = payments.filter(
      (p) => p.cimac_contract_allocation.originalPaymentId === original.id,
    );
    const refunds = children.filter((p) => p.cimac_contract_allocation.adjustmentKind === "refund"),
      reversals = children.filter((p) => p.cimac_contract_allocation.adjustmentKind === "reversal");
    const adjusted = children.reduce(
      (sum, p) => sum + BigInt(p.cimac_contract_allocation.amount),
      BigInt(0),
    );
    if (
      (refunds.length && reversals.length) ||
      reversals.length > 1 ||
      adjusted + BigInt(original.cimac_contract_allocation.amount) < BigInt(0) ||
      (reversals.length &&
        adjusted + BigInt(original.cimac_contract_allocation.amount) !== BigInt(0))
    )
      throw invalid();
  }
  for (const p of payments.filter((p) => p.cimac_contract_allocation.adjustmentKind)) {
    const original = payments.find(
      (o) =>
        o.id === p.cimac_contract_allocation.originalPaymentId &&
        o.source_type === "cimac_customer_collection",
    );
    if (
      !original ||
      !p.cimac_contract_allocation.receivableIds.every((id) =>
        original.cimac_contract_allocation.receivableIds.includes(id),
      ) ||
      (p.cimac_contract_allocation.adjustmentKind === "reversal"
        ? p.payment_date !== original.payment_date
        : p.payment_date < original.payment_date)
    )
      throw invalid();
  }
  return payments;
}
