import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readCimacCollectionAdjustments } from "@/features/finance/cimac-adjustment-read";
import { adjustmentHistory, adjustmentId as id } from "./fixtures/cimac-adjustments";

describe("bounded sealed child allocation reader", () => {
  it("does not issue a broad scan for no correction IDs", async () => {
    const rpc = vi.fn();
    expect(await readCimacCollectionAdjustments({ rpc } as never, [])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reads exact IDs in batches100 and validates the returned allocation DTO identity", async () => {
    const keys = Array.from({ length: 101 }, (_, i) => id(100 + i)),
      rpc = vi.fn(async (_name: string, input: { p_payment_ids: string[] }) => ({
        data: input.p_payment_ids.map((paymentId) => ({
          paymentId,
          adjustment: { ...adjustmentHistory(), paymentId },
        })),
        error: null,
      }));
    const result = await readCimacCollectionAdjustments({ rpc } as never, keys);
    expect(result.map((a) => a.paymentId)).toEqual(keys);
    expect(rpc.mock.calls.map((c) => c[1].p_payment_ids.length)).toEqual([100, 1]);
    expect(rpc.mock.calls.every((c) => c[0] === "cimac_collection_adjustments_rpc")).toBe(true);
  });
  it.each([
    "missing",
    "duplicate",
    "foreign",
    "mismatched-dto",
    "unsealed",
    "bad-audit",
    "bad-sum",
  ])("rejects %s rather than returning a partial or invented adjustment map", async (issue) => {
    const a = adjustmentHistory(),
      keys = [a.paymentId, id(101)],
      rows = [
        { paymentId: a.paymentId, adjustment: a },
        { paymentId: id(101), adjustment: { ...a, paymentId: id(101) } },
      ];
    if (issue === "missing") rows.pop();
    if (issue === "duplicate") rows[1] = rows[0];
    if (issue === "foreign") rows[1].paymentId = id(99);
    if (issue === "mismatched-dto") rows[1].adjustment.paymentId = id(99);
    if (issue === "bad-audit") rows[0].adjustment.auditId = "bad";
    if (issue === "bad-sum") rows[0].adjustment.amount = "21";
    const rpc = vi.fn().mockResolvedValue({
      data: rows,
      error: issue === "unsealed" ? { message: "cimacBillingVerificationFailed" } : null,
    });
    await expect(readCimacCollectionAdjustments({ rpc } as never, keys)).rejects.toThrow();
  });
  it("rejects malformed and repeated request IDs before any RPC", async () => {
    const rpc = vi.fn();
    await expect(readCimacCollectionAdjustments({ rpc } as never, ["bad"])).rejects.toThrow();
    await expect(
      readCimacCollectionAdjustments({ rpc } as never, [id(1), id(1)]),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
