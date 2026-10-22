import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Standalone connector deliberately has no application dependency.
import { OperatorClient, VERSION } from "../operator-connector/core.mjs";
// @ts-expect-error Standalone connector deliberately has no application dependency.
import { callTool, instructions, tools } from "../operator-connector/mcp-tools.mjs";
// @ts-expect-error Standalone connector deliberately has no application dependency.
import { durableClient } from "../operator-connector/pending-client.mjs";
// @ts-expect-error Standalone connector deliberately has no application dependency.
import { pendingStore } from "../operator-connector/pending-store.mjs";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const contract = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bill1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const bill2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const payment = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const spare = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const config = {
  formatVersion: 1,
  localTest: true,
  appUrl: "http://127.0.0.1:3100",
  supabaseUrl: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_test",
};
const manifest = {
  protocolVersion: "1.0",
  minimumConnectorVersion: "0.7.0",
  identity: { userId: "owner" },
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
    workflows: ["collection", "native_collection"],
  },
  nativeCollectionWorkflow: {
    available: true,
    version: 1,
    currencies: ["USD", "CNY"],
    domain: "lease",
    nativeOnly: true,
  },
};
const request = (currency = "USD"): any => ({
  requestId: id,
  originalInstruction: "登记实际收到的原币租金，不折算 XOF，不改已缴至日期",
  contractId: contract,
  currency,
  amount: "0.3",
  paymentDate: "2026-10-22",
  paymentMethod: "bank_transfer",
  allocations: [
    { receivableId: bill1, amount: "0.1" },
    { receivableId: bill2, amount: "0.20" },
  ],
});
const completed = (currency = "USD"): any => ({
  status: "completed",
  verified: true,
  requestId: id,
  contractId: contract,
  currency,
  amount: "0.30",
  paymentIds: [payment],
  allocations: [
    { receivableId: bill1, amount: "0.10", paymentId: payment },
    { receivableId: bill2, amount: "0.20", paymentId: payment },
  ],
  paidThroughBefore: null,
  paidThroughAfter: null,
  verification: {
    version: 1,
    actorId: "owner",
    checks: {
      payments: true,
      ledger: true,
      allocations: true,
      receivables: true,
      audit: true,
      xofUnchanged: true,
    },
    payments: [
      {
        id: payment,
        currency,
        amount: "0.30",
        nativeSettlement: true,
        exchangeRateToXof: null,
        recordedBy: "owner",
      },
    ],
    ledger: [{ paymentId: payment, currency, amount: "0.30", amountXof: "0.00" }],
    allocations: [
      { receivableId: bill1, amount: "0.10", paymentId: payment },
      { receivableId: bill2, amount: "0.20", paymentId: payment },
    ],
    receivables: [
      {
        id: bill1,
        currency,
        amount: "0.10",
        paidBefore: "0.00",
        paidAfter: "0.10",
        amountXof: "0.00",
        paidAmountXof: "0.00",
      },
      {
        id: bill2,
        currency,
        amount: "0.20",
        paidBefore: "0.00",
        paidAfter: "0.20",
        amountXof: "0.00",
        paidAmountXof: "0.00",
      },
    ],
    audit: {
      id: spare,
      actorId: "owner",
      requestId: id,
      channel: "external_codex",
      authorization: "explicit_instruction",
    },
  },
  executionMode: "explicit_instruction",
});
const store = () => ({
  load: async () => ({
    ...config,
    userId: "owner",
    accessToken: "synthetic-access-token",
    refreshToken: "synthetic-refresh-token",
    expiresAt: Date.now() + 3600000,
  }),
});
const reply = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
function transportFor(
  result: unknown = completed(),
  previous: unknown = { status: "not_found", requestId: id },
) {
  return vi
    .fn()
    .mockResolvedValueOnce(reply(manifest))
    .mockResolvedValueOnce(reply(previous))
    .mockResolvedValueOnce(
      reply({ status: "ready_for_direct_execution", previewProof: "synthetic-proof", preview: {} }),
    )
    .mockResolvedValueOnce(reply(result));
}

