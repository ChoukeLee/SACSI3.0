import { routeFor, type Locale } from "@/lib/i18n";

const categoryLabels = {
  apartment: ["公寓", "Appartements"],
  "multi-unit": ["分单元出租", "Location par unité"],
  whole: ["整体出租", "Location intégrale"],
} as const;

export type LeaseBrowseCategory = keyof typeof categoryLabels;
export type OperatingLeaseMode = Exclude<LeaseBrowseCategory, "apartment">;
export const leaseBrowseCategories = Object.keys(categoryLabels) as LeaseBrowseCategory[];
export const leaseSearchLimit = 100;
export const incubatorDormitorySite = "孵化园宿舍";

const separateUnitSites = new Set([
  "old_warehouse",
  "new_warehouse",
  "老仓库",
  "新仓库",
  "孵化园库房",
]);

export function isIncubatorDormitory(asset: { group: string; name?: string }) {
  return (
    asset.group.trim() === incubatorDormitorySite ||
    asset.name?.trim() === "孵化园配套宿舍（四组明细）"
  );
}

/** Includes the existing grouped dormitory record and sites with individually identified bays. */
export function classifyOperatingLeaseMode(asset: {
  group: string;
  name?: string;
  sourceKey?: string | null;
}): OperatingLeaseMode {
  return separateUnitSites.has(asset.group.trim()) ||
    /^(?:old|new)_warehouse:/.test(asset.sourceKey ?? "") ||
    isIncubatorDormitory(asset)
    ? "multi-unit"
    : "whole";
}

export function leaseBrowseCategoryLabel(category: LeaseBrowseCategory, locale: Locale) {
  return categoryLabels[category][locale === "zh" ? 0 : 1];
}

export function parseLeaseBrowseCategory(value: unknown): LeaseBrowseCategory | undefined {
  switch (value) {
    case "apartment":
    case "multi-unit":
    case "whole":
      return value;
    case "warehouse":
      return "multi-unit";
    case "factory":
    case "commercial":
    case "office":
    case "land":
    case "dormitory":
    case "other":
      return "whole";
    default:
      return undefined;
  }
}

export function normalizeLeaseSearch(value: unknown) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, leaseSearchLimit)
    : "";
}

export function leaseBrowseCookieName(viewerId: string) {
  return `sacsi_lease_category_v1_${encodeURIComponent(viewerId)}`;
}

export function leaseBrowseHref(locale: Locale, category: LeaseBrowseCategory) {
  return routeFor(locale, `/leases?assetCategory=${category}`);
}

export function leaseSearchHref(locale: Locale, category: LeaseBrowseCategory, search: string) {
  const query = normalizeLeaseSearch(search);
  if (!query) return leaseBrowseHref(locale, category);
  const params = new URLSearchParams({ assetCategory: category, q: query });
  return routeFor(locale, `/leases?${params}`);
}

export function leaseCollectionHref(locale: Locale) {
  return routeFor(locale, "/leases?assetCategory=followup");
}

export function resolveLeaseBrowseView(
  params: {
    assetCategory?: unknown;
    q?: unknown;
    project?: unknown;
    building?: unknown;
    contract?: unknown;
    returnTo?: unknown;
    operatingAsset?: unknown;
  },
  remembered?: unknown,
): { category: LeaseBrowseCategory | "followup"; searchQuery: string; rememberCategory: boolean } {
  if (params.building || params.contract || params.returnTo)
    return { category: "apartment", searchQuery: "", rememberCategory: false };
  if (params.assetCategory === "followup")
    return { category: "followup", searchQuery: "", rememberCategory: false };
  const explicitCategory = parseLeaseBrowseCategory(params.assetCategory);
  const category =
    explicitCategory ??
    (params.project ? "apartment" : parseLeaseBrowseCategory(remembered)) ??
    "apartment";
  const searchQuery = normalizeLeaseSearch(params.q);
  return {
    category,
    searchQuery,
    rememberCategory: !!explicitCategory && !searchQuery && !params.operatingAsset,
  };
}
