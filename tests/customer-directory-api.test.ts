import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), client: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.user,
  canAccessPage: (role: string) => ["admin", "boss", "finance", "rental_sales"].includes(role),
  hasPermission: (user: { role: string }) => !!user,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/customers/sacsi-directory-service", () => ({
  readSacsiCustomerDirectory: mocks.read,
}));
import { GET } from "../src/app/api/customers/directory/route";
import { CustomerDirectoryError } from "../src/features/customers/customer-directory-model";
import { customerDirectoryFixture, directoryIds } from "./fixtures/customer-directory";
const url = `https://example.invalid/api/customers/directory?customer=${directoryIds.customer}`;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "actor", role: "admin" });
  mocks.client.mockResolvedValue({});
  mocks.read.mockResolvedValue(customerDirectoryFixture("detail"));
});
it("authenticates independently and returns private no-store detail", async () => {
  const res = await GET(new Request(url));
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.read).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ page: 1 }),
    "detail",
    directoryIds.customer,
    1,
  );
});
it.each([null, { role: "front_desk" }])(
  "does not expand the existing customer page role boundary",
  async (user) => {
    mocks.user.mockResolvedValue(user);
    const res = await GET(new Request(url));
    expect(res.status).toBe(user ? 403 : 401);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it.each([
  "&mode=list",
  "&customer=duplicate",
  "&bad=value",
  "&projectId=bad",
  "&relationshipPage=0",
  "&relationshipPage=1.2",
])("rejects malformed query before fetching %s", async (suffix) => {
  const res = await GET(new Request(url + suffix));
  expect(res.status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each([400, 403, 404, 503])("retains unavailable/fail-closed status %i", async (status) => {
  mocks.read.mockRejectedValue(new CustomerDirectoryError(status));
  expect((await GET(new Request(url))).status).toBe(status);
});
