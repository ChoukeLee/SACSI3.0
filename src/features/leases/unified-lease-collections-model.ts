import { assetSourceLabel, isAssetDate } from "@/features/asset-operations/asset-operations-model";
import {
  getOperatingAssetFollowUp,
  hasOperatingAssetLeaseEvidence,
  type OperatingAssetDirectoryData,
  type OperatingAssetDirectoryEntry,
} from "@/features/asset-operations/operating-asset-directory-model";
import {
  followUpLabels,
  followUpReasons,
  latestVerifiedRentReceipt,
  operatingLeaseLocation,
  recordedTenant,
} from "@/features/asset-operations/operating-asset-display";
import { operatingLeaseViews } from "@/features/asset-operations/operating-lease-groups";
import { routeFor, type Locale } from "@/lib/i18n";
import { formatPropertyMoney } from "@/lib/property-money";
import { buildWorkbenchRecordHref } from "@/lib/workbench-links";
import {
  classifyOperatingLeaseMode,
  isIncubatorDormitory,
  leaseBrowseCategoryLabel,
  leaseCollectionHref,
  parseLeaseBrowseCategory,
  type LeaseBrowseCategory,
} from "./lease-browse-model";
import { leaseTenantDisplayName } from "./lease-display-model";
import type { LeaseRecordOverviewRow } from "./lease-room-overview-model";

type RecordCategory = LeaseBrowseCategory;
export type CollectionCategory = "all" | RecordCategory;
export type CollectionStatus = Exclude<keyof typeof followUpLabels, "all"> | "unsettled";

export interface UnifiedLeaseCollectionRow {
  id: string;
  category: RecordCategory;
  name: string;
  group?: string;
  tenant?: string;
  keywords: readonly string[];
  href: string;
  status: CollectionStatus;
  statusLabel?: string;
  reason?: string;
  dueDate: string | null;
  dueSource?: string;
  paidThrough: string | null;
  ownerSettledThrough?: string;
  paidThroughSource?: string;
  coveragePending?: boolean;
  amount: string | null;
  amountLabel: string;
  amountSource?: string;
  latestReceipt?: {
    date: string;
    amount: string;
    periodStart?: string;
    periodEnd?: string;
  };
}

export function parseCollectionCategory(value: unknown): CollectionCategory {
  return parseLeaseBrowseCategory(value) ?? "all";
}

export function collectionCategoryLabel(category: CollectionCategory, locale: Locale) {
  if (category === "all") return locale === "zh" ? "汇总三类" : "Synthèse des trois modes";
  return leaseBrowseCategoryLabel(category, locale);
}

export const collectionStatusLabels: Record<CollectionStatus | "all", [string, string]> = {
  all: followUpLabels.all,
  overdue: followUpLabels.overdue,
  upcoming: followUpLabels.upcoming,
  unsettled: ["历史待结清", "Ancien solde à régler"],
  needs_evidence: ["资料待补", "Données à compléter"],
};

