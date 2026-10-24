import { describe, expect, it } from "vitest";
import {
  decodeCimacLeaseCollectionProjection,
  paymentBelongsToContract,
  readCimacContractAllocation,
  type CimacContractPayment,
} from "@/features/contracts/cimac-contract-allocation";
import {
  classifyContractCashPayment,
  summarizeContractCash,
} from "@/features/contracts/contract-cash-model";
import { decodeWorkspace } from "@/features/contracts/workspace-model";
import {
  workspaceFixture,
  workspaceContract,
  workspaceCustomer,
} from "./fixtures/contract-workspace";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const receivableId = "77777777-7777-4777-8777-777777777777";
function payment(): CimacContractPayment {
  return {
    id: id(1),
    customer_id: workspaceCustomer,
    unit_id: null,
    source_type: "cimac_customer_collection",
    source_id: workspaceCustomer,
    amount: 640000,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    native_settlement: false,
    payment_date: "2026-01-01",
    payment_method: "bank_transfer",
    receipt_no: "TEST-ONE-RECEIPT",
    notes: null,
    request_id: id(2),
    request_kind: "cimac_customer_collection",
    reversal_of_payment_id: null,
    created_at: "2026-01-01T12:00:00Z",
    cimac_contract_allocation: {
      contractId: workspaceContract,
      amount: "600000",
      currency: "XOF",
      receivableIds: [receivableId],
    },
  };
}

describe("one actual receipt with explicit contract-attributed cash", () => {
  it("counts only each contract's exact portion and never rewrites or multiplies the original receipt", () => {
    const first = payment(),
      second = {
        ...payment(),
        cimac_contract_allocation: {
          contractId: id(3),
          amount: "40000",
          currency: "XOF" as const,
          receivableIds: [id(4)],
        },
      };
    expect(classifyContractCashPayment(first)).toEqual({ kind: "income", amountXof: 600000 });
    expect(classifyContractCashPayment(second)).toEqual({ kind: "income", amountXof: 40000 });
    expect(summarizeContractCash([first]).income).toBe(600000);
    expect(summarizeContractCash([second]).income).toBe(40000);
    expect(summarizeContractCash([first, second]).income).toBe(640000);
    expect(first.amount).toBe(640000);
    expect(first.source_id).toBe(workspaceCustomer);
    expect(first.receipt_no).toBe(second.receipt_no);
    expect(first.id).toBe(second.id);
    expect(paymentBelongsToContract(first, workspaceContract)).toBe(true);
    expect(paymentBelongsToContract(first, id(3))).toBe(false);
  });

  it("excludes unscoped customer receipts instead of charging their full header amount to a contract", () => {
    const raw = { ...payment(), cimac_contract_allocation: undefined };
    expect(readCimacContractAllocation(raw)).toBeNull();
    expect(classifyContractCashPayment(raw)).toMatchObject({
      kind: "excluded",
      reason: "unsupported_source",
    });
    expect(summarizeContractCash([raw]).income).toBe(0);
    expect(paymentBelongsToContract(raw, workspaceCustomer)).toBe(false);
  });

  it.each([
    { amount: "640001" },
    { amount: "1.01" },
    { amount: "0" },
    { amount: "-1" },
    { amount: "1e3" },
    { amount: 1 },
    { currency: "USD" },
    { contractId: "bad" },
    { receivableIds: [] },
    { receivableIds: [receivableId, receivableId] },
    { receivableIds: ["bad"] },
    { automaticAllocation: true },
  ])("refuses invalid, foreign-currency or inferred allocation metadata %#", (extra) => {
    const p = payment();
    Object.assign(p.cimac_contract_allocation, extra);
    expect(readCimacContractAllocation(p)).toBeNull();
    expect(classifyContractCashPayment(p).kind).toBe("excluded");
  });

  it.each([
    { source_id: id(3) },
    { customer_id: null },
    { unit_id: id(4) },
    { currency: "CNY" },
    { native_settlement: true },
    { exchange_rate_to_xof: 2 },
    { payment_method: "offset" },
    { reversal_of_payment_id: id(4) },
    { request_id: null },
    { request_kind: "lease_rent" },
    { amount: 599999 },
  ])("requires the actual customer receipt's identity, cash and no-FX facts %#", (extra) => {
    const p = { ...payment(), ...extra } as CimacContractPayment;
    expect(readCimacContractAllocation(p)).toBeNull();
  });

  it("requires complete projection counts, request target and same-customer identity", () => {
    const data = { contractId: workspaceContract, paymentCount: 1, payments: [payment()] };
    expect(
      decodeCimacLeaseCollectionProjection(data, workspaceContract, workspaceCustomer),
    ).toEqual(data.payments);
    for (const extra of [
      { contractId: id(3) },
      { paymentCount: 2 },
      { payments: [payment(), payment()], paymentCount: 2 },
    ])
      expect(() =>
        decodeCimacLeaseCollectionProjection(
          { ...data, ...extra },
          workspaceContract,
          workspaceCustomer,
        ),
      ).toThrow();
    expect(() => decodeCimacLeaseCollectionProjection(data, workspaceContract, id(3))).toThrow();
    expect(
      decodeCimacLeaseCollectionProjection(
        { contractId: workspaceContract, paymentCount: 0, payments: [] },
        workspaceContract,
        workspaceCustomer,
      ),
    ).toEqual([]);
  });

  it("survives the real client workspace decoder without fabricating contract source or payment amount", () => {
    const data = workspaceFixture({ payments: [payment()], paymentCount: 1 }, undefined, "detail");
    const result = decodeWorkspace(data, "lease", data.query, "detail", workspaceContract);
    expect(result.payments[0].source_id).toBe(workspaceCustomer);
    expect(result.payments[0].amount).toBe(640000);
    expect(summarizeContractCash(result.payments).income).toBe(600000);
    const wrongContract = structuredClone(data);
    (wrongContract.payments[0] as CimacContractPayment).cimac_contract_allocation.contractId =
      id(3);
    expect(() =>
      decodeWorkspace(wrongContract, "lease", data.query, "detail", workspaceContract),
    ).toThrow();
    const wrongBill = structuredClone(data);
    (wrongBill.payments[0] as CimacContractPayment).cimac_contract_allocation.receivableIds = [
      id(4),
    ];
    expect(() =>
      decodeWorkspace(wrongBill, "lease", data.query, "detail", workspaceContract),
    ).toThrow();
  });

  it("leaves native USD/CNY and historical converted receipts on their existing classification path", () => {
    const original = {
      ...payment(),
      source_type: "lease_rent",
      source_id: workspaceContract,
      currency: "CNY" as const,
      amount: 100,
      exchange_rate_to_xof: 80,
      native_settlement: false,
    };
    expect(classifyContractCashPayment(original)).toEqual({ kind: "income", amountXof: 8000 });
    expect(readCimacContractAllocation(original)).toBeNull();
    expect(classifyContractCashPayment({ ...original, native_settlement: true })).toMatchObject({
      kind: "excluded",
      reason: "native_currency",
    });
  });
});
