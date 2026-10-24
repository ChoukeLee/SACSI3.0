import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Standalone Node connector has no application dependency.
import { OperatorClient, VERSION } from "../operator-connector/core.mjs";
// @ts-expect-error Standalone Node connector has no application dependency.
import * as cimacWire from "../operator-connector/cimac-maintenance.mjs";
const { normalizeCimacMaintenanceRequest, verifyCimacMaintenanceResult } = cimacWire;
// @ts-expect-error Standalone Node connector has no application dependency.
import { callTool, tools } from "../operator-connector/mcp-tools.mjs";
// @ts-expect-error Standalone Node connector has no application dependency.
import { durableClient } from "../operator-connector/pending-client.mjs";
// @ts-expect-error Standalone Node connector has no application dependency.
import { pendingStore } from "../operator-connector/pending-store.mjs";
import { parseCimacMaintenance } from "@/features/business-actions/cimac-maintenance";
import { verifyCimacMaintenanceResult as httpVerify } from "@/features/business-actions/cimac-maintenance-verification";
import { buildOperatorProtocolManifest } from "@/features/business-actions/operator-protocol";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: mock.auth,
}));
import { GET as capabilities } from "@/app/api/operator/v1/capabilities/route";

const ids = {
  actor: "11111111-1111-4111-8111-111111111111",
  request: "22222222-2222-4222-8222-222222222222",
  contract: "33333333-3333-4333-8333-333333333333",
  unit: "44444444-4444-4444-8444-444444444444",
  payment: "55555555-5555-4555-8555-555555555555",
  ledger: "66666666-6666-4666-8666-666666666666",
  audit: "77777777-7777-4777-8777-777777777777",
};
const config = {
  formatVersion: 1,
  localTest: true,
  appUrl: "http://127.0.0.1:3100",
  supabaseUrl: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_test",
};
const request = (): any => ({
  protocolVersion: "1.0",
  connectorVersion: "0.8.0",
  requestId: ids.request,
  originalInstruction: "补齐已有原币登记，保留历史，不重复收款",
  inputSource: "excel_screenshot",
  operations: [
    {
      type: "note_receipt",
      contractIds: [ids.contract],
      customerName: "测试客户",
      annotation: "用户已确认实际收款，不是新收款",
      receipt: {
        contractId: ids.contract,
        noteMarker: "已收2000元",
        amount: "2000.00",
        currency: "CNY",
        paymentDate: "2026-09-19",
        paymentMethod: "bank_transfer",
      },
    },
  ],
});
const completed = (): any => ({
  status: "completed",
  verified: true,
  requestId: ids.request,
  request: request(),
  actorId: ids.actor,
  operationCount: 1,
  auditId: ids.audit,
  paymentIds: [ids.payment],
  operationResults: [
    {
      type: "note_receipt",
      contractIds: [ids.contract],
      unitIds: [ids.unit],
      paymentIds: [ids.payment],
    },
  ],
  payments: [
    {
      id: ids.payment,
      sourceId: ids.contract,
      paymentType: "lease_deposit",
      currency: "CNY",
      amount: "2000.00",
      paymentDate: "2026-09-19",
      paymentMethod: "bank_transfer",
      recordedBy: ids.actor,
      nativeSettlement: true,
      exchangeRateToXof: null,
      ledgerId: ids.ledger,
      ledgerCurrency: "CNY",
      ledgerAmountXof: "0.00",
      ledgerAmountNative: "2000.00",
      ledgerDirection: "liability_in",
    },
  ],
  reconciliation: {
    paymentCount: 1,
    ledgerCount: 1,
    receivablesCreated: 0,
    originalPaymentsPreserved: true,
    contractsMatch: true,
    unitsMatch: true,
    paymentsMatch: true,
    ledgerMatch: true,
    auditMatch: true,
  },
  executionMode: "explicit_instruction",
});
const manifest = (): any => ({
  protocolVersion: "1.0",
  minimumConnectorVersion: "0.8.0",
  identity: { userId: ids.actor, role: "admin" },
  actions: [],
  safeguards: {
    serviceRoleAllowed: false,
    arbitrarySqlAllowed: false,
    systemChangesAllowed: false,
    screenshotWritesRequireConfirmation: false,
    batchWritesRequireConfirmation: false,
  },
  directExecution: {
    available: true,
    version: 1,
    authorization: "explicit_instruction",
    workflows: ["cimac_maintenance"],
  },
  cimacMaintenanceWorkflow: { available: true, version: 1, adminOnly: true },
});
const store = () => ({
  load: async () => ({
    userId: ids.actor,
    appUrl: config.appUrl,
    supabaseUrl: config.supabaseUrl,
    accessToken: "synthetic-only",
    expiresAt: Date.now() + 3600000,
  }),
});
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const preview = () => ({
  status: "ready_for_direct_execution",
  requestId: ids.request,
  previewProof: "signed-synthetic-proof",
  preview: {
    status: "previewed",
    requestId: ids.request,
    operationCount: 1,
    snapshot: { fingerprint: "fingerprint", requestHash: "request-hash" },
  },
});
const transportFor = (
  result: unknown = completed(),
  prior: unknown = { status: "not_found", requestId: ids.request, verified: false },
) =>
  vi
    .fn()
    .mockResolvedValueOnce(reply(manifest()))
    .mockResolvedValueOnce(reply(prior))
    .mockResolvedValueOnce(reply(preview()))
    .mockResolvedValueOnce(reply(result));
