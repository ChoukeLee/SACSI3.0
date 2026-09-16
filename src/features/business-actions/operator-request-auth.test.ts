import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBearer: vi.fn(), getUser: vi.fn(), resolve: vi.fn(),
  current: vi.fn(), cookie: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createBearer }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.current, resolveVerifiedSupabaseUser: mocks.resolve,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.cookie }));
import { authenticateOperatorRequest } from "./operator-request-auth";

const actor = { id: "verified-actor", role: "admin", displayName: "Operator" };
const client = { auth: { getUser: mocks.getUser } };
const request = (authorization?: string) => new Request("http://localhost/api/operator/v1/actions", {
  headers: authorization === undefined ? {} : { authorization },
});

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
  mocks.createBearer.mockReturnValue(client);
  mocks.current.mockResolvedValue(actor);
  mocks.cookie.mockResolvedValue({ mode: "cookie-client" });
  mocks.getUser.mockResolvedValue({ data: { user: { id: actor.id } }, error: null });
  mocks.resolve.mockResolvedValue(actor);
});

describe("operator request identity boundary", () => {
  it.each([0, 408, 429, 500, 503])("distinguishes authentication outages from invalid tokens: %s", async (status) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status, message: "sensitive detail" } });
    expect(await authenticateOperatorRequest(request("Bearer test-token"))).toEqual({
      authenticated: false, reason: "authentication_unavailable",
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.current).not.toHaveBeenCalled();
  });

  it.each(["AuthRetryableFetchError", "AuthUnknownError"])("handles structured SDK network errors: %s", async (name) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name } });
    expect(await authenticateOperatorRequest(request("Bearer test-token"))).toMatchObject({ reason: "authentication_unavailable" });
  });

  it.each(["createBearer", "getUser", "resolve"] as const)("contains thrown %s failures without falling back to cookies", async (method) => {
    mocks[method].mockImplementation(() => { throw new Error("sensitive detail"); });
    expect(await authenticateOperatorRequest(request("Bearer test-token"))).toEqual({
      authenticated: false, reason: "authentication_unavailable",
    });
    expect(mocks.current).not.toHaveBeenCalled();
  });

  it("contains thrown browser session failures", async () => {
    mocks.current.mockRejectedValue(new Error("sensitive detail"));
    expect(await authenticateOperatorRequest(request())).toEqual({ authenticated: false, reason: "authentication_unavailable" });
  });

  it.each([401, 403])("keeps genuinely rejected credentials invalid: %s", async (status) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status } });
    expect(await authenticateOperatorRequest(request("Bearer test-token"))).toEqual({ authenticated: false, reason: "missing_or_invalid_session" });
  });
  it.each(["", "Basic abc", "Bearer", "Bearer one two"])("rejects explicit invalid credentials without cookie fallback: %s", async (header) => {
    expect(await authenticateOperatorRequest(request(header))).toEqual({
      authenticated: false, reason: "missing_or_invalid_session",
    });
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
    expect(mocks.createBearer).not.toHaveBeenCalled();
  });

  it("uses the verified bearer actor even if a different cookie session exists", async () => {
    expect(await authenticateOperatorRequest(request("Bearer test-token"))).toEqual({
      authenticated: true, mode: "bearer", user: actor, supabase: client,
    });
    expect(mocks.getUser).toHaveBeenCalledWith("test-token");
    expect(mocks.resolve).toHaveBeenCalledWith(client, { id: actor.id });
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.createBearer).toHaveBeenCalledWith("https://example.supabase.co", "test-public-key", {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { headers: { Authorization: "Bearer test-token" } },
    });
  });

  it("does not rescue a rejected token with the browser session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    expect((await authenticateOperatorRequest(request("Bearer expired-token"))).authenticated).toBe(false);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.current).not.toHaveBeenCalled();
  });

  it("requires a configured account after token verification", async () => {
    mocks.resolve.mockResolvedValue(null);
    expect(await authenticateOperatorRequest(request("Bearer test-token"))).toEqual({
      authenticated: false, reason: "account_not_configured",
    });
    expect(mocks.current).not.toHaveBeenCalled();
  });

  it("preserves browser authentication only when no authorization header is supplied", async () => {
    expect(await authenticateOperatorRequest(request())).toMatchObject({ authenticated: true, mode: "cookie", user: actor });
    expect(mocks.createBearer).not.toHaveBeenCalled();
  });

  it("rejects a missing browser session", async () => {
    mocks.current.mockResolvedValue(null);
    expect((await authenticateOperatorRequest(request())).authenticated).toBe(false);
  });
});
