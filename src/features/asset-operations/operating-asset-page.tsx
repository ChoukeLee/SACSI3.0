import "server-only";

import Link from "next/link";
import type { UserRole } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { fetchAssetOperations } from "./asset-operations-server";
import { OperatingAssetDirectory } from "./operating-asset-directory";
import {
  buildOperatingAssetDirectory,
  hasOperatingAssetLeaseEvidence,
  type OperatingAssetCategory,
} from "./operating-asset-directory-model";

const leaseCategories = ["warehouse", "factory", "commercial", "land", "dormitory"] as const;
type LeaseAssetCategory = (typeof leaseCategories)[number];
type LeaseCategory = LeaseAssetCategory | "followup";
export type AssetOperatingView = "operations" | "maintenance";

const collectionCategories: readonly OperatingAssetCategory[] = [...leaseCategories, "office"];
const categoryNames: Record<LeaseAssetCategory, [string, string]> = {
  warehouse: ["仓库", "Entrepôts"],
  factory: ["厂房", "Bâtiments industriels"],
  commercial: ["商用物业", "Locaux commerciaux"],
  land: ["土地", "Terrains"],
  dormitory: ["宿舍", "Dortoirs"],
};

export function canReadOperatingAssets(role: UserRole) {
  return role === "admin" || role === "boss" || role === "finance";
}

export function parseLeaseAssetCategory(value: unknown): LeaseCategory | undefined {
  if (value === "followup") return value;
  return leaseCategories.find((category) => category === value);
}

export function parseAssetOperatingView(value: unknown): AssetOperatingView | undefined {
  return value === "operations" || value === "maintenance" ? value : undefined;
}

export function parseOperatingAssetId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

export function OperatingAssetNavigation({
  locale,
  area,
  category,
  view,
}: {
  locale: Locale;
  area: "leases" | "units";
  category?: LeaseCategory;
  view?: AssetOperatingView;
}) {
  const zh = locale === "zh";
  const base = routeFor(locale, `/${area}`);
  const options =
    area === "leases"
      ? [
          { href: base, label: zh ? "公寓" : "Appartements", current: !category },
          ...leaseCategories.map((value) => ({
            href: `${base}?assetCategory=${value}`,
            label: categoryNames[value][zh ? 0 : 1],
            current: value === category,
          })),
        ]
      : [
          { href: base, label: zh ? "房源与楼栋" : "Lots et bâtiments", current: !view },
          {
            href: `${base}?assetView=operations`,
            label: zh ? "经营资产" : "Actifs d’exploitation",
            current: !!view,
          },
        ];

  return (
    <nav
      aria-label={
        area === "leases"
          ? zh
            ? "长租资产类别"
            : "Catégories de location"
          : zh
            ? "资产查看方式"
            : "Vues des actifs"
      }
      className="flex flex-wrap items-center gap-2 pb-4"
    >
      {options.map(({ href, label, current }) => (
        <Link
          key={href}
          href={href}
          prefetch={false}
          aria-current={current ? "page" : undefined}
          className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${current ? "border-primary/20 bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        >
          {label}
        </Link>
      ))}
      {area === "leases" ? (
        <Link
          href={`${base}?assetCategory=followup`}
          prefetch={false}
          aria-current={category === "followup" ? "page" : undefined}
          className={`ml-auto rounded-md border px-3 py-1.5 text-sm transition-colors ${category === "followup" ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted"}`}
        >
          {zh ? "经营资产收款跟进" : "Suivi des encaissements des actifs"}
        </Link>
      ) : null}
      {area === "units" && view === "operations" ? (
        <Link
          href={`${base}?assetView=maintenance`}
          prefetch={false}
          className="ml-auto rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {zh ? "来源维护与报表" : "Sources et rapports"}
        </Link>
      ) : null}
    </nav>
  );
}

export async function OperatingAssetDirectoryPage({
  locale,
  category,
  selectedAssetId,
  project,
}: {
  locale: Locale;
  category?: LeaseCategory;
  selectedAssetId?: string;
  project?: string;
}) {
  const zh = locale === "zh";
  try {
    const source = await fetchAssetOperations({ includeLeaseEvidence: true });
    if (project && project !== source.projectId && project.toUpperCase() !== "SACSI")
      throw new Error("AssetOperationsProjectUnavailable");
    const today = new Date().toISOString().slice(0, 10);
    const data = buildOperatingAssetDirectory(source, {
      sacsiProjectId: source.projectId,
      applyExcelConfirmation: true,
      today,
      leaseEvidence: source.leaseEvidence,
    });
    const isFollowUp = category === "followup";
    const assets = data.assets.filter((asset) => {
      if (!category) return true;
      if (isFollowUp)
        return (
          collectionCategories.includes(asset.category) &&
          hasOperatingAssetLeaseEvidence(asset, data.entries)
        );
      return (
        asset.category === category &&
        (category === "warehouse" ||
          category === "factory" ||
          hasOperatingAssetLeaseEvidence(asset, data.entries))
      );
    });
    const ids = new Set(assets.map((asset) => asset.id));
    return (
      <OperatingAssetDirectory
        key={category ?? "all"}
        data={{ ...data, assets, entries: data.entries.filter((entry) => ids.has(entry.assetId)) }}
        locale={locale}
        today={today}
        category={isFollowUp ? "all" : (category ?? "all")}
        enableCollections={!!category}
        initialView={isFollowUp ? "collections" : "cards"}
        selectedAssetId={selectedAssetId && ids.has(selectedAssetId) ? selectedAssetId : null}
      />
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      ![
        "AssetOperationsProjectUnavailable",
        "AssetOperationsMigrationRequired",
        "AssetOperationsReadUnavailable",
      ].includes(error.message)
    )
      throw error;
    return (
      <p role="alert" className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        {zh
          ? "经营资产暂时无法读取，请核对项目或刷新重试。"
          : "Actifs indisponibles. Vérifiez le projet ou actualisez."}
      </p>
    );
  }
}
