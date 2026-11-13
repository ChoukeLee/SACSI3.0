"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarClock, Search } from "lucide-react";
import Link from "next/link";
import { SegmentedControl } from "@/components/ui/operational";
import { ApartmentDirectorySection } from "@/features/leases/apartment-directory-section";
import { LeaseBrowseStatusFilter } from "@/features/leases/lease-browse-content";
import {
  classifyOperatingLeaseMode,
  isIncubatorDormitory,
  leaseBrowseCategoryLabel,
  leaseSearchHref,
} from "@/features/leases/lease-browse-model";
import {
  LeaseBrowseToolbar,
  type LeaseBrowseCategory,
} from "@/features/leases/lease-browse-toolbar";
import {
  leaseRoomMatchesFilter,
  type LeaseRoomFilter as CardFilter,
} from "@/features/leases/lease-room-overview";
import {
  leaseRoomMatchesSearch,
  type LeaseRoomOverviewRow,
} from "@/features/leases/lease-room-overview-model";
import leaseStyles from "@/features/leases/lease-room-overview.module.css";
import { formatPropertyMoney } from "@/lib/property-money";
import { cn } from "@/lib/utils";
import { assetReportPeriod, assetSourceLabel } from "./asset-operations-model";
import { OperatingAssetDetail } from "./operating-asset-detail";
import {
  getOperatingAssetFollowUp,
  hasOperatingAssetLeaseEvidence,
  summarizeOperatingAssetCash,
  type buildOperatingAssetDirectory,
  type OperatingAssetCategory,
  type OperatingAssetDirectoryAsset,
  type OperatingAssetDirectoryEntry,
} from "./operating-asset-directory-model";
import {
  followUpLabels,
  followUpReasons,
  operatingAssetCategoryLabel,
  operatingAssetMatchesSearch,
  operatingLeaseLocation,
  recordedTenant,
  referenceRent,
} from "./operating-asset-display";
import {
  OperatingLeaseCard,
  OperatingLeaseLocations,
  OperatingWholeLeases,
} from "./operating-lease-locations";
import { operatingLeaseViews } from "./operating-lease-groups";
import locationStyles from "./operating-lease-locations.module.css";
import styles from "./operating-asset-directory.module.css";

type Locale = "zh" | "fr";
type DirectoryFilter = CardFilter | "followup";
type FollowUp = ReturnType<typeof getOperatingAssetFollowUp>;
type FollowUpStatus = Exclude<FollowUp["status"], "current">;
type FollowUpFilter = "all" | FollowUpStatus;
type DirectoryRow = {
  key: string;
  groupKey?: string;
  asset: OperatingAssetDirectoryAsset;
  entries: OperatingAssetDirectoryEntry[];
  followUp: FollowUp;
  hasLeaseEvidence: boolean;
  attention: Exclude<CardFilter, "all"> | null;
  pendingEntries: number;
};
type CollectionRow = DirectoryRow & { followUp: FollowUp & { status: FollowUpStatus } };

const emptyEntries: OperatingAssetDirectoryEntry[] = [];
function leaseSiteId(asset: OperatingAssetDirectoryAsset) {
  return operatingLeaseLocation(asset) ?? "__lease-site-unassigned__";
}

const cardFilters: { key: CardFilter; labels: [string, string] }[] = [
  { key: "all", labels: ["全部资产", "Tous les actifs"] },
  { key: "overdue", labels: followUpLabels.overdue },
  { key: "upcoming", labels: followUpLabels.upcoming },
  { key: "review", labels: ["待核事项", "À vérifier"] },
];

const followUpPriority: Record<FollowUp["status"], number> = {
  overdue: 0,
  upcoming: 1,
  needs_evidence: 2,
  current: 3,
};

const nameCollators = {
  zh: new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" }),
  fr: new Intl.Collator("fr", { numeric: true, sensitivity: "base" }),
};