function timingLabel(status: CollectionStatus, days: number | null | undefined, zh: boolean) {
  if (days == null) return undefined;
  if (status === "overdue")
    return zh ? `逾期 ${Math.abs(days)} 天` : `Retard de ${Math.abs(days)} j`;
  if (status === "upcoming") {
    if (days === 0) return zh ? "今日应缴" : "Dû aujourd’hui";
    return zh ? `${days} 天内应缴` : `Dû sous ${days} j`;
  }
  return undefined;
}

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
    const sourceName = customer?.name;
    const tenant = leaseTenantDisplayName(unit, sourceName);
    const needsReview = record.conflict || record.reviewReasons.includes("active_record_has_end");
    if (!attention && !needsReview) return [];
    const href = buildWorkbenchRecordHref({
      workspace: "leases",
      id: contract.id,
      locale,
      project: building?.project_id,
      building: unit.building_id,
      returnTo: leaseCollectionHref(locale),
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
        group: building?.display_name || building?.code || undefined,
        tenant,
        keywords: [
          unit.code,
          contract.contract_no,
          tenant !== sourceName ? sourceName : undefined,
        ].filter((value): value is string => !!value),
        href,
        status,
        statusLabel: timingLabel(status, bill?.days, zh),
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
        amountLabel:
          bill?.amountIsEstimated && bill.amount !== null
            ? zh
              ? "逾期未收（含租金测算）"
              : "Solde en retard, estimation incluse"
            : apartmentAmountLabels[status][zh ? 0 : 1],
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
  const views = data.assets.flatMap((asset) =>
    operatingLeaseViews(asset, entriesByAsset.get(asset.id) ?? []),
  );
  return views.flatMap<UnifiedLeaseCollectionRow>(({ key, groupKey, asset, entries }) => {
    if (!hasOperatingAssetLeaseEvidence(asset, entries)) return [];
    const category = classifyOperatingLeaseMode(asset);
    const {
      status,
      reason,
      dueDate,
      dueSourceRef,
      paidThrough,
      outstanding,
      daysUntilDue,
      scheduledPeriods,
      ownerRent,
    } = getOperatingAssetFollowUp(asset, entries, today);
    if (asset.leaseEvidence?.ownerRentAccount) {
      if (ownerRent?.arrearsNative === 0) return [];
      const account = asset.leaseEvidence.ownerRentAccount;
      const query = new URLSearchParams({ assetCategory: category, operatingAsset: asset.id });
      return [
        {
          id: `asset:${key}`,
          category,
          name: asset.displayName,
          group: operatingLeaseLocation(asset),
          tenant: `${zh ? "业主" : "Propriétaire"} ${account.ownerName}`,
          keywords: [asset.code, asset.name, account.ownerName],
          href: routeFor(locale, `/leases?${query}`),
          status: status === "current" ? "needs_evidence" : status,
          reason: zh
            ? "业主应分账按自然月统计，进入当月即计一期；租客付款进度另核。"
            : "Quote-part par mois civil, mois courant inclus ; suivi du locataire distinct.",
          dueDate: ownerRent?.firstUnpaidDate ?? null,
          dueSource: assetSourceLabel(account.rateSourceRef),
          paidThrough: null,
          ownerSettledThrough: ownerRent?.settledThrough,
          amount: ownerRent ? formatPropertyMoney(ownerRent.arrearsNative, "XOF", locale) : null,
          amountLabel: zh ? "业主到期未结" : "Solde du propriétaire",
          amountSource: assetSourceLabel(account.rateSourceRef),
        },
      ];
    }
    const schedule = asset.monthlyRentSchedule;
    const firstScheduledPeriod = scheduledPeriods?.[0];
    const amount =
      outstanding ??
      (schedule && firstScheduledPeriod
        ? {
            amountNative: firstScheduledPeriod.outstandingNative,
            currency: schedule.currency,
            sourceRef: schedule.sourceRef,
          }
        : null);
    const tracksNextPaymentDate = category === "whole" || isIncubatorDormitory(asset);
    const awaitingPaymentDate =
      tracksNextPaymentDate && !dueDate && paidThrough?.status === "verified";
    if (status === "current" && !awaitingPaymentDate) return [];
    const collectionStatus = status === "current" ? "needs_evidence" : status;
    const latestReceipt =
      tracksNextPaymentDate && !dueDate ? latestVerifiedRentReceipt(entries, today) : undefined;
    const tenant = recordedTenant(asset, locale);
    const query = new URLSearchParams({
      assetCategory: category,
      operatingAsset: asset.id,
    });
    if (groupKey) query.set("operatingLeaseGroup", groupKey);
    return [
      {
        id: `asset:${key}`,
        category,
        name: asset.displayName,
        group: operatingLeaseLocation(asset),
        tenant: tenant ? `${tenant.label} ${tenant.names}` : undefined,
        keywords: [
          asset.code,
          asset.name,
          ...(asset.searchAliases ?? []),
          ...(asset.linkedWarehouse
            ? [asset.linkedWarehouse.code, asset.linkedWarehouse.name]
            : []),
          ...(tenant?.evidence.displayNames ? tenant.evidence.names : []),
        ],
        href: routeFor(locale, `/leases?${query}`),
        status: collectionStatus,
        statusLabel: timingLabel(collectionStatus, daysUntilDue, zh),
        reason: reason
          ? followUpReasons[reason][zh ? 0 : 1]
          : awaitingPaymentDate
            ? zh
              ? "下期付款日待补"
              : "Prochaine échéance à compléter"
            : undefined,
        dueDate,
        dueSource: dueSourceRef ? assetSourceLabel(dueSourceRef) : undefined,
        paidThrough: paidThrough?.date ?? null,
        paidThroughSource: paidThrough ? assetSourceLabel(paidThrough.sourceRef) : undefined,
        coveragePending: paidThrough?.status === "pending",
        amount: amount ? formatPropertyMoney(amount.amountNative, amount.currency, locale) : null,
        amountLabel: firstScheduledPeriod
          ? outstanding
            ? zh
              ? "到期未收"
              : "Loyers échus restant dus"
            : zh
              ? "即将应收"
              : "Loyer à échoir"
          : outstanding
            ? zh
              ? "原表余款"
              : "Solde enregistré"
            : zh
              ? "未收金额"
              : "Solde à recevoir",
        amountSource: amount ? assetSourceLabel(amount.sourceRef) : undefined,
        latestReceipt: latestReceipt
          ? {
              date: latestReceipt.cashDate,
              amount: formatPropertyMoney(
                latestReceipt.amountNative,
                latestReceipt.currency,
                locale,
              ),
              periodStart: isAssetDate(latestReceipt.periodStart)
                ? latestReceipt.periodStart
                : undefined,
              periodEnd: isAssetDate(latestReceipt.periodEnd) ? latestReceipt.periodEnd : undefined,
            }
          : undefined,
      },
    ];
  });
}
