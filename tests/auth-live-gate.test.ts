import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// These calls represent distinct incoming requests; never emulate a global user cache.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn(), from: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.user },
    from: mocks.from,
  }),
}));
import { getCurrentUser, hasPermission } from "@/lib/auth";
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.user.mockResolvedValue({
    data: {
      user: {
        id: "verified-user",
        email: "admin@synthetic.invalid",
        user_metadata: { role: "admin" },
      },
    },
    error: null,
  });
  mocks.profile.mockResolvedValue({
    data: { role: "rental_sales", display_name: "Synthetic account" },
    error: null,
  });
  mocks.eq.mockReturnValue({ single: mocks.profile });
  mocks.from.mockReturnValue({ select: () => ({ eq: mocks.eq }) });
});
afterEach(() => log.mockRestore());
it("resolves only the live verified Auth identity's database role, never a JWT/email default", async () => {
  const user = await getCurrentUser();
  expect(user?.role).toBe("rental_sales");
  expect(mocks.eq).toHaveBeenCalledWith("id", "verified-user");
  expect(hasPermission(user, "users:manage")).toBe(false);
  expect(JSON.stringify(log.mock.calls)).not.toContain("verified-user");
  expect(JSON.stringify(log.mock.calls)).not.toContain("Synthetic account");
  expect(JSON.stringify(log.mock.calls)).not.toContain("admin@synthetic.invalid");
});
it("checks live Auth on subsequent requests and cannot reuse a locally verified but revoked session", async () => {
  expect(await getCurrentUser()).not.toBeNull();
  mocks.user.mockResolvedValue({ data: { user: null }, error: { code: "session_not_found" } });
  expect(await getCurrentUser()).toBeNull();
  expect(mocks.user).toHaveBeenCalledTimes(2);
  expect(mocks.profile).toHaveBeenCalledTimes(1);
});
it("observes database role downgrade and profile deletion on the next request", async () => {
  mocks.profile.mockResolvedValueOnce({ data: { role: "admin" }, error: null });
  expect(hasPermission(await getCurrentUser(), "finance:write")).toBe(true);
  mocks.profile.mockResolvedValueOnce({ data: { role: "boss" }, error: null });
  expect(hasPermission(await getCurrentUser(), "finance:write")).toBe(false);
  mocks.profile.mockResolvedValueOnce({ data: null, error: null });
  expect(await getCurrentUser()).toBeNull();
});
it("fails closed on live Auth transport failure and does not log its error contents", async () => {
  const error = new Error("sensitive-network-details");
  mocks.user.mockRejectedValue(error);
  await expect(getCurrentUser()).rejects.toBe(error);
  expect(mocks.profile).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain(error.message);
});
