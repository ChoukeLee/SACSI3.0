import type { PaymentRow } from "@/types/database";

export interface CimacContractAllocation {
  contractId: string;
  amount: string;
  currency: "XOF";
  receivableIds: string[];
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
  if (payment.source_type !== "cimac_customer_collection") return null;
  try {
    identifier(payment.id);
    const customerId = identifier(payment.customer_id);
    identifier(payment.request_id);
    if (
      identifier(payment.source_id) !== customerId ||
      payment.unit_id !== null ||
      (expectedCustomerId !== undefined && customerId !== expectedCustomerId) ||
      payment.currency !== "XOF" ||
      Number(payment.exchange_rate_to_xof) !== 1 ||
      payment.native_settlement !== false ||
      payment.request_kind !== "cimac_customer_collection" ||
      payment.reversal_of_payment_id !== null ||
      !["cash", "check", "bank_transfer", "other"].includes(payment.payment_method ?? "")
    )
      throw invalid();
    const allocation = object((payment as CimacContractPayment).cimac_contract_allocation);
    if (
      Object.keys(allocation).some(
        (key) => !["contractId", "amount", "currency", "receivableIds"].includes(key),
      )
    )
      throw invalid();
    const contractId = identifier(allocation.contractId);
    if (
      (expectedContractId !== undefined && contractId !== expectedContractId) ||
      allocation.currency !== "XOF" ||
      typeof allocation.amount !== "string" ||
      integerAmount(allocation.amount) > integerAmount(payment.amount) ||
      !Array.isArray(allocation.receivableIds) ||
      !allocation.receivableIds.length ||
      allocation.receivableIds.length > 100
    )
      throw invalid();
    const receivableIds = allocation.receivableIds.map(identifier);
    if (new Set(receivableIds).size !== receivableIds.length) throw invalid();
    return {
      contractId,
      amount: String(integerAmount(allocation.amount)),
      currency: "XOF",
      receivableIds,
    };
  } catch {
    return null;
  }
}

export function paymentBelongsToContract(payment: PaymentRow, contractId: string): boolean {
  return payment.source_type === "cimac_customer_collection"
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
  return result.payments.map((raw) => {
    const payment = object(raw) as unknown as PaymentRow;
    const allocation = readCimacContractAllocation(payment, contractId, customerId);
    if (!allocation || seen.has(payment.id)) throw invalid();
    seen.add(payment.id);
    return { ...payment, cimac_contract_allocation: allocation };
  });
}
