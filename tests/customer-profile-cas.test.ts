import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  client: vi.fn(),
  permission: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, requirePermission: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { updateCustomer } from "@/features/customers/actions";
let result: { data: unknown; error: unknown },
  updated: Record<string, unknown>,
  filters: [string, unknown][];
const audit = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "actor", role: "admin" });
  updated = {};
  filters = [];
  result = { data: { id: "customer" }, error: null };
  const builder = {
    update(value: Record<string, unknown>) {
      updated = value;
      return builder;
    },
    eq(key: string, value: unknown) {
      filters.push([key, value]);
      return builder;
    },
    select() {
      return builder;
    },
    maybeSingle: async () => result,
  };
  mocks.client.mockResolvedValue({
    from: (table: string) => (table === "audit_logs" ? { insert: audit } : builder),
  });
});
describe("customer profile optional concurrency guard", () => {
  it("keeps legacy two-argument callers compatible", async () => {
    expect((await updateCustomer("customer", { name: " Changed " })).success).toBe(true);
    expect(updated).toEqual({ name: "Changed" });
    expect(filters).toEqual([["id", "customer"]]);
  });
  it("puts the expected version into the UPDATE predicate, not just an earlier SELECT", async () => {
    expect(
      (await updateCustomer("customer", { name: "Changed" }, "original-version")).success,
    ).toBe(true);
    expect(filters).toEqual([
      ["id", "customer"],
      ["updated_at", "original-version"],
    ]);
    expect(audit).toHaveBeenCalledOnce();
    expect(mocks.revalidate).toHaveBeenCalledWith("/cimac", "layout");
    expect(mocks.revalidate).toHaveBeenCalledWith("/fr/cimac", "layout");
  });
  it("does not log success or invalidate the workspace on a zero-row stale update", async () => {
    result = { data: null, error: null };
    const saved = await updateCustomer("customer", { name: "Changed" }, "old-version");
    expect(saved.success).toBe(false);
    expect(saved.error).toContain("已变化");
    expect(audit).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("does not add risk flags, project identities or financial fields supplied by a caller", async () => {
    await updateCustomer(
      "customer",
      { name: "Changed", is_blacklisted: false, project_id: "other", rent_xof: 0 } as never,
      "version",
    );
    expect(updated).toEqual({ name: "Changed" });
  });
  it("omits document replacement when the form leaves its number unchanged", async () => {
    await updateCustomer("customer", { name: "Changed", phone: "+225" }, "version");
    expect(updated).not.toHaveProperty("encrypted_document_no");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { updated_fields: ["name", "phone"] } }),
    );
  });
});
