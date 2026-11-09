import { assetSourceLabel } from "@/features/asset-operations/asset-operations-model";
import {
  getOperatingAssetFollowUp,
  hasOperatingAssetLeaseEvidence,
  type OperatingAssetDirectoryData,
  type OperatingAssetDirectoryEntry,
} from "@/features/asset-operations/operating-asset-directory-model";
import {
  followUpLabels,
  followUpReasons,
  operatingAssetCategoryLabel,
  recordedTenant,
} from "@/features/asset-operations/operating-asset-display";
import { routeFor, type Locale } from "@/lib/i18n";
import { formatPropertyMoney } from "@/lib/property-money";
import { buildWorkbenchRecordHref } from "@/lib/workbench-links";
import type { LeaseRecordOverviewRow } from "./lease-room-overview-model";

export const collectionCategories = [
  "apartment",
  "warehouse",
  "factory",
  "commercial",
  "land",
  "office",
  "dormitory",
  "other",
] as const;

type RecordCategory = (typeof collectionCategories)[number];
export type CollectionCategory = "all" | RecordCategory;
export type CollectionStatus = Exclude<keyof typeof followUpLabels, "all"> | "unsettled";

export interface UnifiedLeaseCollectionRow {
  id: string;
  category: RecordCategory;
  name: string;
  group: string;
  tenant?: string;
  keywords: readonly string[];
  href: string;
  status: CollectionStatus;
  reason?: string;
  dueDate: string | null;
  dueSource?: string;
  paidThrough: string | null;
  paidThroughSource?: string;
  coveragePending?: boolean;
  amount: string | null;
  amountLabel: string;
  amountSource?: string;
}

export function parseCollectionCategory(value: unknown): CollectionCategory {
  return collectionCategories.find((category) => category === value) ?? "all";
}

export function collectionCategoryLabel(category: CollectionCategory, locale: Locale) {
  if (category === "all") return locale === "zh" ? "全部类别" : "Toutes les catégories";
  if (category === "apartment") return locale === "zh" ? "公寓" : "Appartements";
  return operatingAssetCategoryLabel(category, locale);
}

export const collectionStatusLabels: Record<CollectionStatus | "all", [string, string]> = {
  all: followUpLabels.all,
  overdue: followUpLabels.overdue,
  upcoming: followUpLabels.upcoming,
  unsettled: ["历史待结清", "Ancien solde à régler"],
  needs_evidence: followUpLabels.needs_evidence,
};

const apartmentAmountLabels: Record<CollectionStatus, [string, string]> = {
  overdue: ["逾期未收", "Solde en retard"],
  upcoming: ["近期应缴", "Échéances proches"],
  unsettled: ["历史账单余款", "Solde d’anciennes créances"],
  needs_evidence: ["未收金额", "Solde à recevoir"],
};

const priority: Record<CollectionStatus, number> = {
  overdue: 0,
  upcoming: 1,
  unsettled: 2,
  needs_evidence: 3,
};

export function sortCollectionRows(rows: readonly UnifiedLeaseCollectionRow[], locale: Locale) {
  const collator = new Intl.Collator(locale === "zh" ? "zh-CN" : "fr-FR", { numeric: true });
  return [...rows].sort(
    (a, b) =>
      priority[a.status] - priority[b.status] ||
      (a.status === "needs_evidence" && b.status === "needs_evidence"
        ? Number(b.amount !== null) - Number(a.amount !== null)
        : 0) ||
      (a.dueDate ?? a.paidThrough ?? "9999-12-31").localeCompare(
        b.dueDate ?? b.paidThrough ?? "9999-12-31",
      ) ||
      collator.compare(a.name, b.name) ||
      a.id.localeCompare(b.id),
  );
}

