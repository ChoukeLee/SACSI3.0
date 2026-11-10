import type { CurrencyCode } from "@/types/domain";
import {
  isAssetDate,
  type AssetOperationAsset,
  type AssetOperationEntry,
  type AssetOperationKind,
  type AssetOperationsData,
  type AssetReportPeriod,
} from "./asset-operations-model";

export type OperatingAssetCategory =
  "warehouse" | "factory" | "commercial" | "land" | "office" | "dormitory" | "other";

export interface OperatingAssetReferenceRent {
  amountNative: number;
  currency: CurrencyCode;
  period: "month" | "quarter" | "year";
  sourceRef?: string;
  effectiveFrom?: string;
  effectiveThrough?: string;
}

interface OperatingAssetOutstanding {
  amountNative: number;
  currency: CurrencyCode;
  sourceRef: string;
}

export interface OperatingAssetTenantEvidence {
  names: readonly string[];
  displayNames?: readonly string[];
  sourceRef: string;
  classification: "latest_source" | "historical";
  scope: "asset" | "group";
  asOfSourceDate?: string;
}

export interface OperatingAssetBillingGroup {
  primarySourceKey: string;
  label: string;
  monthlyRent: OperatingAssetReferenceRent;
}

export interface OperatingAssetLeaseEvidence {
  assetSourceRef: string;
  reviewedOn?: string;
  referenceRent?: OperatingAssetReferenceRent;
  rates?: readonly OperatingAssetReferenceRent[];
  paidThrough?: { date: string; sourceRef: string };
  nextPayment?: { dueDate: string; sourceRef: string; unpaid?: boolean };
  outstanding?: OperatingAssetOutstanding;
  tenantEvidence?: OperatingAssetTenantEvidence;
  billingGroup?: OperatingAssetBillingGroup;
  leaseGroups?: readonly OperatingAssetLeaseGroup[];
  notes?: readonly string[];
  leaseListed?: boolean;
  selfUse?: boolean;
  blockReceiptCutoff?: boolean;
}

export interface OperatingAssetLeaseGroup {
  key: string;
  label: string;
  sourceRef: string;
  receiptSourceRef: string;
  receiptSourceRefs?: readonly string[];
  tenantEvidence?: OperatingAssetTenantEvidence;
  warehouseSourceKey?: string;
  paidRoomCount?: number;
  notes?: readonly string[];
  linkedWarehouse?: Pick<AssetOperationAsset, "code" | "name">;
}

export interface OperatingAssetDirectoryAsset extends AssetOperationAsset {
  category: OperatingAssetCategory;
  displayName: string;
  displayGroup: string;
  referenceRent: OperatingAssetReferenceRent | null;
  leaseEvidence: OperatingAssetLeaseEvidence | null;
  leaseGroups?: readonly OperatingAssetLeaseGroup[];
  linkedWarehouse?: OperatingAssetLeaseGroup["linkedWarehouse"];
  paidRoomCount?: number;
  searchAliases?: readonly string[];
}

type EntryWithBooking = AssetOperationEntry & { bookedAmountXof?: number | null };
export type OperatingAssetEntryStatus = "pending" | "verified" | "voided";

export interface OperatingAssetDirectoryEntry extends AssetOperationEntry {
  status: OperatingAssetEntryStatus;
  bookedAmountXof: number | null;
  billingMemberAssetId?: string;
}

export interface OperatingAssetDirectoryData extends AssetOperationsData {
  assets: OperatingAssetDirectoryAsset[];
  entries: OperatingAssetDirectoryEntry[];
}

type DirectorySnapshot = Omit<AssetOperationsData, "entries"> & {
  entries: readonly EntryWithBooking[];
};

export interface OperatingAssetDirectoryOptions {
  /** The resolved SACSI scope. Other projects may reuse source keys. */
  sacsiProjectId?: string;
  /** Source maintenance can retain supplemental records linked to a unit. */
  includeCanonical?: boolean;
  /** Apply the user's confirmation in the trial view. Maintenance uses stored status. */
  applyExcelConfirmation?: boolean;
  leaseEvidence?: Readonly<Record<string, OperatingAssetLeaseEvidence>>;
  today?: string;
}

