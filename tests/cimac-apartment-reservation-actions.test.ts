import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({
  user: vi.fn(),
  client: vi.fn(),
  scope: vi.fn(),
  execute: vi.fn(),
  status: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: deps.revalidate }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: deps.user,
  hasPermission: (user: { role: string }) => user.role === "admin",
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: deps.client }));
vi.mock("@/features/cimac/cimac-workspace-read", () => ({ readCimacWorkspaceScope: deps.scope }));
vi.mock("@/features/cimac/cimac-apartment-reservation-service", () => ({
  executeApartmentReservations: deps.execute,
  readApartmentReservationStatus: deps.status,
}));
import {
  executeCimacApartmentReservations,
  checkCimacApartmentReservationStatus,
} from "@/features/cimac/cimac-apartment-reservation-actions";
import {
  CimacApartmentReservationError,
  type CimacApartmentReservationRequest,
} from "@/features/cimac/cimac-apartment-reservation-model";
const requestId = "77000000-0000-4000-8000-000000000001",
  client = {},
  scope = {},
  request = {
    requestId,
    originalInstruction: "Explicit instruction",
    operations: [],
  } as CimacApartmentReservationRequest;
beforeEach(() => {
  vi.resetAllMocks();
  deps.user.mockResolvedValue({ id: "actor", role: "admin" });
  deps.client.mockResolvedValue(client);
  deps.scope.mockResolvedValue(scope);
  deps.execute.mockResolvedValue({ success: true, requestId, idempotent: false, rooms: [] });
  deps.status.mockResolvedValue({ requestId, status: "not_found", verified: false });
});
describe("apartment reservation web actions", () => {
  it.each([null, "boss", "finance", "rental_sales", "front_desk"])(
    "denies %s before accessing business data",
    async (role) => {
      deps.user.mockResolvedValue(role ? { id: "actor", role } : null);
      expect(await executeCimacApartmentReservations(request)).toMatchObject({
        success: false,
        outcome: "rejected",
      });
      expect(deps.client).not.toHaveBeenCalled();
      expect(deps.execute).not.toHaveBeenCalled();
    },
  );
  it("uses the current actor and scope and returns only the narrow result", async () => {
    expect(await executeCimacApartmentReservations(request)).toEqual({
      success: true,
      requestId,
      idempotent: false,
      rooms: [],
    });
    expect(deps.execute).toHaveBeenCalledExactlyOnceWith(client, scope, "actor", request);
    expect(deps.revalidate.mock.calls).toEqual([
      ["/cimac", "layout"],
      ["/fr/cimac", "layout"],
    ]);
  });
  it("does not write when workspace resolution fails", async () => {
    deps.scope.mockRejectedValue(new Error("PRIVATE_DATA"));
    expect(await executeCimacApartmentReservations(request)).toMatchObject({ success: false });
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it("distinguishes confirmed rollback from unknown outcome without leaking errors", async () => {
    deps.execute.mockRejectedValue(
      new CimacApartmentReservationError("CimacApartmentReservationsChanged", 409),
    );
    expect(await executeCimacApartmentReservations(request)).toMatchObject({
      success: false,
      outcome: "rejected",
    });
    deps.execute.mockRejectedValue(new Error("PRIVATE_DATA"));
    const result = await executeCimacApartmentReservations(request);
    expect(result).toMatchObject({ success: false, outcome: "unknown" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DATA");
  });
  it("allows only read-only original-request lookup and does not imply fresh verification", async () => {
    expect(await checkCimacApartmentReservationStatus(requestId)).toEqual({
      success: true,
      requestId,
      found: false,
      verified: false,
    });
    deps.status.mockResolvedValue({ status: "completed_previously", requestId, verified: false });
    expect(await checkCimacApartmentReservationStatus(requestId)).toEqual({
      success: true,
      requestId,
      found: true,
      verified: false,
    });
    expect(deps.execute).not.toHaveBeenCalled();
    expect(deps.revalidate).not.toHaveBeenCalled();
  });
});
