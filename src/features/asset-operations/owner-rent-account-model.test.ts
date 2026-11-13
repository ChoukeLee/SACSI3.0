import { describe, expect, it } from "vitest";
import type { OwnerSettlement } from "./owner-settlement-model";
import {
  parseOwnerRentBackfillInput,
  readOwnerRentAccount,
  readOwnerRentAccountRpc,
  summarizeOwnerRentAccount,
  verifyOwnerRentBackfillResult,
  type OwnerRentAccount,
  type OwnerRentBackfillInput,
} from "./owner-rent-account-model";

type ReceiptProof = Parameters<typeof summarizeOwnerRentAccount>[2][number];

const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const ASSET = id(1);
const ACTOR = id(2);
const REQUEST = id(3);
const SETTLEMENT_REQUEST = id(4);
const SETTLEMENT_ENTRY = id(5);
const TODAY = "2026-11-13";

function receipt(
  entryId: string,
  cashDate: string,
  amountNative: number,
  sourceRef: string,
): ReceiptProof {
  return {
    id: entryId,
    assetId: ASSET,
    kind: "income",
    category: "rent",
    amountNative,
    currency: "XOF",
    cashDate,
    periodStart: null,
    periodEnd: null,
    recognitionMethod: "unallocated",
    verification: "verified",
    status: "verified",
    sourceRef,
    voidedAt: null,
  };
}

function fixture() {
  const input: OwnerRentBackfillInput = {
    assetId: ASSET,
    expectedUpdatedAt: "2026-11-13T10:00:00.000Z",
    expectedEvidenceHash: "ab".repeat(16),
    expectedSettlementRequestId: SETTLEMENT_REQUEST,
    rateSourceRef: "fixture:annual-rent!F11",
    reason: "按原始来源补录示例业主收款，保留原文和未记录的付款方式。",
    history: [
      {
        cashDate: "2025-04-05",
        amountNative: 5_000_000,
        currency: "XOF",
        paymentMethod: null,
        sourceRef: "fixture:rent-history!H11",
        sourceText: "  示例来源甲：业主分得500万，原结余说明保留。\n",
      },
      {
        cashDate: "2026-06-16",
        amountNative: 5_000_000,
        currency: "XOF",
        paymentMethod: null,
        sourceRef: "fixture:rent-history!I11",
        sourceText: "示例来源乙：业主500万，整厂等值1000万。",
      },
      {
        cashDate: "2026-07-14",
        amountNative: 5_000_000,
        currency: "XOF",
        paymentMethod: null,
        sourceRef: "fixture:rent-history!J11",
        sourceText: "示例来源丙：业主500万，整厂等值1000万。",
      },
      {
        cashDate: "2026-10-15",
        amountNative: 2_500_000,
        currency: "XOF",
        paymentMethod: null,
        sourceRef: "fixture:rent-history!C12",
        sourceText: "示例来源丁：业主250万，整厂等值500万支。",
      },
    ],
  };
  const account: OwnerRentAccount = {
    version: 1,
    requestId: REQUEST,
    ownerName: "示例业主甲",
    shareBps: 5000,
    currency: "XOF",
    wholeMonthlyRentNative: 3_500_000,
    rateSourceRef: input.rateSourceRef,
    chargingRule: "full_calendar_month",
    history: input.history.map((row, index) => ({ ...row, entryId: id(index + 11) })),
    settlementEntryIds: [SETTLEMENT_ENTRY],
    reason: input.reason,
    recordedBy: ACTOR,
    recordedAt: "2026-11-13T10:01:00.000Z",
  };
  const settlement: OwnerSettlement = {
    requestId: SETTLEMENT_REQUEST,
    entryId: SETTLEMENT_ENTRY,
    ownerName: account.ownerName,
    shareBps: 5000,
    receiptAmountNative: 5_000_000,
    currency: "XOF",
    cashDate: "2026-11-12",
    paymentMethod: "cash",
    periodStart: "2024-06-01",
    periodEnd: "2024-08-31",
    throughDate: "2024-08-31",
    monthlyRentNative: 3_500_000,
    monthCount: 3,
    wholeEquivalent: 10_000_000,
    wholeOpeningCredit: 500_000,
    wholeRent: 10_500_000,
    wholeClosingCredit: 0,
    sourceRef: "fixture:latest-owner-distribution",
    reason: "示例季度结算，旧信用不是本次新增现金。",
    recordedBy: ACTOR,
    recordedAt: "2026-11-13T09:00:00.000Z",
  };
  const entries = [
    ...account.history.map((row) =>
      receipt(row.entryId, row.cashDate, row.amountNative, row.sourceRef),
    ),
    receipt(
      settlement.entryId,
      settlement.cashDate,
      settlement.receiptAmountNative,
      settlement.sourceRef,
    ),
  ];
  return { input, account, settlement, entries };
}