function directoryRow(
  view: Pick<DirectoryRow, "key" | "groupKey" | "asset" | "entries">,
  today: string,
  leaseBrowse: boolean,
): DirectoryRow {
  const { asset, entries } = view;
  const followUp = getOperatingAssetFollowUp(asset, entries, today);
  const hasLeaseEvidence = hasOperatingAssetLeaseEvidence(asset, entries);
  const pendingEntries = entries.filter((entry) => entry.status === "pending").length;
  const review =
    asset.verification === "pending" ||
    pendingEntries > 0 ||
    (hasLeaseEvidence &&
      (followUp.status === "needs_evidence" ||
        (leaseBrowse &&
          (classifyOperatingLeaseMode(asset) === "whole" || isIncubatorDormitory(asset)) &&
          !followUp.dueDate)));
  return {
    ...view,
    followUp,
    hasLeaseEvidence,
    pendingEntries,
    attention:
      followUp.status === "overdue" || followUp.status === "upcoming"
        ? followUp.status
        : review
          ? "review"
          : null,
  };
}

interface OperatingAssetDirectoryProps {
  locale: Locale;
  data: ReturnType<typeof buildOperatingAssetDirectory>;
  today: string;
  category: OperatingAssetCategory | "all";
  leaseCategory?: Exclude<LeaseBrowseCategory, "apartment">;
  selectedAssetId?: string | null;
  selectedLeaseGroup?: string;
  enableCollections?: boolean;
  initialView?: "cards" | "collections";
  collectionHref?: string;
  apartmentRows?: LeaseRoomOverviewRow[];
  apartmentUnavailable?: boolean;
  browseViewerId?: string;
  searchQuery?: string;
  searchCategory?: LeaseBrowseCategory;
  assetBrowse?: boolean;
}

export function OperatingAssetDirectory(props: OperatingAssetDirectoryProps) {
  return (
    <OperatingAssetDirectoryView
      key={JSON.stringify([
        props.data.projectId,
        props.category,
        props.leaseCategory,
        props.selectedAssetId,
        props.selectedLeaseGroup,
        props.initialView,
        props.browseViewerId,
        props.searchQuery,
        props.assetBrowse,
      ])}
      {...props}
    />
  );
}

