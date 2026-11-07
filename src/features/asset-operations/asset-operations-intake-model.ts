import type { CurrencyCode } from "@/types/domain";
import {
  isAssetDate,
  type AssetOperationCategory,
  type AssetOperationKind,
} from "./asset-operations-model";

export interface AssetEntryImportDraft {
  requestId?: string;
  assetId?: string;
  assetSourceKey?: string;
  kind: AssetOperationKind;
  category?: AssetOperationCategory;
  amountNative: number;
  currency: CurrencyCode;
  cashDate: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  sourceRef: string;
  description?: string;
}

export interface AssetEntryImportManifest {
  requestId?: string;
  projectId: string;
  sourceFingerprint: string;
  entries: AssetEntryImportDraft[];
  terms: AssetTermsImportDraft[];
}

export interface AssetTermsImportDraft {
  requestId?: string;
  assetId?: string;
  assetSourceKey?: string;
  expectedUpdatedAt: string;
  monthlyRentNative: number | null;
  rentCurrency: CurrencyCode | null;
  reason: string;
}

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const kinds = ["income", "expense", "deposit_in", "deposit_out"];
const categories = [
  "rent",
  "property_fee",
  "maintenance",
  "utilities",
  "cleaning",
  "security",
  "payroll",
  "tax",
  "commission",
  "insurance",
  "other",
  "deposit",
];