function result(account: OwnerRentAccount) {
  return {
    success: true,
    data: {
      assetId: ASSET,
      ownerRentAccount: account,
      entryIds: account.history.map((row) => row.entryId),
    },
    idempotent: false,
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .reverse()
        .map((key) => [key, reverseObjectKeys(record[key])]),
    );
  }
  return value;
}

describe("owner rent historical inputs and proof", () => {
  it("preserves unknown payment methods and exact original source text", () => {
    const { input, account } = fixture();
    expect(parseOwnerRentBackfillInput(input, TODAY)).toEqual(input);
    expect(readOwnerRentAccount(account)).toEqual(account);
    expect(parseOwnerRentBackfillInput(input, TODAY).history[0].sourceText).toBe(
      input.history[0].sourceText,
    );
    expect(account.history.every((row) => row.paymentMethod === null)).toBe(true);
  });

  it.each(["cash", "bank_transfer", "check", "other"])(
    "accepts the explicitly recorded payment method %s",
    (paymentMethod) => {
      const { input } = fixture();
      const changed = structuredClone(input);
      changed.history[0].paymentMethod = paymentMethod as "cash";
      expect(parseOwnerRentBackfillInput(changed, TODAY).history[0].paymentMethod).toBe(
        paymentMethod,
      );
    },
  );

  it.each(["wallet", "cash ", 1, ["cash"], { method: "cash" }, undefined])(
    "rejects an unknown or malformed payment method %j",
    (paymentMethod) => {
      const { input } = fixture();
      const malformed = { ...input, history: [{ ...input.history[0], paymentMethod }] };
      expect(() => parseOwnerRentBackfillInput(malformed, TODAY)).toThrow(
        "invalidOwnerRentHistory",
      );
    },
  );

  it.each([
    { amountNative: 0 },
    { amountNative: 5_000_000.5 },
    { currency: "USD" },
    { cashDate: "2026-11-14" },
    { cashDate: "2026-02-30" },
    { sourceText: "" },
    { sourceRef: "" },
    { unverifiedWholeEquivalent: 10_000_000 },
  ])("rejects incomplete, invalid or extra receipt facts %j", (patch) => {
    const { input } = fixture();
    expect(() =>
      parseOwnerRentBackfillInput(
        { ...input, history: [{ ...input.history[0], ...patch }] },
        TODAY,
      ),
    ).toThrow("invalidOwnerRentHistory");
  });

  it("rejects duplicate sources and nonchronological history", () => {
    const { input } = fixture();
    expect(() =>
      parseOwnerRentBackfillInput({ ...input, history: [...input.history].reverse() }, TODAY),
    ).toThrow("invalidOwnerRentHistory");
    const duplicate = structuredClone(input);
    duplicate.history[1].sourceRef = duplicate.history[0].sourceRef;
    expect(() => parseOwnerRentBackfillInput(duplicate, TODAY)).toThrow("invalidOwnerRentHistory");
    expect(() => parseOwnerRentBackfillInput({ ...input, ownerPaidThrough: TODAY }, TODAY)).toThrow(
      "invalidOwnerRentHistory",
    );
  });

  it("rejects shared history/settlement IDs instead of counting one receipt twice", () => {
    const { account } = fixture();
    expect(() =>
      readOwnerRentAccount({ ...account, settlementEntryIds: [account.history[0].entryId] }),
    ).toThrow("invalidOwnerRentHistory");
    expect(() =>
      readOwnerRentAccount({
        ...account,
        history: account.history.map((row) => ({ ...row, entryId: id(11) })),
      }),
    ).toThrow("invalidOwnerRentHistory");
  });
});

