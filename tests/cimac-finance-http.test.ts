import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: mock.auth,
}));
import {
  cimacFinancePost,
  cimacFinanceStatus,
} from "@/features/business-actions/cimac-finance-http";

import {
  financeActorId as actorId,
  financeRequestId as requestId,
  financeId,
  financeRequest as request,
  financeCompleted as completed,
} from "./fixtures/cimac-finance";
const unitId = financeId(30);
const post = (body: unknown) =>
  new Request("http://localhost/api/operator/v1/cimac-finance/execute", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
const originalEnv = { ...process.env };
let snapshot: unknown;
beforeEach(() => {
  vi.resetAllMocks();
  process.env.SACSI_OPERATOR_CONFIRMATIONS_ENABLED = "true";
  process.env.SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED = "true";
  process.env.SACSI_OPERATOR_PREVIEW_SECRET = "ab".repeat(32);
  snapshot = { fingerprint: "fingerprint-before", requestHash: "request-hash" };
  mock.auth.mockResolvedValue({
    authenticated: true,
    mode: "bearer",
    user: { id: actorId, role: "admin" },
    supabase: { rpc: mock.rpc },
  });
  mock.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "cimac_finance_protocol_version"
        ? 1
        : name === "can_execute_cimac_finance"
          ? true
          : name === "find_cimac_finance"
            ? { status: "not_found" }
            : name === "preview_cimac_finance"
              ? {
                  status: "previewed",
                  requestId,
                  operationCount: request().operations.length,
                  snapshot,
                }
              : name === "execute_cimac_finance"
                ? completed()
                : null,
  }));
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
});
async function proof() {
  const response = await cimacFinancePost(post(request()), "prepare");
  expect(response.status).toBe(200);
  return (await response.json()).previewProof as string;
}
function overrideRpc(name: string, data: unknown, error: unknown = null) {
  const implementation = mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation((called, args) =>
    called === name ? Promise.resolve({ data, error }) : implementation(called, args),
  );
}

