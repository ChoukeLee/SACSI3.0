import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, authenticate } = vi.hoisted(() => ({ rpc: vi.fn(), authenticate: vi.fn() }));
vi.mock("@/features/business-actions/operator-request-auth", () => ({ authenticateOperatorRequest: authenticate }));
import { GET } from "@/app/api/operator/v1/capabilities/route";
import { POST } from "@/app/api/operator/v1/actions/route";

const capability = { action_name: "query_daily_booking", authorized: true, authorization_source: "role" };
const actor = { id: "33333333-3333-4333-8333-333333333333", displayName: "Test operator", role: "admin" };
const getRequest = () => new Request("http://localhost/api/operator/v1/capabilities");
const postRequest = () => new Request("http://localhost/api/operator/v1/actions", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ protocolVersion: "1.0", connectorVersion: "0.1.0",
    requestId: "22222222-2222-4222-8222-222222222222", actionName: "query_daily_booking",
    inputSource: "natural_language", originalInstruction: "查询测试订单",
    input: { bookingId: "11111111-1111-4111-8111-111111111111" } }),
});

beforeEach(() => {
  vi.resetAllMocks();
  authenticate.mockResolvedValue({ authenticated: true, mode: "bearer", user: actor, supabase: { rpc } });
});

describe("live operator permission boundary (synthetic authentication and RPC)", () => {
  it.each(["capabilities", "actions"])("returns 503 and never calls business RPCs during an auth outage: %s", async (endpoint) => {
    authenticate.mockResolvedValue({ authenticated: false, reason: "authentication_unavailable" });
    const response = endpoint === "capabilities" ? await GET(getRequest()) : await POST(postRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("authentication_unavailable");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not fill missing database permissions from an admin page role", async () => {
    rpc.mockResolvedValue({ data: [capability], error: null });
    const response = await GET(getRequest());
    const body = await response.json();
    expect(body.identity.userId).toBe(actor.id);
    expect(body.actions.filter((action: { authorized: boolean }) => action.authorized).map((action: { name: string }) => action.name))
      .toEqual(["query_daily_booking"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("treats an empty permission list as no grants", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).actions.every((action: { authorized: boolean }) => !action.authorized)).toBe(true);
  });

  it.each([null, [null], [{ ...capability, authorized: "true" }],
    [{ ...capability, authorization_source: "none" }], [capability, capability]])("rejects malformed capability data: %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const response = await GET(getRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("operator_capabilities_unavailable");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([false, true])("does not leak capability transport failures (throws=%s)", async (throws) => {
    if (throws) rpc.mockRejectedValue(new Error("secret transport detail"));
    else rpc.mockResolvedValue({ data: [capability], error: { message: "secret transport detail" } });
    const response = await GET(getRequest());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret transport detail");
  });

  it("rechecks permissions after a previously allowed manifest", async () => {
    rpc.mockResolvedValueOnce({ data: [capability], error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    expect((await GET(getRequest())).status).toBe(200);
    const response = await POST(postRequest());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("action_forbidden");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["get_my_operator_capabilities", "can_execute_operator_action"]);
  });

  it("stops with a safe retryable error if permission checking throws", async () => {
    rpc.mockRejectedValue(new Error("secret transport detail"));
    const response = await POST(postRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("authorization_unavailable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([null, "true", 1])("requires an exact true authorization result: %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect((await POST(postRequest())).status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["missing_or_invalid_session", "account_not_configured"])("does not query permissions for %s", async (reason) => {
    authenticate.mockResolvedValue({ authenticated: false, reason });
    const response = await GET(getRequest());
    expect(response.status).toBe(reason === "account_not_configured" ? 403 : 401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).not.toHaveBeenCalled();
  });
});
