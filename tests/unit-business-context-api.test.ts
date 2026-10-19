import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), create: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("@/features/units/unit-business-context-read", async (original) => ({
  ...(await original<typeof import("@/features/units/unit-business-context-read")>()),
  readUnitBusinessContext: mocks.read,
}));
import { GET } from "@/app/api/units/business-context/route";
import { UnitBusinessContextError } from "@/features/units/unit-business-context-read";
const unit = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  project = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  building = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const request = (query = `unit=${unit}`) =>
  new Request(`https://sacsi.invalid/api/units/business-context?${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "operator", role: "finance" });
  mocks.create.mockResolvedValue({ synthetic: true });
  mocks.read.mockResolvedValue({ unitId: unit, relations: [] });
});
describe("asset business-context endpoint", () => {
  it("requires authenticated identity and never creates a privileged anonymous client", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["front_desk", "unknown"])(
    "retains existing asset-page role boundary for %s",
    async (role) => {
      mocks.user.mockResolvedValue({ role });
      expect((await GET(request())).status).toBe(403);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it.each(["admin", "finance", "boss", "rental_sales"])(
    "allows %s only through the current authenticated RLS client",
    async (role) => {
      mocks.user.mockResolvedValue({ role });
      const response = await GET(
        request(`unit=${unit}&project=${project}&building=${building}&page=2`),
      );
      expect(response.status).toBe(200);
      expect(mocks.read).toHaveBeenCalledWith({ synthetic: true }, unit, 2, { project, building });
    },
  );
  it.each([
    "",
    "unit=invalid",
    `unit=${unit}&unit=${unit}`,
    `unit=${unit}&page=0`,
    `unit=${unit}&page=-1`,
    `unit=${unit}&page=1.5`,
    `unit=${unit}&page=100000`,
    `unit=${unit}&building=bad`,
    `unit=${unit}&project=bad`,
    `unit=${unit}&role=admin`,
  ])("rejects invalid or duplicate query %# before any database call", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([404, 503])(
    "preserves unavailable distinction %s without exposing database internals",
    async (status) => {
      mocks.read.mockRejectedValue(new UnitBusinessContextError(status));
      const response = await GET(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: "UnitBusinessContextUnavailable" });
    },
  );
});