export function buildApartmentCollectionRows(
  records: readonly LeaseRecordOverviewRow[],
  locale: Locale,
): UnifiedLeaseCollectionRow[] {
  const zh = locale === "zh";
  return records.flatMap((record) => {
    const { attention, building, contract, customer, paidThrough, unit } = record;
    const needsReview = record.conflict || record.reviewReasons.includes("active_record_has_end");
    if (!attention && !needsReview) return [];
    const href = buildWorkbenchRecordHref({
      workspace: "leases",
      id: contract.id,
      locale,
      project: building?.project_id,
      building: unit.building_id,
      returnTo: routeFor(locale, "/leases?assetCategory=followup&collectionCategory=apartment"),
    });
    if (!href) return [];

    // A coverage review can carry an as-of date in the original model. It is not a payment date.
    const bill = attention && attention.kind !== "coverage" ? attention : null;
    const status: CollectionStatus =
      !attention || attention.kind === "coverage" ? "needs_evidence" : attention.kind;
    const reason =
      status !== "needs_evidence"
        ? undefined
        : record.reviewReasons.includes("historical_balance_requires_review")
          ? zh
            ? "历史账单待核对"
            : "Anciennes créances à vérifier"
          : zh
            ? "租赁与账单资料待核"
            : "Dossier et créances à vérifier";
    return [
      {
        id: `apartment:${contract.id}`,
        category: "apartment",
        name: unit.unit_no,
        group:
          building?.display_name || building?.code || collectionCategoryLabel("apartment", locale),
        tenant: customer?.name ?? undefined,
        keywords: [unit.code, contract.contract_no].filter((value): value is string => !!value),
        href,
        status,
        reason,
        dueDate: bill?.dueDate ?? null,
        paidThrough,
        amount: bill
          ? bill.amount === null
            ? zh
              ? "多币种 · 查看明细"
              : "Plusieurs devises · voir le détail"
            : formatPropertyMoney(bill.amount, bill.currency ?? "XOF", locale)
          : null,
        amountLabel: apartmentAmountLabels[status][zh ? 0 : 1],
      },
    ];
  });
}

export function buildOperatingCollectionRows(
  data: OperatingAssetDirectoryData,
  today: string,
  locale: Locale,
): UnifiedLeaseCollectionRow[] {
  const zh = locale === "zh";
  const entriesByAsset = new Map<string, OperatingAssetDirectoryEntry[]>();
  for (const entry of data.entries) {
    const list = entriesByAsset.get(entry.assetId);
    if (list) list.push(entry);
    else entriesByAsset.set(entry.assetId, [entry]);
  }
  return data.assets.flatMap((asset) => {
    const entries = entriesByAsset.get(asset.id) ?? [];
    if (!hasOperatingAssetLeaseEvidence(asset, entries)) return [];
    const { status, reason, dueDate, dueSourceRef, paidThrough, outstanding } =
      getOperatingAssetFollowUp(asset, entries, today);
    if (status === "current") return [];
    const tenant = recordedTenant(asset, locale);
    const query = new URLSearchParams({
      assetCategory: asset.category,
      operatingAsset: asset.id,
    });
    return [
      {
        id: `asset:${asset.id}`,
        category: asset.category,
        name: asset.displayName,
        group: asset.displayGroup || collectionCategoryLabel(asset.category, locale),
        tenant: tenant ? `${tenant.label} ${tenant.names}` : undefined,
        keywords: [asset.code, asset.name],
        href: routeFor(locale, `/leases?${query}`),
        status,
        reason: reason ? followUpReasons[reason][zh ? 0 : 1] : undefined,
        dueDate,
        dueSource: dueSourceRef ? assetSourceLabel(dueSourceRef) : undefined,
        paidThrough: paidThrough?.date ?? null,
        paidThroughSource: paidThrough ? assetSourceLabel(paidThrough.sourceRef) : undefined,
        coveragePending: paidThrough?.status === "pending",
        amount: outstanding
          ? formatPropertyMoney(outstanding.amountNative, outstanding.currency, locale)
          : null,
        amountLabel: outstanding
          ? zh
            ? "原表余款"
            : "Solde enregistré"
          : zh
            ? "未收金额"
            : "Solde à recevoir",
        amountSource: outstanding ? assetSourceLabel(outstanding.sourceRef) : undefined,
      },
    ];
  });
}
