import type { ReceiptSummary } from "./receipt-analysis-types";
import { decodeDailyCustomers } from "./customer-summary";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class CalendarContextError extends Error {
  constructor(
    message = "calendarContextUnavailable",
    public status = 503,
  ) {
    super(message);
  }
}
export function parseContextBuilding(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value))
    throw new CalendarContextError("invalidCalendarContext", 400);
  return value;
}
export interface CalendarCashSummary {
  buildingId: string;
  today: string;
  month: string;
  cash: ReceiptSummary;
  generatedAt: string;
}
export function decodeCalendarCash(
  value: unknown,
  buildingId: string,
  today: string,
): CalendarCashSummary {
  const row = value as CalendarCashSummary | null;
  const cash = row?.cash;
  if (
    !row ||
    row.buildingId !== buildingId ||
    row.today !== today ||
    row.month !== today.slice(0, 7) ||
    !cash ||
    !Number.isFinite(Date.parse(row.generatedAt)) ||
    [cash.gross, cash.refund, cash.adjustment, cash.net, cash.count, cash.excludedCount].some(
      (n) => !Number.isSafeInteger(n),
    ) ||
    cash.gross < 0 ||
    cash.refund < 0 ||
    cash.count < 0 ||
    cash.excludedCount < 0 ||
    !Number.isSafeInteger(cash.gross - cash.refund + cash.adjustment) ||
    cash.net !== cash.gross - cash.refund + cash.adjustment
  )
    throw new CalendarContextError();
  return row;
}
export function parseCustomerSearch(params: Record<string, unknown>) {
  if (Object.keys(params).some((key) => !["buildingId", "query", "page"].includes(key)))
    throw new CalendarContextError("invalidDailyCustomerQuery", 400);
  const buildingId = parseContextBuilding(params.buildingId);
  const query = typeof params.query === "string" ? params.query.trim().normalize("NFC") : "";
  const page = params.page === undefined ? 1 : Number(params.page);
  if (query.length > 80 || !Number.isSafeInteger(page) || page < 1 || page > 2000)
    throw new CalendarContextError("invalidDailyCustomerQuery", 400);
  return { buildingId, query, page };
}
export function decodeCustomerSearch(
  value: unknown,
  expected: ReturnType<typeof parseCustomerSearch>,
) {
  const row = value as {
    buildingId: string;
    query: string;
    page: number;
    hasMore: boolean;
    rows: unknown;
  } | null;
  if (
    !row ||
    row.buildingId !== expected.buildingId ||
    row.query !== expected.query ||
    row.page !== expected.page ||
    typeof row.hasMore !== "boolean"
  )
    throw new CalendarContextError();
  let rows;
  try {
    rows = decodeDailyCustomers(row.rows);
  } catch {
    throw new CalendarContextError();
  }
  if (rows.length > 50 || (row.hasMore && rows.length !== 50)) throw new CalendarContextError();
  return { ...row, rows };
}