function OperatingAssetDirectoryView({
  locale,
  data,
  today,
  category,
  leaseCategory,
  selectedAssetId,
  selectedLeaseGroup,
  enableCollections = false,
  initialView = "cards",
  collectionHref,
  apartmentRows,
  apartmentUnavailable = false,
  browseViewerId,
  searchQuery,
  searchCategory,
  assetBrowse = false,
}: OperatingAssetDirectoryProps) {
  const zh = locale === "zh";
  const lang = zh ? 0 : 1;
  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [cardFilter, setCardFilter] = useState<DirectoryFilter>("all");
  const [view, setView] = useState(initialView);
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>("all");
  const [selectedId, setSelectedId] = useState(
    selectedAssetId && selectedLeaseGroup
      ? `${selectedAssetId}:${selectedLeaseGroup}`
      : (selectedAssetId ?? null),
  );
  const groupStorageKey =
    browseViewerId && leaseCategory === "multi-unit"
      ? `sacsi:${assetBrowse ? "asset" : "lease"}-site:${browseViewerId}:${data.projectId}:${leaseCategory}`
      : null;
  const selectedAssetSite =
    selectedAssetId && groupStorageKey
      ? data.assets.find((asset) => asset.id === selectedAssetId)
      : undefined;
  const initialSite = selectedAssetSite ? leaseSiteId(selectedAssetSite) : undefined;
  useEffect(() => {
    if (!groupStorageKey) return;
    if (initialSite) {
      setSelectedGroup(initialSite);
      return;
    }
    try {
      const saved = localStorage.getItem(groupStorageKey);
      const legacy =
        saved === null
          ? localStorage.getItem(`sacsi:lease-site:${browseViewerId}:${data.projectId}:warehouse`)
          : null;
      setSelectedGroup(
        saved ??
          (legacy === "__warehouse-unassigned__" ? "__lease-site-unassigned__" : legacy) ??
          "",
      );
    } catch {
      // Keep the default location when browser storage is unavailable.
    }
  }, [browseViewerId, data.projectId, groupStorageKey, initialSite]);
  function changeGroup(group: string) {
    setSelectedGroup(group);
    if (!groupStorageKey) return;
    try {
      localStorage.setItem(groupStorageKey, group);
    } catch {
      // The selection still applies for the current view.
    }
  }
  const entriesByAsset = useMemo(() => {
    const grouped = new Map<string, OperatingAssetDirectoryEntry[]>();
    for (const entry of data.entries) {
      const entries = grouped.get(entry.assetId);
      if (entries) entries.push(entry);
      else grouped.set(entry.assetId, [entry]);
    }
    for (const entries of grouped.values()) {
      entries.sort(
        (a, b) =>
          (b.cashDate ?? b.periodStart ?? "").localeCompare(a.cashDate ?? a.periodStart ?? "") ||
          a.id.localeCompare(b.id),
      );
    }
    return grouped;
  }, [data.entries]);
  const rows = useMemo(() => {
    const scoped = data.assets
      .filter((asset) =>
        leaseCategory
          ? classifyOperatingLeaseMode(asset) === leaseCategory
          : category === "all" || asset.category === category,
      )
      .flatMap((asset) => {
        const entries = entriesByAsset.get(asset.id) ?? emptyEntries;
        const views =
          browseViewerId || assetBrowse
            ? operatingLeaseViews(asset, entries)
            : [{ key: asset.id, asset, entries }];
        return views.map((view) => directoryRow(view, today, !!browseViewerId));
      });
    if (leaseCategory || category !== "all") {
      const warehouseOrder = new Map([
        ["老仓库", 0],
        ["新仓库", 1],
        ["孵化园库房", 2],
      ]);
      scoped.sort((a, b) => {
        const groupOrder =
          leaseCategory === "multi-unit" || category === "warehouse"
            ? (warehouseOrder.get(a.asset.displayGroup) ?? 3) -
              (warehouseOrder.get(b.asset.displayGroup) ?? 3)
            : 0;
        return (
          groupOrder || nameCollators[locale].compare(a.asset.displayName, b.asset.displayName)
        );
      });
    }
    return scoped;
  }, [
    assetBrowse,
    browseViewerId,
    category,
    data.assets,
    entriesByAsset,
    leaseCategory,
    locale,
    today,
  ]);
  const showCollections = enableCollections && view === "collections";
  const locationMode =
    !!(browseViewerId || assetBrowse) && leaseCategory === "multi-unit" && !showCollections;
  const wholeMode =
    !!(browseViewerId || assetBrowse) && leaseCategory === "whole" && !showCollections;
  const activeSearch = browseViewerId && !assetBrowse ? (searchQuery ?? "").trim() : search;
  const isSearchView = !!browseViewerId && !assetBrowse && !leaseCategory;
  const emptySearch = isSearchView && !activeSearch;
  const browseCategory = leaseCategory ?? searchCategory ?? "apartment";
  const hasApartments = !emptySearch && (apartmentRows !== undefined || apartmentUnavailable);
  const showLeaseToolbar =
    !assetBrowse &&
    !showCollections &&
    (Boolean(browseViewerId || collectionHref) || enableCollections || hasApartments);
  const thisMonth = assetReportPeriod("month", today.slice(0, 7));
  const groupOptions = new Map<string, string>();
  const locations = new Map<
    string,
    { id: string; name: string; count: number; followUpCount: number }
  >();
  if (hasApartments) groupOptions.set("apartment", zh ? "公寓" : "Appartements");
  for (const { asset, attention } of rows) {
    if (locationMode) {
      const id = leaseSiteId(asset);
      let site = locations.get(id);
      if (!site) {
        const name = operatingLeaseLocation(asset) ?? (zh ? "场地未登记" : "Site non renseigné");
        site = { id, name, count: 0, followUpCount: 0 };
        locations.set(id, site);
        groupOptions.set(id, name);
      }
      site.count++;
      if (attention) site.followUpCount++;
    } else if (!browseViewerId && category === "all" && (showCollections || hasApartments)) {
      groupOptions.set(asset.category, operatingAssetCategoryLabel(asset.category, locale));
    } else if (category !== "all" && asset.displayGroup) {
      groupOptions.set(asset.displayGroup, asset.displayGroup);
    }
  }
  const activeGroup = groupOptions.has(selectedGroup)
    ? selectedGroup
    : locationMode
      ? (locations.keys().next().value ?? "")
      : "";
  let followUpHref = collectionHref;
  if (collectionHref && category === "all" && activeGroup) {
    const [pathname, query] = collectionHref.split("?");
    const params = new URLSearchParams(query);
    params.set("collectionCategory", activeGroup);
    followUpHref = `${pathname}?${params}`;
  }
  const scoped = emptySearch
    ? []
    : rows.filter(
        ({ asset }) =>
          !activeGroup ||
          (locationMode
            ? leaseSiteId(asset)
            : category === "all"
              ? asset.category
              : asset.displayGroup) === activeGroup,
      );
  const showApartments = hasApartments && (!activeGroup || activeGroup === "apartment");
  const matchingApartments = showApartments
    ? (apartmentRows?.filter((row) => leaseRoomMatchesSearch(row, activeSearch)) ?? [])
    : [];
  const apartmentFilter = cardFilter === "followup" ? "all" : cardFilter;
  const visibleApartmentCount = matchingApartments.filter((row) =>
    leaseRoomMatchesFilter(row, apartmentFilter),
  ).length;
  const showApartmentContent =
    showApartments && (apartmentUnavailable || visibleApartmentCount > 0);
  const visible = scoped.filter(({ asset }) => operatingAssetMatchesSearch(asset, activeSearch));
  const countableRows = isSearchView ? visible : scoped;
  const counts: Record<DirectoryFilter, number> = {
    all: countableRows.length,
    followup: 0,
    overdue: 0,
    upcoming: 0,
    review: 0,
  };
  for (const { attention } of countableRows) {
    if (attention) {
      counts[attention]++;
      counts.followup++;
    }
  }
  if (showApartments && apartmentRows) {
    const countableApartments = isSearchView ? matchingApartments : apartmentRows;
    for (const { key } of cardFilters) {
      counts[key] += countableApartments.filter((row) => leaseRoomMatchesFilter(row, key)).length;
    }
  }
  const matchingRows =
    (showLeaseToolbar || assetBrowse) && cardFilter !== "all"
      ? visible.filter((row) =>
          cardFilter === "followup" ? row.attention !== null : row.attention === cardFilter,
        )
      : visible;
  const groups = new Map<string, DirectoryRow[]>();
  if (!locationMode && !wholeMode) {
    for (const row of matchingRows) {
      const label = isSearchView
        ? leaseBrowseCategoryLabel(classifyOperatingLeaseMode(row.asset), locale)
        : category === "all"
          ? operatingAssetCategoryLabel(row.asset.category, locale)
          : row.asset.displayGroup || operatingAssetCategoryLabel(category, locale);
      const group = groups.get(label);
      if (group) group.push(row);
      else groups.set(label, [row]);
    }
  }
  const collectionRows = enableCollections
    ? visible.filter(
        (row): row is CollectionRow => row.followUp.status !== "current" && row.hasLeaseEvidence,
      )
    : [];
  const groupLabel =
    category === "all"
      ? zh
        ? "资产类别"
        : "Catégorie d’actifs"
      : zh
        ? "资产分组"
        : "Groupe d’actifs";
  const allGroupsLabel =
    category === "all"
      ? zh
        ? "全部类别"
        : "Toutes les catégories"
      : zh
        ? "全部分组"
        : "Tous les groupes";
  const groupItems = [
    { value: "", label: allGroupsLabel },
    ...Array.from(groupOptions, ([value, label]) => ({ value, label })),
  ];
  const selected = emptySearch
    ? undefined
    : (rows.find(({ key }) => key === selectedId) ??
      (selectedAssetSite?.id === selectedId && selectedAssetSite?.leaseGroups?.length
        ? directoryRow(
            {
              key: selectedAssetSite.id,
              asset: selectedAssetSite,
              entries: entriesByAsset.get(selectedAssetSite.id) ?? emptyEntries,
            },
            today,
            true,
          )
        : undefined));
  const apartmentContent =
    !showCollections && showApartmentContent ? (
      <ApartmentDirectorySection
        rows={apartmentRows ?? []}
        search={activeSearch}
        filter={apartmentFilter}
        locale={locale}
        unavailable={apartmentUnavailable}
        returnTo={isSearchView ? leaseSearchHref(locale, browseCategory, activeSearch) : undefined}
      />
    ) : null;
  const statusLabel = assetBrowse
    ? zh
      ? "资产状态筛选"
      : "Filtres des actifs"
    : zh
      ? "长租状态筛选"
      : "Filtres de suivi des locations";
  const statusOptions = cardFilters.map(({ key, labels }) => ({
    value: key as DirectoryFilter,
    label: key === "all" ? (zh ? "全部状态" : "Tous les statuts") : labels[lang],
    count: counts[key],
  }));
  if (locationMode) {
    statusOptions.splice(1, 0, {
      value: "followup",
      label: zh ? "需跟进" : "À suivre",
      count: counts.followup,
    });
  }
  const browseStatusFilter = (
    <LeaseBrowseStatusFilter
      label={statusLabel}
      value={cardFilter}
      options={statusOptions}
      onChange={(value) => {
        const nextFilter = statusOptions.find((option) => option.value === value);
        if (nextFilter) setCardFilter(nextFilter.value);
      }}
    />
  );
  const legacyStatusFilters = (
    <div className={leaseStyles.filters} role="group" aria-label={statusLabel}>
      {cardFilters.map(({ key, labels }) => (
        <button
          type="button"
          key={key}
          aria-pressed={cardFilter === key}
          onClick={() => setCardFilter(key)}
          className={cn(
            cardFilter === key && leaseStyles.activeFilter,
            key === "overdue" && counts.overdue > 0 && leaseStyles.filterOverdue,
          )}
        >
          {labels[lang]}
          <span>{counts[key]}</span>
        </button>
      ))}
    </div>
  );

  return (
    <section
      className={styles.directory}
      data-lease-view={showLeaseToolbar || undefined}
      aria-label={zh ? "经营资产目录" : "Répertoire des actifs"}
    >
      {assetBrowse ? (
        <header className={styles.assetOverviewHeading}>
          <h1>{zh ? "资产" : "Actifs"}</h1>
          <p>
            {zh
              ? "完整家底：按场地查看资产、客户与收支。"
              : "Tous les actifs, leurs clients et leurs paiements, par site."}
          </p>
        </header>
      ) : null}
      {browseViewerId && !assetBrowse ? (
        <>
          <LeaseBrowseToolbar locale={locale} category={browseCategory} searchQuery={searchQuery} />
          {isSearchView && !emptySearch ? (
            <header className={locationStyles.siteHeading}>
              <div className={styles.searchResultHeading}>
                <h2>{zh ? "跨类别搜索结果" : "Résultats toutes catégories"}</h2>
                <span>{zh ? `${counts[cardFilter]} 项` : `${counts[cardFilter]} résultat(s)`}</span>
              </div>
              {browseStatusFilter}
            </header>
          ) : null}
        </>
      ) : null}
      {!browseViewerId && showLeaseToolbar && groupOptions.size > 1 ? (
        <div className={styles.groupScope}>
          <span className={styles.note}>{groupLabel}</span>
          <SegmentedControl
            value={activeGroup}
            items={groupItems}
            onChange={setSelectedGroup}
            ariaLabel={groupLabel}
            className={styles.groupDesktop}
          />
          <select
            aria-label={groupLabel}
            className={cn(styles.groupSelect, styles.groupMobile)}
            value={activeGroup}
            onChange={(event) => setSelectedGroup(event.target.value)}
          >
            {groupItems.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {!browseViewerId || assetBrowse ? (
        <div className={showLeaseToolbar ? leaseStyles.toolbar : styles.toolbar}>
          {showLeaseToolbar ? legacyStatusFilters : null}
          <div className={showLeaseToolbar ? leaseStyles.tools : styles.toolbar}>
            <label className={showLeaseToolbar ? leaseStyles.search : styles.search}>
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label={zh ? "搜索经营资产" : "Rechercher un actif"}
                placeholder={zh ? "搜索名称、编号或租户" : "Nom, numéro ou locataire"}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {showLeaseToolbar ? null : (
              <span className={styles.note}>
                {zh ? `${visible.length} 项资产` : `${visible.length} actifs`}
              </span>
            )}
            {!showLeaseToolbar && !assetBrowse && groupOptions.size > 1 ? (
              <select
                aria-label={groupLabel}
                className={styles.groupSelect}
                value={activeGroup}
                onChange={(event) => setSelectedGroup(event.target.value)}
              >
                {groupItems.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : null}
            {followUpHref ? (
              <Link href={followUpHref} prefetch={false} className={leaseStyles.followupButton}>
                <CalendarClock size={15} aria-hidden="true" />
                {zh ? "收款跟进" : "Suivi des loyers"}
              </Link>
            ) : enableCollections ? (
              <button
                type="button"
                className={showLeaseToolbar ? leaseStyles.followupButton : styles.collectionToggle}
                aria-pressed={showCollections}
                onClick={() => setView(showCollections ? "cards" : "collections")}
              >
                <CalendarClock size={15} aria-hidden="true" />
                {zh ? "收款跟进" : "Suivi des loyers"}
                <span>{collectionRows.length}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {isSearchView && apartmentContent ? (
        <section className={styles.group}>
          <header className={styles.groupHeading}>
            <h2 className={styles.groupTitle}>{leaseBrowseCategoryLabel("apartment", locale)}</h2>
            {apartmentUnavailable ? null : (
              <span>
                {zh ? `${visibleApartmentCount} 项资产` : `${visibleApartmentCount} actifs`}
              </span>
            )}
          </header>
          {apartmentContent}
        </section>
      ) : (
        apartmentContent
      )}
      {showCollections ? (
        <AssetCollectionFollowUp
          rows={collectionRows}
          filter={followUpFilter}
          locale={locale}
          onFilter={setFollowUpFilter}
          onSelect={setSelectedId}
        />
      ) : locationMode ? (
        <OperatingLeaseLocations
          locale={locale}
          sites={Array.from(locations.values())}
          activeSite={activeGroup}
          rows={matchingRows}
          selectedAssetId={selected?.key ?? null}
          statusKey={cardFilter}
          statusFilter={browseStatusFilter}
          onSelectSite={changeGroup}
          onSelectAsset={setSelectedId}
        />
      ) : wholeMode ? (
        <OperatingWholeLeases
          rows={assetBrowse ? matchingRows : visible}
          locale={locale}
          today={today}
          initialAssetId={selectedAssetId}
          onOpenDetail={setSelectedId}
        />
      ) : groups.size ? (
        Array.from(groups, ([group, assets]) => (
          <section key={group} className={styles.group}>
            {category === "all" && !showLeaseToolbar ? (
              <h2>{group}</h2>
            ) : (
              <header className={styles.groupHeading}>
                <h2 className={styles.groupTitle}>{group}</h2>
                <span>{zh ? `${assets.length} 项资产` : `${assets.length} actifs`}</span>
              </header>
            )}
            <ul className={isSearchView ? locationStyles.cards : styles.cards}>
              {assets.map((row) =>
                isSearchView ? (
                  <OperatingLeaseCard
                    key={row.key}
                    row={row}
                    locale={locale}
                    selected={selected?.key === row.key}
                    onSelect={() => setSelectedId(row.key)}
                  />
                ) : (
                  <AssetDirectoryCard
                    key={row.key}
                    row={row}
                    period={thisMonth}
                    locale={locale}
                    selected={selected?.key === row.key}
                    onSelect={() => setSelectedId(row.key)}
                  />
                ),
              )}
            </ul>
          </section>
        ))
      ) : showApartmentContent ? null : (
        <p className={styles.empty}>
          {emptySearch
            ? zh
              ? "输入房号、资产名称或租户开始搜索。"
              : "Saisissez un lot, un actif ou un locataire pour commencer."
            : activeSearch.trim() || cardFilter !== "all"
              ? zh
                ? "未找到符合条件的资产。"
                : "Aucun actif ne correspond à la recherche."
              : zh
                ? "此分类暂无资产。"
                : "Aucun actif dans cette catégorie."}
        </p>
      )}
      {selected ? (
        <OperatingAssetDetail
          key={selected.key}
          leaseGroup={!!selected.groupKey}
          asset={selected.asset}
          entries={selected.entries}
          followUp={selected.followUp}
          locale={locale}
          today={today}
          leaseView={!!browseViewerId || assetBrowse}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </section>
  );
}

function AssetCollectionFollowUp({
  rows,
  filter,
  locale,
  onFilter,
  onSelect,
}: {
  rows: CollectionRow[];
  filter: FollowUpFilter;
  locale: Locale;
  onFilter: (filter: FollowUpFilter) => void;
  onSelect: (assetId: string) => void;
}) {
  const zh = locale === "zh";
  const lang = zh ? 0 : 1;
  const counts = { all: rows.length, overdue: 0, upcoming: 0, needs_evidence: 0 };
  for (const { followUp } of rows) {
    counts[followUp.status]++;
  }
  const visible = rows
    .filter(({ followUp }) => filter === "all" || filter === followUp.status)
    .sort(
      (a, b) =>
        followUpPriority[a.followUp.status] - followUpPriority[b.followUp.status] ||
        (a.followUp.status === "needs_evidence"
          ? Number(Boolean(b.followUp.outstanding)) - Number(Boolean(a.followUp.outstanding))
          : 0) ||
        (a.followUp.dueDate ?? a.followUp.paidThrough?.date ?? "9999-12-31").localeCompare(
          b.followUp.dueDate ?? b.followUp.paidThrough?.date ?? "9999-12-31",
        ) ||
        nameCollators[locale].compare(a.asset.displayName, b.asset.displayName),
    );
  const unregistered = zh ? "未登记" : "Non renseigné";
  return (
    <section
      className={styles.collectionPanel}
      aria-label={zh ? "集中收款跟进" : "Suivi des loyers regroupé"}
    >
      <header className={styles.collectionHeading}>
        <h2>{zh ? "收款跟进" : "Suivi des loyers"}</h2>
        <p className={styles.note}>
          {zh
            ? "根据已登记的付款日和未收金额跟进。租金覆盖日期和待补资料单独展示。"
            : "Le suivi s’appuie sur les échéances et soldes enregistrés. Les périodes couvertes et les données à compléter sont indiquées séparément."}
        </p>
        <div
          className={styles.collectionFilters}
          role="group"
          aria-label={zh ? "收款跟进筛选" : "Filtres de suivi"}
        >
          {(Object.keys(followUpLabels) as FollowUpFilter[]).map((key) => (
            <button
              type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => onFilter(key)}
            >
              {followUpLabels[key][lang]}
              <span>{counts[key]}</span>
            </button>
          ))}
        </div>
      </header>
      {visible.length ? (
        <ul className={styles.collectionRows}>
          {visible.map(({ key, asset, followUp }) => {
            const tenant = recordedTenant(asset, locale);
            return (
              <li key={key}>
                <button
                  type="button"
                  className={styles.collectionRow}
                  aria-haspopup="dialog"
                  onClick={() => onSelect(key)}
                >
                  <span>
                    <span>{asset.displayName}</span>
                    <small>
                      {asset.displayGroup || operatingAssetCategoryLabel(asset.category, locale)}
                    </small>
                    {tenant ? (
                      <small className={styles.collectionTenant}>
                        {tenant.label} {tenant.names}
                      </small>
                    ) : null}
                  </span>
                  <span>
                    <span
                      className={styles.status}
                      data-status={
                        followUp.status === "needs_evidence" ? "pending" : followUp.status
                      }
                    >
                      {followUpLabels[followUp.status][lang]}
                    </span>
                    {followUp.reason &&
                    followUp.reason !== "due_date_missing" &&
                    followUp.reason !== "paid_through_missing" ? (
                      <small>{followUpReasons[followUp.reason][lang]}</small>
                    ) : null}
                  </span>
                  <span>
                    <span
                      title={
                        followUp.dueSourceRef ? assetSourceLabel(followUp.dueSourceRef) : undefined
                      }
                    >
                      {zh ? "付款日" : "Échéance"} {followUp.dueDate ?? unregistered}
                    </span>
                    <small
                      title={
                        followUp.paidThrough
                          ? assetSourceLabel(followUp.paidThrough.sourceRef)
                          : undefined
                      }
                    >
                      {followUp.paidThrough?.status === "pending"
                        ? zh
                          ? "租金记载至"
                          : "Loyer documenté au"
                        : zh
                          ? "已交至"
                          : "Payé au"}{" "}
                      {followUp.paidThrough?.date ?? unregistered}
                    </small>
                  </span>
                  <span
                    className={styles.collectionAmount}
                    title={
                      followUp.outstanding
                        ? assetSourceLabel(followUp.outstanding.sourceRef)
                        : undefined
                    }
                  >
                    {followUp.outstanding
                      ? formatPropertyMoney(
                          followUp.outstanding.amountNative,
                          followUp.outstanding.currency,
                          locale,
                        )
                      : unregistered}
                    <small>
                      {followUp.outstanding
                        ? zh
                          ? "原表余款"
                          : "Solde enregistré"
                        : zh
                          ? "未收金额"
                          : "Solde à recevoir"}
                    </small>
                  </span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.collectionEmpty}>
          {zh ? "当前筛选没有需要跟进的记录。" : "Aucun suivi dans cette sélection."}
        </p>
      )}
    </section>
  );
}

function AssetDirectoryCard({
  row,
  period,
  locale,
  selected,
  onSelect,
}: {
  row: DirectoryRow;
  period: ReturnType<typeof assetReportPeriod>;
  locale: Locale;
  selected: boolean;
  onSelect: () => void;
}) {
  const { asset, entries, followUp, attention, pendingEntries } = row;
  const zh = locale === "zh";
  const lang = zh ? 0 : 1;
  const cash = summarizeOperatingAssetCash([asset], entries, period);
  const receipts = cash.originals.filter(({ income }) => income > 0);
  const coverage = followUp.paidThrough;
  const rent = referenceRent(asset, locale);
  const tenant = recordedTenant(asset, locale);
  const days = followUp.daysUntilDue;
  let attentionLabel: string | null = null;
  if (attention === "overdue") {
    attentionLabel =
      days === null
        ? followUpLabels.overdue[lang]
        : zh
          ? `逾期 ${Math.abs(days)} 天`
          : `Retard de ${Math.abs(days)} j`;
  } else if (attention === "upcoming") {
    attentionLabel =
      days === null
        ? followUpLabels.upcoming[lang]
        : days === 0
          ? zh
            ? "今日应缴"
            : "Dû aujourd’hui"
          : zh
            ? `${days} 天内应缴`
            : `Dû sous ${days} j`;
  } else if (attention === "review") {
    attentionLabel = pendingEntries
      ? zh
        ? `${pendingEntries} 笔历史流水待核`
        : `${pendingEntries} flux à vérifier`
      : asset.verification === "pending"
        ? zh
          ? "资料待核"
          : "Dossier à vérifier"
        : followUpLabels.needs_evidence[lang];
  }
  return (
    <li>
      <button
        type="button"
        className={styles.card}
        aria-haspopup="dialog"
        aria-pressed={selected}
        data-review={attention === "review" || undefined}
        data-collection-status={
          attention === "overdue" || attention === "upcoming" ? attention : undefined
        }
        onClick={onSelect}
      >
        <span className={styles.cardHeader}>
          <strong>{asset.displayName}</strong>
          <span className={styles.cardCategory}>
            {asset.leaseEvidence?.selfUse
              ? zh
                ? "自用"
                : "Usage propre"
              : operatingAssetCategoryLabel(asset.category, locale)}
          </span>
        </span>
        {tenant ? (
          <span className={styles.cardTenant} title={tenant.names}>
            <span>{tenant.label}</span>
            <span>{tenant.names}</span>
          </span>
        ) : null}
        <span className={styles.cardFact}>
          <span>{rent.label}</span>
          <span>{rent.amount}</span>
        </span>
        <span className={styles.cardFact}>
          <span>
            {coverage?.status === "pending"
              ? zh
                ? "租金记载至"
                : "Loyer documenté au"
              : zh
                ? "已交至"
                : "Payé au"}
          </span>
          <span>
            {coverage?.date ?? (zh ? "未登记" : "Non renseigné")}
            {coverage?.status === "pending" ? (zh ? " · 待核" : " · À vérifier") : ""}
          </span>
        </span>
        <span className={styles.cardFact}>
          <span>{zh ? "本月实收" : "Encaissé ce mois"}</span>
          <span>
            {receipts.length
              ? receipts
                  .map(({ income, currency }) => formatPropertyMoney(income, currency, locale))
                  .join(" · ")
              : zh
                ? "暂无"
                : "Aucun"}
          </span>
        </span>
        <span className={styles.cardFooter}>
          {attentionLabel ? (
            <span
              className={styles.status}
              data-status={attention === "review" ? "pending" : (attention ?? undefined)}
            >
              {attentionLabel}
            </span>
          ) : (
            <span className={styles.openHint}>{zh ? "查看资料" : "Voir le dossier"}</span>
          )}
          <span className={styles.cardAction}>
            {attentionLabel ? (
              <span className={styles.openHint}>{zh ? "查看资料" : "Voir le dossier"}</span>
            ) : null}
            <ArrowRight size={14} aria-hidden="true" />
          </span>
        </span>
      </button>
    </li>
  );
}
