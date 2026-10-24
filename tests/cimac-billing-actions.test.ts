import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  requireRole: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import {
  readCimacWriteReceipt,
  recordCimacCollection,
  saveCimacFeeTerms,
  saveCimacMeterReading,
} from "@/features/finance/cimac-billing-actions";
import type {
  CimacCollectionInput,
  CimacFeeTermInput,
  CimacMeterReadingInput,
} from "@/features/finance/cimac-billing-types";
import type { CimacRequestInput } from "@/features/finance/cimac-billing-service";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-01-01T00:00:00.123456+00:00";
function collection(extra: Record<string, unknown> = {}): CimacRequestInput<CimacCollectionInput> {
  return {
    requestId: id(1),
    customerId: id(2),
    paymentDate: "2026-01-01",
    currency: "XOF",
    amount: "640000",
    paymentMethod: "bank_transfer",
    allocations: [
      {
        receivableId: id(3),
        amount: "600000",
        expectedOutstanding: "600000",
        expectedUpdatedAt: stamp,
      },
      {
        receivableId: id(4),
        amount: "40000",
        expectedOutstanding: "40000",
        expectedUpdatedAt: stamp,
      },
    ],
    ...extra,
  } as CimacRequestInput<CimacCollectionInput>;
}
function fee(extra: Record<string, unknown> = {}): CimacRequestInput<CimacFeeTermInput> {
  return {
    requestId: id(1),
    customerId: id(2),
    contractId: id(10),
    unitId: id(11),
    category: "property_fee",
    currency: "XOF",
    monthlyRate: "900",
    pricingBasis: "per_sqm",
    chargeableArea: "173",
    annualStartsOn: "2027-04-01",
    annualEndsOn: "2028-03-31",
    proration: "daily_pending_convention",
    source: "合同标准，起算日待核",
    ...extra,
  } as CimacRequestInput<CimacFeeTermInput>;
}
function meter(extra: Record<string, unknown> = {}): CimacRequestInput<CimacMeterReadingInput> {
  return {
    requestId: id(1),
    customerId: id(2),
    contractId: id(10),
    unitId: id(11),
    meterKind: "water",
    meterNo: "W-1",
    serviceMonth: "2026-01-01",
    readOn: "2026-01-31",
    currentReading: "12.325",
    ...extra,
  } as CimacRequestInput<CimacMeterReadingInput>;
}
function proof(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    status: "completed",
    kind: "collection",
    requestId: id(1),
    actorId: id(8),
    customerId: id(2),
    entityId: id(5),
    auditId: id(9),
    idempotent: false,
    paymentId: id(5),
    receiptNo: "TEST-CIMAC-01",
    amount: "640000",
    currency: "XOF",
    allocations: [
      { paymentId: id(5), receivableId: id(3), amount: "600000", currency: "XOF" },
      { paymentId: id(5), receivableId: id(4), amount: "40000", currency: "XOF" },
    ],
    ...extra,
  };
}
function feeProof() {
  const { requestId: _requestId, ...data } = fee();
  const {
    paymentId: _paymentId,
    receiptNo: _receiptNo,
    currency: _currency,
    amount: _amount,
    allocations: _allocations,
    ...base
  } = proof();
  return {
    ...base,
    kind: "fee_terms",
    record: {
      ...data,
      id: id(5),
      status: "pending_review",
      startsOn: null,
      endsOn: null,
      notes: null,
      recordedBy: id(8),
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}
function meterProof() {
  const { requestId: _requestId, ...data } = meter();
  const {
    paymentId: _paymentId,
    receiptNo: _receiptNo,
    currency: _currency,
    amount: _amount,
    allocations: _allocations,
    ...base
  } = proof();
  return {
    ...base,
    kind: "meter_reading",
    record: {
      ...data,
      id: id(5),
      previousReading: null,
      usage: null,
      evidence: null,
      notes: null,
      status: "recorded_pending_rate",
      recordedBy: id(8),
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue({ id: id(8), role: "finance" });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: proof(), error: null });
});

describe("authenticated, narrowly scoped server actions", () => {
  it("records exactly one authenticated atomic receipt with stable request identity", async () => {
    expect(
      await recordCimacCollection(
        collection({ actualCollector: " 黄姐 ", collectorBasis: " 收据 ", notes: " 实收 " }),
      ),
    ).toEqual(proof());
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "finance");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("cimac_collect_customer_rpc");
    expect(args.p_request_id).toBe(id(1));
    expect(args.p_input).toMatchObject({
      actualCollector: "黄姐",
      collectorBasis: "收据",
      notes: "实收",
    });
    for (const key of ["requestId", "actorId", "recordedBy", "exchangeRate", "paidThroughDate"])
      expect(args.p_input).not.toHaveProperty(key);
  });

  it("invalidates Chinese and French customer, finance, lease and reporting reads", async () => {
    await recordCimacCollection(collection());
    for (const path of [
      "/finance",
      "/fr/finance",
      "/customers",
      "/fr/customers",
      `/customers/${id(2)}`,
      `/fr/customers/${id(2)}`,
      "/leases",
      "/fr/leases",
      "/reports",
      "/fr/reports",
    ])
      expect(mocks.revalidate).toHaveBeenCalledWith(path);
  });

  it("does not guess actual collector, currency conversion, coverage or a replacement request", async () => {
    await recordCimacCollection(collection());
    const { requestId, ...payload } = collection();
    expect(mocks.rpc).toHaveBeenCalledWith("cimac_collect_customer_rpc", {
      p_request_id: requestId,
      p_input: payload,
    });
  });

  it("saves pending fee evidence only, preserving unknown starts and native currency", async () => {
    const saved = feeProof();
    saved.record.currency = "USD";
    saved.record.monthlyRate = "60";
    mocks.rpc.mockResolvedValue({ data: saved, error: null });
    expect(
      await saveCimacFeeTerms(fee({ currency: "USD", monthlyRate: "60", startsOn: null })),
    ).toEqual(saved);
    const { requestId, ...payload } = fee({ currency: "USD", monthlyRate: "60" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("cimac_save_fee_terms_rpc", {
      p_request_id: requestId,
      p_input: payload,
    });
    expect(payload).not.toHaveProperty("startsOn");
    expect(payload).not.toHaveProperty("amount");
  });

  it("saves current-only meter readings, never fabricating consumption, rates or bills", async () => {
    mocks.rpc.mockResolvedValue({ data: meterProof(), error: null });
    expect(await saveCimacMeterReading(meter())).toEqual(meterProof());
    const { requestId, ...payload } = meter();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("cimac_save_meter_reading_rpc", {
      p_request_id: requestId,
      p_input: payload,
    });
    for (const key of ["amount", "unitPrice", "usage", "previousReading", "createReceivable"])
      expect(payload).not.toHaveProperty(key);
  });

  it.each([recordCimacCollection, saveCimacFeeTerms, saveCimacMeterReading])(
    "denies a non-writing account before parsing or any database request %#",
    async (action) => {
      mocks.requireRole.mockRejectedValue(new Error("Role required: admin or finance"));
      await expect(action({} as never)).rejects.toThrow("Role required");
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each([
    () => recordCimacCollection(collection({ amount: 640000 })),
    () => recordCimacCollection(collection({ actualCollector: "黄姐" })),
    () => recordCimacCollection(collection({ currency: "USD" })),
    () => recordCimacCollection(collection({ recordedBy: id(99) })),
    () => saveCimacFeeTerms(fee({ source: "" })),
    () => saveCimacFeeTerms(fee({ id: id(5) })),
    () => saveCimacFeeTerms(fee({ status: "confirmed" })),
    () => saveCimacMeterReading(meter({ currentReading: "NaN" })),
    () => saveCimacMeterReading(meter({ amount: "1000" })),
    () => saveCimacMeterReading(meter({ serviceMonth: "2026-01" })),
  ])(
    "does not send malformed requests or claim that earlier same-ID requests cannot have committed %#",
    async (action) => {
      expect(await action()).toMatchObject({ success: false, rejected: false });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );
});

describe("unknown outcomes and original-ID recovery", () => {
  it.each([
    ["cimacBillingPermissionDenied", "42501"],
    ["cimacBillingInvalidInput", "P0001"],
    ["cimacBillingTargetMismatch", "P0001"],
    ["cimacBillingRequestIdConflict", "P0001"],
    ["cimacBillingUnsupportedCurrency", "P0001"],
    ["cimacBillingProtectedPayment", "P0001"],
    ["cimacBillingAccountTooLarge", "P0001"],
    ["audit failure", "P0001"],
    ["deadlock", "40P01"],
    ["transport lost", ""],
  ])("keeps %s uncertain rather than permitting duplicate receipts", async (message, code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message, code } });
    expect(await recordCimacCollection(collection())).toMatchObject({
      success: false,
      rejected: false,
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([
    () => recordCimacCollection(collection()),
    () => saveCimacFeeTerms(fee()),
    () => saveCimacMeterReading(meter()),
  ])(
    "allows correction only for the reviewed post-lock, no-prior-result snapshot guard %#",
    async (action) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { message: "cimacBillingSnapshotChanged", code: "P0001" },
      });
      expect(await action()).toMatchObject({ success: false, rejected: true });
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each(["42501", "XX000", "", undefined])(
    "never treats a generic SQLSTATE or guard-like message as proof of rejection (%s)",
    async (code) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { message: "cimacBillingSnapshotChanged", code },
      });
      expect(await recordCimacCollection(collection())).toMatchObject({
        success: false,
        rejected: false,
      });
    },
  );

  it("does not leak transport/database secrets into a failure message", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private-db-password-must-not-leak", code: "XX000" },
    });
    const result = await recordCimacCollection(collection());
    expect(JSON.stringify(result)).not.toContain("private-db-password");
    expect(result).toMatchObject({ success: false, rejected: false });
  });

  it("keeps thrown client/transport failures unknown", async () => {
    mocks.createClient.mockRejectedValueOnce(new Error("client unavailable"));
    expect(await recordCimacCollection(collection())).toMatchObject({
      success: false,
      rejected: false,
    });
    mocks.rpc.mockRejectedValueOnce(new Error("response lost after commit"));
    expect(await recordCimacCollection(collection())).toMatchObject({
      success: false,
      rejected: false,
    });
  });

  it("retries exact original request and content after a lost response, without new IDs", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("response lost after commit"));
    expect(await recordCimacCollection(collection())).toMatchObject({
      success: false,
      rejected: false,
    });
    mocks.rpc.mockResolvedValueOnce({ data: proof({ idempotent: true }), error: null });
    expect(await recordCimacCollection(collection())).toEqual(proof({ idempotent: true }));
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });

  it.each([
    { requestId: id(99) },
    { actorId: id(99) },
    { customerId: id(99) },
    { amount: "640001" },
    { allocations: [] },
    { success: false },
  ])("does not accept a mismatched or malformed commit receipt %#", async (extra) => {
    mocks.rpc.mockResolvedValue({ data: proof(extra), error: null });
    expect(await recordCimacCollection(collection())).toMatchObject({
      success: false,
      rejected: false,
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("preserves completed proof even if cache invalidation fails", async () => {
    mocks.revalidate.mockImplementation(() => {
      throw new Error("cache unavailable");
    });
    expect(await recordCimacCollection(collection())).toEqual(proof());
    expect(mocks.revalidate).toHaveBeenCalledWith("/fr/reports");
  });

  it.each([proof(), feeProof(), meterProof()])(
    "reads independently verifiable collection/rule/meter receipts %# without performing writes",
    async (saved) => {
      mocks.rpc.mockResolvedValue({ data: saved, error: null });
      expect(await readCimacWriteReceipt(id(1))).toEqual({ status: "found", receipt: saved });
      expect(mocks.requireRole).toHaveBeenCalledWith("admin", "finance", "boss");
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.rpc).toHaveBeenCalledWith("cimac_billing_request_rpc", { p_request_id: id(1) });
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it("reports not_found only when the returned request identity matches; never as safe-to-repeat rejection", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "not_found", requestId: id(1) }, error: null });
    expect(await readCimacWriteReceipt(id(1))).toEqual({ status: "not_found" });
    mocks.rpc.mockResolvedValue({ data: { status: "not_found", requestId: id(99) }, error: null });
    expect(await readCimacWriteReceipt(id(1))).toMatchObject({ status: "unavailable" });
  });

  it("handles unreadable receipts and malformed IDs without fabricating persisted facts", async () => {
    expect(await readCimacWriteReceipt("bad")).toMatchObject({ status: "unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "cimacBillingPermissionDenied", code: "42501" },
    });
    expect(await readCimacWriteReceipt(id(1))).toMatchObject({ status: "unavailable" });
    mocks.rpc.mockRejectedValue(new Error("network unavailable"));
    expect(await readCimacWriteReceipt(id(1))).toMatchObject({ status: "unavailable" });
  });
});