const GUOJI_SOURCE_KEY = "warehouse:guoji";
const GUOJI_OLD_CLASSIFICATION = "用户于2026-11-09确认独立仓库";
const GUOJI_CORRECTION = "用户更正为土地";
const catalogGroupLabels = new Map([
  ["old_warehouse", "老仓库"],
  ["new_warehouse", "新仓库"],
]);
const rentCutoffWorkbookSource =
  "sha256:e3ed7762344e6e731633bd753702308c51c6a4d24559ee520065ab947d9b16c6|file:公寓、仓库租金截止日期等.xlsx|sheet:";
// The user's confirmation covers the two workbook revisions used for the SACSI intake.
const confirmedExcelSources = [
  "sha256:8e3b00f2bf83047118f3614e99cdb58b3d2d09538dcb3c602421153443e03164|file:出租公寓及仓库明细.xlsx|sheet:",
  rentCutoffWorkbookSource,
];

export function isConfirmedExcelSource(ref: string | null | undefined) {
  return !!ref && confirmedExcelSources.some((source) => ref.startsWith(source));
}

const categoryRules: readonly [OperatingAssetCategory, RegExp][] = [
  ["land", /土地|地块|地塊|用地|\b(?:land|terrain)\b/],
  ["dormitory", /宿舍|\b(?:dormitory|dorm|dortoir)\b/],
  ["office", /办公室|辦公室|办公楼|辦公樓|\b(?:office|bureau)\b/],
  ["factory", /厂房|廠房|\b(?:factory|usine)\b/],
  [
    "commercial",
    /^其他经营场地$|商业|商業|商铺|商鋪|宾馆|賓館|超市|门面|門面|\b(?:vallon|commercial|storefront|hotel)\b/,
  ],
  ["warehouse", /仓库|倉庫|库房|庫房|仓储|倉儲|\b(?:warehouse|entrep[oô]t|incubator)\b/],
];

function hintedCategory(label: string) {
  const normalized = label.normalize("NFKC").trim().toLowerCase().replace(/[_:-]/g, " ");
  return categoryRules.find(([, pattern]) => pattern.test(normalized))?.[0];
}

function isGuojiLand(asset: AssetOperationAsset, sacsiProjectId?: string) {
  return (
    !!sacsiProjectId && asset.projectId === sacsiProjectId && asset.sourceKey === GUOJI_SOURCE_KEY
  );
}

function recordedRent(
  asset: AssetOperationAsset,
  guojiLand: boolean,
  evidence: OperatingAssetLeaseEvidence | null,
  today?: string,
): OperatingAssetDirectoryAsset["referenceRent"] {
  const coversToday = (rate: OperatingAssetReferenceRent) =>
    !today ||
    ((!rate.effectiveFrom || rate.effectiveFrom <= today) &&
      (!rate.effectiveThrough || rate.effectiveThrough >= today));
  if (evidence?.referenceRent || evidence?.rates?.length) {
    return (
      evidence.rates?.find(coversToday) ??
      (evidence.referenceRent && coversToday(evidence.referenceRent)
        ? evidence.referenceRent
        : null)
    );
  }
  if (asset.monthlyRentNative !== null && asset.rentCurrency !== null) {
    return { amountNative: asset.monthlyRentNative, currency: asset.rentCurrency, period: "month" };
  }
  // B77 states the quarterly rent. F77, the monthly rent cell, is blank.
  if (guojiLand && asset.sourceRefs.includes(`${rentCutoffWorkbookSource}老仓库等|range:A77:G77`)) {
    return { amountNative: 25_000_000, currency: "XOF", period: "quarter" };
  }
  return null;
}

export function classifyOperatingAsset(
  asset: AssetOperationAsset,
  sacsiProjectId?: string,
): OperatingAssetCategory {
  if (isGuojiLand(asset, sacsiProjectId)) return "land";
  if (
    sacsiProjectId &&
    asset.projectId === sacsiProjectId &&
    asset.sourceKey === "legacy_company:office"
  )
    return "commercial";
  return (
    hintedCategory(asset.group) ??
    hintedCategory(asset.name) ??
    hintedCategory(asset.sourceKey ?? "") ??
    "other"
  );
}

const CURRENCIES: readonly CurrencyCode[] = ["XOF", "CNY", "USD"];