describe("owner rent account read and backfill result binding", () => {
  it("compares equivalent JSON semantically rather than by object key order", () => {
    const { account } = fixture();
    const rpc = {
      assetId: ASSET,
      account: reverseObjectKeys(account),
      settlementEntryIds: [SETTLEMENT_ENTRY],
    };
    expect(readOwnerRentAccountRpc(rpc, account, ASSET)).toEqual(account);
  });

  it("binds the RPC account to its asset and preserves the required settlement journal ID", () => {
    const { account } = fixture();
    const rpc = { assetId: ASSET, account, settlementEntryIds: [SETTLEMENT_ENTRY] };
    expect(() => readOwnerRentAccountRpc({ ...rpc, assetId: id(90) }, account, ASSET)).toThrow();
    expect(() =>
      readOwnerRentAccountRpc({ ...rpc, settlementEntryIds: [id(91)] }, account, ASSET),
    ).toThrow();
    expect(() =>
      readOwnerRentAccountRpc(
        { ...rpc, account: { ...account, wholeMonthlyRentNative: 3_600_000 } },
        account,
        ASSET,
      ),
    ).toThrow();
    expect(
      readOwnerRentAccountRpc(
        { ...rpc, settlementEntryIds: [SETTLEMENT_ENTRY, id(92)] },
        account,
        ASSET,
      ).settlementEntryIds,
    ).toEqual([SETTLEMENT_ENTRY, id(92)]);
  });

  it("accepts an exact completed result and an exact idempotent replay", () => {
    const { input, account } = fixture();
    expect(verifyOwnerRentBackfillResult(result(account), input, REQUEST, ACTOR)).toEqual({
      account,
      idempotent: false,
    });
    expect(
      verifyOwnerRentBackfillResult(
        { ...result(account), idempotent: true },
        input,
        REQUEST,
        ACTOR,
      ),
    ).toEqual({ account, idempotent: true });
  });

  it("rejects results for another actor, request or asset", () => {
    const { input, account } = fixture();
    expect(() => verifyOwnerRentBackfillResult(result(account), input, REQUEST, id(90))).toThrow();
    expect(() => verifyOwnerRentBackfillResult(result(account), input, id(90), ACTOR)).toThrow();
    const wrongAsset = result(account);
    wrongAsset.data.assetId = id(90);
    expect(() => verifyOwnerRentBackfillResult(wrongAsset, input, REQUEST, ACTOR)).toThrow();
  });

  it.each([
    { amountNative: 10_000_000 },
    { cashDate: "2025-04-06" },
    { sourceRef: "fixture:different-source" },
    { sourceText: "丢失了原始文字" },
    { paymentMethod: "cash" as const },
  ])("rejects result proofs that change submitted source facts %j", (patch) => {
    const { input, account } = fixture();
    account.history[0] = { ...account.history[0], ...patch };
    expect(() => verifyOwnerRentBackfillResult(result(account), input, REQUEST, ACTOR)).toThrow();
  });

  it("requires source-aligned returned IDs and rejects extra success fields", () => {
    const { input, account } = fixture();
    const wrongIds = result(account);
    wrongIds.data.entryIds.reverse();
    expect(() => verifyOwnerRentBackfillResult(wrongIds, input, REQUEST, ACTOR)).toThrow();
    expect(() =>
      verifyOwnerRentBackfillResult(
        { ...result(account), tenantPaidThrough: TODAY },
        input,
        REQUEST,
        ACTOR,
      ),
    ).toThrow();
  });
});