const user = { id: ids.actor, displayName: "Test admin", role: "admin" as const };

describe("CIMAC standalone bounded maintenance connector", () => {
  it("uses exact actor/request/operations and row evidence after status and signed preview", async () => {
    const transport = transportFor();
    const result = await new OperatorClient(config, store(), transport).cimacMaintenance(
      "execute",
      request(),
    );
    expect(result).toMatchObject({ status: "completed", verified: true, actorId: ids.actor });
    expect(VERSION).toBe("0.8.0");
    expect(transport.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/api/operator/v1/capabilities",
      "/api/operator/v1/cimac-maintenance/status",
      "/api/operator/v1/cimac-maintenance/prepare",
      "/api/operator/v1/cimac-maintenance/execute",
    ]);
    expect(JSON.parse(transport.mock.calls[3][1].body)).toEqual({
      request: request(),
      previewProof: "signed-synthetic-proof",
    });
    expect(
      transport.mock.calls.every(
        ([, options]) => options.headers.Authorization === "Bearer synthetic-only",
      ),
    ).toBe(true);
  });
  it("supports the existing authenticated CLI execute envelope without generic actions/RPC", async () => {
    const transport = transportFor();
    await new OperatorClient(config, store(), transport).execute({
      actionName: "cimac_maintenance",
      operation: "execute",
      scope: "business_data",
      exceptionalBusinessCase: false,
      ...request(),
    });
    expect(transport.mock.calls).toHaveLength(4);
    expect(
      transport.mock.calls.every(([url]) => !url.includes("/actions") && !url.includes("/rpc")),
    ).toBe(true);
  });
  it("queries without preparing or writing", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(reply(manifest()))
      .mockResolvedValueOnce(reply({ status: "previewed", verified: false, readOnly: true }));
    expect(
      await new OperatorClient(config, store(), transport).cimacMaintenance("query", request()),
    ).toMatchObject({ readOnly: true });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0]).toContain("cimac-maintenance/query");
  });
  it.each([null, false, 1, "true"])(
    "requires literal availability rather than truthy values: %s",
    async (available) => {
      const metadata = manifest();
      metadata.cimacMaintenanceWorkflow.available = available;
      const transport = vi.fn().mockResolvedValue(reply(metadata));
      await expect(
        new OperatorClient(config, store(), transport).cimacMaintenance("execute", request()),
      ).rejects.toThrow("cimac_maintenance_not_available");
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["finance", "boss", "front_desk"])(
    "refuses page role %s without any business request",
    async (role) => {
      const metadata = manifest();
      metadata.identity.role = role;
      const transport = vi.fn().mockResolvedValue(reply(metadata));
      await expect(
        new OperatorClient(config, store(), transport).cimacMaintenance("execute", request()),
      ).rejects.toThrow("cimac_maintenance_not_available");
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it("does not replay a historical request and rejects changed operations under the same id", async () => {
    const prior = {
      status: "completed_previously",
      verified: false,
      actorId: ids.actor,
      requestId: ids.request,
      request: request(),
    };
    const transport = transportFor(undefined, prior);
    expect(
      await new OperatorClient(config, store(), transport).cimacMaintenance("execute", request()),
    ).toMatchObject({ status: "completed_previously", verified: false });
    expect(transport).toHaveBeenCalledTimes(2);
    const changed = request();
    changed.operations[0].receipt.amount = "2001";
    await expect(
      new OperatorClient(config, store(), transportFor(undefined, prior)).cimacMaintenance(
        "execute",
        changed,
      ),
    ).rejects.toThrow("request_state_requires_reconciliation");
  });
  it.each([
    (r: any) => {
      r.actorId = ids.unit;
    },
    (r: any) => {
      r.request.operations[0].receipt.amount = "2001.00";
    },
    (r: any) => {
      r.operationResults[0].type = "close";
    },
    (r: any) => {
      r.payments[0].amount = "1999.00";
    },
    (r: any) => {
      r.payments[0].sourceId = ids.unit;
    },
    (r: any) => {
      r.payments[0].ledgerAmountNative = "1999.00";
    },
    (r: any) => {
      r.payments[0].ledgerAmountXof = "160000.00";
    },
    (r: any) => {
      r.reconciliation.originalPaymentsPreserved = false;
    },
    (r: any) => {
      r.reconciliation.receivablesCreated = 1;
    },
    (r: any) => {
      delete r.request;
    },
  ])(
    "requires independent evidence beyond verified=true and mirrors HTTP verifier",
    async (change) => {
      const result = completed();
      change(result);
      expect(verifyCimacMaintenanceResult(result, request(), ids.actor)).toBe(false);
      expect(verifyCimacMaintenanceResult(result, request(), ids.actor)).toBe(
        httpVerify(result, request(), ids.actor),
      );
      await expect(
        new OperatorClient(config, store(), transportFor(result)).cimacMaintenance(
          "execute",
          request(),
        ),
      ).rejects.toThrow("execution_verification_failed_keep_original_request_id");
    },
  );
  it("does not retry an unknown POST outcome or substitute another workflow", async () => {
    const unknown = vi
      .fn()
      .mockResolvedValueOnce(reply(manifest()))
      .mockResolvedValueOnce(reply({ status: "not_found", requestId: ids.request }))
      .mockResolvedValueOnce(reply(preview()))
      .mockRejectedValueOnce(new Error("private transport detail"));
    await expect(
      new OperatorClient(config, store(), unknown).cimacMaintenance("execute", request()),
    ).rejects.toThrow("outcome_unknown_keep_original_request_id");
    expect(unknown).toHaveBeenCalledTimes(4);
  });
  it.each([
    { table: "payments" },
    { humanConfirmed: true },
    { operations: [{ type: "sql", sql: "select 1" }] },
    { originalInstruction: "x".repeat(4001) },
  ])("rejects arbitrary or oversized data before any request: %j", async (change) => {
    const transport = vi.fn();
    await expect(
      new OperatorClient(config, store(), transport).cimacMaintenance("execute", {
        ...request(),
        ...change,
      }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("keeps standalone request normalization identical to server parser", () => {
    const input = request();
    input.operations[0].receipt.amount = "2000";
    expect(normalizeCimacMaintenanceRequest(input)).toEqual(parseCimacMaintenance(input));
    expect(verifyCimacMaintenanceResult(completed(), request(), ids.actor)).toBe(true);
  });
  it("publishes bounded typed MCP tools with write/read annotations", async () => {
    const write = tools.find((tool: any) => tool.name === "execute_cimac_maintenance");
    expect(write.annotations.readOnlyHint).toBe(false);
    expect(write.inputSchema.properties.operations.items.oneOf).toHaveLength(7);
    const client = { cimacMaintenance: vi.fn().mockResolvedValue({}) };
    const lock = { lock: (callback: () => unknown) => callback() };
    const { protocolVersion, connectorVersion, ...input } = request();
    await callTool("execute_cimac_maintenance", input, client, lock);
    expect(client.cimacMaintenance).toHaveBeenCalledWith("execute", input);
    await expect(
      callTool(
        "execute_cimac_maintenance",
        { ...input, operations: [{ ...input.operations[0], table: "payments" }] },
        client,
        lock,
      ),
    ).rejects.toThrow("invalid_tool_arguments");
  });
});

describe("CIMAC capability rollout fails closed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED", "true");
    vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "true");
    mock.auth.mockResolvedValue({
      authenticated: true,
      mode: "bearer",
      user,
      supabase: { rpc: mock.rpc },
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([null, 1, "true", false])(
    "does not infer a new grant from default mock data %s",
    async (allowed) => {
      mock.rpc.mockImplementation(async (name: string) => ({
        error: null,
        data:
          name === "get_my_operator_capabilities"
            ? []
            : name === "cimac_maintenance_protocol_version"
              ? 1
              : name === "can_execute_cimac_maintenance"
                ? allowed
                : null,
      }));
      const metadata = await (await capabilities(new Request("http://localhost"))).json();
      expect(metadata.cimacMaintenanceWorkflow.available).toBe(false);
      expect(metadata.directExecution.workflows).not.toContain("cimac_maintenance");
    },
  );
  it("requires the new live protocol/grant and admin role before raising minimum to 0.8", async () => {
    mock.rpc.mockImplementation(async (name: string) => ({
      error: null,
      data:
        name === "get_my_operator_capabilities"
          ? []
          : name === "cimac_maintenance_protocol_version"
            ? 1
            : name === "can_execute_cimac_maintenance"
              ? true
              : null,
    }));
    const metadata = await (await capabilities(new Request("http://localhost"))).json();
    expect(metadata.minimumConnectorVersion).toBe("0.8.0");
    expect(metadata.directExecution.workflows).toEqual(["cimac_maintenance"]);
    expect(metadata.actions.every((a: any) => !a.authorized)).toBe(true);
    expect(
      buildOperatorProtocolManifest({
        user: { ...user, role: "finance" },
        directWorkflows: ["cimac_maintenance"],
      }).directExecution.workflows,
    ).toEqual([]);
  });
});

describe("CIMAC encrypted pending recovery", () => {
  let directory: string;
  const crypt = (value: any, operation: string) =>
    operation === "protect"
      ? Buffer.from("enc:" + Buffer.from(value).toString("base64"))
      : Buffer.from(Buffer.from(value).toString().slice(4), "base64");
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sacsi-cimac-pending-"));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  it("stores v3 before sending, recovers only by status, and preserves old entries", async () => {
    const journal = pendingStore(directory, config.appUrl, crypt);
    journal.put(ids.actor, {
      requestId: ids.unit,
      kind: "note",
      state: "needs_details",
      sourceText: "old note",
    });
    const client = {
      capabilities: vi.fn().mockResolvedValue(manifest()),
      cimacMaintenance: vi.fn().mockImplementation(async (op: string) => {
        if (op === "execute") {
          expect(journal.get(ids.actor, ids.request).state).toBe("preparing");
          throw new Error("outcome_unknown");
        }
        return { status: "not_found", requestId: ids.request, verified: false };
      }),
    };
    const wrapped = durableClient(client, store(), journal, config);
    await expect(wrapped.cimacMaintenance("execute", request())).rejects.toThrow("outcome_unknown");
    expect(journal.get(ids.actor, ids.request).state).toBe("unknown");
    const file = join(directory, "pending-v1", readdirSync(join(directory, "pending-v1"))[0]);
    expect(JSON.parse(crypt(readFileSync(file), "unprotect").toString()).formatVersion).toBe(3);
    expect(readFileSync(file).toString()).not.toContain("2000.00");
    expect(await wrapped.pending("recover", { requestId: ids.request })).toMatchObject({
      status: "not_found",
      verified: false,
    });
    expect(client.cimacMaintenance.mock.calls.map(([op]: any[]) => op)).toEqual([
      "execute",
      "status",
    ]);
    expect(journal.list(ids.actor)).toHaveLength(2);
    const changed = request();
    changed.operations[0].receipt.amount = "2001.00";
    await expect(wrapped.cimacMaintenance("execute", changed)).rejects.toThrow(
      "pending_request_changed_reconcile_first",
    );
  });
});