describe("CIMAC controlled HTTP finance boundary", () => {
  it("rejects fresh prepare and execution before authentication when emergency writes are disabled", async () => {
    process.env.SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED = "false";
    expect((await cimacFinancePost(post(request()), "prepare")).status).toBe(503);
    expect(
      (await cimacFinancePost(post({ request: request(), previewProof: "token" }), "execute"))
        .status,
    ).toBe(503);
    expect(mock.auth).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("never initializes cookie authentication for missing or malformed bearer headers", async () => {
    for (const authorization of [null, "Basic cookie-user", "Bearer ", "Bearer one two"]) {
      const headers: Record<string, string> = { cookie: "session=another-user" };
      if (authorization !== null) headers.authorization = authorization;
      const response = await cimacFinancePost(
        new Request("http://localhost", {
          method: "POST",
          headers,
          body: JSON.stringify(request()),
        }),
        "query",
      );
      expect(response.status).toBe(401);
      expect(
        (
          await cimacFinanceStatus(
            new Request(`http://localhost?requestId=${requestId}`, { headers }),
          )
        ).status,
      ).toBe(401);
    }
    expect(mock.auth).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("queries without signing or writes even when new writes are disabled", async () => {
    process.env.SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED = "false";
    delete process.env.SACSI_OPERATOR_PREVIEW_SECRET;
    const response = await cimacFinancePost(post(request()), "query");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      status: "previewed",
      readOnly: true,
      verified: false,
    });
    expect(
      mock.rpc.mock.calls.some(([name]) => name.startsWith("execute_") || name.startsWith("find_")),
    ).toBe(false);
  });
  it("binds authenticated actor, exact request, snapshot, deployment and expiry before one write", async () => {
    const previewProof = await proof();
    expect(mock.rpc.mock.calls.some(([name]) => name.startsWith("execute_"))).toBe(false);
    const response = await cimacFinancePost(post({ request: request(), previewProof }), "execute");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "completed",
      verified: true,
      executionMode: "explicit_instruction",
      actorId,
      requestId,
    });
    const writes = mock.rpc.mock.calls.filter(([name]) => name === "execute_cimac_finance");
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toMatchObject({ p_request: request(), p_snapshot: snapshot });
    expect(writes[0][1].p_expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it("rejects anonymous, cookie and unauthorized callers", async () => {
    mock.auth.mockResolvedValueOnce({ authenticated: false, reason: "missing_or_invalid_session" });
    expect((await cimacFinancePost(post(request()), "prepare")).status).toBe(401);
    mock.auth.mockResolvedValueOnce({
      authenticated: true,
      mode: "cookie",
      user: { id: actorId, role: "admin" },
      supabase: { rpc: mock.rpc },
    });
    expect((await cimacFinancePost(post(request()), "prepare")).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
    overrideRpc("can_execute_cimac_finance", false);
    expect((await cimacFinancePost(post(request()), "prepare")).status).toBe(403);
    expect(
      mock.rpc.mock.calls.some(
        ([name]) => name.startsWith("preview_") || name.startsWith("execute_"),
      ),
    ).toBe(false);
  });
  it("fails closed if upgrade or signing configuration is unavailable", async () => {
    overrideRpc("cimac_finance_protocol_version", 0);
    expect((await cimacFinancePost(post(request()), "prepare")).status).toBe(503);
    overrideRpc("cimac_finance_protocol_version", 1);
    delete process.env.SACSI_OPERATOR_PREVIEW_SECRET;
    expect((await cimacFinancePost(post(request()), "prepare")).status).toBe(503);
    expect(mock.rpc.mock.calls.some(([name]) => name.startsWith("execute_"))).toBe(false);
  });
  it("rejects malformed, oversized and arbitrary write assertions before RPC", async () => {
    const malformed = new Request("http://localhost", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: "{",
    });
    expect((await cimacFinancePost(malformed, "prepare")).status).toBe(400);
    expect(
      (await cimacFinancePost(post({ ...request(), table: "payments" }), "prepare")).status,
    ).toBe(400);
    expect(
      (
        await cimacFinancePost(
          post({ request: request(), previewProof: "token", humanConfirmed: true }),
          "execute",
        )
      ).status,
    ).toBe(400);
    expect((await cimacFinancePost(post({ x: "a".repeat(262144) }), "prepare")).status).toBe(413);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each(["request", "snapshot", "actor", "deployment", "expiry"])(
    "rejects changed %s without executing",
    async (change) => {
      if (change === "expiry") {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
      }
      const previewProof = await proof();
      const input = request();
      if (change === "request") input.originalInstruction = "changed instruction";
      if (change === "snapshot") snapshot = { fingerprint: "changed", requestHash: "request-hash" };
      if (change === "actor")
        mock.auth.mockResolvedValue({
          authenticated: true,
          mode: "bearer",
          user: { id: unitId, role: "admin" },
          supabase: { rpc: mock.rpc },
        });
      if (change === "deployment") process.env.VERCEL_GIT_COMMIT_SHA = "different-release";
      if (change === "expiry") vi.setSystemTime(new Date("2026-11-02T12:10:00Z"));
      const response = await cimacFinancePost(post({ request: input, previewProof }), "execute");
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        valid: false,
        code: change === "expiry" ? "preview_expired" : "preview_changed",
      });
      expect(mock.rpc.mock.calls.some(([name]) => name.startsWith("execute_"))).toBe(false);
    },
  );
  it("returns known history without executing or claiming fresh verification", async () => {
    overrideRpc("find_cimac_finance", {
      ...completed(),
      status: "completed_previously",
      request: request(),
    });
    const response = await cimacFinancePost(
      post({ request: request(), previewProof: "history" }),
      "execute",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "completed_previously",
      verified: false,
      requestId,
    });
    expect(
      mock.rpc.mock.calls.some(
        ([name]) => name.startsWith("preview_") || name.startsWith("execute_"),
      ),
    ).toBe(false);
  });
  it("rejects request ID reuse with changed instruction or actor", async () => {
    overrideRpc("find_cimac_finance", {
      ...completed(),
      status: "completed_previously",
      request: { ...request(), originalInstruction: "different" },
    });
    expect((await cimacFinancePost(post(request()), "prepare")).status).toBe(409);
    overrideRpc("find_cimac_finance", {
      ...completed(),
      actorId: unitId,
      status: "completed_previously",
      request: request(),
    });
    expect((await cimacFinancePost(post(request()), "prepare")).status).toBe(409);
    expect(mock.rpc.mock.calls.some(([name]) => name.startsWith("execute_"))).toBe(false);
  });
  it.each([
    "lost-response",
    "incomplete",
    "failed-check",
    "wrong-actor",
    "db-conflict",
    "unverifiable-replay",
  ])("keeps unknown post-attempt outcome on %s", async (kind) => {
    const previewProof = await proof();
    if (kind === "lost-response") {
      const implementation = mock.rpc.getMockImplementation()!;
      mock.rpc.mockImplementation((name, args) =>
        name === "execute_cimac_finance"
          ? Promise.reject(new Error("secret diagnostic postgres key"))
          : implementation(name, args),
      );
    } else if (kind === "incomplete")
      overrideRpc("execute_cimac_finance", { status: "completed", verified: true });
    else if (kind === "failed-check") {
      const result = completed();
      result.verification.checks.audit = false;
      overrideRpc("execute_cimac_finance", result);
    } else if (kind === "wrong-actor")
      overrideRpc("execute_cimac_finance", { ...completed(), actorId: unitId });
    else if (kind === "db-conflict")
      overrideRpc("execute_cimac_finance", null, {
        message: "cimacFinanceSnapshotChanged private details",
      });
    else
      overrideRpc("execute_cimac_finance", {
        status: "completed_previously",
        requestId,
        actorId,
        request: { ...request(), originalInstruction: "different" },
      });
    const response = await cimacFinancePost(post({ request: request(), previewProof }), "execute");
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result).toMatchObject({
      status: "execution_unknown",
      verified: false,
      requestId,
      retryPolicy: "recheck_same_request_id_only",
    });
    expect(JSON.stringify(result)).not.toMatch(/private|secret|postgres/);
    expect(mock.rpc.mock.calls.filter(([name]) => name === "execute_cimac_finance")).toHaveLength(
      1,
    );
  });
  it("redacts unexpected pre-write database errors", async () => {
    overrideRpc("preview_cimac_finance", null, { message: "private host and credential" });
    const response = await cimacFinancePost(post(request()), "prepare");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "cimac_finance_unavailable" });
  });
  it("denies non-admin bearer before database calls", async () => {
    mock.auth.mockResolvedValue({
      authenticated: true,
      mode: "bearer",
      user: { id: actorId, role: "finance" },
      supabase: { rpc: mock.rpc },
    });
    expect((await cimacFinancePost(post(request()), "query")).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("returns completed history with its canonical request and no fresh verification", async () => {
    overrideRpc("find_cimac_finance", {
      ...completed(),
      status: "completed_previously",
      verified: true,
    });
    const response = await cimacFinanceStatus(
      new Request(`http://localhost?requestId=${requestId}`, {
        headers: { authorization: "Bearer test-token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      requestId,
      actorId,
      request: request(),
      verified: false,
      status: "completed_previously",
    });
    overrideRpc("find_cimac_finance", {
      status: "completed_previously",
      requestId,
      actorId,
      request: null,
    });
    expect(
      (
        await cimacFinanceStatus(
          new Request(`http://localhost?requestId=${requestId}`, {
            headers: { authorization: "Bearer test-token" },
          }),
        )
      ).status,
    ).toBe(503);
    expect(mock.rpc.mock.calls.some(([name]) => name.startsWith("execute_"))).toBe(false);
  });
  it("keeps outcome recovery read-only and rejects ambiguous status parameters", async () => {
    process.env.SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED = "false";
    expect(
      (
        await cimacFinanceStatus(
          new Request(`http://localhost?requestId=${requestId}`, {
            headers: { authorization: "Bearer test-token" },
          }),
        )
      ).status,
    ).toBe(200);
    for (const query of [
      "",
      `requestId=${requestId}&requestId=${requestId}`,
      `requestId=${requestId}&actorId=${actorId}`,
      "requestId=bad",
    ]) {
      expect(
        (
          await cimacFinanceStatus(
            new Request(`http://localhost?${query}`, {
              headers: { authorization: "Bearer test-token" },
            }),
          )
        ).status,
      ).toBe(400);
    }
    overrideRpc("find_cimac_finance", {
      status: "completed_previously",
      requestId,
      actorId: unitId,
    });
    expect(
      (
        await cimacFinanceStatus(
          new Request(`http://localhost?requestId=${requestId}`, {
            headers: { authorization: "Bearer test-token" },
          }),
        )
      ).status,
    ).toBe(503);
    expect(mock.rpc.mock.calls.some(([name]) => name.startsWith("execute_"))).toBe(false);
  });
});
