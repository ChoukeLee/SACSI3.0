import { isAssetDate, assetReportPeriod } from "./asset-operations-model";
import {
  isOwnerSettlementId,
  OWNER_SETTLEMENT_MAX,
  type OwnerSettlement,
  type OwnerSettlementPaymentMethod,
} from "./owner-settlement-model";

export interface OwnerRentHistoryInput {
  cashDate: string;
  amountNative: number;
  currency: "XOF";
  paymentMethod: OwnerSettlementPaymentMethod | null;
  sourceRef: string;
  sourceText: string;
}
export interface OwnerRentBackfillInput {
  assetId: string;
  expectedUpdatedAt: string;
  expectedEvidenceHash: string;
  expectedSettlementRequestId: string;
  rateSourceRef: string;
  reason: string;
  history: OwnerRentHistoryInput[];
}
export interface OwnerRentAccount {
  version: 1;
  requestId: string;
  ownerName: string;
  shareBps: number;
  currency: "XOF";
  wholeMonthlyRentNative: number;
  rateSourceRef: string;
  chargingRule: "full_calendar_month";
  history: (OwnerRentHistoryInput & { entryId: string })[];
  settlementEntryIds: string[];
  reason: string;
  recordedBy: string;
  recordedAt: string;
}
export type OwnerRentBackfillResult =
  | { ok: true; account: OwnerRentAccount; idempotent: boolean }
  | { ok: false; error: string; rejected: boolean };
export interface OwnerRentSummary {
  ownerName: string;
  shareBps: number;
  cumulativeActualNative: number;
  monthlyOwnerRentNative: number;
  settledThrough: string;
  dueMonthCount: number;
  grossDueNative: number;
  appliedCreditNative: number;
  arrearsNative: number;
  firstUnpaidDate: string | null;
  asOf: string;
  periods: {
    start: string;
    end: string;
    dueNative: number;
    creditNative: number;
    outstandingNative: number;
  }[];
}

function object(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    throw new Error("invalidOwnerRentHistory");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max
  );
}
function money(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= OWNER_SETTLEMENT_MAX
  );
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function ids(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 10_000 &&
    value.every(isOwnerSettlementId) &&
    new Set(value).size === value.length
  );
}

