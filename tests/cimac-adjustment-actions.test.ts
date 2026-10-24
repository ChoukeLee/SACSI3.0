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
  readCimacCollectionPosition,
  readCimacWriteReceipt,
  recordCimacRefund,
  reverseCimacCollection,
} from "@/features/finance/cimac-billing-actions";
import {
  adjustmentId as id,
  adjustmentPosition,
  adjustmentProof,
  refundInput,
  reversalInput,
} from "./fixtures/cimac-adjustments";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue({ id: id(8), role: "finance" });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
});

describe("authenticated correction and recovery actions", () => {
  it.each(["refund", "reversal"] as const)(
    "sends explicit %s to the atomic user-scoped RPC, never modifies an original receipt",
    async (kind) => {
      const input = kind === "refund" ? refundInput() : reversalInput(),
        run = kind === "refund" ? recordCimacRefund : reverseCimacCollection;
      mocks.rpc.mockResolvedValue({ data: adjustmentProof(kind), error: null });
      expect(await run(input as never)).toEqual(adjustmentProof(kind));
      expect(mocks.requireRole).toHaveBeenCalledWith("admin", "finance");
      const { requestId, ...payload } = input;
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
        kind === "refund" ? "cimac_refund_collection_rpc" : "cimac_reverse_collection_rpc",
        { p_request_id: requestId, p_input: payload },
      );
      for (const path of [
        "/finance",
        "/fr/finance",
        "/leases",
        "/fr/leases",
        "/reports",
        "/fr/reports",
        `/customers/${id(3)}`,
        `/fr/customers/${id(3)}`,
      ])
        expect(mocks.revalidate).toHaveBeenCalledWith(path);
    },
  );
  it.each(["refund", "reversal"] as const)(
    "requires the write role even with a valid %s payload",
    async (kind) => {
      mocks.requireRole.mockRejectedValue(new Error("forbidden"));
      await expect(
        kind === "refund"
          ? recordCimacRefund(refundInput())
          : reverseCimacCollection(reversalInput()),
      ).rejects.toThrow("forbidden");
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["refund", "reversal"] as const)(
    "only the locked, no-prior SnapshotChanged proof can release %s for refreshed correction",
    async (kind) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: "P0001", message: "cimacBillingSnapshotChanged" },
      });
      expect(
        await (kind === "refund"
          ? recordCimacRefund(refundInput())
          : reverseCimacCollection(reversalInput())),
      ).toMatchObject({ success: false, rejected: true });
    },
  );
  it.each([
    { code: "42501", message: "cimacBillingPermissionDenied" },
    { code: "P0001", message: "cimacBillingInvalidInput" },
    { code: "P0001", message: "cimacBillingTargetMismatch" },
    { code: "P0001", message: "cimacBillingRequestIdConflict" },
    { code: "23514", message: "cimacBillingSnapshotChanged" },
    { code: "57014", message: "statement timeout" },
    { code: "P0001", message: "cimacBillingSnapshotChanged " },
  ])("does not classify arbitrary failure text/state as definite rejection %#", async (error) => {
    mocks.rpc.mockResolvedValue({ data: null, error });
    expect(await recordCimacRefund(refundInput())).toMatchObject({
      success: false,
      rejected: false,
    });
    expect(await reverseCimacCollection(reversalInput())).toMatchObject({
      success: false,
      rejected: false,
    });
  });
  it("retains uncertainty through invalid retry content, malformed success and transport failures", async () => {
    expect(await recordCimacRefund({ ...refundInput(), amount: 20 } as never)).toMatchObject({
      success: false,
      rejected: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockRejectedValue(new Error("connection lost after commit"));
    expect(await recordCimacRefund(refundInput())).toMatchObject({
      success: false,
      rejected: false,
    });
    mocks.rpc.mockResolvedValue({
      data: { ...adjustmentProof(), originalPaymentId: id(99) },
      error: null,
    });
    expect(await recordCimacRefund(refundInput())).toMatchObject({
      success: false,
      rejected: false,
    });
  });
  it("same-ID same-content retry recovers the verified result and never replaces identity", async () => {
    mocks.rpc
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({ data: { ...adjustmentProof(), idempotent: true }, error: null });
    expect((await recordCimacRefund(refundInput())).success).toBe(false);
    expect(await recordCimacRefund(refundInput())).toEqual({
      ...adjustmentProof(),
      idempotent: true,
    });
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });
  it("cache invalidation failure cannot deny an already verified committed result", async () => {
    mocks.rpc.mockResolvedValue({ data: adjustmentProof(), error: null });
    mocks.revalidate.mockImplementation(() => {
      throw new Error("cache");
    });
    expect(await recordCimacRefund(refundInput())).toEqual(adjustmentProof());
  });
  it.each(["refund", "reversal"] as const)(
    "recovers the actual %s type independent of the open form and performs no write",
    async (kind) => {
      mocks.rpc.mockResolvedValue({ data: adjustmentProof(kind), error: null });
      expect(await readCimacWriteReceipt(id(1))).toEqual({
        status: "found",
        receipt: adjustmentProof(kind),
      });
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("cimac_billing_request_rpc", {
        p_request_id: id(1),
      });
    },
  );
  it("reads exact original position under readonly boss or finance permission", async () => {
    mocks.rpc.mockResolvedValue({ data: adjustmentPosition("refund"), error: null });
    expect(await readCimacCollectionPosition(id(2))).toEqual({
      status: "available",
      position: adjustmentPosition("refund"),
    });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "finance", "boss");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("cimac_collection_position_rpc", {
      p_original_payment_id: id(2),
    });
  });
  it("a missing, foreign or corrupt position stays unavailable, never a synthetic zero balance", async () => {
    expect((await readCimacCollectionPosition("bad")).status).toBe("unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({
      data: { ...adjustmentPosition(), originalPaymentId: id(99) },
      error: null,
    });
    expect((await readCimacCollectionPosition(id(2))).status).toBe("unavailable");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    expect((await readCimacCollectionPosition(id(2))).status).toBe("unavailable");
  });
});