describe("owner cash and rent arrears remain separate", () => {
  it("counts only 22.5m actual owner receipts and 27 monthly dues after the settled anchor", () => {
    const { account, settlement, entries } = fixture();
    const summary = summarizeOwnerRentAccount(account, settlement, entries, ASSET, TODAY);
    expect(summary).toMatchObject({
      ownerName: "示例业主甲",
      shareBps: 5000,
      cumulativeActualNative: 22_500_000,
      monthlyOwnerRentNative: 1_750_000,
      settledThrough: "2024-08-31",
      dueMonthCount: 27,
      grossDueNative: 47_250_000,
      appliedCreditNative: 0,
      arrearsNative: 47_250_000,
      firstUnpaidDate: "2024-09-01",
      asOf: TODAY,
    });
    expect(summary?.periods).toHaveLength(27);
    expect(summary?.periods[0]).toEqual({
      start: "2024-09-01",
      end: "2024-09-30",
      dueNative: 1_750_000,
      creditNative: 0,
      outstandingNative: 1_750_000,
    });
    expect(summary?.periods.at(-1)).toEqual({
      start: "2026-11-01",
      end: "2026-11-30",
      dueNative: 1_750_000,
      creditNative: 0,
      outstandingNative: 1_750_000,
    });
  });

  it("never offsets post-anchor dues with old cash, opening credit or unlinked equivalents", () => {
    const { account, settlement, entries } = fixture();
    const unrelated = [
      receipt(id(91), "2026-11-12", 10_000_000, "fixture:whole-equivalent-not-owner-cash"),
      receipt(id(92), "2026-11-12", 500_000, "fixture:old-credit-not-new-cash"),
    ];
    const summary = summarizeOwnerRentAccount(
      account,
      settlement,
      [...entries, ...unrelated],
      ASSET,
      TODAY,
    );
    expect(summary?.cumulativeActualNative).toBe(22_500_000);
    expect(summary?.arrearsNative).toBe(47_250_000);
    expect(summary?.appliedCreditNative).toBe(0);
  });

  it("uses closing credit once across successive months and finds the first partly unpaid month", () => {
    const { account, settlement, entries } = fixture();
    settlement.wholeOpeningCredit = 4_500_000;
    settlement.wholeClosingCredit = 4_000_000;
    const summary = summarizeOwnerRentAccount(account, settlement, entries, ASSET, TODAY);
    expect(summary).toMatchObject({
      cumulativeActualNative: 22_500_000,
      grossDueNative: 47_250_000,
      appliedCreditNative: 2_000_000,
      arrearsNative: 45_250_000,
      firstUnpaidDate: "2024-10-01",
    });
    expect(summary?.periods.slice(0, 3).map(({ creditNative }) => creditNative)).toEqual([
      1_750_000, 250_000, 0,
    ]);
    expect(summary?.periods.reduce((sum, period) => sum + period.creditNative, 0)).toBe(2_000_000);
  });

  it.each([
    ["2026-11-01", 27, 47_250_000],
    ["2026-11-13", 27, 47_250_000],
    ["2026-12-01", 28, 49_000_000],
  ])("charges each started calendar month once as of %s", (today, months, due) => {
    const { account, settlement, entries } = fixture();
    settlement.cashDate = "2026-10-16";
    entries.at(-1)!.cashDate = settlement.cashDate;
    const summary = summarizeOwnerRentAccount(account, settlement, entries, ASSET, today);
    expect(summary?.dueMonthCount).toBe(months);
    expect(summary?.arrearsNative).toBe(due);
  });

  it.each([
    ["2024-02-01", 2, "2024-02-29"],
    ["2024-02-29", 2, "2024-02-29"],
    ["2024-03-01", 3, "2024-03-31"],
  ])("keeps the February leap boundary correct as of %s", (today, months, lastEnd) => {
    const { account, settlement, entries } = fixture();
    account.history.forEach((row, index) => {
      row.cashDate = `2023-0${index + 1}-05`;
      entries[index].cashDate = row.cashDate;
    });
    settlement.cashDate = "2023-12-31";
    settlement.periodStart = "2023-10-01";
    settlement.periodEnd = "2023-12-31";
    settlement.throughDate = settlement.periodEnd;
    entries.at(-1)!.cashDate = settlement.cashDate;
    const summary = summarizeOwnerRentAccount(account, settlement, entries, ASSET, today);
    expect(summary?.dueMonthCount).toBe(months);
    expect(summary?.periods.at(-1)?.end).toBe(lastEnd);
    expect(summary?.firstUnpaidDate).toBe("2024-01-01");
  });

  it("returns null for missing linked proof instead of displaying a healthy zero", () => {
    const { account, settlement, entries } = fixture();
    expect(
      summarizeOwnerRentAccount(account, settlement, entries.slice(1), ASSET, TODAY),
    ).toBeNull();
    expect(
      summarizeOwnerRentAccount(account, settlement, entries.slice(0, -1), ASSET, TODAY),
    ).toBeNull();
  });

  it.each<[string, Partial<ReceiptProof>]>([
    ["changed amount", { amountNative: 4_999_999 }],
    ["changed cash date", { cashDate: "2025-04-06" }],
    ["missing source", { sourceRef: "" }],
    ["different source", { sourceRef: "fixture:unrelated" }],
    ["another asset", { assetId: id(90) }],
    ["voided receipt", { status: "voided", voidedAt: "2026-11-13T10:00:00Z" }],
    ["pending receipt", { status: "pending", verification: "pending" }],
    ["wrong category", { category: "other" }],
    ["wrong currency", { currency: "USD" }],
    ["tenant coverage", { periodStart: "2024-06-01", periodEnd: "2024-08-31" }],
    ["period allocation", { recognitionMethod: "daily" }],
  ])("returns null for %s rather than understated cash or arrears", (_label, patch) => {
    const { account, settlement, entries } = fixture();
    entries[0] = { ...entries[0], ...patch };
    expect(summarizeOwnerRentAccount(account, settlement, entries, ASSET, TODAY)).toBeNull();
  });

  it("requires the latest settlement cash proof and the same owner/rate/share", () => {
    const { account, settlement, entries } = fixture();
    const changedLatest = [...entries];
    changedLatest[changedLatest.length - 1] = { ...entries.at(-1)!, amountNative: 10_000_000 };
    expect(summarizeOwnerRentAccount(account, settlement, changedLatest, ASSET, TODAY)).toBeNull();
    expect(
      summarizeOwnerRentAccount(
        { ...account, ownerName: "示例业主乙" },
        settlement,
        entries,
        ASSET,
        TODAY,
      ),
    ).toBeNull();
    expect(
      summarizeOwnerRentAccount({ ...account, shareBps: 4000 }, settlement, entries, ASSET, TODAY),
    ).toBeNull();
    expect(
      summarizeOwnerRentAccount(
        { ...account, wholeMonthlyRentNative: 3_600_000 },
        settlement,
        entries,
        ASSET,
        TODAY,
      ),
    ).toBeNull();
    expect(summarizeOwnerRentAccount(account, settlement, entries, ASSET, "2026-11-11")).toBeNull();
  });
});