function historyRow(value: unknown, today: string, hasEntry: boolean) {
  const row = object(value, [
    ...(hasEntry ? ["entryId"] : []),
    "cashDate",
    "amountNative",
    "currency",
    "paymentMethod",
    "sourceRef",
    "sourceText",
  ]);
  if (
    (hasEntry && !isOwnerSettlementId(row.entryId)) ||
    !isAssetDate(row.cashDate) ||
    !/^20\d{2}-/.test(row.cashDate) ||
    row.cashDate > today ||
    !money(row.amountNative) ||
    row.currency !== "XOF" ||
    (row.paymentMethod !== null &&
      (typeof row.paymentMethod !== "string" ||
        !["cash", "bank_transfer", "check", "other"].includes(row.paymentMethod))) ||
    !text(row.sourceRef, 500) ||
    typeof row.sourceText !== "string" ||
    row.sourceText.trim().length < 1 ||
    row.sourceText.length > 2000
  )
    throw new Error("invalidOwnerRentHistory");
  return row as unknown as OwnerRentHistoryInput & { entryId: string };
}
function history(value: unknown, today: string, hasEntry: boolean) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new Error("invalidOwnerRentHistory");
  const rows = value.map((row) => historyRow(row, today, hasEntry));
  if (
    new Set(rows.map((row) => row.sourceRef)).size !== rows.length ||
    rows.some((row, index) => index > 0 && row.cashDate <= rows[index - 1].cashDate) ||
    (hasEntry && new Set(rows.map((row) => row.entryId)).size !== rows.length)
  )
    throw new Error("invalidOwnerRentHistory");
  return rows;
}
export function parseOwnerRentBackfillInput(value: unknown, today: string): OwnerRentBackfillInput {
  const row = object(value, [
    "assetId",
    "expectedUpdatedAt",
    "expectedEvidenceHash",
    "expectedSettlementRequestId",
    "rateSourceRef",
    "reason",
    "history",
  ]);
  if (
    !isOwnerSettlementId(row.assetId) ||
    !timestamp(row.expectedUpdatedAt) ||
    typeof row.expectedEvidenceHash !== "string" ||
    !/^[0-9a-f]{32}$/.test(row.expectedEvidenceHash) ||
    !isOwnerSettlementId(row.expectedSettlementRequestId) ||
    !text(row.rateSourceRef, 500) ||
    !text(row.reason, 2000) ||
    !isAssetDate(today)
  )
    throw new Error("invalidOwnerRentHistory");
  return {
    ...row,
    history: history(row.history, today, false),
  } as unknown as OwnerRentBackfillInput;
}
export function readOwnerRentAccount(value: unknown): OwnerRentAccount {
  const row = object(value, [
    "version",
    "requestId",
    "ownerName",
    "shareBps",
    "currency",
    "wholeMonthlyRentNative",
    "rateSourceRef",
    "chargingRule",
    "history",
    "settlementEntryIds",
    "reason",
    "recordedBy",
    "recordedAt",
  ]);
  if (
    row.version !== 1 ||
    !isOwnerSettlementId(row.requestId) ||
    !text(row.ownerName, 200) ||
    typeof row.shareBps !== "number" ||
    !Number.isInteger(row.shareBps) ||
    row.shareBps < 1 ||
    row.shareBps > 10_000 ||
    row.currency !== "XOF" ||
    !money(row.wholeMonthlyRentNative) ||
    !text(row.rateSourceRef, 500) ||
    row.chargingRule !== "full_calendar_month" ||
    !ids(row.settlementEntryIds) ||
    !text(row.reason, 2000) ||
    !isOwnerSettlementId(row.recordedBy) ||
    !timestamp(row.recordedAt)
  )
    throw new Error("invalidOwnerRentHistory");
  const rows = history(row.history, "9999-12-31", true);
  if (rows.some((entry) => (row.settlementEntryIds as string[]).includes(entry.entryId)))
    throw new Error("invalidOwnerRentHistory");
  return { ...row, history: rows } as unknown as OwnerRentAccount;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function readOwnerRentAccountRpc(
  value: unknown,
  expected: OwnerRentAccount,
  assetId: string,
): OwnerRentAccount {
  const row = object(value, ["assetId", "account", "settlementEntryIds"]);
  const account = readOwnerRentAccount(row.account);
  if (
    row.assetId !== assetId ||
    !ids(row.settlementEntryIds) ||
    stable(account) !== stable(expected) ||
    account.settlementEntryIds.some((id) => !(row.settlementEntryIds as string[]).includes(id))
  )
    throw new Error("invalidOwnerRentHistory");
  return readOwnerRentAccount({ ...account, settlementEntryIds: row.settlementEntryIds });
}
export function verifyOwnerRentBackfillResult(
  value: unknown,
  input: OwnerRentBackfillInput,
  requestId: string,
  actorId: string,
) {
  const result = object(value, ["success", "data", "idempotent"]);
  const data = object(result.data, ["assetId", "ownerRentAccount", "entryIds"]);
  const account = readOwnerRentAccount(data.ownerRentAccount);
  if (
    result.success !== true ||
    typeof result.idempotent !== "boolean" ||
    data.assetId !== input.assetId ||
    account.requestId !== requestId ||
    account.recordedBy !== actorId ||
    account.rateSourceRef !== input.rateSourceRef ||
    account.reason !== input.reason ||
    account.history.length !== input.history.length ||
    !ids(data.entryIds) ||
    data.entryIds.length !== input.history.length ||
    !account.history.every(
      (row, index) =>
        row.entryId === (data.entryIds as string[])[index] &&
        Object.entries(input.history[index]).every(
          ([key, fact]) => row[key as keyof OwnerRentHistoryInput] === fact,
        ),
    )
  )
    throw new Error("assetOperationResultUnknown");
  return { account, idempotent: result.idempotent };
}

interface ReceiptProof {
  id: string;
  assetId: string;
  kind: string;
  category?: string;
  amountNative: number;
  currency: string;
  cashDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  recognitionMethod: string;
  verification: string;
  status: string;
  sourceRef: string;
  voidedAt?: string | null;
}
function exactNumber(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(0))
    throw new Error("invalidOwnerRentHistory");
  return Number(value);
}

