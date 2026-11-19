import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import {
  executeApartmentPaid,
  apartmentPaidStatus,
} from "@/features/cimac/cimac-apartment-paid-service";
import {
  paidActor,
  paidId,
  paidInput,
  paidResult,
  paidScope,
} from "./fixtures/cimac-apartment-paid";
import { combinedInput, combinedResult } from "./fixtures/cimac-apartment-paid-v2";
const rpc = vi.fn(),
  from = vi.fn();
const client = { rpc, from } as unknown as SupabaseClient;
beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockResolvedValue({ data: paidResult(), error: null });
  from.mockImplementation(() => {
    const b = {
      select: () => b,
      eq: () => b,
      in: () => b,
      range: async () => ({
        data: paidInput().rooms.map((r, i) => ({
          unit_id: r.unitId,
          building_id: paidScope.buildings[0].id,
          floor_number: 2,
          room_suffix: i + 1,
        })),
        error: null,
        count: 3,
      }),
    };
    return b;
  });
});
describe("paid apartment authenticated service boundary", () => {
  it("dispatches one combined receipt and retains its exact hold CAS and annual property fields", async () => {
    rpc.mockResolvedValue({ data: combinedResult(), error: null });
    const request = combinedInput();
    expect(await executeApartmentPaid(client, paidScope, paidActor, request)).toMatchObject({
      success: true,
      totalAmountXof: 6330000,
      roomCount: 3,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cimac_apartment_paid_receipt_execute_rpc", {
      p_request: request,
    });
  });
  it("verifies combined-receipt status without issuing a second financial write", async () => {
    rpc.mockResolvedValue({ data: combinedResult(), error: null });
    expect(
      await apartmentPaidStatus(client, paidScope, paidActor, combinedInput().requestId),
    ).toMatchObject({ found: true, verified: false });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cimac_apartment_paid_receipt_status_rpc", {
      p_request_id: combinedInput().requestId,
    });
  });
  it("returns a known 409 for an atomic hold CAS rejection, without disclosing database text", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "CimacApartmentPaidHoldChanged internal details", code: "P0001" },
    });
    await expect(
      executeApartmentPaid(client, paidScope, paidActor, combinedInput()),
    ).rejects.toMatchObject({ status: 409, message: "CimacApartmentPaidHoldChanged" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("only dispatches the typed atomic RPC once and reconciles all raw rows", async () => {
    expect(await executeApartmentPaid(client, paidScope, paidActor, paidInput())).toMatchObject({
      success: true,
      totalAmountXof: 5250000,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cimac_apartment_paid_receipt_execute_rpc", {
      p_request: paidInput(),
    });
  });
  it("does not dispatch malformed payloads", async () => {
    await expect(
      executeApartmentPaid(client, paidScope, paidActor, { ...paidInput(), sql: "x" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects an actor or project substitution in returned evidence", async () => {
    await expect(
      executeApartmentPaid(client, paidScope, paidId(99), paidInput()),
    ).rejects.toThrow();
  });
  it("preserves the original request for status verification and does not re-execute it", async () => {
    expect(
      await apartmentPaidStatus(client, paidScope, paidActor, paidInput().requestId),
    ).toMatchObject({ found: true, verified: false });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cimac_apartment_paid_receipt_status_rpc", {
      p_request_id: paidInput().requestId,
    });
  });
  it("reports not-found without permission to infer completion or replay under another ID", async () => {
    rpc.mockResolvedValue({
      data: { success: false, status: "not_found", requestId: paidInput().requestId },
      error: null,
    });
    expect(
      await apartmentPaidStatus(client, paidScope, paidActor, paidInput().requestId),
    ).toMatchObject({ found: false, verified: false });
    expect(from).not.toHaveBeenCalled();
  });
  it("fails unknown data closed and does not leak raw database exception details", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private sensitive database error" } });
    await expect(
      executeApartmentPaid(client, paidScope, paidActor, paidInput()),
    ).rejects.toMatchObject({ message: "apartment_paid_unverified", status: 503 });
  });
});
