import { formatPropertyMoney } from "@/lib/property-money";
import type {
  OperatingAssetCategory,
  OperatingAssetDirectoryAsset,
  OperatingAssetFollowUp,
} from "./operating-asset-directory-model";

type Locale = "zh" | "fr";
type FollowUpFilter = "all" | Exclude<OperatingAssetFollowUp["status"], "current">;

const categoryLabels: Record<OperatingAssetCategory, [string, string]> = {
  warehouse: ["仓库", "Entrepôts"],
  factory: ["厂房", "Usines"],
  commercial: ["商铺及营业场所", "Commerces"],
  land: ["土地及场地", "Terrains"],
  office: ["办公室", "Bureaux"],
  dormitory: ["宿舍", "Dortoirs"],
  other: ["其他经营资产", "Autres actifs d’exploitation"],
};

export function operatingAssetCategoryLabel(category: OperatingAssetCategory, locale: Locale) {
  return categoryLabels[category][locale === "zh" ? 0 : 1];
}

const rentLabels = {
  month: ["参考月租", "Loyer mensuel indicatif"],
  quarter: ["季租", "Loyer trimestriel"],
  year: ["年租", "Loyer annuel"],
} as const;

export function referenceRent(asset: OperatingAssetDirectoryAsset, locale: Locale) {
  const zh = locale === "zh";
  const rent = asset.referenceRent;
  return {
    label: rentLabels[rent?.period ?? "month"][zh ? 0 : 1],
    amount: rent
      ? formatPropertyMoney(rent.amountNative, rent.currency, locale)
      : zh
        ? "未登记"
        : "Non renseigné",
  };
}

const tenantLabels = {
  asset: {
    latest_source: ["登记租户", "Locataire enregistré"],
    historical: ["历史租户", "Ancien locataire"],
  },
  group: {
    latest_source: ["合租登记", "Locataires du groupe"],
    historical: ["历史合租租户", "Anciens locataires du groupe"],
  },
} as const;

export function recordedTenant(asset: OperatingAssetDirectoryAsset, locale: Locale) {
  const evidence = asset.leaseEvidence?.tenantEvidence;
  if (!evidence) return null;
  const zh = locale === "zh";
  return {
    evidence,
    label: tenantLabels[evidence.scope][evidence.classification][zh ? 0 : 1],
    names: evidence.names.join(zh ? "、" : ", "),
  };
}

export const followUpLabels: Record<FollowUpFilter, [string, string]> = {
  all: ["全部跟进", "Tous les suivis"],
  overdue: ["已逾期", "En retard"],
  upcoming: ["15天内应缴", "Dû sous 15 jours"],
  needs_evidence: ["待补资料", "Données à compléter"],
};

export const followUpReasons: Record<
  NonNullable<OperatingAssetFollowUp["reason"]>,
  [string, string]
> = {
  due_date_missing: ["付款日未登记", "Date d’échéance non renseignée"],
  paid_through_missing: ["已交至未登记", "Date de couverture non renseignée"],
  unpaid_unconfirmed: ["未收金额待确认", "Solde à confirmer"],
  coverage_ended: ["已登记的租金覆盖已结束", "Période de loyer enregistrée terminée"],
  coverage_ending: ["已登记的租金覆盖即将结束", "Fin prochaine de la période enregistrée"],
  source_conflict: ["来源记录需核对", "Sources à rapprocher"],
};
