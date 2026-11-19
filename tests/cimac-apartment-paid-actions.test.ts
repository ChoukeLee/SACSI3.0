import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({
  user: vi.fn(),
  permission: vi.fn(),
  client: vi.fn(),
  scope: vi.fn(),
  execute: vi.fn(),
  status: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: deps.revalidate }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: deps.user, hasPermission: deps.permission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: deps.client }));
vi.mock("@/features/cimac/cimac-workspace-read", () => ({ readCimacWorkspaceScope: deps.scope }));
vi.mock("@/features/cimac/cimac-apartment-paid-service", () => ({
  executeApartmentPaid: deps.execute,
  apartmentPaidStatus: deps.status,
}));
import {
  executeApartmentPaidReceipt,
  checkApartmentPaidStatus,
} from "@/features/cimac/cimac-apartment-paid-actions";
import { ApartmentPaidError } from "@/features/cimac/cimac-apartment-paid-model";
import { paidActor, paidInput, paidScope } from "./fixtures/cimac-apartment-paid";
import { combinedInput } from "./fixtures/cimac-apartment-paid-v2";
beforeEach(() => {
  vi.resetAllMocks();
  deps.user.mockResolvedValue({ id: paidActor, role: "admin" });
  deps.permission.mockReturnValue(true);
  deps.client.mockResolvedValue({ rpc: "real session client" });
  deps.scope.mockResolvedValue(paidScope);
  deps.execute.mockResolvedValue({
    success: true,
    requestId: paidInput().requestId,
    idempotent: false,
    totalAmountXof: 5250000,
    roomCount: 3,
  });
});
describe("paid apartment server actions", () => {
  it("forwards the exact v2 property and old-hold request through the authenticated service", async () => {
    const input = combinedInput();
    expect(await executeApartmentPaidReceipt(input)).toMatchObject({ success: true });
    expect(deps.execute).toHaveBeenCalledWith(
      { rpc: "real session client" },
      paidScope,
      paidActor,
      input,
    );
  });
  it("reports an atomic hold-version rejection as rejected so the caller can refresh", async () => {
    deps.execute.mockRejectedValue(new ApartmentPaidError("CimacApartmentPaidHoldChanged", 409));
    const result = await executeApartmentPaidReceipt(combinedInput());
    expect(result).toMatchObject({ success: false, outcome: "rejected" });
    expect(deps.revalidate).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("CimacApartmentPaidHoldChanged");
  });
  it.each(["admin", "finance"])(
    "permits explicitly authorised %s with the actual session client",
    async (role) => {
      deps.user.mockResolvedValue({ id: paidActor, role });
      expect(await executeApartmentPaidReceipt(paidInput())).toMatchObject({ success: true });
      expect(deps.execute).toHaveBeenCalledWith(
        { rpc: "real session client" },
        paidScope,
        paidActor,
        paidInput(),
      );
      expect(deps.revalidate).toHaveBeenCalledWith("/cimac", "layout");
    },
  );
  it.each([null, "boss", "rental_sales", "front_desk"])(
    "denies an unauthorised role %s before acquiring the database client",
    async (role) => {
      deps.user.mockResolvedValue(role ? { id: paidActor, role } : null);
      expect(await executeApartmentPaidReceipt(paidInput())).toMatchObject({
        success: false,
        outcome: "rejected",
      });
      expect(deps.client).not.toHaveBeenCalled();
    },
  );
  it("denies a missing finance write capability", async () => {
    deps.permission.mockReturnValue(false);
    expect(await executeApartmentPaidReceipt(paidInput())).toMatchObject({
      success: false,
      outcome: "rejected",
    });
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it("does not turn an uncertain result into a safe rejection or disclose its exception", async () => {
    deps.execute.mockRejectedValue(new Error("private financial error"));
    const r = await executeApartmentPaidReceipt(paidInput());
    expect(r).toMatchObject({ success: false, outcome: "unknown" });
    expect(JSON.stringify(r)).not.toContain("private financial");
    expect(deps.revalidate).not.toHaveBeenCalled();
  });
  it("distinguishes a known drift rejection", async () => {
    deps.execute.mockRejectedValue(new ApartmentPaidError("CimacApartmentPaidScopeChanged", 409));
    expect(await executeApartmentPaidReceipt(paidInput())).toMatchObject({
      success: false,
      outcome: "rejected",
    });
  });
  it("uses status only for a previous request", async () => {
    deps.status.mockResolvedValue({
      success: true,
      found: true,
      verified: false,
      requestId: paidInput().requestId,
    });
    expect(await checkApartmentPaidStatus(paidInput().requestId)).toMatchObject({
      found: true,
      verified: false,
    });
    expect(deps.execute).not.toHaveBeenCalled();
  });
});
