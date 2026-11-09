import "server-only";

import Link from "next/link";
import type { UserRole } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { fetchAssetOperations } from "./asset-operations-server";
import { OperatingAssetDirectory } from "./operating-asset-directory";
import { buildOperatingAssetDirectory } from "./operating-asset-directory-model";

const leaseCategories = ["warehouse", "factory", "commercial", "land"] as const;
type LeaseCategory = (typeof leaseCategories)[number];
export type AssetOperatingView = "operations" | "maintenance";

const categoryNames: Record<LeaseCategory, [string, string]> = {
  warehouse: ["仓库", "Entrepôts"],
  factory: ["厂房", "Bâtiments industriels"],
  commercial: ["商用物业", "Locaux commerciaux"],
  land: ["土地", "Terrains"],
};

export function canReadOperatingAssets(role: UserRole) {
  return role === "admin" || role === "boss" || role === "finance";
}

export function parseLeaseAssetCategory(value: unknown): LeaseCategory | undefined {
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
    const source = await fetchAssetOperations();
    if (project && project !== source.projectId && project.toUpperCase() !== "SACSI")
      throw new Error("AssetOperationsProjectUnavailable");
    const data = buildOperatingAssetDirectory(source, {
      sacsiProjectId: source.projectId,
      applyExcelConfirmation: true,
    });
    const withRentSource = new Set(
      data.entries
        .filter((entry) => entry.kind === "income" && entry.category === "rent" && !entry.voidedAt)
        .map((entry) => entry.assetId),
    );
    const assets = data.assets.filter(
      (asset) =>
        !category ||
        (asset.category === category &&
          ((category !== "commercial" && category !== "land") || withRentSource.has(asset.id))),
    );
    const ids = new Set(assets.map((asset) => asset.id));
    return (
      <OperatingAssetDirectory
        key={category ?? "all"}
        data={{ ...data, assets, entries: data.entries.filter((entry) => ids.has(entry.assetId)) }}
        locale={locale}
        today={new Date().toISOString().slice(0, 10)}
        category={category ?? "all"}
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
