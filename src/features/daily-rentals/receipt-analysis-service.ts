import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReceiptReadResult, ReceiptSummary } from "./receipt-analysis-types";
import { composeReceiptAnalysis, parseReceiptQuery } from "./receipt-analysis-query";

export class ReceiptReadError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
  ) {
    super(message);
  }
}
const unavailable = () => new ReceiptReadError("receiptHistoryUnavailable");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}
function numeric(value: unknown, integer = true) {
  if (typeof value !== "number" && !(typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)))
    throw unavailable();
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    Math.abs(number) > Number.MAX_SAFE_INTEGER ||
    (integer && !Number.isSafeInteger(number))
  )
    throw unavailable();
  return number;
}
function summary(value: unknown): ReceiptSummary {
  const row = record(value);
  const result = {
    gross: numeric(row.gross),
    refund: numeric(row.refund),
    adjustment: numeric(row.adjustment),
    net: numeric(row.net),
    count: numeric(row.count),
    excludedCount: numeric(row.excludedCount),
  };
  if (
    result.gross < 0 ||
    result.refund < 0 ||
    result.count < 0 ||
    result.excludedCount < 0 ||
    !Number.isSafeInteger(result.gross - result.refund + result.adjustment) ||
    result.net !== result.gross - result.refund + result.adjustment
  )
    throw unavailable();
  return result;
}
function text(value: unknown, nullable = true): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string") throw unavailable();
  return value;
}
function dateText(value: unknown, nullable = false) {
  const result = text(value, nullable);
  if (
    result !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(result) ||
      !Number.isFinite(Date.parse(`${result}T00:00:00Z`)) ||
      new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result)
  )
    throw unavailable();
  return result;
}
export function decodeReceiptRead(value: unknown): ReceiptReadResult {
  const result = record(value);
  if (
    !Array.isArray(result.rows) ||
    !Array.isArray(result.trend) ||
    !Array.isArray(result.buildings)
  )
    throw unavailable();
  const total = numeric(result.total),
    totals = summary(result.summary);
  if (total < 0 || totals.count + totals.excludedCount !== total) throw unavailable();
  const coverage = record(result.coverage);
  const firstDate = dateText(coverage.firstDate, true),
    lastDate = dateText(coverage.lastDate, true);
  if (
    (firstDate === null) !== (lastDate === null) ||
    (firstDate && lastDate && firstDate > lastDate)
  )
    throw unavailable();
  const rows = result.rows.map((value) => {
    const row = record(value);
    if (!["collection", "refund", "reversal", "excluded"].includes(String(row.kind)))
      throw unavailable();
    const kind = row.kind as ReceiptReadResult["rows"][number]["kind"];
    const amount = row.amount === null ? null : numeric(row.amount, false);
    const amountXof = row.amountXof === null ? null : numeric(row.amountXof);
    if (
      (kind === "excluded") !== (amountXof === null) ||
      (kind !== "excluded" && (amount === null || amount !== amountXof)) ||
      (kind === "collection" && amountXof! <= 0) ||
      (["refund", "reversal"].includes(kind) && amountXof! >= 0)
    )
      throw unavailable();
    return {
      id: text(row.id, false)!,
      date: dateText(row.date)!,
      createdAt: text(row.createdAt, false)!,
      bookingId: text(row.bookingId),
      unitId: text(row.unitId),
      room: text(row.room),
      buildingId: text(row.buildingId),
      buildingName: text(row.buildingName),
      guestName: text(row.guestName),
      bookingAgentName: text(row.bookingAgentName),
      receiptNo: text(row.receiptNo),
      paymentMethod: text(row.paymentMethod),
      amount,
      currency: text(row.currency, false)!,
      amountXof,
      kind,
      exclusionReason: text(row.exclusionReason),
      reversalOf: text(row.reversalOf),
      notes: text(row.notes),
    };
  });
  if (rows.length > total) throw unavailable();
  const generatedAt = text(result.generatedAt, false)!;
  if (!Number.isFinite(Date.parse(generatedAt))) throw unavailable();
  return {
    rows,
    total,
    summary: totals,
    previous: summary(result.previous),
    year: summary(result.year),
    trend: result.trend.map((value) => {
      const row = record(value);
      if (typeof row.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month))
        throw unavailable();
      return { ...summary(row), month: row.month };
    }),
    coverage: { firstDate, lastDate },
    buildings: result.buildings.map((value) => {
      const row = record(value);
      return {
        id: text(row.id, false)!,
        code: text(row.code, false)!,
        name: text(row.name, false)!,
      };
    }),
    generatedAt,
  };
}
export async function readReceiptAnalysis(
  client: Pick<SupabaseClient, "rpc">,
  query: ReturnType<typeof parseReceiptQuery>,
) {
  const { data, error } = await client.rpc("daily_receipts_read_rpc", {
    p_input: query.input,
    p_page: query.exporting ? 1 : query.filters.page,
    p_export: query.exporting,
  });
  if (error) {
    if (error.code === "42501") throw new ReceiptReadError("receiptPermissionDenied", 403);
    if (error.message === "dailyReceiptsExportTooLarge")
      throw new ReceiptReadError("receiptExportTooLarge", 413);
    if (["invalidDailyReceiptsFilter", "invalidDailyReceiptsDateRange"].includes(error.message))
      throw new ReceiptReadError("invalidReceiptFilter", 400);
    throw unavailable();
  }
  const result = decodeReceiptRead(data);
  if (
    (!query.exporting && result.rows.length > 50) ||
    (query.exporting && result.rows.length !== result.total)
  )
    throw unavailable();
  return composeReceiptAnalysis(result, query);
}
