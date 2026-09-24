import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), requireRole: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import {
  createLeaseContract,
  activateContract,
  terminateContract,
} from "@/features/leases/lease-contract-actions";
import { processMoveOut } from "@/features/leases/lease-moveout-actions";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { success: true, data: { id: "contract" } }, error: null });
});
it("creates through a single authenticated call and ignores a forged visible contract number", async () => {
  const result = await createLeaseContract({
    unitId: "unit",
    customerId: "customer",
    contractNo: "FORGED",
    startDate: "2026-01-01",
    expectedEndDate: "2026-03-31",
    paymentCycle: "monthly",
    paymentDay: 1,
    monthlyRentXof: 100,
    depositAmountXof: 200,
    depositReceived: true,
    rentFreeDays: 0,
    requestId: "stable-id",
  });
  expect(result.success).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  const [name, args] = mocks.rpc.mock.calls[0];
  expect(name).toBe("lease_lifecycle_rpc");
  expect(args.p_request_id).toBe("stable-id");
  expect(args.p_input.contractNo).toBeUndefined();
  expect(mocks.requireRole).toHaveBeenCalledWith("admin", "rental_sales");
});
it("forwards stable request and expected version for activation and admin termination", async () => {
  await activateContract("contract", "activate-id", "version");
  await terminateContract("contract", "terminate-id", "version");
  expect(mocks.rpc.mock.calls.map((c) => c[1].p_request_id)).toEqual([
    "activate-id",
    "terminate-id",
  ]);
  expect(mocks.requireRole).toHaveBeenLastCalledWith("admin");
});
it("keeps transport and conflicting-request errors unresolved but recognizes a rolled-back validation error", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "fetch failed", code: "" } });
  expect((await activateContract("c", "id", "v")).rejected).toBe(false);
  mocks.rpc.mockResolvedValue({ error: { message: "requestIdConflict", code: "P0001" } });
  expect((await activateContract("c", "id", "v")).rejected).toBe(false);
  mocks.rpc.mockResolvedValue({ error: { message: "leaseActiveConflict", code: "P0001" } });
  expect((await activateContract("c", "id", "v")).rejected).toBe(true);
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("settles through one RPC and passes actual-collection confirmation rather than writing rows", async () => {
  await processMoveOut({
    contractId: "c",
    actualEndDate: "2026-03-31",
    unpaidRentXof: 10,
    utilityCleared: true,
    depositDeductionXof: 0,
    depositRefundXof: 20,
    requestId: "id",
    expectedUpdatedAt: "v",
    rentCollectedConfirmed: true,
    paymentMethod: "cash",
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.requireRole).toHaveBeenCalledWith("admin", "finance");
  expect(mocks.rpc.mock.calls[0][1].p_input.rentCollectedConfirmed).toBe(true);
});
