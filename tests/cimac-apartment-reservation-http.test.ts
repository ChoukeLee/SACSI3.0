import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({
  auth: vi.fn(),
  scope: vi.fn(),
  rpc: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  status: vi.fn(),
  revalidate: vi.fn(),
  direct: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: deps.revalidate }));
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: deps.auth,
}));
vi.mock("@/features/business-actions/operator-direct-execution", () => ({
  directExecutionEnabled: deps.direct,
}));
vi.mock("@/features/cimac/cimac-workspace-read", () => ({ readCimacWorkspaceScope: deps.scope }));
vi.mock("@/features/cimac/cimac-apartment-reservation-service", async (original) => ({
  ...(await original<object>()),
  readCimacApartmentReservationOptions: deps.query,
  executeApartmentReservations: deps.execute,
  readApartmentReservationStatus: deps.status,
}));
import { cimacApartmentReservationHttp } from "@/features/business-actions/cimac-apartment-reservation-http";
import { CimacApartmentReservationError } from "@/features/cimac/cimac-apartment-reservation-model";
const id = (n: number) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const requestId = id(1),
  unitId = id(2),
  stamp = "2026-11-02T19:00:00.123456+00:00";
const body = () => ({
  requestId,
  originalInstruction: "Explicit synthetic unpaid hold",
  operations: [
    {
      type: "reserve",
      unitId,
      expectedUnitUpdatedAt: stamp,
      expectedReservationId: null,
      expectedReservationUpdatedAt: null,
      reserverName: "Synthetic Booker",
      reason: "User requested a hold",
    },
  ],
});
const client = { rpc: deps.rpc },
  scope = { project: { id: id(3) }, buildings: [] };
const req = (value: unknown = {}, token = true, path = "query") =>
  new Request(`https://sacsi.example/api/operator/v1/cimac-apartment-reservations/${path}`, {
    method: "POST",
    headers: token ? { authorization: "Bearer synthetic-token" } : {},
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.resetAllMocks();
  deps.direct.mockReturnValue(true);
  deps.auth.mockResolvedValue({
    authenticated: true,
    mode: "bearer",
    user: { id: id(9), role: "admin" },
    supabase: client,
  });
  deps.scope.mockResolvedValue(scope);
  deps.rpc.mockImplementation(async (name) => ({
    data: name === "cimac_apartment_reservations_protocol_version" ? 1 : true,
    error: null,
  }));
  deps.query.mockResolvedValue({ success: true, schemaAvailable: true, rooms: [] });
  deps.execute.mockResolvedValue({ success: true, requestId, rooms: [] });
  deps.status.mockResolvedValue({ status: "not_found", requestId, verified: false });
});
describe("authenticated apartment reservation HTTP boundary", () => {
  it("rejects cookie-only requests before selecting an actor", async () => {
    expect((await cimacApartmentReservationHttp(req({}, false), "query")).status).toBe(401);
    expect(deps.auth).not.toHaveBeenCalled();
    expect(deps.query).not.toHaveBeenCalled();
  });
  it.each(["boss", "finance", "rental_sales", "front_desk"])(
    "does not infer %s write permission",
    async (role) => {
      deps.auth.mockResolvedValue({
        authenticated: true,
        mode: "bearer",
        user: { id: id(9), role },
        supabase: client,
      });
      expect((await cimacApartmentReservationHttp(req(body()), "execute")).status).toBe(403);
      expect(deps.scope).not.toHaveBeenCalled();
      expect(deps.execute).not.toHaveBeenCalled();
    },
  );
  it("requires protocol and actual ACL, never using page role as a grant", async () => {
    deps.rpc.mockResolvedValue({ data: null, error: null });
    expect((await cimacApartmentReservationHttp(req(), "query")).status).toBe(503);
    expect(deps.query).not.toHaveBeenCalled();
    deps.rpc.mockImplementation(async (name) => ({
      data: name === "cimac_apartment_reservations_protocol_version" ? 1 : false,
      error: null,
    }));
    expect((await cimacApartmentReservationHttp(req(), "query")).status).toBe(403);
  });
  it("queries only exact B17 room numbers without accepting a project override", async () => {
    expect(
      (await cimacApartmentReservationHttp(req({ unitNos: ["201", "516"] }), "query")).status,
    ).toBe(200);
    expect(deps.query).toHaveBeenCalledExactlyOnceWith(client, scope, id(9), ["201", "516"]);
    expect(
      (await cimacApartmentReservationHttp(req({ unitNos: ["201"], project: "other" }), "query"))
        .status,
    ).toBe(400);
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it("writes one validated batch, revalidates both locales and does not require browser confirmation", async () => {
    const response = await cimacApartmentReservationHttp(req(body()), "execute");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(deps.execute).toHaveBeenCalledExactlyOnceWith(client, scope, id(9), body());
    expect(deps.revalidate.mock.calls).toEqual([
      ["/cimac", "layout"],
      ["/fr/cimac", "layout"],
    ]);
  });
  it("rejects financial and occupancy fields instead of silently discarding them", async () => {
    expect(
      (await cimacApartmentReservationHttp(req({ ...body(), amount: 0 }), "execute")).status,
    ).toBe(400);
    expect(
      (
        await cimacApartmentReservationHttp(
          req({ ...body(), operations: [{ ...body().operations[0], occupied: true }] }),
          "execute",
        )
      ).status,
    ).toBe(400);
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it("stops writes while preserving original-request recovery and reads", async () => {
    deps.direct.mockReturnValue(false);
    expect((await cimacApartmentReservationHttp(req(body()), "execute")).status).toBe(503);
    expect((await cimacApartmentReservationHttp(req(), "query")).status).toBe(200);
    const response = await cimacApartmentReservationHttp(
      new Request(`https://sacsi.example/status?requestId=${requestId}`, {
        headers: { authorization: "Bearer synthetic-token" },
      }),
      "status",
    );
    expect(await response.json()).toMatchObject({ status: "not_found", verified: false });
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it("does not turn an unknown outcome into success or disclose transport details", async () => {
    deps.execute.mockRejectedValue(new Error("PRIVATE_TRANSPORT_DETAIL"));
    const response = await cimacApartmentReservationHttp(req(body()), "execute");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "execution_unknown",
      requestId,
      verified: false,
      retryPolicy: "recheck_same_request_id_only",
    });
    expect(deps.revalidate).not.toHaveBeenCalled();
  });
  it("returns only fixed conflict codes for verified database rollback", async () => {
    deps.execute.mockRejectedValue(
      new CimacApartmentReservationError("CimacApartmentReservationsAlreadyHeld", 409),
    );
    const response = await cimacApartmentReservationHttp(req(body()), "execute");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "CimacApartmentReservationsAlreadyHeld",
      requestId,
      verified: false,
    });
  });
  it("refuses ambiguous status arguments without a write", async () => {
    const response = await cimacApartmentReservationHttp(
      new Request(`https://sacsi.example/status?requestId=${requestId}&requestId=${requestId}`, {
        headers: { authorization: "Bearer synthetic-token" },
      }),
      "status",
    );
    expect(response.status).toBe(400);
    expect(deps.status).not.toHaveBeenCalled();
  });
});
