import "server-only";

import Link from "next/link";
import { cookies } from "next/headers";
import type { UserRole } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import {
  classifyOperatingLeaseMode,
  leaseBrowseCookieName,
  resolveLeaseBrowseView,
  type LeaseBrowseCategory,
} from "@/features/leases/lease-browse-model";
import { LeaseBrowseToolbar } from "@/features/leases/lease-browse-toolbar";
import { leaseRoomMatchesSearch } from "@/features/leases/lease-room-overview-model";
import { loadApartmentLeaseOverview } from "@/features/leases/unified-lease-collections-page";
import { fetchAssetOperations } from "./asset-operations-server";
import { OperatingAssetDirectory } from "./operating-asset-directory";
import { operatingAssetMatchesSearch } from "./operating-asset-display";
import { buildOperatingAssetDirectory } from "./operating-asset-directory-model";
import { withIncubatorDormitoryLeaseGroups } from "./operating-lease-groups-server";

type LeaseAssetCategory = Exclude<LeaseBrowseCategory, "apartment">;
export type AssetOperatingView = "operations" | "maintenance";

export function canReadOperatingAssets(role: UserRole) {
  return role === "admin" || role === "boss" || role === "finance";
}

export async function readLeaseBrowseView(
  params: Parameters<typeof resolveLeaseBrowseView>[0],
  viewerId: string,
) {
  const store = await cookies();
  return resolveLeaseBrowseView(params, store.get(leaseBrowseCookieName(viewerId))?.value);
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
  view,
}: {
  locale: Locale;
  view?: AssetOperatingView;
}) {
  const zh = locale === "zh";
  const base = routeFor(locale, "/units");
  const options = [
    { href: base, label: zh ? "房源与楼栋" : "Lots et bâtiments", current: !view },
    {
      href: `${base}?assetView=operations`,
      label: zh ? "经营资产" : "Actifs d’exploitation",
      current: !!view,
    },
  ];

  return (
    <nav
      aria-label={zh ? "资产查看方式" : "Vues des actifs"}
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
      {view === "operations" ? (
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
  selectedLeaseGroup,
  project,
  viewerId,
  searchQuery,
  searchCategory,
}: {
  locale: Locale;
  category?: LeaseAssetCategory;
  selectedAssetId?: string;
  selectedLeaseGroup?: string;
  project?: string;
  viewerId?: string;
  searchQuery?: string;
  searchCategory?: LeaseBrowseCategory;
}) {
  const zh = locale === "zh";
  const browseCategory = searchCategory ?? category;
  const search = searchQuery?.trim();
  try {
    const [source, apartment] = await Promise.all([
      fetchAssetOperations({ includeLeaseEvidence: true }),
      search ? loadApartmentLeaseOverview({ locale, project, viewerId }) : undefined,
    ]);
    if (project && project !== source.projectId && project.toUpperCase() !== "SACSI")
      throw new Error("AssetOperationsProjectUnavailable");
    const today = new Date().toISOString().slice(0, 10);
    const directory = buildOperatingAssetDirectory(source, {
      sacsiProjectId: source.projectId,
      applyExcelConfirmation: true,
      today,
      leaseEvidence: source.leaseEvidence,
    });
    const data = browseCategory ? withIncubatorDormitoryLeaseGroups(directory) : directory;
    const selectedAsset = selectedAssetId
      ? data.assets.find((asset) => asset.id === selectedAssetId)
      : undefined;
    const matchedLeaseGroup = selectedAsset?.leaseGroups?.find(
      ({ key }) => key === selectedLeaseGroup,
    );
    const leaseCategory =
      category && selectedAsset ? classifyOperatingLeaseMode(selectedAsset) : category;
    const assets = search
      ? data.assets.filter((asset) => operatingAssetMatchesSearch(asset, search))
      : data.assets.filter(
          (asset) => !leaseCategory || classifyOperatingLeaseMode(asset) === leaseCategory,
        );
    const ids = new Set(assets.map((asset) => asset.id));
    return (
      <OperatingAssetDirectory
        key={search ? `search:${browseCategory}:${search}` : (leaseCategory ?? "assets")}
        data={{ ...data, assets, entries: data.entries.filter((entry) => ids.has(entry.assetId)) }}
        locale={locale}
        today={today}
        category="all"
        leaseCategory={leaseCategory}
        enableCollections={!!browseCategory}
        initialView="cards"
        browseViewerId={browseCategory ? viewerId : undefined}
        searchQuery={search}
        searchCategory={searchCategory}
        apartmentRows={apartment?.rows.filter((row) => leaseRoomMatchesSearch(row, search ?? ""))}
        apartmentUnavailable={apartment?.unavailable}
        selectedAssetId={
          selectedAssetId && ids.has(selectedAssetId) && (!selectedLeaseGroup || matchedLeaseGroup)
            ? selectedAssetId
            : null
        }
        selectedLeaseGroup={matchedLeaseGroup?.key}
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
      <>
        {browseCategory && viewerId ? (
          <LeaseBrowseToolbar locale={locale} category={browseCategory} searchQuery={search} />
        ) : null}
        <p role="alert" className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
          {zh
            ? "经营资产暂时无法读取，请核对项目或刷新重试。"
            : "Actifs indisponibles. Vérifiez le projet ou actualisez."}
        </p>
      </>
    );
  }
}
