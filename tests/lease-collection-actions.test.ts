import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), requireRole: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import {
  recordLeaseCollection,
  readLeaseCollectionReceipt,
} from "@/features/leases/lease-collection-actions";
import {
  parseLeaseCollectionInput,
  decodeLeaseCollectionResult,
  decodeLeaseCollectionReceipt,
} from "@/features/leases/lease-collection-service";
import type { LeaseCollectionInput } from "@/features/leases/lease-collection-types";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function input(extra: Record<string, unknown> = {}): LeaseCollectionInput {
  return {
    contractId: id(1),
    requestId: id(2),
    paymentDate: "2026-01-01",
    currency: "XOF",
    amount: 640000,
    paymentMethod: "bank_transfer",
    allocations: [
      { receivableId: id(3), amount: 600000, expectedOutstanding: 600000 },
      { receivableId: id(4), amount: 40000, expectedOutstanding: 40000 },
    ],
    ...extra,
  } as LeaseCollectionInput;
}
function success(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    requestId: id(2),
    referenceNos: ["Synthetic-RENT-01", "Synthetic-PROP-01"],
    paymentIds: [id(5), id(6)],
    allocations: [
      { receivableId: id(3), amount: 600000, paymentId: id(5), currency: "XOF" },
      { receivableId: id(4), amount: 40000, paymentId: id(6), currency: "XOF" },
    ],
    currency: "XOF",
    totalAmount: 640000,
    paidThroughBefore: "2026-08-31",
    paidThroughAfter: "2026-08-31",
    idempotent: false,
    ...extra,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: success(), error: null });
});
it("uses exactly one authenticated RPC and the caller's stable master request", async () => {
  const result = await recordLeaseCollection(
    input({
      externalReceiptNo: "  R-1  ",
      actualCollector: " 黄姐 ",
      collectorBasis: " 明确凭证 ",
      notes: " 已实际收到 ",
    }),
  );
  expect(result).toEqual(success());
  expect(mocks.requireRole).toHaveBeenCalledWith("admin", "finance");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  const [name, args] = mocks.rpc.mock.calls[0];
  expect(name).toBe("lease_collection_rpc");
  expect(args.p_request_id).toBe(id(2));
  expect(args.p_input).toMatchObject({
    actualCollector: "黄姐",
    collectorBasis: "明确凭证",
    externalReceiptNo: "R-1",
    notes: "已实际收到",
  });
  expect(args.p_input.requestId).toBeUndefined();
  expect(args.p_input).not.toHaveProperty("paidThroughDate");
  expect(mocks.revalidate).toHaveBeenCalledWith("/fr/leases");
});
it("does not invent a collector, method, rate, period, or a replacement request", async () => {
  await recordLeaseCollection(input());
  expect(mocks.rpc.mock.calls[0][1]).toEqual({
    p_request_id: id(2),
    p_input: {
      contractId: id(1),
      paymentDate: "2026-01-01",
      currency: "XOF",
      amount: 640000,
      paymentMethod: "bank_transfer",
      allocations: input().allocations,
    },
  });
});
it.each([
  { amount: 640001 },
  { amount: 0 },
  { amount: NaN },
  { amount: Infinity },
  { amount: 1.00000001 },
  { amount: 999999999999.999 },
  { currency: "EUR" },
  { currency: ["XOF"] },
  { paymentMethod: "offset" },
  { paymentMethod: ["cash"] },
  { paymentDate: "2026-02-30" },
  { paymentDate: "2099-01-01" },
  { paymentDate: "0000-01-01" },
  { actualCollector: "黄姐" },
  { collectorBasis: "单独来源" },
  { actualCollector: "x".repeat(101), collectorBasis: "source" },
  { actualCollector: "Name", collectorBasis: "x".repeat(1001) },
  { externalReceiptNo: "x".repeat(201) },
  { notes: "x".repeat(2001) },
  { allocations: [] },
  { requestId: "missing" },
  { recordedBy: id(8) },
  { allocations: [{ receivableId: id(3), amount: 640000, expectedOutstanding: 600000 }] },
  {
    allocations: [
      { receivableId: id(3), amount: 320000, expectedOutstanding: 600000 },
      { receivableId: id(3), amount: 320000, expectedOutstanding: 600000 },
    ],
  },
  {
    allocations: [
      {
        receivableId: id(3),
        amount: 640000,
        expectedOutstanding: 640000,
        expectedUpdatedAt: "invalid",
      },
    ],
  },
])("rejects malformed server-action input %# without calling the database", async (extra) => {
  expect(await recordLeaseCollection(input(extra))).toMatchObject({
    success: false,
    rejected: false,
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("accepts exact cents without floating tolerance or rounding malformed decimals", () => {
  expect(
    parseLeaseCollectionInput(
      input({
        amount: 0.3,
        allocations: [
          { receivableId: id(3), amount: 0.1, expectedOutstanding: 0.1 },
          { receivableId: id(4), amount: 0.2, expectedOutstanding: 0.2 },
        ],
      }),
    ).amount,
  ).toBe(0.3);
  expect(() => parseLeaseCollectionInput(input({ amount: 0.30000000000000004 }))).toThrow(
    "invalidLeaseCollection",
  );
});
it.each([
  ["leaseCollectionBalanceChanged", "P0001", true],
  ["leaseCollectionCoverageChanged", "P0001", true],
  ["leaseCollectionAccessDenied", "42501", false],
  ["invalidLeaseCollection", "P0001", false],
  ["injected audit failure", "P0001", false],
  ["deadlock detected", "40P01", false],
  ["requestIdConflict", "P0001", false],
  ["fetch failed", "", false],
  ["temporary outage", "XX000", false],
])("classifies %s as definite rollback=%s", async (message, code, rejected) => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message, code } });
  expect(await recordLeaseCollection(input())).toMatchObject({ success: false, rejected });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("retains unknown outcomes after a thrown transport exception", async () => {
  mocks.rpc.mockRejectedValue(new Error("transport lost after commit"));
  expect(await recordLeaseCollection(input())).toMatchObject({ success: false, rejected: false });
});
it.each([
  { success: false },
  { requestId: id(9) },
  { currency: "USD" },
  { totalAmount: 1 },
  { referenceNos: [] },
  { paymentIds: [id(5)] },
  { allocations: [{ receivableId: id(3), amount: 640000, paymentId: id(5), currency: "XOF" }] },
  {
    allocations: [
      { receivableId: id(3), amount: 600000, paymentId: id(8), currency: "XOF" },
      { receivableId: id(4), amount: 40000, paymentId: id(6), currency: "XOF" },
    ],
  },
  {
    allocations: [
      { receivableId: id(3), amount: 600000, paymentId: id(5), currency: "USD" },
      { receivableId: id(4), amount: 40000, paymentId: id(6), currency: "XOF" },
    ],
  },
])("never treats an invalid success %# as a safe-to-repeat rejection", async (extra) => {
  mocks.rpc.mockResolvedValue({ data: success(extra), error: null });
  expect(await recordLeaseCollection(input())).toMatchObject({ success: false, rejected: false });
});
it("returns exact persisted facts including links and idempotent status, not the UI's estimate", () => {
  expect(decodeLeaseCollectionResult(success({ idempotent: true }), input())).toEqual(
    success({ idempotent: true }),
  );
});
it("stops before RPC when the authenticated account is denied", async () => {
  mocks.requireRole.mockRejectedValueOnce(new Error("denied"));
  await expect(recordLeaseCollection(input())).rejects.toThrow("denied");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not report an earlier committed request rejected when scope or role is revoked before retry", async () => {
  expect(await recordLeaseCollection(input())).toMatchObject({ success: true });
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "leaseCollectionAccessDenied", code: "42501" },
  });
  expect(await recordLeaseCollection(input())).toMatchObject({ success: false, rejected: false });
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "leaseCollectionPermissionDenied", code: "42501" },
  });
  expect(await recordLeaseCollection(input())).toMatchObject({ success: false, rejected: false });
  expect(await recordLeaseCollection(input({ amount: 1.001 }))).toMatchObject({
    success: false,
    rejected: false,
  });
});
it("recovers a persisted receipt and exact contract identity without the original browser payload", async () => {
  mocks.rpc.mockResolvedValue({ data: success({ contractId: id(1) }), error: null });
  expect(await readLeaseCollectionReceipt(id(2))).toEqual({
    status: "found",
    contractId: id(1),
    receipt: success(),
  });
  expect(mocks.rpc).toHaveBeenCalledWith("lease_collection_receipt_read_rpc", {
    p_request_id: id(2),
  });
  expect(mocks.requireRole).toHaveBeenCalledWith("admin", "finance", "boss");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("distinguishes absent from unreadable receipts without declaring an uncommitted outcome", async () => {
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "leaseCollectionNotFound", code: "P0001" },
  });
  expect(await readLeaseCollectionReceipt(id(2))).toEqual({ status: "not_found" });
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "leaseCollectionAccessDenied", code: "42501" },
  });
  expect(await readLeaseCollectionReceipt(id(2))).toMatchObject({ status: "unavailable" });
  mocks.rpc.mockRejectedValue(new Error("network"));
  expect(await readLeaseCollectionReceipt(id(2))).toMatchObject({ status: "unavailable" });
});
it.each([
  { contractId: undefined },
  { contractId: "invalid" },
  { requestId: id(99) },
  { totalAmount: 640001 },
  {
    allocations: [
      { receivableId: id(3), amount: 600000, paymentId: id(5), currency: "USD" },
      { receivableId: id(4), amount: 40000, paymentId: id(6), currency: "XOF" },
    ],
  },
  {
    allocations: [
      { receivableId: id(3), amount: 600000, paymentId: id(5), currency: "XOF" },
      { receivableId: id(3), amount: 40000, paymentId: id(6), currency: "XOF" },
    ],
  },
])("refuses malformed recovered facts %# rather than fabricating a receipt", async (extra) => {
  mocks.rpc.mockResolvedValue({ data: success({ contractId: id(1), ...extra }), error: null });
  expect(await readLeaseCollectionReceipt(id(2))).toMatchObject({ status: "unavailable" });
});
it("validates exact sums and all referenced payment identities in standalone receipts", () => {
  expect(() =>
    decodeLeaseCollectionReceipt(
      success({
        paymentIds: [id(5), id(6)],
        allocations: [{ receivableId: id(3), amount: 640000, paymentId: id(5), currency: "XOF" }],
      }),
      id(2),
    ),
  ).toThrow("invalidLeaseCollection");
  expect(() => decodeLeaseCollectionReceipt(success({ totalAmount: 640001 }), id(2))).toThrow(
    "invalidLeaseCollection",
  );
});
const coverage = () => ({
  expectedPaidThroughDate: "2026-08-31",
  expectedContractUpdatedAt: "2026-01-01T00:00:00Z",
  throughDate: "2026-09-30",
  receivableIds: [id(3)],
});
it("sends opt-in coverage without deriving a date from money and accepts only the actual confirmed result", async () => {
  const result = success({
    paidThroughAfter: "2026-09-30",
    coverage: { throughDate: "2026-09-30", receivableIds: [id(3)] },
  });
  mocks.rpc.mockResolvedValue({ data: result, error: null });
  expect(await recordLeaseCollection(input({ coverage: coverage() }))).toEqual(result);
  expect(mocks.rpc.mock.calls[0][1].p_input.coverage).toEqual(coverage());
});
it.each([
  { throughDate: "2026-08-31" },
  { throughDate: "2026-02-30" },
  { expectedPaidThroughDate: null },
  { expectedContractUpdatedAt: "bad" },
  { receivableIds: [] },
  { receivableIds: [id(3), id(3)] },
  { receivableIds: [id(99)] },
  { nextInvoice: { amount: 1 } },
])(
  "refuses malformed optional coverage %# without losing an earlier request identity",
  async (extra) => {
    expect(
      await recordLeaseCollection(input({ coverage: { ...coverage(), ...extra } })),
    ).toMatchObject({ success: false, rejected: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it.each([
  { paidThroughBefore: undefined },
  { paidThroughAfter: undefined },
  { paidThroughAfter: "2026-09-30" },
  {
    paidThroughAfter: "2026-09-30",
    coverage: { throughDate: "2026-10-31", receivableIds: [id(3)] },
  },
  {
    paidThroughAfter: "2026-09-30",
    coverage: { throughDate: "2026-09-30", receivableIds: [id(99)] },
  },
  {
    paidThroughBefore: null,
    paidThroughAfter: "2026-09-30",
    coverage: { throughDate: "2026-09-30", receivableIds: [id(3)] },
  },
])(
  "keeps malformed or unrequested coverage responses %# unknown instead of fabricating success",
  async (extra) => {
    mocks.rpc.mockResolvedValue({ data: success(extra), error: null });
    expect(await recordLeaseCollection(input())).toMatchObject({ success: false, rejected: false });
  },
);
