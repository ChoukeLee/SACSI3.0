import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/cimac/cimac-apartment-read", () => ({ readCimacApartments: deps.read }));
import {
  apartmentTimestamp,
  parseCimacApartmentReservationRequest,
} from "@/features/cimac/cimac-apartment-reservation-model";
import {
  executeApartmentReservations,
  parseApartmentUnitNos,
  readApartmentReservationStatus,
  readCimacApartmentReservationOptions,
  verifyApartmentReservationResult,
} from "@/features/cimac/cimac-apartment-reservation-service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CimacWorkspaceScope } from "@/features/cimac/cimac-workspace-types";

const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1),
  project = id(2),
  building = id(3),
  unit = id(4),
  reservation = id(5),
  requestId = id(6),
  stamp = "2026-11-02T19:00:00.123456+00:00";
const scope = {
  project: { id: project, code: "CIMAC", displayName: "Synthetic" },
  buildings: [
    {
      id: building,
      code: "CIMAC-B17",
      name: "Synthetic",
      isActive: true,
      constructionStatus: null,
    },
  ],
} satisfies CimacWorkspaceScope;
const input = () => ({
  requestId,
  originalInstruction: "Hold the named apartment; unpaid and dates unknown",
  operations: [
    {
      type: "reserve" as const,
      unitId: unit,
      expectedUnitUpdatedAt: stamp,
      expectedReservationId: null,
      expectedReservationUpdatedAt: null,
      reserverName: "Synthetic Booker",
      reason: "Explicit unpaid undated hold",
    },
  ],
});
const result = () => ({
  success: true,
  requestId,
  actorId: actor,
  projectId: project,
  buildingId: building,
  idempotent: false,
  rooms: [
    {
      unitId: unit,
      unitNo: "201",
      reservationId: reservation,
      status: "reserved",
      reserverName: "Synthetic Booker",
      paymentStatus: "unpaid",
      updatedAt: stamp,
    },
  ],
});
const rpc = vi.fn();
const client = { rpc } as unknown as SupabaseClient;
beforeEach(() => {
  vi.resetAllMocks();
  deps.read.mockResolvedValue({
    projectId: project,
    buildingId: building,
    reservationSchemaAvailable: true,
    rooms: [
      { registered: true, unitId: unit, unitNo: "201", unitUpdatedAt: stamp, reservation: null },
    ],
  });
  rpc.mockResolvedValue({ data: result(), error: null });
});
describe("unpaid undated apartment hold contracts", () => {
  it("accepts only known rooms and explicit CAS without requesting dates or money", () => {
    expect(parseCimacApartmentReservationRequest(input())).toEqual(input());
    expect(parseApartmentUnitNos(["201", "516"])).toEqual(["201", "516"]);
    expect(parseApartmentUnitNos(undefined)).toBeUndefined();
  });
  it.each([
    { ...input(), paymentDate: "2026-11-02" },
    { ...input(), operations: [] },
    { ...input(), operations: [...input().operations, ...input().operations] },
    { ...input(), operations: [{ ...input().operations[0], amount: 0 }] },
    { ...input(), operations: [{ ...input().operations[0], checkIn: "2026-11-02" }] },
    { ...input(), operations: [{ ...input().operations[0], reserverName: "" }] },
    { ...input(), operations: [{ ...input().operations[0], reserverName: "X\nY" }] },
    {
      ...input(),
      operations: [{ ...input().operations[0], expectedUnitUpdatedAt: "2026-02-31T00:00:00Z" }],
    },
    { ...input(), operations: [{ ...input().operations[0], type: "check_in" }] },
    { ...input(), operations: [{ ...input().operations[0], type: "cancel" }] },
    { ...input(), operations: [{ ...input().operations[0], expectedReservationId: reservation }] },
  ])("rejects invented/ambiguous write fields %#", (raw) => {
    expect(() => parseCimacApartmentReservationRequest(raw)).toThrow();
  });
  it.each(
    [["1701"], ["201", "201"], [], ["201\n"], ["101"], ["601"], [201]].map((rooms) => ({ rooms })),
  )("rejects ambiguous room queries $rooms", ({ rooms }) => {
    expect(() => parseApartmentUnitNos(rooms)).toThrow();
  });
  it("retains microsecond CAS precision and validates civil timestamps", () => {
    expect(apartmentTimestamp(stamp)).toBe(true);
    expect(apartmentTimestamp("2026-02-31T00:00:00Z")).toBe(false);
  });
  it("returns fixed-building registered options with current hold instead of creating a customer", async () => {
    expect(await readCimacApartmentReservationOptions(client, scope, actor, ["201"])).toMatchObject(
      {
        actorId: actor,
        projectId: project,
        buildingId: building,
        schemaAvailable: true,
        rooms: [{ unitId: unit, unitUpdatedAt: stamp, reservation: null }],
      },
    );
    expect(rpc).not.toHaveBeenCalled();
    await expect(
      readCimacApartmentReservationOptions(client, scope, actor, ["202"]),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("executes only the fixed-purpose RPC with the authenticated RLS client", async () => {
    expect(await executeApartmentReservations(client, scope, actor, input())).toEqual(result());
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cimac_apartment_reservations_execute_rpc", {
      p_request: input(),
    });
  });
  it("does not send a foreign unit or unavailable schema to the write RPC", async () => {
    await expect(
      executeApartmentReservations(client, scope, actor, {
        ...input(),
        operations: [{ ...input().operations[0], unitId: id(99) }],
      }),
    ).rejects.toMatchObject({ status: 403 });
    deps.read.mockResolvedValue({
      projectId: project,
      buildingId: building,
      reservationSchemaAvailable: false,
      rooms: [],
    });
    await expect(executeApartmentReservations(client, scope, actor, input())).rejects.toMatchObject(
      { status: 503 },
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { actorId: id(99) },
    { projectId: id(99) },
    { buildingId: id(99) },
    { requestId: id(99) },
    { idempotent: "true" },
    { rooms: [] },
    { rooms: [{ ...result().rooms[0], paymentStatus: "paid" }] },
    { rooms: [{ ...result().rooms[0], reserverName: "Another Booker" }] },
    { rooms: [{ ...result().rooms[0], unitNo: "202" }] },
    { rooms: [{ ...result().rooms[0], status: "occupied" }] },
  ])("refuses unverified post-write results %#", (change) => {
    expect(() =>
      verifyApartmentReservationResult(
        { ...result(), ...change },
        input(),
        actor,
        project,
        building,
        new Map([[unit, "201"]]),
      ),
    ).toThrow();
  });
  it("keeps historical status read-only and explicitly unverified", async () => {
    rpc.mockResolvedValue({
      data: {
        status: "completed_previously",
        verified: false,
        requestId,
        actorId: actor,
        request: input(),
        result: result(),
      },
      error: null,
    });
    expect(await readApartmentReservationStatus(client, scope, actor, requestId)).toMatchObject({
      status: "completed_previously",
      verified: false,
      actorId: actor,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cimac_apartment_reservations_status_rpc", {
      p_request_id: requestId,
    });
    rpc.mockResolvedValue({
      data: { status: "not_found", verified: false, requestId },
      error: null,
    });
    expect(await readApartmentReservationStatus(client, scope, actor, requestId)).toMatchObject({
      status: "not_found",
      verified: false,
    });
  });
  it("sanitizes database conflicts and unknown diagnostics", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "CimacApartmentReservationsAlreadyHeld private_data" },
    });
    await expect(executeApartmentReservations(client, scope, actor, input())).rejects.toMatchObject(
      { code: "CimacApartmentReservationsAlreadyHeld", status: 409 },
    );
    rpc.mockResolvedValue({ data: null, error: { code: "500", message: "private_data" } });
    await expect(executeApartmentReservations(client, scope, actor, input())).rejects.toThrow(
      "apartment_reservation_unavailable",
    );
  });
});
