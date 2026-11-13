import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ownerActorId,
  ownerAssetId,
  ownerContext,
  ownerInput,
  ownerRequestId,
  ownerResult,
} from "../../../tests/fixtures/owner-settlement";
import { getOwnerSettlementContext, recordOwnerSettlement } from "./owner-settlement-actions";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  client: vi.fn(),
  role: vi.fn(),
  revalidate: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/operation-monitoring", () => ({ captureOperationFailure: mocks.capture }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.role.mockResolvedValue({ id: ownerActorId, role: "finance" });
});
afterEach(() => vi.useRealTimers());

it("reads fresh context with the authenticated account and checks the exact target", async () => {
  mocks.rpc.mockResolvedValue({ data: ownerContext(), error: null });
  expect(await getOwnerSettlementContext(ownerAssetId)).toEqual({
    ok: true,
    context: ownerContext(),
  });
  expect(mocks.role).toHaveBeenCalledWith("admin", "finance");
  expect(mocks.rpc).toHaveBeenCalledWith("asset_operations_owner_settlement_context_rpc", {
    p_asset_id: ownerAssetId,
  });
  mocks.rpc.mockResolvedValue({
    data: { ...ownerContext(), assetId: ownerRequestId },
    error: null,
  });
  expect(await getOwnerSettlementContext(ownerAssetId)).toMatchObject({
    ok: false,
    error: "ownerSettlementContextUnavailable",
  });
});

it("requires write role before invoking the normal-session RPC", async () => {
  mocks.role.mockRejectedValue(new Error("Role required"));
  await expect(recordOwnerSettlement(ownerInput(), ownerRequestId)).rejects.toThrow(
    "Role required",
  );
  expect(mocks.client).not.toHaveBeenCalled();
});

it("rejects invalid fields before dispatch, and only refreshes after exact result verification", async () => {
  expect(
    await recordOwnerSettlement({ ...ownerInput(), currency: "CNY" }, ownerRequestId),
  ).toMatchObject({ ok: false, rejected: true });
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: ownerResult(), error: null });
  expect(await recordOwnerSettlement(ownerInput(), ownerRequestId)).toMatchObject({
    ok: true,
    settlement: { receiptAmountNative: 5_000_000 },
    idempotent: false,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("asset_operations_record_owner_settlement_rpc", {
    p_input: ownerInput(),
    p_request_id: ownerRequestId,
  });
  expect(mocks.revalidate).toHaveBeenCalledWith("/leases");
  expect(mocks.revalidate).toHaveBeenCalledWith("/finance");
});

it("supports the original idempotent result but treats altered or missing evidence as unknown", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { ...ownerResult(), idempotent: true }, error: null });
  expect(await recordOwnerSettlement(ownerInput(), ownerRequestId)).toMatchObject({
    ok: true,
    idempotent: true,
  });
  mocks.revalidate.mockClear();
  const changed = ownerResult();
  changed.data.ownerSettlement.recordedBy = ownerAssetId;
  mocks.rpc.mockResolvedValue({ data: changed, error: null });
  expect(await recordOwnerSettlement(ownerInput(), ownerRequestId)).toEqual({
    ok: false,
    error: "assetOperationResultUnknown",
    rejected: false,
  });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("separates definitive business rejection from uncertain results without leaking exceptions", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "P0001", message: "ownerSettlementEquationMismatch" },
  });
  expect(await recordOwnerSettlement(ownerInput(), ownerRequestId)).toMatchObject({
    ok: false,
    error: "ownerSettlementEquationMismatch",
    rejected: true,
  });
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "P0001", message: "requestIdConflict" },
  });
  expect(await recordOwnerSettlement(ownerInput(), ownerRequestId)).toMatchObject({
    ok: false,
    rejected: false,
  });
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "23514", message: "private constraint details: secret" },
  });
  expect(await recordOwnerSettlement(ownerInput(), ownerRequestId)).toEqual({
    ok: false,
    error: "assetOperationResultUnknown",
    rejected: false,
  });
  mocks.rpc.mockRejectedValueOnce(new Error("private host and credential"));
  expect(await recordOwnerSettlement(ownerInput(), ownerRequestId)).toEqual({
    ok: false,
    error: "assetOperationResultUnknown",
    rejected: false,
  });
  expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain("credential");
});
