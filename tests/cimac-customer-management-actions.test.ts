import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  client: vi.fn(),
  scope: vi.fn(),
  customer: vi.fn(),
  unit: vi.fn(),
  rpc: vi.fn(),
  prior: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<object>()),
  getCurrentUser: m.user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/features/cimac/cimac-workspace-read", () => ({
  readCimacWorkspaceScope: m.scope,
  readCimacCustomer: m.customer,
}));
vi.mock("@/features/cimac/cimac-profile-service", () => ({ readCimacOperationUnit: m.unit }));
import { manageCimacCustomer } from "@/features/cimac/cimac-profile-actions";
import { validCimacCustomerLink } from "@/features/cimac/cimac-customer-management-model";
const id = "10000000-0000-4000-8000-000000000001",
  request = "10000000-0000-4000-8000-000000000002",
  project = "10000000-0000-4000-8000-000000000003";
const stamp = "2026-10-25T10:00:00Z";
const link = {
  unitId: "10000000-0000-4000-8000-000000000004",
  brand: "箭牌卫浴",
  relationshipKind: "signed_contract" as const,
  signingState: "signed_effective" as const,
  signedDate: null,
  sourceReference: "已核合同",
};
const input = () => ({
  rows: [
    {
      rowKey: id,
      customerId: id,
      expectedUpdatedAt: stamp,
      name: "Company",
      phone: "PRIVATE_PHONE",
      notes: null,
      membershipStatus: "current",
      sourceReference: "CIMAC客户名册维护",
      links: [link],
    },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: "actor", role: "admin", displayName: "Admin" });
  m.scope.mockResolvedValue({ project: { id: project, code: "CIMAC" }, buildings: [] });
  m.customer.mockResolvedValue({
    profile: { id, updated_at: stamp, name: "Company", phone: "PRIVATE_PHONE", notes: null },
  });
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: m.prior,
  };
  m.client.mockResolvedValue({ rpc: m.rpc, from: vi.fn(() => builder) });
  m.prior.mockResolvedValue({ data: null, error: null });
  m.rpc.mockResolvedValue({
    data: {
      success: true,
      requestId: request,
      projectId: project,
      rows: [{ customerId: id, membershipStatus: "current" }],
    },
    error: null,
  });
});
describe("admin CIMAC membership and explicit links", () => {
  it.each(["finance", "rental_sales"])(
    "keeps %s out of admin-only management RPC",
    async (role) => {
      m.user.mockResolvedValue({ id: "actor", role });
      expect((await manageCimacCustomer(request, id, stamp, "current", link)).success).toBe(false);
      expect(m.rpc).not.toHaveBeenCalled();
      expect(m.customer).not.toHaveBeenCalled();
    },
  );
  it.each([null, "boss", "front_desk"])("denies %s before any mutation", async (role) => {
    m.user.mockResolvedValue(role ? { id: "actor", role } : null);
    await expect(manageCimacCustomer(request, id, stamp, "current", link)).rejects.toThrow();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("upserts only the selected scoped link, without lease/payment RPCs or sensitive response fields", async () => {
    const result = await manageCimacCustomer(request, id, stamp, "current", link);
    expect(result).toEqual({ success: true });
    expect(m.unit).toHaveBeenCalledWith(expect.anything(), expect.anything(), link.unitId);
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("cimac_customer_profiles_sync_rpc", {
      p_request_id: request,
      p_input: input(),
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PHONE");
  });
  it("restores an already completed request before stale profile CAS after a lost response", async () => {
    m.prior.mockResolvedValue({
      data: { actor_id: "actor", metadata: { project_id: project, input: input() } },
      error: null,
    });
    m.customer.mockResolvedValue({ profile: { id, updated_at: "new-version" } });
    expect(await manageCimacCustomer(request, id, stamp, "current", link)).toEqual({
      success: true,
    });
    expect(m.customer).not.toHaveBeenCalled();
    expect(m.rpc).toHaveBeenCalledWith("cimac_customer_profiles_sync_rpc", {
      p_request_id: request,
      p_input: input(),
    });
  });
  it("rejects a changed completed request instead of inventing another write", async () => {
    m.prior.mockResolvedValue({
      data: { actor_id: "actor", metadata: { project_id: project, input: input() } },
      error: null,
    });
    expect((await manageCimacCustomer(request, id, stamp, "archived", link)).success).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rejects stale versions and foreign units before submitting the RPC", async () => {
    expect((await manageCimacCustomer(request, id, "old", "current", link)).success).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
    m.unit.mockRejectedValueOnce(new Error("foreign"));
    await expect(manageCimacCustomer(request, id, stamp, "current", link)).rejects.toThrow(
      "foreign",
    );
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("surfaces active-business archive rejection without pretending to terminate a contract", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "CimacCustomerSyncArchiveActive" } });
    expect((await manageCimacCustomer(request, id, stamp, "archived")).error).toContain(
      "仍有当前业务",
    );
    expect(m.rpc.mock.calls[0][1].p_input.rows[0].links).toEqual([]);
  });
  it("requires source evidence, valid dates and known documentary enums", () => {
    expect(validCimacCustomerLink(link)).toBe(true);
    expect(validCimacCustomerLink({ ...link, signedDate: "2026-02-30" })).toBe(false);
    expect(validCimacCustomerLink({ ...link, sourceReference: " " })).toBe(false);
  });
});
