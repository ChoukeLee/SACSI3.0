import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), requireRole: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import {
  correctLeaseRentPeriod,
  reviewLeaseRentPeriod,
} from "@/features/leases/lease-rent-period-actions";
const input = {
  expectedToken: "a".repeat(32),
  paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  receivableId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  paidThroughDate: "2026-06-30",
  reason: "Explicit correction",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
});
it("requires admin and performs exactly one audited RPC, with no direct table writes", async () => {
  expect((await correctLeaseRentPeriod("contract", input, "stable-request")).success).toBe(true);
  expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("correct_lease_rent_period_rpc", {
    p_contract_id: "contract",
    p_input: input,
    p_request_id: "stable-request",
  });
  expect(mocks.revalidate).toHaveBeenCalledWith("/leases");
});
it("does not read or write if the server role guard fails", async () => {
  mocks.requireRole.mockRejectedValue(new Error("denied"));
  await expect(correctLeaseRentPeriod("contract", input, "id")).rejects.toThrow("denied");
  await expect(reviewLeaseRentPeriod("contract")).rejects.toThrow("denied");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("distinguishes rolled-back rejection from unknown result and conflicting identities", async () => {
  for (const [error, rejected] of [
    [{ code: "P0001", message: "leasePeriodChanged" }, true],
    [{ code: "P0001", message: "requestIdConflict" }, false],
    [{ code: "", message: "fetch failed" }, false],
  ] as const) {
    mocks.rpc.mockResolvedValue({ data: null, error });
    expect((await correctLeaseRentPeriod("contract", input, "id")).rejected).toBe(rejected);
  }
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
