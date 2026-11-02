import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import ts from "typescript";
// @ts-expect-error Standalone connector deliberately has no application TS dependency.
import { OperatorClient, VERSION, parseCommandInput } from "../operator-connector/core.mjs";
// @ts-expect-error Standalone connector deliberately has no application TS dependency.
import { serve } from "../operator-connector/mcp-server.mjs";
// @ts-expect-error Standalone connector deliberately has no application TS dependency.
import * as financeWire from "../operator-connector/cimac-finance.mjs";
// @ts-expect-error Standalone connector deliberately has no application TS dependency.
import { durableClient } from "../operator-connector/pending-client.mjs";
// @ts-expect-error Standalone connector deliberately has no application TS dependency.
import { pendingStore } from "../operator-connector/pending-store.mjs";
// @ts-expect-error Standalone connector deliberately has no application TS dependency.
import { callTool, tools } from "../operator-connector/mcp-tools.mjs";
// @ts-expect-error Standalone connector deliberately has no application TS dependency.
import { packageFiles } from "../scripts/lib/operator-package.mjs";
import { parseCimacFinance } from "@/features/business-actions/cimac-finance";
import { verifyCimacFinanceResult as httpVerify } from "@/features/business-actions/cimac-finance-verification";
import {
  financeActorId,
  financeCompleted,
  financeId,
  financeRequest,
  financeRequestId,
} from "./fixtures/cimac-finance";
const { normalizeCimacFinanceRequest, verifyCimacFinanceResult } = financeWire;
const config = {
  formatVersion: 1,
  localTest: true,
  appUrl: "http://127.0.0.1:3100",
  supabaseUrl: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_synthetic",
};
const store = () => ({
  load: async () => ({
    userId: financeActorId,
    appUrl: config.appUrl,
    supabaseUrl: config.supabaseUrl,
    accessToken: "synthetic-only",
    expiresAt: Date.now() + 3600000,
  }),
});
const manifest = (): any => ({
  protocolVersion: "1.0",
  minimumConnectorVersion: "0.9.0",
  identity: { userId: financeActorId, role: "admin" },
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
    workflows: ["cimac_finance"],
  },
  cimacFinanceWorkflow: { available: true, version: 1, adminOnly: true },
});
const reply = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const completed = (): any => ({ ...financeCompleted(), executionMode: "explicit_instruction" });
const preview = () => ({
  status: "ready_for_direct_execution",
  requestId: financeRequestId,
  previewProof: "synthetic-signed-proof",
  preview: {
    requestId: financeRequestId,
    operationCount: financeRequest().operations.length,
    snapshot: { fingerprint: "snapshot", requestHash: "request-hash" },
  },
});
const prior = () => ({
  status: "completed_previously",
  requestId: financeRequestId,
  actorId: financeActorId,
  request: financeRequest(),
  verified: false,
});
const transportFor = (
  result: unknown = completed(),
  history: unknown = { status: "not_found", requestId: financeRequestId, verified: false },
) =>
  vi
    .fn()
    .mockResolvedValueOnce(reply(manifest()))
    .mockResolvedValueOnce(reply(history))
    .mockResolvedValueOnce(reply(preview()))
    .mockResolvedValueOnce(reply(result));