describe("native currency standalone direct connector", () => {
  it.each(["USD", "CNY"])(
    "executes %s once, preserving exact native money without a web draft",
    async (currency) => {
      const transport = transportFor(completed(currency));
      const client = new OperatorClient(config, store(), transport);
      const input = request(currency);
      expect(await client.nativeCollection("execute", input)).toMatchObject({
        status: "completed",
        verified: true,
        currency,
        amount: "0.30",
      });
      expect(VERSION).toBe("0.7.0");
      expect(input.amount).toBe("0.3");
      expect(transport.mock.calls.map((call) => call[0])).toEqual([
        `${config.appUrl}/api/operator/v1/capabilities`,
        `${config.appUrl}/api/operator/v1/native-collections/status?requestId=${id}`,
        `${config.appUrl}/api/operator/v1/native-collections/prepare`,
        `${config.appUrl}/api/operator/v1/native-collections/execute`,
      ]);
      const prepared = JSON.parse(transport.mock.calls[2][1].body);
      const executed = JSON.parse(transport.mock.calls[3][1].body);
      expect(prepared).toEqual({
        ...input,
        inputSource: "natural_language",
        protocolVersion: "1.0",
        connectorVersion: "0.7.0",
        amount: "0.30",
        allocations: [
          { receivableId: bill1, amount: "0.10" },
          { receivableId: bill2, amount: "0.20" },
        ],
      });
      expect(executed).toEqual({ request: prepared, previewProof: "synthetic-proof" });
      expect(JSON.stringify(executed)).not.toMatch(
        /totalXof|amountXof|exchangeRate|replacesConfirmationId/,
      );
      for (const call of transport.mock.calls) {
        expect(call[1].redirect).toBe("error");
        expect(call[1].headers.Authorization).toBe("Bearer synthetic-access-token");
      }
    },
  );

  it("keeps screenshot provenance and explicitly provided coverage without inventing either", async () => {
    const input = {
      ...request(),
      inputSource: "excel_screenshot",
      actualCollector: "振咏",
      collectorBasis: "用户明确说明",
      coverage: {
        expectedPaidThroughDate: "2026-09-30",
        expectedContractUpdatedAt: "2026-10-21T12:00:00Z",
        throughDate: "2026-10-31",
        receivableIds: [bill1, bill2],
      },
    };
    const result = {
      ...completed(),
      paidThroughBefore: "2026-09-30",
      paidThroughAfter: "2026-10-31",
    };
    const transport = transportFor(result);
    await new OperatorClient(config, store(), transport).nativeCollection("execute", input);
    const sent = JSON.parse(transport.mock.calls[2][1].body);
    expect(sent.inputSource).toBe("excel_screenshot");
    expect(sent.coverage).toEqual(input.coverage);
    expect(sent.actualCollector).toBe("振咏");
  });

  it("refuses a changed coverage result even when the financial totals match", async () => {
    const input = {
      ...request(),
      coverage: {
        expectedPaidThroughDate: "2026-09-30",
        expectedContractUpdatedAt: "2026-10-21T12:00:00Z",
        throughDate: "2026-10-31",
        receivableIds: [bill1, bill2],
      },
    };
    const transport = transportFor({
      ...completed(),
      paidThroughBefore: "2026-09-30",
      paidThroughAfter: "2026-11-30",
    });
    await expect(
      new OperatorClient(config, store(), transport).nativeCollection("execute", input),
    ).rejects.toThrow("execution_verification_failed_keep_original_request_id");
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("supports the largest safe native amount with exact string transport", async () => {
    const input = {
      ...request(),
      amount: "999999999999.99",
      allocations: [{ receivableId: bill1, amount: "999999999999.99" }],
    };
    const result = {
      ...completed(),
      amount: input.amount,
      allocations: [{ receivableId: bill1, amount: input.amount, paymentId: payment }],
    };
    result.verification.payments[0].amount = input.amount;
    result.verification.ledger[0].amount = input.amount;
    result.verification.allocations = structuredClone(result.allocations);
    result.verification.receivables = [
      {
        id: bill1,
        currency: "USD",
        amount: input.amount,
        paidBefore: "0.00",
        paidAfter: input.amount,
        amountXof: "0.00",
        paidAmountXof: "0.00",
      },
    ];
    const transport = transportFor(result);
    await new OperatorClient(config, store(), transport).nativeCollection("execute", input);
    expect(JSON.parse(transport.mock.calls[2][1].body).amount).toBe("999999999999.99");
  });

  it("normalizes uppercase UUIDs and trimmed text before journal comparison and signed HTTP preview", async () => {
    const input = {
      ...request(),
      requestId: id.toUpperCase(),
      contractId: contract.toUpperCase(),
      originalInstruction: `  ${request().originalInstruction}  `,
      allocations: request().allocations.map((item: any) => ({
        ...item,
        receivableId: item.receivableId.toUpperCase(),
      })),
      externalReceiptNo: "  receipt-1  ",
      actualCollector: "  振咏  ",
      collectorBasis: "  用户明确说明  ",
      notes: "  original note  ",
      coverage: {
        expectedPaidThroughDate: "2026-09-30",
        expectedContractUpdatedAt: "2026-10-21T12:00:00Z",
        throughDate: "2026-10-31",
        receivableIds: [bill1.toUpperCase(), bill2.toUpperCase()],
      },
    };
    const result = {
      ...completed(),
      paidThroughBefore: "2026-09-30",
      paidThroughAfter: "2026-10-31",
    };
    const transport = transportFor(result);
    await new OperatorClient(config, store(), transport).nativeCollection("execute", input);
    expect(transport.mock.calls[1][0]).toContain(`requestId=${id}`);
    const normalized = JSON.parse(transport.mock.calls[2][1].body);
    expect(normalized).toMatchObject({
      requestId: id,
      contractId: contract,
      originalInstruction: request().originalInstruction,
      externalReceiptNo: "receipt-1",
      actualCollector: "振咏",
      collectorBasis: "用户明确说明",
      notes: "original note",
      coverage: { receivableIds: [bill1, bill2] },
    });
    expect(normalized.allocations.map((item: any) => item.receivableId)).toEqual([bill1, bill2]);
    expect(input.requestId).toBe(id.toUpperCase());
  });

  const invalidInputs = [
    [
      "XOF",
      (r: any) => {
        r.currency = "XOF";
      },
    ],
    [
      "other currency",
      (r: any) => {
        r.currency = "EUR";
      },
    ],
    [
      "number amount",
      (r: any) => {
        r.amount = 0.3;
      },
    ],
    [
      "zero",
      (r: any) => {
        r.amount = "0.00";
      },
    ],
    [
      "negative",
      (r: any) => {
        r.amount = "-0.30";
      },
    ],
    [
      "exponent",
      (r: any) => {
        r.amount = "3e-1";
      },
    ],
    [
      "over precision",
      (r: any) => {
        r.amount = "0.300";
      },
    ],
    [
      "too large",
      (r: any) => {
        r.amount = "1000000000000";
      },
    ],
    [
      "leading zero",
      (r: any) => {
        r.amount = "00.30";
      },
    ],
    [
      "unbalanced",
      (r: any) => {
        r.amount = "0.31";
      },
    ],
    [
      "duplicate receivable",
      (r: any) => {
        r.allocations[1].receivableId = bill1;
      },
    ],
    [
      "invalid allocation",
      (r: any) => {
        r.allocations[0].amount = "0.101";
      },
    ],
    [
      "no allocation",
      (r: any) => {
        r.allocations = [];
      },
    ],
    [
      "too many allocations",
      (r: any) => {
        r.allocations = Array(101).fill(r.allocations[0]);
      },
    ],
    [
      "invalid date",
      (r: any) => {
        r.paymentDate = "2026-02-30";
      },
    ],
    [
      "offset",
      (r: any) => {
        r.paymentMethod = "offset";
      },
    ],
    [
      "invented source",
      (r: any) => {
        r.inputSource = "web_confirmed";
      },
    ],
    [
      "collector without basis",
      (r: any) => {
        r.actualCollector = "颖";
      },
    ],
    [
      "basis without collector",
      (r: any) => {
        r.collectorBasis = "unknown";
      },
    ],
    [
      "receipt too long",
      (r: any) => {
        r.externalReceiptNo = "a".repeat(201);
      },
    ],
    [
      "blank notes",
      (r: any) => {
        r.notes = "  \t ";
      },
    ],
    [
      "blank collector",
      (r: any) => {
        r.actualCollector = "  ";
        r.collectorBasis = "confirmed";
      },
    ],
    [
      "blank instruction",
      (r: any) => {
        r.originalInstruction = "  \n  ";
      },
    ],
    [
      "exchange field",
      (r: any) => {
        r.exchangeRateToXof = 1;
      },
    ],
    [
      "replacement field",
      (r: any) => {
        r.replacesConfirmationId = spare;
      },
    ],
    [
      "actor injection",
      (r: any) => {
        r.actorId = spare;
      },
    ],
    [
      "mixed currency allocation",
      (r: any) => {
        r.allocations[0].currency = "CNY";
      },
    ],
    [
      "invalid coverage",
      (r: any) => {
        r.coverage = {};
      },
    ],
  ] as const;
  it.each(invalidInputs)("rejects %s before any network operation", async (_label, change) => {
    const input = request();
    change(input);
    const transport = vi.fn();
    await expect(
      new OperatorClient(config, store(), transport).nativeCollection("execute", input),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  const invalidResults = [
    [
      "wrong currency",
      (r: any) => {
        r.currency = "CNY";
      },
    ],
    [
      "wrong contract",
      (r: any) => {
        r.contractId = spare;
      },
    ],
    [
      "wrong request",
      (r: any) => {
        r.requestId = spare;
      },
    ],
    [
      "wrong total",
      (r: any) => {
        r.amount = "0.31";
      },
    ],
    [
      "numeric total",
      (r: any) => {
        r.amount = 0.3;
      },
    ],
    [
      "not two decimals",
      (r: any) => {
        r.amount = "0.3";
      },
    ],
    [
      "unverified",
      (r: any) => {
        r.verified = false;
      },
    ],
    [
      "wrong mode",
      (r: any) => {
        r.executionMode = "sacsi_web";
      },
    ],
    [
      "missing evidence",
      (r: any) => {
        delete r.verification;
      },
    ],
    [
      "missing allocation",
      (r: any) => {
        r.allocations.pop();
      },
    ],
    [
      "duplicate allocation",
      (r: any) => {
        r.allocations[1] = r.allocations[0];
      },
    ],
    [
      "wrong allocation",
      (r: any) => {
        r.allocations[0].amount = "0.11";
      },
    ],
    [
      "unknown payment",
      (r: any) => {
        r.allocations[0].paymentId = spare;
      },
    ],
    [
      "unreferenced payment",
      (r: any) => {
        r.paymentIds.push(spare);
      },
    ],
    [
      "duplicate payment IDs",
      (r: any) => {
        r.paymentIds.push(payment);
      },
    ],
    [
      "missing coverage facts",
      (r: any) => {
        delete r.paidThroughBefore;
      },
    ],
    [
      "automatic coverage",
      (r: any) => {
        r.paidThroughAfter = "2026-10-31";
      },
    ],
    [
      "unsupported proof version",
      (r: any) => {
        r.verification.version = 2;
      },
    ],
    [
      "wrong proof actor",
      (r: any) => {
        r.verification.actorId = "another-owner";
      },
    ],
    [
      "false native checks",
      (r: any) => {
        r.verification.checks.xofUnchanged = false;
      },
    ],
    [
      "missing payment proof",
      (r: any) => {
        r.verification.payments = [];
      },
    ],
    [
      "wrong payment currency",
      (r: any) => {
        r.verification.payments[0].currency = "XOF";
      },
    ],
    [
      "converted payment",
      (r: any) => {
        r.verification.payments[0].nativeSettlement = false;
      },
    ],
    [
      "invented exchange rate",
      (r: any) => {
        r.verification.payments[0].exchangeRateToXof = 1;
      },
    ],
    [
      "wrong payment recorder",
      (r: any) => {
        r.verification.payments[0].recordedBy = "another-owner";
      },
    ],
    [
      "wrong payment native amount",
      (r: any) => {
        r.verification.payments[0].amount = "0.31";
      },
    ],
    [
      "wrong ledger XOF",
      (r: any) => {
        r.verification.ledger[0].amountXof = "1.00";
      },
    ],
    [
      "wrong ledger currency",
      (r: any) => {
        r.verification.ledger[0].currency = "CNY";
      },
    ],
    [
      "wrong proof allocation",
      (r: any) => {
        r.verification.allocations[0].amount = "0.11";
      },
    ],
    [
      "wrong receivable delta",
      (r: any) => {
        r.verification.receivables[0].paidAfter = "0.09";
      },
    ],
    [
      "nonzero receivable XOF",
      (r: any) => {
        r.verification.receivables[0].paidAmountXof = "0.01";
      },
    ],
    [
      "wrong audit actor",
      (r: any) => {
        r.verification.audit.actorId = "another-owner";
      },
    ],
    [
      "wrong audit channel",
      (r: any) => {
        r.verification.audit.channel = "sacsi_web";
      },
    ],
  ] as const;
  it.each(invalidResults)(
    "treats %s as an unknown outcome, never successful or retried",
    async (_label, change) => {
      const result = completed();
      change(result);
      const transport = transportFor(result);
      await expect(
        new OperatorClient(config, store(), transport).nativeCollection("execute", request()),
      ).rejects.toThrow("execution_verification_failed_keep_original_request_id");
      expect(transport).toHaveBeenCalledTimes(4);
    },
  );

  it("does not execute an already completed request or claim a fresh verification", async () => {
    const transport = transportFor(undefined, {
      status: "completed_previously",
      requestId: id,
      verified: false,
    });
    expect(
      await new OperatorClient(config, store(), transport).nativeCollection("execute", request()),
    ).toMatchObject({ status: "completed_previously", verified: false, requestId: id });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects old protocol or a newer required connector without touching native endpoints", async () => {
    for (const change of [{ protocolVersion: "2.0" }, { minimumConnectorVersion: "0.8.0" }]) {
      const transport = vi.fn().mockResolvedValueOnce(reply({ ...manifest, ...change }));
      await expect(
        new OperatorClient(config, store(), transport).nativeCollection("execute", request()),
      ).rejects.toThrow("connector_upgrade_required");
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it("labels a concurrent idempotent completion as history", async () => {
    const transport = transportFor({
      status: "completed_previously",
      requestId: id,
      verified: false,
    });
    expect(
      await new OperatorClient(config, store(), transport).nativeCollection("execute", request()),
    ).toMatchObject({ status: "completed_previously", verified: false });
    expect(transport).toHaveBeenCalledTimes(4);
  });
  it("does not fallback when the workflow is absent", async () => {
    const transport = vi.fn().mockResolvedValue(
      reply({
        ...manifest,
        directExecution: { ...manifest.directExecution, workflows: ["collection"] },
      }),
    );
    await expect(
      new OperatorClient(config, store(), transport).nativeCollection("execute", request()),
    ).rejects.toThrow("native_collection_not_available");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("can read original status while direct execution is temporarily switched off", async () => {
    const disabled = {
      ...manifest,
      directExecution: { ...manifest.directExecution, available: false, workflows: [] },
      safeguards: {
        ...manifest.safeguards,
        screenshotWritesRequireConfirmation: true,
        batchWritesRequireConfirmation: true,
      },
    };
    const transport = vi
      .fn()
      .mockResolvedValueOnce(reply(disabled))
      .mockResolvedValueOnce(
        reply({ status: "completed_previously", requestId: id, verified: false }),
      );
    expect(
      await new OperatorClient(config, store(), transport).nativeCollection("status", {
        requestId: id,
      }),
    ).toMatchObject({ status: "completed_previously", verified: false });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: "pending", requestId: id },
    { status: "not_found" },
    { status: "completed_previously", requestId: id, verified: true },
  ])("refuses unsafe original status %j", async (status) => {
    const transport = transportFor(undefined, status);
    await expect(
      new OperatorClient(config, store(), transport).nativeCollection("execute", request()),
    ).rejects.toThrow("request_state_requires_reconciliation");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("preserves unknown outcomes on a broken response after execute", async () => {
    const transport = transportFor();
    transport
      .mockReset()
      .mockResolvedValueOnce(reply(manifest))
      .mockResolvedValueOnce(reply({ status: "not_found", requestId: id }))
      .mockResolvedValueOnce(
        reply({ status: "ready_for_direct_execution", previewProof: "synthetic-proof" }),
      )
      .mockResolvedValueOnce(new Response("broken"));
    await expect(
      new OperatorClient(config, store(), transport).nativeCollection("execute", request()),
    ).rejects.toThrow("outcome_unknown_keep_original_request_id");
    expect(transport).toHaveBeenCalledTimes(4);
  });
  it.each([{ contractId: contract }, { buildingCode: "11#", unitNo: "503" }])(
    "queries only current native facts by %j",
    async (query) => {
      const facts = { native_receivables: [{ id: bill1, currency: "USD", amount_native: "0.30" }] };
      const transport = vi
        .fn()
        .mockResolvedValueOnce(reply(manifest))
        .mockResolvedValueOnce(reply(facts));
      expect(
        await new OperatorClient(config, store(), transport).nativeCollection("query", query),
      ).toEqual(facts);
      expect(transport.mock.calls[1][0]).toBe(
        `${config.appUrl}/api/operator/v1/native-collections/query`,
      );
      expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual(query);
    },
  );
  it("canonicalizes selector and status UUIDs without changing the original inputs", async () => {
    const selector = { contractId: contract.toUpperCase() };
    const transport = vi
      .fn()
      .mockResolvedValueOnce(reply(manifest))
      .mockResolvedValueOnce(reply({ native_receivables: [] }));
    await new OperatorClient(config, store(), transport).nativeCollection("query", selector);
    expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual({ contractId: contract });
    expect(selector.contractId).toBe(contract.toUpperCase());
    const statusTransport = vi
      .fn()
      .mockResolvedValueOnce(reply(manifest))
      .mockResolvedValueOnce(reply({ status: "not_found", requestId: id }));
    await new OperatorClient(config, store(), statusTransport).nativeCollection("status", {
      requestId: id.toUpperCase(),
    });
    expect(statusTransport.mock.calls[1][0]).toContain(`requestId=${id}`);
  });
  it.each([
    {},
    { contractId: contract, unitNo: "503" },
    { buildingCode: "11#" },
    { contractId: contract, exchangeRateToXof: 1 },
  ])("rejects ambiguous or injected query %j", async (query) => {
    const transport = vi.fn();
    await expect(
      new OperatorClient(config, store(), transport).nativeCollection("query", query),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("exposes a bounded native write tool without widening old XOF schemas", async () => {
    const native = tools.find((tool: any) => tool.name === "execute_native_collection");
    expect(native.annotations.readOnlyHint).toBe(false);
    expect(native.inputSchema.properties.currency.enum).toEqual(["USD", "CNY"]);
    expect(native.inputSchema.properties.amount.type).toBe("string");
    expect(native.inputSchema.additionalProperties).toBe(false);
    for (const name of ["query_native_collection_position", "native_collection_status"])
      expect(tools.find((tool: any) => tool.name === name).annotations.readOnlyHint).toBe(true);
    const xof = tools.find((tool: any) => tool.name === "execute_collection_batch");
    expect(xof.inputSchema.properties.totalXof.type).toBe("integer");
    expect(xof.inputSchema.properties.currency).toBeUndefined();
    const client = { nativeCollection: vi.fn().mockResolvedValue({}) };
    const lock = { lock: async (fn: () => Promise<unknown>) => fn() };
    await callTool("execute_native_collection", request(), client, lock);
    expect(client.nativeCollection).toHaveBeenCalledWith("execute", request());
    await expect(
      callTool("execute_native_collection", { ...request(), amount: 0.3 }, client, lock),
    ).rejects.toThrow("invalid_tool_arguments");
    await expect(
      callTool("execute_native_collection", { ...request(), humanConfirmed: true }, client, lock),
    ).rejects.toThrow("invalid_tool_arguments");
    expect(instructions).toContain("保留原币");
    expect(instructions).toContain("退款登记不是实际银行转账");
  });
});

describe("native collection encrypted pending compatibility", () => {
  let directory: string, journal: any, client: any, wrapped: any;
  const crypt = (value: string | Buffer, mode: string) =>
    mode === "protect"
      ? Buffer.from(`TEST:${Buffer.from(value).toString("base64")}`)
      : Buffer.from(Buffer.from(value).toString().slice(5), "base64");
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sacsi-native-pending-"));
    journal = pendingStore(directory, config.appUrl, crypt);
    client = {
      capabilities: vi.fn().mockResolvedValue(manifest),
      nativeCollection: vi.fn(),
      collection: vi.fn(),
      api: vi.fn(),
    };
    wrapped = durableClient(client, store(), journal, config);
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  const saved = (dir: string) => join(dir, "pending-v1", readdirSync(join(dir, "pending-v1"))[0]);
  it("upgrades only on the first native write, preserves v1 items, and saves canonical request before sending", async () => {
    journal.put("owner", {
      requestId: spare,
      kind: "note",
      sourceText: "old receipt",
      state: "needs_details",
    });
    expect(
      JSON.parse(crypt(readFileSync(saved(directory)), "unprotect").toString()).formatVersion,
    ).toBe(1);
    client.nativeCollection.mockImplementation(async () => {
      expect(journal.get("owner", id)).toMatchObject({
        kind: "native_collection",
        executionMode: "direct",
        state: "preparing",
        request: { amount: "0.30", inputSource: "natural_language" },
      });
      expect(
        JSON.parse(crypt(readFileSync(saved(directory)), "unprotect").toString()).formatVersion,
      ).toBe(2);
      throw new Error("outcome_unknown_keep_original_request_id");
    });
    await expect(wrapped.nativeCollection("execute", request())).rejects.toThrow("outcome_unknown");
    expect(journal.get("owner", spare).sourceText).toBe("old receipt");
    expect(journal.get("owner", id).state).toBe("unknown");
    const reopened = pendingStore(directory, config.appUrl, crypt);
    expect(reopened.list("owner")).toHaveLength(2);
    expect(reopened.list("another-owner")).toEqual([]);
  });
  it("canonicalizes equivalent decimal strings before same-request comparison", async () => {
    client.nativeCollection.mockRejectedValue(new Error("offline"));
    await expect(wrapped.nativeCollection("execute", request())).rejects.toThrow("offline");
    const same = request();
    same.amount = "0.30";
    same.allocations[0].amount = "0.10";
    await expect(wrapped.nativeCollection("execute", same)).rejects.toThrow("offline");
    expect(client.nativeCollection).toHaveBeenCalledTimes(2);
    const changed = request();
    changed.amount = "0.40";
    changed.allocations[1].amount = "0.30";
    await expect(wrapped.nativeCollection("execute", changed)).rejects.toThrow(
      "pending_request_changed_reconcile_first",
    );
    expect(client.nativeCollection).toHaveBeenCalledTimes(2);
  });
  it("journals uppercase identifiers and padded text in the same canonical form as HTTP", async () => {
    client.nativeCollection.mockRejectedValue(new Error("offline"));
    const input = {
      ...request(),
      requestId: id.toUpperCase(),
      contractId: contract.toUpperCase(),
      allocations: request().allocations.map((allocation: any) => ({
        ...allocation,
        receivableId: allocation.receivableId.toUpperCase(),
      })),
      originalInstruction: `  ${request().originalInstruction}  `,
      notes: "  recorded source  ",
    };
    await expect(wrapped.nativeCollection("execute", input)).rejects.toThrow("offline");
    const stored = journal.get("owner", id).request;
    expect(stored).toMatchObject({
      requestId: id,
      contractId: contract,
      originalInstruction: request().originalInstruction,
      notes: "recorded source",
      amount: "0.30",
    });
    expect(stored.allocations.map((allocation: any) => allocation.receivableId)).toEqual([
      bill1,
      bill2,
    ]);
    expect(client.nativeCollection.mock.calls[0]).toEqual(["execute", stored]);
    await expect(
      wrapped.nativeCollection("execute", { ...request(), notes: "recorded source" }),
    ).rejects.toThrow("offline");
    expect(client.nativeCollection).toHaveBeenCalledTimes(2);
  });
  it.each(["not_found", "completed_previously"])(
    "recovers %s only through native status, never replaying or using an XOF route",
    async (status) => {
      client.nativeCollection.mockRejectedValueOnce(new Error("offline"));
      await expect(wrapped.nativeCollection("execute", request())).rejects.toThrow();
      client.nativeCollection.mockResolvedValueOnce({
        status,
        requestId: id,
        ...(status === "completed_previously" ? { verified: false } : {}),
      });
      expect(await wrapped.pending("recover", { requestId: id })).toMatchObject({
        status,
        requestId: id,
      });
      expect(client.nativeCollection.mock.calls.map((call: any[]) => call[0])).toEqual([
        "execute",
        "status",
      ]);
      expect(client.collection).not.toHaveBeenCalled();
      expect(client.api).not.toHaveBeenCalled();
      expect(journal.get("owner", id).state).toBe(
        status === "completed_previously" ? "completed_history" : "unknown",
      );
      if (status === "completed_previously") {
        await expect(wrapped.nativeCollection("execute", request())).rejects.toThrow(
          "pending_already_completed_do_not_repeat",
        );
        expect(client.nativeCollection).toHaveBeenCalledTimes(2);
      }
    },
  );
  it("never stores invalid money or sends a request when journaling fails", async () => {
    const broken = durableClient(
      client,
      store(),
      {
        get: () => {
          throw new Error("storage failed");
        },
      },
      config,
    );
    await expect(broken.nativeCollection("execute", request())).rejects.toThrow("storage failed");
    await expect(
      wrapped.nativeCollection("execute", { ...request(), amount: "0.301" }),
    ).rejects.toThrow("invalid_native_collection_amount");
    expect(client.nativeCollection).not.toHaveBeenCalled();
    expect(journal.list("owner")).toEqual([]);
  });
  it.each([
    { status: "not_found" },
    { status: "completed_previously", requestId: spare, verified: false },
    { status: "completed_previously", requestId: id, verified: true },
  ])("rejects mismatched native recovery %j without marking completion", async (result) => {
    client.nativeCollection.mockRejectedValueOnce(new Error("offline"));
    await expect(wrapped.nativeCollection("execute", request())).rejects.toThrow("offline");
    client.nativeCollection.mockResolvedValueOnce(result);
    await expect(wrapped.pending("recover", { requestId: id })).rejects.toThrow(
      "pending_server_identity_mismatch",
    );
    expect(journal.get("owner", id).state).toBe("unknown");
    expect(client.nativeCollection.mock.calls.map((call: any[]) => call[0])).toEqual([
      "execute",
      "status",
    ]);
    expect(client.api).not.toHaveBeenCalled();
  });
  it("retains the original pending request after a permission revocation", async () => {
    client.nativeCollection.mockRejectedValueOnce(new Error("offline"));
    await expect(wrapped.nativeCollection("execute", request())).rejects.toThrow("offline");
    client.capabilities.mockRejectedValueOnce(new Error("action_forbidden"));
    await expect(wrapped.pending("recover", { requestId: id })).rejects.toThrow("action_forbidden");
    expect(journal.get("owner", id).request.amount).toBe("0.30");
    expect(client.nativeCollection).toHaveBeenCalledTimes(1);
  });
  it("rejects unknown kinds without falling back to confirmations/status or rewriting ciphertext", async () => {
    journal.put("owner", {
      requestId: id,
      kind: "note",
      sourceText: "test",
      state: "needs_details",
    });
    const file = saved(directory);
    const content = JSON.parse(crypt(readFileSync(file), "unprotect").toString());
    content.items[0].kind = "future_finance_write";
    const bytes = crypt(JSON.stringify(content), "protect");
    writeFileSync(file, bytes);
    await expect(wrapped.pending("recover", { requestId: id })).rejects.toThrow(
      "pending_kind_upgrade_required",
    );
    expect(readFileSync(file)).toEqual(bytes);
    expect(client.nativeCollection).not.toHaveBeenCalled();
    expect(client.api).not.toHaveBeenCalled();
  });
  it("rejects native kind mislabeled as v1 and retains a v2 marker after later legacy writes", async () => {
    client.nativeCollection.mockResolvedValue(completed());
    await wrapped.nativeCollection("execute", request());
    journal.put("owner", {
      requestId: spare,
      kind: "note",
      sourceText: "after upgrade",
      state: "needs_details",
    });
    const file = saved(directory);
    const content = JSON.parse(crypt(readFileSync(file), "unprotect").toString());
    expect(content.formatVersion).toBe(2);
    content.formatVersion = 1;
    writeFileSync(file, crypt(JSON.stringify(content), "protect"));
    expect(() => journal.list("owner")).toThrow("pending_kind_upgrade_required");
  });
});