/** Accept facts only; verification and allocation are forced by the server. */
export function parseAssetEntryImport(value: unknown, projectId: string): AssetEntryImportManifest {
  if (!value || typeof value !== "object") throw new Error("InvalidManifest");
  const manifest = value as Record<string, unknown>;
  if (
    manifest.requestId !== undefined &&
    (typeof manifest.requestId !== "string" || !uuid.test(manifest.requestId))
  )
    throw new Error("InvalidRequestId");
  const rawEntries = manifest.entries ?? [];
  const rawTerms = manifest.terms ?? [];
  if (
    manifest.projectId !== projectId ||
    typeof manifest.sourceFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/i.test(manifest.sourceFingerprint) ||
    !Array.isArray(rawEntries) ||
    !Array.isArray(rawTerms) ||
    (!rawEntries.length && !rawTerms.length) ||
    rawEntries.length > 100 ||
    rawTerms.length > 100
  )
    throw new Error("InvalidManifest");
  const entries = rawEntries.map((value: unknown): AssetEntryImportDraft => {
    if (!value || typeof value !== "object") throw new Error("InvalidEntry");
    const row = value as Record<string, unknown>;
    const id = typeof row.assetId === "string" && uuid.test(row.assetId) ? row.assetId : undefined;
    const key =
      typeof row.assetSourceKey === "string" && row.assetSourceKey.trim()
        ? row.assetSourceKey.trim()
        : undefined;
    if (
      (!id && !key) ||
      !kinds.includes(String(row.kind)) ||
      typeof row.amountNative !== "number" ||
      !Number.isFinite(row.amountNative) ||
      row.amountNative <= 0 ||
      !Number.isSafeInteger(Math.round(row.amountNative * 100)) ||
      Math.abs(Math.round(row.amountNative * 100) / 100 - row.amountNative) > 0.0000001 ||
      !["XOF", "CNY", "USD"].includes(String(row.currency)) ||
      !isAssetDate(row.cashDate) ||
      typeof row.sourceRef !== "string" ||
      !row.sourceRef.trim() ||
      row.sourceRef.length > 500
    )
      throw new Error("InvalidEntry");
    if (
      row.requestId !== undefined &&
      (typeof row.requestId !== "string" || !uuid.test(row.requestId))
    )
      throw new Error("InvalidRequestId");
    if (row.category !== undefined && !categories.includes(String(row.category)))
      throw new Error("InvalidCategory");
    const starts =
      row.periodStart === undefined || row.periodStart === null || row.periodStart === ""
        ? null
        : row.periodStart;
    const ends =
      row.periodEnd === undefined || row.periodEnd === null || row.periodEnd === ""
        ? null
        : row.periodEnd;
    if (
      (starts !== null || ends !== null) &&
      (!isAssetDate(starts) || !isAssetDate(ends) || ends < starts)
    )
      throw new Error("InvalidPeriod");
    if (
      row.description !== undefined &&
      (typeof row.description !== "string" || row.description.length > 1000)
    )
      throw new Error("InvalidDescription");
    if (row.paymentId || row.ledgerEntryId) throw new Error("CanonicalLinkNotAllowed");
    return {
      ...(typeof row.requestId === "string" ? { requestId: row.requestId } : {}),
      ...(id ? { assetId: id } : {}),
      ...(key ? { assetSourceKey: key } : {}),
      kind: row.kind as AssetOperationKind,
      ...(row.category ? { category: row.category as AssetOperationCategory } : {}),
      amountNative: row.amountNative,
      currency: row.currency as CurrencyCode,
      cashDate: row.cashDate,
      periodStart: starts as string | null,
      periodEnd: ends as string | null,
      sourceRef: row.sourceRef.trim(),
      description: typeof row.description === "string" ? row.description : "",
    };
  });
  const terms = rawTerms.map((value: unknown): AssetTermsImportDraft => {
    if (!value || typeof value !== "object") throw new Error("InvalidTerms");
    const row = value as Record<string, unknown>;
    const id = typeof row.assetId === "string" && uuid.test(row.assetId) ? row.assetId : undefined;
    const key =
      typeof row.assetSourceKey === "string" && row.assetSourceKey.trim()
        ? row.assetSourceKey.trim()
        : undefined;
    if (
      (!id && !key) ||
      typeof row.expectedUpdatedAt !== "string" ||
      !Number.isFinite(Date.parse(row.expectedUpdatedAt)) ||
      typeof row.reason !== "string" ||
      !row.reason.trim() ||
      row.reason.length > 500
    )
      throw new Error("InvalidTerms");
    if (
      row.requestId !== undefined &&
      (typeof row.requestId !== "string" || !uuid.test(row.requestId))
    )
      throw new Error("InvalidRequestId");
    if (
      row.monthlyRentNative !== null &&
      (typeof row.monthlyRentNative !== "number" ||
        !Number.isFinite(row.monthlyRentNative) ||
        row.monthlyRentNative <= 0 ||
        !Number.isSafeInteger(Math.round(row.monthlyRentNative * 100)) ||
        Math.abs(Math.round(row.monthlyRentNative * 100) / 100 - row.monthlyRentNative) >
          0.0000001 ||
        !["XOF", "CNY", "USD"].includes(String(row.rentCurrency)))
    )
      throw new Error("InvalidTermsMoney");
    if (row.monthlyRentNative === null && row.rentCurrency !== null)
      throw new Error("InvalidTermsMoney");
    return {
      ...(typeof row.requestId === "string" ? { requestId: row.requestId } : {}),
      ...(id ? { assetId: id } : {}),
      ...(key ? { assetSourceKey: key } : {}),
      expectedUpdatedAt: row.expectedUpdatedAt,
      monthlyRentNative: row.monthlyRentNative as number | null,
      rentCurrency: row.rentCurrency as CurrencyCode | null,
      reason: row.reason.trim(),
    };
  });
  return {
    ...(typeof manifest.requestId === "string" ? { requestId: manifest.requestId } : {}),
    projectId,
    sourceFingerprint: manifest.sourceFingerprint.toLowerCase(),
    entries,
    terms,
  };
}

export function summarizeAssetEntryImport(manifest: AssetEntryImportManifest) {
  const grouped = new Map<
    string,
    { currency: CurrencyCode; kind: AssetOperationKind; amount: number; count: number }
  >();
  for (const entry of manifest.entries) {
    const key = `${entry.currency}:${entry.kind}`;
    const group = grouped.get(key) ?? {
      currency: entry.currency,
      kind: entry.kind,
      amount: 0,
      count: 0,
    };
    group.amount = (Math.round(group.amount * 100) + Math.round(entry.amountNative * 100)) / 100;
    group.count += 1;
    grouped.set(key, group);
  }
  const dates = manifest.entries.map((entry) => entry.cashDate).sort();
  return {
    start: dates[0] ?? null,
    end: dates.at(-1) ?? null,
    termCount: manifest.terms.length,
    totals: Array.from(grouped.values()).sort(
      (a, b) => a.currency.localeCompare(b.currency) || a.kind.localeCompare(b.kind),
    ),
  };
}