function minorUnits(amount: unknown): bigint | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  const minor = Math.round(amount * 100);
  if (minor <= 0 || !Number.isSafeInteger(minor) || Math.abs(minor / 100 - amount) > 0.0000001)
    return null;
  return BigInt(minor);
}

function bookedXof(entry: EntryWithBooking): number | null {
  if (!CURRENCIES.includes(entry.currency) || minorUnits(entry.amountNative) === null) return null;
  // XOF originals and their XOF booking are two views of the same amount.
  const amount = entry.currency === "XOF" ? entry.amountNative : entry.bookedAmountXof;
  return amount != null && minorUnits(amount) !== null ? amount : null;
}

function entryStatus(
  asset: AssetOperationAsset,
  entry: AssetOperationEntry,
): OperatingAssetEntryStatus {
  if (entry.voidedAt) return "voided";
  return asset.verification === "verified" && entry.verification === "verified"
    ? "verified"
    : "pending";
}

function scopedEntries(
  assets: ReadonlyMap<string, AssetOperationAsset>,
  entries: readonly EntryWithBooking[],
) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (!assets.has(entry.assetId) || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** Keep the full source history for the displayed assets. Report dates are a separate concern. */
export function buildOperatingAssetDirectory(
  snapshot: DirectorySnapshot,
  {
    includeCanonical = false,
    sacsiProjectId,
    applyExcelConfirmation = false,
    leaseEvidence,
    today,
  }: OperatingAssetDirectoryOptions = {},
): OperatingAssetDirectoryData {
  const confirmExcel = applyExcelConfirmation && snapshot.projectId === sacsiProjectId;
  const assets = snapshot.assets
    .filter(
      (asset) =>
        asset.projectId === snapshot.projectId && (includeCanonical || asset.unitId === null),
    )
    .map((asset) => {
      const guojiLand = isGuojiLand(asset, sacsiProjectId);
      const candidate =
        confirmExcel && asset.sourceKey ? leaseEvidence?.[asset.sourceKey] : undefined;
      const evidence =
        candidate && asset.sourceRefs.includes(candidate.assetSourceRef) ? candidate : null;
      return {
        ...asset,
        verification:
          confirmExcel && asset.sourceRefs.some(isConfirmedExcelSource)
            ? ("verified" as const)
            : asset.verification,
        category: classifyOperatingAsset(asset, sacsiProjectId),
        displayName: guojiLand ? "国基土地" : asset.name,
        displayGroup: guojiLand ? "土地" : (catalogGroupLabels.get(asset.group) ?? asset.group),
        referenceRent: recordedRent(asset, guojiLand, evidence, today),
        leaseEvidence: evidence,
        sourceRefs: guojiLand
          ? [
              ...new Set([
                ...asset.sourceRefs.filter((ref) => !ref.startsWith(GUOJI_OLD_CLASSIFICATION)),
                GUOJI_CORRECTION,
              ]),
            ]
          : asset.sourceRefs,
      };
    });
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const entries = scopedEntries(assetMap, snapshot.entries)
    .map((entry) => {
      const asset = assetMap.get(entry.assetId)!;
      const confirmedEntry =
        confirmExcel && !entry.voidedAt && isConfirmedExcelSource(entry.sourceRef)
          ? { ...entry, verification: "verified" as const }
          : entry;
      return {
        ...confirmedEntry,
        status: entryStatus(asset, confirmedEntry),
        bookedAmountXof: bookedXof(entry),
        description: isGuojiLand(asset, sacsiProjectId)
          ? entry.description.replace(/^原表为国基仓库租金。/, "国基土地租金。")
          : entry.description,
      };
    })
    .sort((a, b) => (b.cashDate ?? "").localeCompare(a.cashDate ?? "") || a.id.localeCompare(b.id));
  return { projectId: snapshot.projectId, assets, entries, canWrite: snapshot.canWrite };
}

type RentCoverage = { date: string; sourceRef: string; status: "verified" | "pending" };

export interface OperatingAssetFollowUp {
  paidThrough: RentCoverage | null;
  dueDate: string | null;
  dueSourceRef: string | null;
  outstanding: OperatingAssetOutstanding | null;
  status: "overdue" | "upcoming" | "needs_evidence" | "current";
  reason:
    | "due_date_missing"
    | "paid_through_missing"
    | "unpaid_unconfirmed"
    | "coverage_ended"
    | "coverage_ending"
    | "source_conflict"
    | null;
  daysUntilDue: number | null;
}

export function hasOperatingAssetLeaseEvidence(
  asset: OperatingAssetDirectoryAsset,
  entries: readonly OperatingAssetDirectoryEntry[],
) {
  const evidence = asset.leaseEvidence;
  return (
    !evidence?.selfUse &&
    (!!(
      evidence?.leaseListed ||
      evidence?.paidThrough ||
      evidence?.nextPayment ||
      evidence?.outstanding
    ) ||
      entries.some(
        (entry) =>
          entry.assetId === asset.id &&
          entry.status !== "voided" &&
          entry.kind === "income" &&
          entry.category === "rent",
      ))
  );
}

function rentCoverage(
  asset: OperatingAssetDirectoryAsset,
  entries: readonly OperatingAssetDirectoryEntry[],
  today: string,
): RentCoverage | null {
  const evidence = asset.leaseEvidence;
  const reviewedCutoff = evidence?.paidThrough;
  let latest: RentCoverage | null =
    reviewedCutoff && isAssetDate(reviewedCutoff.date)
      ? { ...reviewedCutoff, status: "verified" }
      : null;
  const restrictFallback = latest !== null || evidence?.blockReceiptCutoff === true;
  for (const entry of entries) {
    if (
      entry.assetId !== asset.id ||
      entry.billingMemberAssetId ||
      entry.status === "voided" ||
      entry.kind !== "income" ||
      entry.category !== "rent" ||
      !isAssetDate(entry.periodEnd) ||
      !isAssetDate(entry.cashDate) ||
      entry.cashDate > today ||
      (restrictFallback && (!evidence?.reviewedOn || entry.cashDate <= evidence.reviewedOn))
    )
      continue;
    if (
      !latest ||
      (latest.status === "pending" && entry.status === "verified") ||
      (entry.status === latest.status && entry.periodEnd > latest.date)
    ) {
      latest = { date: entry.periodEnd, sourceRef: entry.sourceRef, status: entry.status };
    }
  }
  return latest;
}

function daysBetween(from: string, to: string) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export function getOperatingAssetFollowUp(
  asset: OperatingAssetDirectoryAsset,
  entries: readonly OperatingAssetDirectoryEntry[],
  today: string,
): OperatingAssetFollowUp {
  const evidence = asset.leaseEvidence;
  const paidThrough = rentCoverage(asset, entries, today);
  const nextPayment = evidence?.nextPayment;
  const dueDate = isAssetDate(nextPayment?.dueDate) ? nextPayment.dueDate : null;
  const outstanding = evidence?.outstanding ?? null;
  const daysUntilDue = dueDate ? daysBetween(today, dueDate) : null;
  const facts = {
    paidThrough,
    dueDate,
    dueSourceRef: dueDate ? (nextPayment?.sourceRef ?? null) : null,
    outstanding,
    daysUntilDue,
  };
  const needsEvidence = (
    reason: NonNullable<OperatingAssetFollowUp["reason"]>,
  ): OperatingAssetFollowUp => ({ ...facts, status: "needs_evidence", reason });

  if (evidence?.selfUse) return { ...facts, status: "current", reason: null };
  if (dueDate && daysUntilDue !== null && nextPayment?.unpaid === true) {
    if (paidThrough?.status === "verified" && paidThrough.date >= dueDate) {
      return needsEvidence("source_conflict");
    }
    if (daysUntilDue < 0) return { ...facts, status: "overdue", reason: null };
    if (daysUntilDue <= 15) return { ...facts, status: "upcoming", reason: null };
  }
  if (outstanding && !dueDate) return needsEvidence("due_date_missing");
  if (daysUntilDue !== null && daysUntilDue <= 15 && nextPayment?.unpaid !== true) {
    return needsEvidence("unpaid_unconfirmed");
  }
  if (!paidThrough || paidThrough.status !== "verified")
    return needsEvidence("paid_through_missing");
  const coverageDays = daysBetween(today, paidThrough.date);
  if (!dueDate && coverageDays < 0) return needsEvidence("coverage_ended");
  if (!dueDate && coverageDays <= 15) return needsEvidence("coverage_ending");
  return { ...facts, status: "current", reason: null };
}

export interface OperatingAssetCashAmounts {
  income: number;
  expense: number;
  net: number;
  depositIn: number;
  depositOut: number;
  entryCount: number;
}

export interface OperatingAssetCashSummary {
  originals: (OperatingAssetCashAmounts & { currency: CurrencyCode })[];
  bookedXof: OperatingAssetCashAmounts | null;
  missingBookedXofCount: number;
  verifiedEntryCount: number;
  pendingEntryCount: number;
  voidedEntryCount: number;
  undatedEntryCount: number;
  invalidEntryCount: number;
}

const cashField = {
  income: "income",
  expense: "expense",
  deposit_in: "depositIn",
  deposit_out: "depositOut",
} as const satisfies Record<AssetOperationKind, string>;

function emptyCashTotals() {
  return {
    income: BigInt(0),
    expense: BigInt(0),
    depositIn: BigInt(0),
    depositOut: BigInt(0),
    entryCount: 0,
  };
}

type CashTotals = ReturnType<typeof emptyCashTotals>;

function cashAmounts(totals: CashTotals): OperatingAssetCashAmounts {
  const money = (minor: bigint) => {
    const value = Number(minor);
    if (!Number.isSafeInteger(value)) throw new Error("OperatingAssetCashOutOfRange");
    return value / 100;
  };
  return {
    income: money(totals.income),
    expense: money(totals.expense),
    net: money(totals.income - totals.expense),
    depositIn: money(totals.depositIn),
    depositOut: money(totals.depositOut),
    entryCount: totals.entryCount,
  };
}

/** Cash summaries use the actual receipt date and keep booked XOF separate from originals. */
export function summarizeOperatingAssetCash(
  assets: readonly AssetOperationAsset[],
  entries: readonly EntryWithBooking[],
  period?: Pick<AssetReportPeriod, "start" | "end">,
): OperatingAssetCashSummary {
  if (
    period &&
    (!isAssetDate(period.start) || !isAssetDate(period.end) || period.end < period.start)
  )
    throw new Error("InvalidOperatingAssetCashPeriod");

  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const originals = new Map<CurrencyCode, CashTotals>();
  const booked = emptyCashTotals();
  let pendingEntryCount = 0;
  let voidedEntryCount = 0;
  let undatedEntryCount = 0;
  let invalidEntryCount = 0;
  let verifiedEntryCount = 0;
  let missingBookedXofCount = 0;
  for (const entry of scopedEntries(assetMap, entries)) {
    if (!isAssetDate(entry.cashDate)) {
      undatedEntryCount++;
      continue;
    }
    if (period && (entry.cashDate < period.start || entry.cashDate > period.end)) continue;
    const status = entryStatus(assetMap.get(entry.assetId)!, entry);
    if (status === "voided") {
      voidedEntryCount++;
      continue;
    }
    if (status === "pending") {
      pendingEntryCount++;
      continue;
    }
    const amount = minorUnits(entry.amountNative);
    if (
      amount === null ||
      !CURRENCIES.includes(entry.currency) ||
      !Object.hasOwn(cashField, entry.kind) ||
      !entry.sourceRef?.trim()
    ) {
      invalidEntryCount++;
      continue;
    }
    const field = cashField[entry.kind];
    const original = originals.get(entry.currency) ?? emptyCashTotals();
    original[field] += amount;
    original.entryCount++;
    originals.set(entry.currency, original);
    verifiedEntryCount++;

    const bookedAmount = minorUnits(bookedXof(entry));
    if (bookedAmount === null) {
      missingBookedXofCount++;
      continue;
    }
    booked[field] += bookedAmount;
    booked.entryCount++;
  }
  return {
    originals: CURRENCIES.flatMap((currency) => {
      const totals = originals.get(currency);
      return totals ? [{ currency, ...cashAmounts(totals) }] : [];
    }),
    bookedXof: booked.entryCount ? cashAmounts(booked) : null,
    missingBookedXofCount,
    verifiedEntryCount,
    pendingEntryCount,
    voidedEntryCount,
    undatedEntryCount,
    invalidEntryCount,
  };
}