/** Owner cash and owner dues are separate facts. Historical receipts never offset post-anchor dues twice. */
export function summarizeOwnerRentAccount(
  account: OwnerRentAccount,
  settlement: OwnerSettlement,
  entries: readonly ReceiptProof[],
  assetId: string,
  today: string,
): OwnerRentSummary | null {
  try {
    if (
      !isAssetDate(today) ||
      account.ownerName !== settlement.ownerName ||
      account.shareBps !== settlement.shareBps ||
      account.wholeMonthlyRentNative !== settlement.monthlyRentNative ||
      !account.settlementEntryIds.includes(settlement.entryId)
    )
      return null;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const proof = (id: string) => {
      const entry = byId.get(id);
      if (
        !entry ||
        entry.assetId !== assetId ||
        entry.status !== "verified" ||
        entry.verification !== "verified" ||
        entry.voidedAt ||
        entry.kind !== "income" ||
        entry.category !== "rent" ||
        entry.currency !== "XOF" ||
        !money(entry.amountNative) ||
        !isAssetDate(entry.cashDate) ||
        entry.cashDate > today ||
        entry.periodStart !== null ||
        entry.periodEnd !== null ||
        entry.recognitionMethod !== "unallocated"
      )
        throw new Error("invalidOwnerRentHistory");
      return entry;
    };
    let cumulative = BigInt(0);
    const seen = new Set<string>();
    for (const row of account.history) {
      const entry = proof(row.entryId);
      if (
        entry.amountNative !== row.amountNative ||
        entry.cashDate !== row.cashDate ||
        entry.sourceRef !== row.sourceRef
      )
        return null;
      cumulative += BigInt(entry.amountNative);
      seen.add(entry.id);
    }
    for (const id of account.settlementEntryIds) {
      if (seen.has(id)) continue;
      const entry = proof(id);
      if (
        id === settlement.entryId &&
        (entry.amountNative !== settlement.receiptAmountNative ||
          entry.cashDate !== settlement.cashDate ||
          entry.sourceRef !== settlement.sourceRef)
      )
        return null;
      cumulative += BigInt(entry.amountNative);
      seen.add(id);
    }
    const share = BigInt(account.shareBps),
      denominator = BigInt(10_000);
    const monthly = BigInt(account.wholeMonthlyRentNative) * share;
    const credit = BigInt(settlement.wholeClosingCredit) * share;
    if (monthly % denominator !== BigInt(0) || credit % denominator !== BigInt(0)) return null;
    const ownerMonthly = monthly / denominator;
    let remainingCredit = credit / denominator;
    const initialCredit = remainingCredit;
    const cursor = new Date(`${settlement.periodEnd}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const periods: OwnerRentSummary["periods"] = [];
    let arrears = BigInt(0);
    while (cursor.toISOString().slice(0, 10) <= today) {
      const start = cursor.toISOString().slice(0, 10);
      const end = assetReportPeriod("month", start.slice(0, 7)).end;
      const applied = remainingCredit < ownerMonthly ? remainingCredit : ownerMonthly;
      remainingCredit -= applied;
      const outstanding = ownerMonthly - applied;
      arrears += outstanding;
      periods.push({
        start,
        end,
        dueNative: exactNumber(ownerMonthly),
        creditNative: exactNumber(applied),
        outstandingNative: exactNumber(outstanding),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return {
      ownerName: account.ownerName,
      shareBps: account.shareBps,
      cumulativeActualNative: exactNumber(cumulative),
      monthlyOwnerRentNative: exactNumber(ownerMonthly),
      settledThrough: settlement.periodEnd,
      dueMonthCount: periods.length,
      grossDueNative: exactNumber(ownerMonthly * BigInt(periods.length)),
      appliedCreditNative: exactNumber(initialCredit - remainingCredit),
      arrearsNative: exactNumber(arrears),
      firstUnpaidDate: periods.find((period) => period.outstandingNative > 0)?.start ?? null,
      asOf: today,
      periods,
    };
  } catch {
    return null;
  }
}