describe("standalone CIMAC finance 0.9 controlled transport", () => {
  it("finds original request, previews, executes once and independently verifies every raw row", async () => {
    const transport = transportFor();
    expect(
      await new OperatorClient(config, store(), transport).cimacFinance(
        "execute",
        financeRequest(),
      ),
    ).toMatchObject({
      status: "completed",
      verified: true,
      requestId: financeRequestId,
      actorId: financeActorId,
    });
    expect(VERSION).toBe("0.10.0");
    expect(transport.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/api/operator/v1/capabilities",
      "/api/operator/v1/cimac-finance/status",
      "/api/operator/v1/cimac-finance/prepare",
      "/api/operator/v1/cimac-finance/execute",
    ]);
    expect(JSON.parse(transport.mock.calls[3][1].body)).toEqual({
      request: financeRequest(),
      previewProof: "synthetic-signed-proof",
    });
    expect(
      transport.mock.calls.every(
        ([, options]) => options.headers.Authorization === "Bearer synthetic-only",
      ),
    ).toBe(true);
    expect(packageFiles).toContain("cimac-finance.mjs");
  });
  it("preserves the existing CLI envelope without generic actions/RPC", async () => {
    const transport = transportFor();
    await new OperatorClient(config, store(), transport).execute({
      actionName: "cimac_finance",
      operation: "execute",
      scope: "business_data",
      exceptionalBusinessCase: false,
      ...financeRequest(),
    });
    expect(transport).toHaveBeenCalledTimes(4);
    expect(
      transport.mock.calls.every(([url]) => !url.includes("/rpc") && !url.includes("/actions")),
    ).toBe(true);
  });
  it("only queries when asked to inspect", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(reply(manifest()))
      .mockResolvedValueOnce(reply({ status: "previewed", readOnly: true, verified: false }));
    expect(
      await new OperatorClient(config, store(), transport).cimacFinance("query", financeRequest()),
    ).toMatchObject({ readOnly: true, verified: false });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0]).toContain("cimac-finance/query");
  });
  it.each([false, null, 1, "true"])(
    "requires literal finance availability: %s",
    async (available) => {
      const meta = manifest();
      meta.cimacFinanceWorkflow.available = available;
      const transport = vi.fn().mockResolvedValue(reply(meta));
      await expect(
        new OperatorClient(config, store(), transport).cimacFinance("execute", financeRequest()),
      ).rejects.toThrow("cimac_finance_not_available");
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["finance", "boss", "front_desk"])(
    "does not substitute page role %s for admin authority",
    async (role) => {
      const meta = manifest();
      meta.identity.role = role;
      const transport = vi.fn().mockResolvedValue(reply(meta));
      await expect(
        new OperatorClient(config, store(), transport).cimacFinance("execute", financeRequest()),
      ).rejects.toThrow("cimac_finance_not_available");
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it("does not substitute old maintenance/native workflows", async () => {
    const meta = manifest();
    meta.directExecution.workflows = ["cimac_maintenance", "native_collection"];
    const transport = vi.fn().mockResolvedValue(reply(meta));
    await expect(
      new OperatorClient(config, store(), transport).cimacFinance("execute", financeRequest()),
    ).rejects.toThrow("cimac_finance_not_available");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("keeps status read-only during emergency stop", async () => {
    const meta = manifest();
    meta.directExecution = { ...meta.directExecution, available: false, workflows: [] };
    meta.safeguards.screenshotWritesRequireConfirmation = true;
    meta.safeguards.batchWritesRequireConfirmation = true;
    meta.cimacFinanceWorkflow.available = false;
    const transport = vi
      .fn()
      .mockResolvedValueOnce(reply(meta))
      .mockResolvedValueOnce(reply(prior()));
    expect(
      await new OperatorClient(config, store(), transport).cimacFinance("status", {
        requestId: financeRequestId,
      }),
    ).toMatchObject({ status: "completed_previously", verified: false });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("never replays a known request or accepts changed instructions for that id", async () => {
    const transport = transportFor(undefined, prior());
    expect(
      await new OperatorClient(config, store(), transport).cimacFinance(
        "execute",
        financeRequest(),
      ),
    ).toMatchObject({ status: "completed_previously", verified: false });
    expect(transport).toHaveBeenCalledTimes(2);
    const changed = financeRequest();
    changed.originalInstruction = "changed instruction";
    await expect(
      new OperatorClient(config, store(), transportFor(undefined, prior())).cimacFinance(
        "execute",
        changed,
      ),
    ).rejects.toThrow("execution_result_invalid_keep_original_request_id");
  });
  it.each(["prepare", "execute"])(
    "checks exact request echo even for a raced %s completion",
    async (stage) => {
      const history = prior();
      history.request.originalInstruction = "wrong request";
      const transport = vi
        .fn()
        .mockResolvedValueOnce(reply(manifest()))
        .mockResolvedValueOnce(reply({ status: "not_found", requestId: financeRequestId }))
        .mockResolvedValueOnce(reply(stage === "prepare" ? history : preview()));
      if (stage === "execute") transport.mockResolvedValueOnce(reply(history));
      await expect(
        new OperatorClient(config, store(), transport).cimacFinance("execute", financeRequest()),
      ).rejects.toThrow("execution_result_invalid_keep_original_request_id");
      expect(transport).toHaveBeenCalledTimes(stage === "prepare" ? 3 : 4);
    },
  );
  it("does not retry unknown outcomes or reveal transport diagnostics", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(reply(manifest()))
      .mockResolvedValueOnce(reply({ status: "not_found", requestId: financeRequestId }))
      .mockResolvedValueOnce(reply(preview()))
      .mockRejectedValueOnce(new Error("private transport detail"));
    await expect(
      new OperatorClient(config, store(), transport).cimacFinance("execute", financeRequest()),
    ).rejects.toThrow("outcome_unknown_keep_original_request_id");
    expect(transport).toHaveBeenCalledTimes(4);
  });
  it.each([
    (r: any) => {
      r.actorId = financeId(999);
    },
    (r: any) => {
      r.request.originalInstruction = "changed";
    },
    (r: any) => {
      r.verification.payments[0].amount++;
    },
    (r: any) => {
      r.verification.payments[0].currency = "CNY";
    },
    (r: any) => {
      r.verification.payments[0].source_id = financeId(999);
    },
    (r: any) => {
      r.verification.ledger[0].direction = "income";
    },
    (r: any) => {
      r.verification.receivables[0].amount_xof++;
    },
    (r: any) => {
      r.verification.receivables[0].service_period_start = "2026-10-26";
    },
    (r: any) => {
      r.verification.allocations[0].amount_xof--;
    },
    (r: any) => {
      r.verification.contracts[1].paid_through_date = "2028-05-31";
    },
    (r: any) => {
      r.verification.contracts[1].deposit_received = true;
    },
    (r: any) => {
      r.verification.reclassifications[0].paymentAfter.amount++;
    },
    (r: any) => {
      r.verification.reclassifications[0].ledgerAfter.amount_xof++;
    },
    (r: any) => {
      r.verification.units[4].reservation_holder_name = "Unconfirmed label";
    },
    (r: any) => {
      r.verification.units[0].unit_no = "231";
    },
    (r: any) => {
      r.verification.audit.requestId = financeId(999);
    },
  ])("does not trust bare flags: row evidence mutation %#", async (mutate) => {
    const result = completed();
    mutate(result);
    expect(verifyCimacFinanceResult(result, financeRequest(), financeActorId)).toBe(false);
    expect(verifyCimacFinanceResult(result, financeRequest(), financeActorId)).toBe(
      httpVerify(result, financeRequest(), financeActorId),
    );
    await expect(
      new OperatorClient(config, store(), transportFor(result)).cimacFinance(
        "execute",
        financeRequest(),
      ),
    ).rejects.toThrow("execution_verification_failed_keep_original_request_id");
  });
  it.each([
    { table: "payments" },
    { humanConfirmed: true },
    { inputSource: "natural_language" },
    { operations: [{ type: "sql", sql: "update payments" }] },
  ])("rejects unbounded inputs before any transport: %j", async (change) => {
    const transport = vi.fn();
    await expect(
      new OperatorClient(config, store(), transport).cimacFinance("execute", {
        ...financeRequest(),
        ...change,
      }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("normalizes exactly like the server without changing native money or source", () => {
    const request = financeRequest();
    request.originalInstruction = "  synthetic instruction  ";
    if (request.operations[3].type !== "reclassify") throw new Error("fixture");
    request.operations[3].amountCny = "31875";
    expect(normalizeCimacFinanceRequest(request)).toEqual(parseCimacFinance(request));
    const { protocolVersion, connectorVersion, ...mcpInput } = financeRequest();
    expect(normalizeCimacFinanceRequest(mcpInput)).toEqual(financeRequest());
  });
  it("keeps the entire standalone parser/verifier an exact reproducible mirror of the HTTP contract", () => {
    const parser = readFileSync("src/features/business-actions/cimac-finance.ts", "utf8");
    const verifier = readFileSync(
      "src/features/business-actions/cimac-finance-verification.ts",
      "utf8",
    ).replace(/^import[\s\S]*?from\s*"\.\/cimac-finance";\s*/, "");
    const compiled = ts.transpileModule(parser + "\n" + verifier, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText;
    const prefix =
      '// Standalone mirror of the bounded HTTP finance contract and raw-row verifier.\nimport { isDeepStrictEqual } from "node:util";\nimport { createHash } from "node:crypto";\n';
    const suffix =
      '\nexport function normalizeCimacFinanceRequest(value) { return parseCimacFinance({...value, protocolVersion: value?.protocolVersion ?? "1.0", connectorVersion: value?.connectorVersion ?? "0.9.0"}); }\n';
    expect(
      readFileSync("operator-connector/cimac-finance.mjs", "utf8").replace(/\r\n/g, "\n"),
    ).toBe(prefix + compiled + suffix);
  });
  it("declares bounded MCP writes and supports nullable expected labels without exposing patch", async () => {
    const write = tools.find((t: any) => t.name === "execute_cimac_finance");
    expect(write.annotations.readOnlyHint).toBe(false);
    expect(write.inputSchema.properties.operations.items.oneOf).toHaveLength(4);
    const client = { cimacFinance: vi.fn().mockResolvedValue({}) },
      lock = { lock: (f: () => unknown) => f() };
    const { protocolVersion, connectorVersion, ...input } = financeRequest();
    await callTool("execute_cimac_finance", input, client, lock);
    expect(client.cimacFinance).toHaveBeenCalledWith("execute", input);
    const identity = {
      requestId: financeRequestId,
      originalInstruction: "synthetic identity instruction",
      inputSource: "excel_screenshot",
      operations: [
        {
          type: "identity",
          customerId: financeId(10),
          customerName: "Synthetic merchant",
          units: [{ unitNo: "103", expectedHolderName: null }],
          holderName: "Synthetic merchant",
          annotation: "confirmed label",
        },
      ],
    };
    await callTool("execute_cimac_finance", identity, client, lock);
    await expect(
      callTool(
        "execute_cimac_finance",
        { ...identity, operations: [{ ...identity.operations[0], patch: {} }] },
        client,
        lock,
      ),
    ).rejects.toThrow("invalid_tool_arguments");
    await expect(
      callTool(
        "execute_cimac_finance",
        {
          ...identity,
          operations: [
            { ...identity.operations[0], units: [{ unitNo: "103", expectedHolderName: 1 }] },
          ],
        },
        client,
        lock,
      ),
    ).rejects.toThrow("invalid_tool_arguments");
  });
});

describe("finance-only bounded command framing", () => {
  const body = (actionName: string) => JSON.stringify({ actionName, padding: "汉".repeat(30000) });
  it("permits only explicit finance CLI envelopes above 64KB and caps all at 256KB", () => {
    expect(parseCommandInput(body("cimac_finance"), "execute").actionName).toBe("cimac_finance");
    for (const action of ["cimac_maintenance", "record_daily_payment", "unknown"])
      expect(() => parseCommandInput(body(action), "execute")).toThrow("input_too_large");
    expect(() => parseCommandInput(body("cimac_finance"), "login")).toThrow("input_too_large");
    expect(() =>
      parseCommandInput(
        JSON.stringify({ actionName: "cimac_finance", padding: "汉".repeat(90000) }),
        "execute",
      ),
    ).toThrow("input_too_large");
  });
  it.each(["query_cimac_finance", "execute_cimac_finance"])(
    "accepts a bounded chunked finance MCP frame: %s",
    async (name) => {
      const frame = Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: { padding: "汉".repeat(30000) } },
        }) + "\n",
      );
      const dispatch = vi.fn().mockResolvedValue({ jsonrpc: "2.0", id: 1, result: {} });
      const output = new Writable({
        write(_data, _encoding, callback) {
          callback();
        },
      });
      await serve(
        Readable.from([frame.subarray(0, 70000), frame.subarray(70000)]),
        output,
        dispatch,
      );
      expect(dispatch).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps legacy MCP frames at 64KB and rejects an unbounded or incomplete new frame", async () => {
    const dispatch = vi.fn(),
      output = new Writable({
        write(_data, _encoding, callback) {
          callback();
        },
      });
    const legacy =
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "execute_cimac_maintenance", arguments: { padding: "汉".repeat(30000) } },
      }) + "\n";
    await expect(serve(Readable.from([legacy]), output, dispatch)).rejects.toThrow(
      "input_too_large",
    );
    await expect(
      serve(Readable.from(["x".repeat(70000) + "\n"]), output, dispatch),
    ).rejects.toThrow("input_too_large");
    await expect(serve(Readable.from(["x".repeat(262145)]), output, dispatch)).rejects.toThrow(
      "input_too_large",
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("CIMAC finance encrypted v4 journal", () => {
  let directory: string;
  const crypt = (value: any, operation: string) =>
    operation === "protect"
      ? Buffer.from("enc:" + Buffer.from(value).toString("base64"))
      : Buffer.from(Buffer.from(value).toString().slice(4), "base64");
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "synthetic-cimac-v4-"));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  const file = () => join(directory, "pending-v1", readdirSync(join(directory, "pending-v1"))[0]);
  it("encrypts before sending, preserves old kinds and never downgrades after v1/native writes", async () => {
    const journal = pendingStore(directory, config.appUrl, crypt);
    journal.put(financeActorId, {
      requestId: financeId(800),
      kind: "note",
      state: "needs_details",
      sourceText: "old note",
    });
    journal.put(financeActorId, {
      requestId: financeId(801),
      kind: "native_collection",
      state: "unknown",
      request: {},
    });
    journal.put(financeActorId, {
      requestId: financeId(802),
      kind: "cimac_maintenance",
      state: "unknown",
      request: {},
    });
    const client = {
      capabilities: vi.fn().mockResolvedValue(manifest()),
      cimacFinance: vi.fn().mockImplementation(async (operation: string) => {
        if (operation === "execute") {
          expect(journal.get(financeActorId, financeRequestId).state).toBe("preparing");
          throw new Error("outcome_unknown");
        }
        return { status: "not_found", requestId: financeRequestId, verified: false };
      }),
    };
    const wrapped = durableClient(client, store(), journal, config);
    await expect(
      wrapped.execute({
        actionName: "cimac_finance",
        operation: "execute",
        scope: "business_data",
        exceptionalBusinessCase: false,
        ...financeRequest(),
      }),
    ).rejects.toThrow("outcome_unknown");
    expect(JSON.parse(crypt(readFileSync(file()), "unprotect").toString()).formatVersion).toBe(4);
    expect(readFileSync(file()).toString()).not.toContain("excel_screenshot");
    journal.put(financeActorId, {
      requestId: financeId(803),
      kind: "cimac_maintenance",
      state: "unknown",
      request: {},
    });
    journal.put(financeActorId, {
      requestId: financeId(804),
      kind: "native_collection",
      state: "unknown",
      request: {},
    });
    expect(JSON.parse(crypt(readFileSync(file()), "unprotect").toString()).formatVersion).toBe(4);
    expect(journal.list(financeActorId)).toHaveLength(6);
    expect(await wrapped.pending("recover", { requestId: financeRequestId })).toMatchObject({
      status: "not_found",
      verified: false,
    });
    expect(client.cimacFinance.mock.calls.map(([op]: any[]) => op)).toEqual(["execute", "status"]);
    const changed = financeRequest();
    changed.originalInstruction = "different original";
    await expect(wrapped.cimacFinance("execute", changed)).rejects.toThrow(
      "pending_request_changed_reconcile_first",
    );
  });
  it("rejects changed historical request evidence without deleting or replaying the original", async () => {
    const journal = pendingStore(directory, config.appUrl, crypt),
      client = {
        capabilities: vi.fn().mockResolvedValue(manifest()),
        cimacFinance: vi.fn().mockRejectedValueOnce(new Error("unknown")),
      };
    const wrapped = durableClient(client, store(), journal, config);
    await expect(wrapped.cimacFinance("execute", financeRequest())).rejects.toThrow("unknown");
    const history = prior();
    history.request.originalInstruction = "wrong history";
    client.cimacFinance.mockResolvedValueOnce(history);
    await expect(wrapped.pending("recover", { requestId: financeRequestId })).rejects.toThrow(
      "pending_server_identity_mismatch",
    );
    expect(journal.get(financeActorId, financeRequestId).state).toBe("unknown");
    expect(client.cimacFinance).toHaveBeenCalledTimes(2);
  });
  it("recovers matching historical completion without replaying or claiming fresh verification", async () => {
    const journal = pendingStore(directory, config.appUrl, crypt);
    const client = {
      capabilities: vi.fn().mockResolvedValue(manifest()),
      cimacFinance: vi.fn().mockRejectedValueOnce(new Error("unknown")),
    };
    const wrapped = durableClient(client, store(), journal, config);
    await expect(wrapped.cimacFinance("execute", financeRequest())).rejects.toThrow("unknown");
    client.cimacFinance.mockResolvedValueOnce(prior());
    expect(await wrapped.pending("recover", { requestId: financeRequestId })).toMatchObject({
      status: "completed_previously",
      verified: false,
    });
    expect(journal.get(financeActorId, financeRequestId).state).toBe("completed_history");
    await expect(wrapped.cimacFinance("execute", financeRequest())).rejects.toThrow(
      "pending_already_completed_do_not_repeat",
    );
    expect(client.cimacFinance.mock.calls.map(([op]: any[]) => op)).toEqual(["execute", "status"]);
  });
  it("rejects mislabeled older formats without rewriting ciphertext", () => {
    const journal = pendingStore(directory, config.appUrl, crypt);
    journal.put(financeActorId, {
      requestId: financeRequestId,
      kind: "cimac_finance",
      state: "unknown",
      request: financeRequest(),
    });
    const saved = JSON.parse(crypt(readFileSync(file()), "unprotect").toString());
    saved.formatVersion = 3;
    const ciphertext = crypt(JSON.stringify(saved), "protect");
    writeFileSync(file(), ciphertext);
    expect(() => journal.list(financeActorId)).toThrow("pending_kind_upgrade_required");
    expect(readFileSync(file())).toEqual(ciphertext);
  });
});
