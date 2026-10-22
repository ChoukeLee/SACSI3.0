import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: mock.auth,
}));
import {
  nativeCollectionPost,
  nativeCollectionStatus,
} from "@/features/business-actions/operator-native-collection-http";
import { nativeIds, nativeRequest, nativeResult } from "./fixtures/native-collection";

const post = (body: unknown) =>
  new Request("http://localhost/api/operator/v1/native-collections/execute", {
    method: "POST",
    body: JSON.stringify(body),
  });
const original = { ...process.env };
let snapshot: unknown;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.SACSI_OPERATOR_CONFIRMATIONS_ENABLED = "true";
  process.env.SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED = "true";
  process.env.SACSI_OPERATOR_PREVIEW_SECRET = "ab".repeat(32);
  snapshot = {
    contract: { id: nativeIds.contract },
    receivables: [{ id: nativeIds.receivable, paid_amount_native: "0.00" }],
  };
  mock.auth.mockResolvedValue({
    authenticated: true,
    mode: "bearer",
    user: { id: nativeIds.actor },
    supabase: { rpc: mock.rpc },
  });
  mock.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "operator_native_collection_protocol_version"
        ? 1
        : name === "can_execute_operator_native_collection"
          ? true
          : name === "find_operator_native_collection"
            ? { status: "not_found" }
            : name === "preview_operator_native_collection"
              ? snapshot
              : name === "execute_operator_native_collection"
                ? nativeResult()
                : { status: "found" },
  }));
});
afterEach(() => {
  process.env = { ...original };
});
async function proof() {
  return (await (await nativeCollectionPost(post(nativeRequest()), "prepare")).json()).previewProof;
}

describe("bearer native collection direct boundary", () => {
  it("previews without writes and executes with actor/request/snapshot/deployment-bound proof", async () => {
    const token = await proof();
    expect(mock.rpc.mock.calls.some((c) => c[0] === "execute_operator_native_collection")).toBe(
      false,
    );
    const response = await nativeCollectionPost(
      post({ request: nativeRequest(), previewProof: token }),
      "execute",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "completed",
      verified: true,
      currency: "USD",
      amount: "100.25",
      executionMode: "explicit_instruction",
    });
    expect(
      mock.rpc.mock.calls.filter((c) => c[0] === "execute_operator_native_collection"),
    ).toHaveLength(1);
  });
  it("rejects disabled, anonymous and cookie callers before any business RPC", async () => {
    process.env.SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED = "false";
    expect((await nativeCollectionPost(post(nativeRequest()), "prepare")).status).toBe(503);
    process.env.SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED = "true";
    mock.auth.mockResolvedValueOnce({ authenticated: false, reason: "missing_or_invalid_session" });
    expect((await nativeCollectionPost(post(nativeRequest()), "prepare")).status).toBe(401);
    mock.auth.mockResolvedValueOnce({
      authenticated: true,
      mode: "cookie",
      user: { id: nativeIds.actor },
      supabase: { rpc: mock.rpc },
    });
    expect((await nativeCollectionPost(post(nativeRequest()), "prepare")).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("rejects an invented confirmation assertion, changed request and stale balance", async () => {
    const token = await proof();
    expect(
      (
        await nativeCollectionPost(
          post({ request: nativeRequest(), previewProof: token, humanConfirmed: true }),
          "execute",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await nativeCollectionPost(
          post({
            request: { ...nativeRequest(), originalInstruction: "changed" },
            previewProof: token,
          }),
          "execute",
        )
      ).status,
    ).toBe(409);
    snapshot = { changed: true };
    expect(
      (
        await nativeCollectionPost(
          post({ request: nativeRequest(), previewProof: token }),
          "execute",
        )
      ).status,
    ).toBe(409);
    expect(mock.rpc.mock.calls.some((c) => c[0] === "execute_operator_native_collection")).toBe(
      false,
    );
  });
  it("does not execute a known prior completion or claim freshly verified history", async () => {
    const implementation = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name, args) =>
      name === "find_operator_native_collection"
        ? Promise.resolve({
            error: null,
            data: { request: nativeRequest(), ...nativeResult() },
          }).then((r) => ({
            ...r,
            data: { ...r.data, status: "completed_previously", verified: false },
          }))
        : implementation(name, args),
    );
    const response = await nativeCollectionPost(
      post({ request: nativeRequest(), previewProof: "history" }),
      "execute",
    );
    expect(await response.json()).toMatchObject({
      status: "completed_previously",
      verified: false,
    });
    expect(mock.rpc.mock.calls.some((c) => /^(preview|execute)_operator_native/.test(c[0]))).toBe(
      false,
    );
  });
  it.each(["lost_response", "incomplete_evidence"])(
    "preserves the original request on %s without replay",
    async (mode) => {
      const token = await proof(),
        implementation = mock.rpc.getMockImplementation()!;
      mock.rpc.mockImplementation((name, args) => {
        if (name !== "execute_operator_native_collection") return implementation(name, args);
        if (mode === "lost_response") return Promise.reject(new Error("private diagnostic"));
        return Promise.resolve({ error: null, data: { ...nativeResult(), verification: null } });
      });
      const response = await nativeCollectionPost(
        post({ request: nativeRequest(), previewProof: token }),
        "execute",
      );
      expect(response.status).toBe(503);
      const result = await response.json();
      expect(result).toMatchObject({
        status: "execution_unknown",
        verified: false,
        requestId: nativeIds.request,
        retryPolicy: "recheck_same_request_id_only",
      });
      expect(JSON.stringify(result)).not.toContain("private diagnostic");
      expect(
        mock.rpc.mock.calls.filter((c) => c[0] === "execute_operator_native_collection"),
      ).toHaveLength(1);
    },
  );
  it("status recovery is read-only and rejects ambiguous query parameters", async () => {
    process.env.SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED = "false";
    process.env.SACSI_OPERATOR_CONFIRMATIONS_ENABLED = "false";
    expect(
      (await nativeCollectionStatus(new Request(`http://localhost?requestId=${nativeIds.request}`)))
        .status,
    ).toBe(200);
    expect(
      (
        await nativeCollectionStatus(
          new Request(
            `http://localhost?requestId=${nativeIds.request}&requestId=${nativeIds.request}`,
          ),
        )
      ).status,
    ).toBe(400);
    expect(mock.rpc.mock.calls.every((c) => !c[0].startsWith("execute_"))).toBe(true);
  });
});
