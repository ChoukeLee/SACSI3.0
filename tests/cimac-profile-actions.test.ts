import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  client: vi.fn(),
  scope: vi.fn(),
  customer: vi.fn(),
  unit: vi.fn(),
  updateCustomer: vi.fn(),
  createCustomer: vi.fn(),
  updateUnit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<object>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/cimac/cimac-workspace-read", () => ({
  readCimacWorkspaceScope: mocks.scope,
  readCimacCustomer: mocks.customer,
}));
vi.mock("@/features/cimac/cimac-profile-service", () => ({ readCimacOperationUnit: mocks.unit }));
vi.mock("@/features/customers/actions", () => ({
  updateCustomer: mocks.updateCustomer,
  createCustomer: mocks.createCustomer,
}));
vi.mock("@/features/units/actions", () => ({ updateUnitStatus: mocks.updateUnit }));
import {
  updateCimacAssetCondition,
  updateCimacCustomerProfile,
  createCimacCustomerIdentity,
} from "@/features/cimac/cimac-profile-actions";
const stamp = "2026-10-25T10:00:00Z";
const id = "10000000-0000-4000-8000-000000000001";
const scope = { project: { id: "cimac", code: "CIMAC" }, buildings: [] };
const client = { from: vi.fn(), rpc: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({
    id: "actor",
    role: "admin",
    displayName: "operator",
  } as CurrentUser);
  mocks.client.mockResolvedValue(client);
  mocks.scope.mockResolvedValue(scope);
  mocks.customer.mockResolvedValue({ profile: { id, updated_at: stamp } });
  mocks.unit.mockResolvedValue({ id, updated_at: stamp });
  mocks.updateCustomer.mockResolvedValue({
    success: true,
    data: { id, encrypted_document_no: "DO_NOT_RETURN" },
  });
  mocks.updateUnit.mockResolvedValue({ success: true });
  mocks.createCustomer.mockResolvedValue({
    success: true,
    data: { id, encrypted_document_no: "DO_NOT_RETURN" },
  });
});
describe("CIMAC profile operations enforce the workspace at the write boundary", () => {
  it.each(["admin", "finance", "rental_sales"])(
    "allows %s to create only the shared identity after park-scope validation",
    async (role) => {
      mocks.user.mockResolvedValue({ id: "actor", role, displayName: "operator" });
      const input = {
        name: "New Client",
        phone: "+2251234",
        document_no_plain: "confirmed-number",
      };
      const result = await createCimacCustomerIdentity(input);
      expect(mocks.scope).toHaveBeenCalledExactlyOnceWith(client);
      expect(mocks.createCustomer).toHaveBeenCalledExactlyOnceWith(input);
      expect(result).toEqual({ success: true, data: { id } });
      expect(JSON.stringify(result)).not.toContain("DO_NOT_RETURN");
      expect(mocks.customer).not.toHaveBeenCalled();
      expect(client.from).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );
  it.each([null, "boss", "front_desk"])(
    "rejects shared-identity creation by %s before reading or writing",
    async (role) => {
      mocks.user.mockResolvedValue(role ? { id: "actor", role, displayName: "reader" } : null);
      await expect(createCimacCustomerIdentity({ name: "New Client" })).rejects.toThrow();
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.createCustomer).not.toHaveBeenCalled();
    },
  );
  it("does not create an identity if CIMAC is inaccessible even when global customer writes are allowed", async () => {
    mocks.scope.mockRejectedValue(new Error("CIMAC unavailable"));
    await expect(createCimacCustomerIdentity({ name: "New Client" })).rejects.toThrow(
      "CIMAC unavailable",
    );
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });
  it("keeps create validation errors without returning a fake created identity", async () => {
    mocks.createCustomer.mockResolvedValue({ success: false, error: "Name missing" });
    expect(await createCimacCustomerIdentity({ name: "" })).toEqual({
      success: false,
      error: "Name missing",
    });
  });
  it.each([null, "boss", "front_desk"])(
    "rejects customer mutation for %s before creating a data client",
    async (role) => {
      mocks.user.mockResolvedValue(role ? { id: "actor", role, displayName: "reader" } : null);
      await expect(
        updateCimacCustomerProfile(id, stamp, { name: "Test Customer" }),
      ).rejects.toThrow();
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.updateCustomer).not.toHaveBeenCalled();
    },
  );
  it.each(["finance", "rental_sales", "boss", "front_desk"])(
    "rejects asset mutation for %s",
    async (role) => {
      mocks.user.mockResolvedValue({ id: "actor", role, displayName: "reader" });
      await expect(updateCimacAssetCondition(id, "locked", stamp)).rejects.toThrow();
      expect(mocks.unit).not.toHaveBeenCalled();
      expect(mocks.updateUnit).not.toHaveBeenCalled();
    },
  );
  it("resolves the current RLS park and a scoped customer before reusing the original update", async () => {
    const input = { name: "Confirmed Name", phone: "+2251234", document_no_plain: "1234" };
    const result = await updateCimacCustomerProfile(id, stamp, input);
    expect(mocks.scope).toHaveBeenCalledExactlyOnceWith(client);
    expect(mocks.customer).toHaveBeenCalledWith(
      client,
      scope,
      id,
      expect.objectContaining({ project: "CIMAC" }),
    );
    expect(mocks.updateCustomer).toHaveBeenCalledExactlyOnceWith(id, input, stamp);
    expect(result).toEqual({ success: true, data: { id } });
    expect(JSON.stringify(result)).not.toContain("DO_NOT_RETURN");
  });
  it("does not update a foreign customer even if globally visible under the user's RLS", async () => {
    mocks.customer.mockRejectedValue(new Error("CustomerNotInCimac"));
    await expect(updateCimacCustomerProfile(id, stamp, { name: "New name" })).rejects.toThrow(
      "CustomerNotInCimac",
    );
    expect(mocks.updateCustomer).not.toHaveBeenCalled();
  });
  it("rejects a stale customer version before submitting the mutation", async () => {
    const result = await updateCimacCustomerProfile(id, "old", { name: "New name" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("已变化");
    expect(mocks.updateCustomer).not.toHaveBeenCalled();
  });
  it("keeps the existing mutation error and does not claim a successful save", async () => {
    mocks.updateCustomer.mockResolvedValue({ success: false, error: "concurrent change" });
    expect(await updateCimacCustomerProfile(id, stamp, { name: "New name" })).toEqual({
      success: false,
      error: "concurrent change",
    });
  });
  it("preserves the condition RPC and expected version after a fresh park asset check", async () => {
    expect(await updateCimacAssetCondition(id, "maintenance", stamp)).toEqual({ success: true });
    expect(mocks.unit).toHaveBeenCalledExactlyOnceWith(client, scope, id);
    expect(mocks.updateUnit).toHaveBeenCalledExactlyOnceWith(id, "maintenance", stamp);
  });
  it("does not mutate a foreign or stale asset", async () => {
    mocks.unit.mockRejectedValueOnce(new Error("foreign asset"));
    await expect(updateCimacAssetCondition(id, "locked", stamp)).rejects.toThrow("foreign asset");
    expect(mocks.updateUnit).not.toHaveBeenCalled();
    expect((await updateCimacAssetCondition(id, "locked", "old")).success).toBe(false);
    expect(mocks.updateUnit).not.toHaveBeenCalled();
  });
});
