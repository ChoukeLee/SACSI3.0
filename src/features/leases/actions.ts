"use server";
// Compatibility entrypoint: business implementations are grouped by responsibility.
import * as contract from "./lease-contract-actions";
import * as payment from "./lease-payment-actions";
import * as moveout from "./lease-moveout-actions";
export async function createLeaseContract(
  ...args: Parameters<typeof contract.createLeaseContract>
) {
  return contract.createLeaseContract(...args);
}
export async function activateContract(...args: Parameters<typeof contract.activateContract>) {
  return contract.activateContract(...args);
}
export async function terminateContract(...args: Parameters<typeof contract.terminateContract>) {
  return contract.terminateContract(...args);
}
export async function recordLeaseFinancialEntry(
  ...args: Parameters<typeof payment.recordLeaseFinancialEntry>
) {
  return payment.recordLeaseFinancialEntry(...args);
}
export async function recordCombinedLeasePayment(
  ...args: Parameters<typeof payment.recordCombinedLeasePayment>
) {
  return payment.recordCombinedLeasePayment(...args);
}
export async function processMoveOut(...args: Parameters<typeof moveout.processMoveOut>) {
  return moveout.processMoveOut(...args);
}
