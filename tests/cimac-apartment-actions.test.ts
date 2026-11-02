import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth";
import type { CimacWorkspaceScope } from "@/features/cimac/cimac-workspace-types";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  client: vi.fn(),
  scope: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<object>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/cimac/cimac-workspace-read", () => ({
  readCimacWorkspaceScope: mocks.scope,
}));

import { initializeCimacApartments } from "@/features/cimac/cimac-apartment-actions";

const id = (value: number) => `72000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const actor = id(1),
  project = id(2),
  building = id(3),
  request = id(4);
const unitIds = Array.from({ length: 64 }, (_, index) => id(index + 100));
const client = { rpc: vi.fn(), from: vi.fn() };
const rawDetail = "PRIVATE_DATABASE_DETAIL_DO_NOT_RETURN";

function scope(): CimacWorkspaceScope {
  return {
    project: { id: project, code: "CIMAC", displayName: "Synthetic park" },
    buildings: [
      {
        id: building,
        code: "CIMAC-B17",
        name: "Synthetic B17",
        constructionStatus: "unverified",
        isActive: true,
      },
    ],
  };
}

function response(patch: Record<string, unknown> = {}) {
  return {
    success: true,
    requestId: request,
    actorId: actor,
    projectId: project,
    buildingId: building,
    roomCount: 64,
    unitIds: [...unitIds],
    idempotent: false,
    ...patch,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({
    id: actor,
    role: "admin",
    displayName: "Synthetic operator",
  } as CurrentUser);
  mocks.client.mockResolvedValue(client);
  mocks.scope.mockResolvedValue(scope());
  client.rpc.mockResolvedValue({ data: response(), error: null });
});

describe("CIMAC apartment initialization action boundary", () => {
  it.each([null, "boss", "finance", "rental_sales", "front_desk"])(
    "requires the verified admin role before creating a database client: %s",
    async (role) => {
      mocks.user.mockResolvedValue(
        role ? { id: actor, role, displayName: "Synthetic reader" } : null,
      );
      expect((await initializeCimacApartments(request)).success).toBe(false);
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.scope).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each(["", "not-a-uuid", `${request}\n`, `${request} `, null, undefined, 123, { request }])(
    "rejects malformed request identity before reading or writing: %j",
    async (value) => {
      const result = await initializeCimacApartments(value as string);
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("操作编号无效"),
      });
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.scope).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each(["absent", "inactive", "foreign code", "ambiguous"])(
    "rejects an unverified B17 target without invoking the RPC: %s",
    async (kind) => {
      const current = scope();
      if (kind === "absent") current.buildings = [];
      if (kind === "inactive") current.buildings[0].isActive = false;
      if (kind === "foreign code") current.buildings[0].code = "OTHER-B17";
      if (kind === "ambiguous") current.buildings.push({ ...current.buildings[0], id: id(5) });
      mocks.scope.mockResolvedValue(current);
      const result = await initializeCimacApartments(request);
      expect(result).toMatchObject({ success: false, error: expect.stringContaining("17栋范围") });
      expect(mocks.scope).toHaveBeenCalledExactlyOnceWith(client);
      expect(client.rpc).not.toHaveBeenCalled();
      expect(client.from).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it("does not initialize when the current actor cannot resolve the authorized CIMAC scope", async () => {
    mocks.scope.mockRejectedValue(new Error(rawDetail));
    const result = await initializeCimacApartments(request);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(rawDetail);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "returns only a verified result and revalidates both workspace layouts (idempotent=%s)",
    async (idempotent) => {
      client.rpc.mockResolvedValue({
        data: response({ idempotent, privateField: rawDetail }),
        error: null,
      });
      expect(await initializeCimacApartments(request)).toEqual({
        success: true,
        requestId: request,
        roomCount: 64,
        idempotent,
      });
      expect(mocks.scope).toHaveBeenCalledExactlyOnceWith(client);
      expect(client.rpc).toHaveBeenCalledExactlyOnceWith("cimac_apartments_initialize_rpc", {
        p_request_id: request,
      });
      expect(client.from).not.toHaveBeenCalled();
      expect(mocks.revalidate.mock.calls).toEqual([
        ["/cimac", "layout"],
        ["/fr/cimac", "layout"],
      ]);
    },
  );

  const invalidResponses: [string, Record<string, unknown>][] = [
    ["different actor", { actorId: id(10) }],
    ["different project", { projectId: id(11) }],
    ["different building", { buildingId: id(12) }],
    ["different request", { requestId: id(13) }],
    ["reported failure", { success: false }],
    ["nonboolean success", { success: "true" }],
    ["wrong room count", { roomCount: 63 }],
    ["noninteger room count", { roomCount: "64" }],
    ["missing idempotency", { idempotent: undefined }],
    ["nonboolean idempotency", { idempotent: "true" }],
    ["missing unit identifiers", { unitIds: undefined }],
    ["nonarray unit identifiers", { unitIds: { length: 64 } }],
    ["too few unit identifiers", { unitIds: unitIds.slice(1) }],
    ["too many unit identifiers", { unitIds: [...unitIds, id(999)] }],
    ["duplicate unit identifier", { unitIds: [...unitIds.slice(0, 63), unitIds[0]] }],
    ["malformed unit identifier", { unitIds: ["bad-id", ...unitIds.slice(1)] }],
    ["nonstring unit identifier", { unitIds: [100, ...unitIds.slice(1)] }],
  ];
  it.each(invalidResponses)(
    "does not report or invalidate an unverifiable write result: %s",
    async (_kind, patch) => {
      client.rpc.mockResolvedValue({
        data: response({ ...patch, privateField: rawDetail }),
        error: null,
      });
      const result = await initializeCimacApartments(request);
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("无法核实建立结果"),
      });
      expect(JSON.stringify(result)).not.toContain(rawDetail);
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each([null, undefined, {}, []])(
    "rejects absent or incomplete RPC responses: %j",
    async (data) => {
      client.rpc.mockResolvedValue({ data, error: null });
      expect((await initializeCimacApartments(request)).success).toBe(false);
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each(["PGRST202", "42883"])(
    "reports undeployed migration without leaking database details: %s",
    async (code) => {
      client.rpc.mockResolvedValue({
        data: response(),
        error: { code, message: rawDetail, details: rawDetail },
      });
      expect(await initializeCimacApartments(request)).toEqual({
        success: false,
        error: "公寓台账尚未启用，请先完成数据库迁移。",
      });
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each([
    "CimacApartmentsRoomConflict",
    "CimacApartmentsRequestConflict",
    "CimacApartmentsAlreadyInitialized",
  ])("reports a conflict without claiming success or exposing raw details: %s", async (reason) => {
    client.rpc.mockResolvedValue({
      data: response(),
      error: { code: "23505", message: `${reason}: ${rawDetail}` },
    });
    const result = await initializeCimacApartments(request);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("不会覆盖现有记录"),
    });
    expect(JSON.stringify(result)).not.toContain(rawDetail);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(["42501", "NETWORK_ERROR", "40001"])(
    "retains the original request on unknown outcomes and hides raw details: %s",
    async (code) => {
      client.rpc.mockResolvedValue({ data: response(), error: { code, message: rawDetail } });
      const result = await initializeCimacApartments(request);
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("不要换号重复建立"),
      });
      expect(JSON.stringify(result)).not.toContain(rawDetail);
      expect(client.rpc).toHaveBeenCalledExactlyOnceWith("cimac_apartments_initialize_rpc", {
        p_request_id: request,
      });
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each(["client", "rpc"])(
    "turns thrown transport failures into an unconfirmed outcome: %s",
    async (stage) => {
      if (stage === "client") mocks.client.mockRejectedValue(new Error(rawDetail));
      else client.rpc.mockRejectedValue(new Error(rawDetail));
      const result = await initializeCimacApartments(request);
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("保留当前请求号"),
      });
      expect(JSON.stringify(result)).not.toContain(rawDetail);
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );
});
