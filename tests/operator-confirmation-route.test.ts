import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, authenticate } = vi.hoisted(() => ({ rpc: vi.fn(), authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({ authenticateOperatorRequest: authenticate }));
import { POST as prepare } from "@/app/api/operator/v1/confirmations/prepare/route";
import { POST as draft } from "@/app/api/operator/v1/confirmations/drafts/route";
import { POST as confirm } from "@/app/api/operator/v1/confirmations/[id]/route";
import { confirmationDeployment, confirmationBrowserOriginMatches } from "@/features/business-actions/operator-confirmation-http";
import { previewActor, previewRequest, previewSecret, previewSnapshot } from "./fixtures/operator-preview";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const context = { params: Promise.resolve({ id }) };
const request = (body?: unknown, headers: Record<string,string> = { origin: "http://localhost" }) => new Request("http://localhost/api/operator/v1/confirmations/" + id, {
  method: "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED", "true"); vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET", previewSecret);
  authenticate.mockResolvedValue({ authenticated: true, mode: "cookie", user: { id: previewActor, role: "admin" }, supabase: { rpc } });
  rpc.mockImplementation(async name => {
    if (name === "can_execute_operator_action") return { data: true };
    if (name === "operator_daily_payment_protocol_version") return { data: 2 };
    if (name === "daily_booking_operation_snapshot") return { data: previewSnapshot() };
    if (name === "create_operator_payment_confirmation") return { data: { id, status: "pending" } };
    if (name === "get_operator_payment_confirmation") return { data: { request: { ...previewRequest(), confirmationDeployment: confirmationDeployment() } } };
    throw new Error("synthetic private diagnostic");
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("account confirmation HTTP boundaries", () => {
  it("uses an explicitly pinned public origin without trusting forwarded host", () => {
    vi.stubEnv("SACSI_OPERATOR_PUBLIC_ORIGIN","http://127.0.0.1:3100");
    expect(confirmationBrowserOriginMatches(request(undefined,{origin:"http://127.0.0.1:3100"}))).toBe(true);
    expect(confirmationBrowserOriginMatches(request(undefined,{origin:"https://evil.invalid","x-forwarded-host":"evil.invalid"}))).toBe(false);
    expect(confirmationBrowserOriginMatches(request())).toBe(false);
    vi.stubEnv("SACSI_OPERATOR_PUBLIC_ORIGIN","https://example.com/path");
    expect(confirmationBrowserOriginMatches(request())).toBe(false);
  });
  it("defaults closed without any authentication or database call", async () => {
    vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED", "false");
    expect((await draft(request())).status).toBe(503); expect((await confirm(request(),context)).status).toBe(503);
    expect(authenticate).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("persists only a matching signed preview and its signed expiry", async () => {
    const proof = await (await prepare(request(previewRequest()))).json(); rpc.mockClear();
    const response = await draft(request({ request: previewRequest(), previewProof: proof.previewProof }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ confirmationPath: `/operator/confirmations/${id}` });
    expect(rpc).toHaveBeenLastCalledWith("create_operator_payment_confirmation", expect.objectContaining({ p_expires_at: proof.expiresAt }));
    expect(rpc.mock.calls.some(([name]) => name === "confirm_operator_payment")).toBe(false);
  });
  it("rejects forged preview before persistence", async () => {
    expect((await draft(request({ request: previewRequest(), previewProof: "forged" }))).status).toBe(409);
    expect(rpc.mock.calls.some(([name]) => name === "create_operator_payment_confirmation")).toBe(false);
  });
  it.each<Record<string,string>>([{}, { origin: "https://evil.invalid" }, { origin: "http://localhost", authorization: "Bearer token" }])("denies non-browser/CSRF headers %j", async headers => {
    expect((await confirm(request(undefined,headers),context)).status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  });
  it("enforces current ownership from the database", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "confirmationNotFound" } });
    expect((await confirm(request(),context)).status).toBe(404); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed deployment before writing", async () => {
    rpc.mockResolvedValueOnce({ data: { request: { ...previewRequest(), confirmationDeployment: "old" } } });
    expect((await confirm(request(),context)).status).toBe(409); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("contains uncertain outcomes without retries or diagnostics", async () => {
    const response = await confirm(request(),context);
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "confirmation_outcome_unknown" });
    expect(rpc.mock.calls.filter(([name]) => name === "confirm_operator_payment")).toHaveLength(1);
  });
  it("never reports success without payment evidence", async () => {
    rpc.mockResolvedValueOnce({ data: { request: { ...previewRequest(), confirmationDeployment: confirmationDeployment() } } }).mockResolvedValueOnce({ data: { status: "completed" } });
    const response = await confirm(request(),context);
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "confirmation_result_unverified" });
  });
});
