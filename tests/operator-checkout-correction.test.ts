import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { previewActor, previewBooking, previewSecret } from "./fixtures/operator-preview";
const { rpc, authenticate } = vi.hoisted(() => ({ rpc: vi.fn(), authenticate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: authenticate,
}));
import { GET } from "@/app/api/operator/v1/capabilities/route";
import { executeOperatorDirect } from "@/features/business-actions/operator-direct-execution";
import { issuePreviewProof } from "@/features/business-actions/operator-preview-proof";
import { confirmationDeployment } from "@/features/business-actions/operator-confirmation-http";

const requestId = "77777777-7777-4777-8777-777777777777";
const id = "88888888-8888-4888-8888-888888888888";
const input = {
  requestId,
  operation: "correct_checkout",
  bookingId: previewBooking,
  originalInstruction: "截图定位；本人确认实际只住一晚，优惠四万，已有四万收款结清。",
  actualCheckOut: "2026-10-08",
  discountAmountXof: 40000,
  inputSource: "excel_screenshot",
  reason: "漏退房，按实际一晚及明确优惠更正",
};
const snapshot = {
  snapshot: { synthetic: true },
  plan: { operation: "correct_checkout", totalAfter: 40000, paidAfter: 40000 },
};
let installed = true;
let allowed = true;
let role = "admin";
beforeEach(() => {
  vi.resetAllMocks();
  installed = true;
  allowed = true;
  role = "admin";
  vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_PREVIEW_SECRET", previewSecret);
  authenticate.mockImplementation(async () => ({
    authenticated: true,
    mode: "bearer",
    user: { id: previewActor, displayName: "Synthetic", role },
    supabase: { rpc },
  }));
  rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === "booking_checkout_correction_protocol_version")
      return installed ? { data: 1 } : { error: { message: "missing function" } };
    if (name === "get_my_operator_capabilities")
      return {
        data: [
          {
            action_name: "correct_daily_booking",
            authorized: allowed,
            authorization_source: allowed ? "role" : "none",
          },
        ],
      };
    if (name.endsWith("protocol_version"))
      return { data: name === "operator_daily_payment_protocol_version" ? 2 : 1 };
    if (name === "operator_booking_operation") {
      if (args?.p_mode === "status") return { data: { status: "not_found" } };
      if (args?.p_mode === "preview") return { data: snapshot };
      if (args?.p_mode === "create") return { data: { id } };
      if (args?.p_mode === "confirm")
        return {
          data: {
            status: "completed",
            verified: true,
            requestId,
            bookingId: previewBooking,
            operation: "correct_checkout",
          },
        };
    }
    return { data: false };
  });
});
afterEach(() => vi.unstubAllEnvs());
function direct(fields: Record<string, unknown> = input, actorId = previewActor) {
  const proof = issuePreviewProof(
    { actorId, request: input, snapshot, deployment: confirmationDeployment() },
    previewSecret,
  ).previewProof;
  return executeOperatorDirect(
    new Request("https://test.invalid/api/operator/v1/booking-operations/execute", {
      method: "POST",
      headers: { authorization: "Bearer synthetic", "content-type": "application/json" },
      body: JSON.stringify({ request: fields, previewProof: proof }),
    }),
    "booking_operation",
  );
}
function writes() {
  return rpc.mock.calls.filter(
    ([name, args]) =>
      name === "operator_booking_operation" && ["create", "confirm"].includes(args?.p_mode),
  );
}
it.each([false, true])(
  "advertises checkout correction only with its installed migration: %s",
  async (ready) => {
    installed = ready;
    const body = await (
      await GET(new Request("https://test.invalid/api/operator/v1/capabilities"))
    ).json();
    expect(body.bookingOperations.checkoutCorrection.available).toBe(ready);
    expect(body.bookingOperations.operations.includes("correct_checkout")).toBe(ready);
    expect(
      body.actions
        .find((a: { name: string }) => a.name === "correct_daily_booking")
        .supportedOperations.includes("correct_checkout"),
    ).toBe(ready);
  },
);
it.each(["no_action_grant", "not_admin"])(
  "does not advertise correction for %s",
  async (scenario) => {
    if (scenario === "no_action_grant") allowed = false;
    else role = "front_desk";
    const body = await (
      await GET(new Request("https://test.invalid/api/operator/v1/capabilities"))
    ).json();
    expect(body.bookingOperations.operations).not.toContain("correct_checkout");
  },
);
it("executes the complete correction via a signed live preview, retaining its screenshot source", async () => {
  const r = await direct();
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    status: "completed",
    verified: true,
    requestId,
    operation: "correct_checkout",
  });
  expect(writes()).toHaveLength(2);
  expect(writes()[0][1].p_request).toEqual(input);
});
it("refuses a server without the correction migration before any write", async () => {
  installed = false;
  const r = await direct();
  expect(r.status).toBe(503);
  expect(writes()).toEqual([]);
});
it.each(["discount", "source", "actor"])(
  "rejects tampering with the signed %s before writes",
  async (scenario) => {
    const r = await direct(
      scenario === "discount"
        ? { ...input, discountAmountXof: 0 }
        : scenario === "source"
          ? { ...input, inputSource: "natural_language" }
          : input,
      scenario === "actor" ? "99999999-9999-4999-8999-999999999999" : previewActor,
    );
    expect(r.status).toBe(409);
    expect(writes()).toEqual([]);
  },
);
