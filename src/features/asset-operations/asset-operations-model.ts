import type { CurrencyCode } from "@/types/domain";

export interface AssetOperationAsset {
  id: string;
  projectId: string;
  unitId: string | null;
  sourceKey?: string;
  code: string;
  name: string;
  group: string;
  verification: "pending" | "verified";
  sourceRefs: string[];
  monthlyRentNative: number | null;
  rentCurrency: CurrencyCode | null;
  costCoverageThrough: string | null;
  updatedAt: string;
}

export type AssetOperationKind = "income" | "expense" | "deposit_in" | "deposit_out";
export type AssetOperationCategory =
  | "rent"
  | "property_fee"
  | "maintenance"
  | "utilities"
  | "cleaning"
  | "security"
  | "payroll"
  | "tax"
  | "commission"
  | "insurance"
  | "other"
  | "deposit";

export interface AssetOperationEntry {
  id: string;
  assetId: string;
  kind: AssetOperationKind;
  category?: AssetOperationCategory;
  amountNative: number;
  currency: CurrencyCode;
  cashDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  recognitionMethod: "unallocated" | "daily";
  verification: "pending" | "verified";
  sourceRef: string;
  description: string;
  updatedAt?: string;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface AssetOperationsData {
  projectId: string;
  assets: AssetOperationAsset[];
  entries: AssetOperationEntry[];
  canWrite: boolean;
}

export interface AssetReportPeriod {
  mode: "week" | "month" | "custom";
  anchor: string;
  start: string;
  end: string;
}

export interface AssetCurrencySummary {
  currency: CurrencyCode;
  cashIncome: number;
  cashExpense: number;
  cashNet: number;
  depositIn: number;
  depositOut: number;
  periodIncome: number;
  periodExpense: number;
  periodNet: number;
  cashFactCount: number;
  serviceFactCount: number;
}

export interface AssetOperationsReport {
  period: AssetReportPeriod;
  currencies: AssetCurrencySummary[];
  pendingCurrencies: AssetPendingCurrencySummary[];
  pendingEntryCount: number;
  pendingAssetCount: number;
  unallocatedServiceCount: number;
  undatedEntryCount: number;
  voidedEntryCount: number;
  exclusions: { entryId: string; reason: string }[];
  entries: AssetOperationEntry[];
}

export interface AssetPendingCurrencySummary {
  currency: CurrencyCode;
  income: number;
  expense: number;
  depositIn: number;
  depositOut: number;
  entryCount: number;
}

const DAY = 86_400_000;
const currencies: CurrencyCode[] = ["XOF", "CNY", "USD"];

export function isAssetDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function dayNumber(date: string) {
  return Date.parse(`${date}T00:00:00Z`) / DAY;
}

function isoDay(day: number) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

export function assetReportPeriod(
  mode: AssetReportPeriod["mode"],
  anchor: string,
  end?: string,
): AssetReportPeriod {
  if (mode === "month") {
    if (!/^\d{4}-\d{2}$/.test(anchor) || !isAssetDate(`${anchor}-01`))
      throw new Error("InvalidMonth");
    const first = new Date(`${anchor}-01T00:00:00Z`);
    const last = new Date(first);
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    return { mode, anchor, start: `${anchor}-01`, end: last.toISOString().slice(0, 10) };
  }
  if (!isAssetDate(anchor)) throw new Error("InvalidStartDate");
  if (mode === "custom") {
    if (!isAssetDate(end) || end < anchor) throw new Error("InvalidEndDate");
    return { mode, anchor, start: anchor, end };
  }
  const day = dayNumber(anchor);
  const weekday = new Date(`${anchor}T00:00:00Z`).getUTCDay();
  const monday = day - ((weekday + 6) % 7);
  return { mode, anchor, start: isoDay(monday), end: isoDay(monday + 6) };
}

function minorUnits(amount: number, currency: CurrencyCode): bigint | null {
  if (!Number.isFinite(amount) || amount <= 0 || !currencies.includes(currency)) return null;
  const scale = 100;
  const minor = Math.round(amount * scale);
  if (!Number.isSafeInteger(minor) || Math.abs(minor / scale - amount) > 0.0000001) return null;
  return BigInt(minor);
}

function fromMinor(amount: bigint) {
  return Number(amount) / 100;
}

/** Allocate an inclusive service period by calendar day, conserving each minor unit. */
export function allocateAssetPeriodAmount(
  amount: number,
  currency: CurrencyCode,
  serviceStart: string,
  serviceEnd: string,
  reportStart: string,
  reportEnd: string,
) {
  const minor = minorUnits(amount, currency);
  if (
    minor === null ||
    ![serviceStart, serviceEnd, reportStart, reportEnd].every(isAssetDate) ||
    serviceEnd < serviceStart ||
    reportEnd < reportStart
  )
    throw new Error("InvalidAllocationInput");
  const start = Math.max(dayNumber(serviceStart), dayNumber(reportStart));
  const end = Math.min(dayNumber(serviceEnd), dayNumber(reportEnd));
  if (end < start) return 0;
  const origin = dayNumber(serviceStart);
  const days = BigInt(dayNumber(serviceEnd) - origin + 1);
  // Difference of cumulative allocations keeps adjacent week/month reports exact.
  const allocated =
    (minor * BigInt(end - origin + 1)) / days - (minor * BigInt(start - origin)) / days;
  return fromMinor(allocated);
}

function emptySummary(currency: CurrencyCode): AssetCurrencySummary {
  return {
    currency,
    cashIncome: 0,
    cashExpense: 0,
    cashNet: 0,
    depositIn: 0,
    depositOut: 0,
    periodIncome: 0,
    periodExpense: 0,
    periodNet: 0,
    cashFactCount: 0,
    serviceFactCount: 0,
  };
}

function addMoney(left: number, right: number) {
  const scale = 100;
  return (Math.round(left * scale) + Math.round(right * scale)) / scale;
}

export function buildAssetOperationsReport(
  assets: AssetOperationAsset[],
  entries: AssetOperationEntry[],
  period: AssetReportPeriod,
): AssetOperationsReport {
  if (!isAssetDate(period.start) || !isAssetDate(period.end) || period.end < period.start)
    throw new Error("InvalidReportPeriod");
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const summaries = new Map<CurrencyCode, AssetCurrencySummary>();
  const pendingSummaries = new Map<CurrencyCode, AssetPendingCurrencySummary>();
  const report: AssetOperationsReport = {
    period,
    currencies: [],
    pendingCurrencies: [],
    pendingEntryCount: 0,
    pendingAssetCount: assets.filter((asset) => asset.verification !== "verified").length,
    unallocatedServiceCount: 0,
    undatedEntryCount: 0,
    voidedEntryCount: 0,
    exclusions: [],
    entries: [],
  };
  const seen = new Set<string>();
  for (const entry of entries) {
    const asset = assetMap.get(entry.assetId);
    if (!asset) continue;
    if (seen.has(entry.id)) {
      report.exclusions.push({ entryId: entry.id, reason: "DuplicateEntryId" });
      continue;
    }
    seen.add(entry.id);
    if (
      !currencies.includes(entry.currency) ||
      minorUnits(entry.amountNative, entry.currency) === null
    ) {
      report.exclusions.push({ entryId: entry.id, reason: "InvalidMoney" });
      continue;
    }
    if (
      !["income", "expense", "deposit_in", "deposit_out"].includes(entry.kind) ||
      !entry.sourceRef.trim()
    ) {
      report.exclusions.push({ entryId: entry.id, reason: "MissingClassificationOrSource" });
      continue;
    }
    const cashValid = isAssetDate(entry.cashDate);
    const serviceValid =
      isAssetDate(entry.periodStart) &&
      isAssetDate(entry.periodEnd) &&
      entry.periodEnd >= entry.periodStart;
    const hasInvalidDate =
      (entry.cashDate !== null && !cashValid) ||
      ((entry.periodStart !== null || entry.periodEnd !== null) && !serviceValid);
    if (hasInvalidDate) {
      report.exclusions.push({ entryId: entry.id, reason: "InvalidDates" });
      continue;
    }
    const cashInPeriod =
      cashValid && entry.cashDate! >= period.start && entry.cashDate! <= period.end;
    const serviceInPeriod =
      serviceValid && entry.periodStart! <= period.end && entry.periodEnd! >= period.start;
    if (!cashValid && !serviceValid) {
      report.undatedEntryCount += 1;
      continue;
    }
    if (!cashInPeriod && !serviceInPeriod) continue;
    report.entries.push(entry);
    if (entry.voidedAt) {
      report.voidedEntryCount += 1;
      report.exclusions.push({ entryId: entry.id, reason: "VoidedEntry" });
      continue;
    }
    if (entry.verification !== "verified" || asset.verification !== "verified") {
      report.pendingEntryCount += 1;
      if (cashInPeriod) {
        const pending = pendingSummaries.get(entry.currency) ?? {
          currency: entry.currency,
          income: 0,
          expense: 0,
          depositIn: 0,
          depositOut: 0,
          entryCount: 0,
        };
        const target = {
          income: "income",
          expense: "expense",
          deposit_in: "depositIn",
          deposit_out: "depositOut",
        }[entry.kind] as "income" | "expense" | "depositIn" | "depositOut";
        pending[target] = addMoney(pending[target], entry.amountNative);
        pending.entryCount += 1;
        pendingSummaries.set(entry.currency, pending);
      }
      continue;
    }
    const summary = summaries.get(entry.currency) ?? emptySummary(entry.currency);
    summaries.set(entry.currency, summary);
    if (cashInPeriod) {
      const target = {
        income: "cashIncome",
        expense: "cashExpense",
        deposit_in: "depositIn",
        deposit_out: "depositOut",
      }[entry.kind] as "cashIncome" | "cashExpense" | "depositIn" | "depositOut";
      summary[target] = addMoney(summary[target], entry.amountNative);
      summary.cashFactCount += 1;
    }
    if (entry.kind === "income" || entry.kind === "expense") {
      if (serviceInPeriod && entry.recognitionMethod === "daily") {
        const allocated = allocateAssetPeriodAmount(
          entry.amountNative,
          entry.currency,
          entry.periodStart!,
          entry.periodEnd!,
          period.start,
          period.end,
        );
        const target = entry.kind === "income" ? "periodIncome" : "periodExpense";
        summary[target] = addMoney(summary[target], allocated);
        summary.serviceFactCount += 1;
      } else if (!serviceValid || entry.recognitionMethod !== "daily") {
        report.unallocatedServiceCount += 1;
      }
    }
  }
  report.currencies = currencies.flatMap((currency) => {
    const summary = summaries.get(currency);
    if (!summary) return [];
    summary.cashNet = addMoney(summary.cashIncome, -summary.cashExpense);
    summary.periodNet = addMoney(summary.periodIncome, -summary.periodExpense);
    return [summary];
  });
  report.pendingCurrencies = currencies.flatMap((currency) => {
    const summary = pendingSummaries.get(currency);
    return summary ? [summary] : [];
  });
  report.entries.sort(
    (a, b) =>
      (b.cashDate ?? b.periodStart ?? "").localeCompare(a.cashDate ?? a.periodStart ?? "") ||
      a.id.localeCompare(b.id),
  );
  return report;
}

export function assetSourceLabel(source: string) {
  const fields = new Map(
    source.split("|").map((part) => {
      const colon = part.indexOf(":");
      return colon < 0 ? [part, ""] : [part.slice(0, colon), part.slice(colon + 1)];
    }),
  );
  const file = fields.get("file");
  const sheet = fields.get("sheet");
  const range = fields.get("range") ?? fields.get("cell");
  return file && sheet ? `${file} · ${sheet}${range ? `!${range}` : ""}` : source;
}

/** Avoid formula execution if a source label is opened in Excel. */
export function assetCsvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function assetOperationsCsv(headers: string[], rows: (string | number | null)[][]) {
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(assetCsvCell).join(",")).join("\r\n");
}
