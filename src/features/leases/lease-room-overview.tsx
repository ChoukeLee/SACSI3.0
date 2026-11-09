"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight, CalendarClock, Search } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn, floorSortValue, normalizeFloorLabel } from "@/lib/utils";
import { formatPropertyMoney, propertyLeaseRentLabel } from "@/lib/property-money";
import { nativeLease } from "@/lib/native-money";
import { LeaseBrowseStatusFilter, LeaseLocationIndex } from "./lease-browse-content";
import {
  leaseRoomMatchesSearch,
  type LeaseRecordAttention,
  type LeaseRecordOverviewRow,
  type LeaseRoomOverviewRow,
} from "./lease-room-overview-model";
import styles from "./lease-room-overview.module.css";

export type LeaseRoomFilter = "all" | "overdue" | "upcoming" | "review";

type RoomFollowUp = Exclude<LeaseRoomFilter, "all">;
type BuildingBrowse = {
  locations: readonly { id: string; display_name: string; code: string }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filter: LeaseRoomFilter;
  onFilterChange: (filter: LeaseRoomFilter) => void;
  focusOnNavigation: RefObject<boolean>;
};

function needsLeaseReview(row: Pick<LeaseRoomOverviewRow, "conflict" | "reviewReasons">) {
  return row.conflict || row.reviewReasons.includes("active_record_has_end");
}

function roomFollowUp(row: LeaseRoomOverviewRow, includePeriodReview = false): RoomFollowUp | null {
  if (needsLeaseReview(row) || row.attention?.kind === "coverage") return "review";
  if (row.attention) return row.attention.kind;
  return includePeriodReview && row.reviewReasons.includes("registered_period_needs_review")
    ? "review"
    : null;
}

export function leaseRoomMatchesFilter(row: LeaseRoomOverviewRow, filter: LeaseRoomFilter) {
  return filter === "all" || roomFollowUp(row) === filter;
}

export function leaseRoomFloorLabel(unit: LeaseRoomOverviewRow["unit"], locale: Locale) {
  const recorded = unit.floor_label?.trim();
  if (recorded)
    return /^\d+\s*(?:F|楼|层)?$/i.test(recorded)
      ? normalizeFloorLabel(recorded, unit.unit_no)
      : recorded;
  const inferred = normalizeFloorLabel(null, unit.unit_no);
  return inferred && inferred !== "F"
    ? inferred
    : locale === "zh"
      ? "楼层待登记"
      : "Étage à renseigner";
}

function roomFloorSort(label: string) {
  const basement = label.match(/^(?:B|地下)\s*(\d+)/i);
  if (basement) return -Number(basement[1]);
  const chinese = label.match(/^(?:第)?([一二三四五六七八九十]+)[楼层]$/)?.[1];
  if (!chinese) return floorSortValue(label);
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (chinese.includes("十")) {
    const [tens, ones] = chinese.split("十");
    return (tens ? (digits[tens] ?? 1) : 1) * 10 + (digits[ones] ?? 0);
  }
  return digits[chinese] ?? floorSortValue(label);
}

function occupancyLabel(row: LeaseRoomOverviewRow, zh: boolean) {
  if (needsLeaseReview(row)) return zh ? "租赁待核" : "Location à vérifier";
  const labels: Record<LeaseRoomOverviewRow["occupancy"], [string, string]> = {
    leased: ["在租", "Loué"],
    scheduled: ["待起租", "Location à venir"],
    reserved: ["已预留", "Réservé"],
    self_use: ["自用", "Usage interne"],
    available: ["可用", "Disponible"],
    maintenance: ["维修中", "Maintenance"],
    locked: ["已锁定", "Bloqué"],
    other_occupied: ["使用中", "Occupé"],
    unknown: ["状态待核", "État à vérifier"],
    conflict: ["租赁待核", "Locations à vérifier"],
  };
  return labels[row.occupancy][zh ? 0 : 1];
}

export function leaseRoomOccupancyLabel(row: LeaseRoomOverviewRow, locale: Locale) {
  return occupancyLabel(row, locale === "zh");
}

function tenantLabel(
  row: Pick<LeaseRoomOverviewRow, "conflict" | "reviewReasons" | "contract" | "customer">,
  zh: boolean,
) {
  if (row.conflict) return zh ? "多条租赁记录待核" : "Plusieurs locations à vérifier";
  if (row.reviewReasons.includes("active_record_has_end"))
    return zh ? "租赁状态待核" : "Statut locatif à vérifier";
  if (row.customer?.name) return row.customer.name;
  return row.contract
    ? zh
      ? "租客待登记"
      : "Locataire à compléter"
    : zh
      ? "暂无当前租赁"
      : "Aucune location en cours";
}

function attentionLabel(
  row: Pick<LeaseRoomOverviewRow, "conflict" | "reviewReasons"> & {
    attention: LeaseRecordAttention | null;
  },
  zh: boolean,
) {
  const attention = row.attention;
  if (needsLeaseReview(row) && (!attention || attention.kind === "coverage"))
    return zh ? "租赁资料待核" : "Dossier à vérifier";
  if (!attention) return null;
  if (attention.kind === "unsettled") return zh ? "历史待结清" : "Ancien solde à régler";
  if (attention.kind === "overdue")
    return attention.days === null
      ? zh
        ? "已逾期"
        : "En retard"
      : zh
        ? `逾期 ${Math.abs(attention.days)} 天`
        : `Retard de ${Math.abs(attention.days)} j`;
  if (attention.kind === "upcoming")
    return attention.days === null
      ? zh
        ? "近期应缴"
        : "Échéance proche"
      : attention.days === 0
        ? zh
          ? "今日应缴"
          : "Dû aujourd’hui"
        : zh
          ? `${attention.days} 天内应缴`
          : `Dû sous ${attention.days} j`;
  return zh ? "缴费待核" : "Paiement à vérifier";
}

function attentionAmount(
  row: Pick<LeaseRoomOverviewRow, "conflict" | "reviewReasons"> & {
    attention: LeaseRecordAttention | null;
  },
  locale: Locale,
) {
  const value = row.attention;
  if (needsLeaseReview(row) && (!value || value.kind === "coverage"))
    return locale === "zh" ? "查看资料核对" : "Vérifier le dossier";
  if (value && value.kind !== "coverage" && value.amount === null)
    return locale === "zh" ? "多币种 · 查看明细" : "Plusieurs devises · voir le détail";
  if (!value || value.amount === null) return locale === "zh" ? "金额待核" : "Montant à vérifier";
  const currency = value.currency ?? "XOF";
  const label = formatPropertyMoney(value.amount, currency, locale);
  return currency === "XOF" ? label : `${label} ${currency}`;
}

function recordStatusLabel(row: LeaseRecordOverviewRow, zh: boolean) {
  if (needsLeaseReview(row) || row.reviewReasons.includes("record_status_end_conflict"))
    return zh ? "租赁待核" : "Location à vérifier";
  if (row.contract.status === "expired") return zh ? "已过期" : "Expiré";
  if (row.contract.status === "terminated") return zh ? "已终止" : "Résilié";
  if (row.historical) return zh ? "历史租赁" : "Ancienne location";
  if (row.contract.status === "draft") return zh ? "草稿 · 待起租" : "Brouillon · à venir";
  return row.occupancy === "scheduled"
    ? zh
      ? "待起租"
      : "À venir"
    : zh
      ? "当前租赁"
      : "Location actuelle";
}

function recordSearchText(row: LeaseRecordOverviewRow) {
  return [
    row.unit.unit_no,
    row.unit.code,
    row.building?.display_name,
    row.customer?.name,
    row.contract.contract_no,
    row.contract.start_date,
    row.contract.expected_end_date,
    row.contract.actual_end_date,
    row.paidThrough,
    row.contract.status,
    recordStatusLabel(row, true),
    recordStatusLabel(row, false),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function leaseRecordPeriodLabel(
  contract: LeaseRecordOverviewRow["contract"],
  locale: Locale,
) {
  const zh = locale === "zh";
  const start = contract.start_date || (zh ? "起租待补" : "Début à compléter");
  if (contract.actual_end_date)
    return `${start} · ${zh ? "实际结束" : "Fin effective"} ${contract.actual_end_date}`;
  const end =
    !contract.expected_end_date || contract.expected_end_confirmed === false
      ? zh
        ? "到期待补"
        : "Fin à compléter"
      : contract.expected_end_date >= "2099-01-01"
        ? zh
          ? "长期"
          : "Long terme"
        : contract.expected_end_date;
  return `${start} · ${zh ? "约定至" : "Fin prévue"} ${end}`;
}

function monthlyRent(row: LeaseRoomOverviewRow, locale: Locale) {
  if (!row.contract) return "—";
  const amount = nativeLease(row.contract)
    ? Number(row.contract.monthly_rent_amount)
    : Number(row.contract.monthly_rent_xof);
  return Number.isFinite(amount) && amount > 0
    ? propertyLeaseRentLabel(row.contract, locale)
    : locale === "zh"
      ? "待核"
      : "À vérifier";
}

function CompactRoomCard({
  row,
  building,
  locale,
  selected,
  disabled,
  includePeriodReview,
  onSelect,
}: {
  row: LeaseRoomOverviewRow;
  building: string;
  locale: Locale;
  selected: boolean;
  disabled: boolean;
  includePeriodReview: boolean;
  onSelect: (row: LeaseRoomOverviewRow) => void;
}) {
  const zh = locale === "zh";
  const tenant = tenantLabel(row, zh);
  const followUp = roomFollowUp(row, includePeriodReview);
  const periodReview = row.reviewReasons.includes("registered_period_needs_review");
  const attention = needsLeaseReview(row)
    ? zh
      ? "租赁资料待核"
      : "Dossier à vérifier"
    : (attentionLabel(row, zh) ?? (periodReview ? (zh ? "租期待核" : "Période à vérifier") : null));
  const paidThroughLabel = zh ? "已交至" : "Payé au";
  const paidThrough = row.contract ? (row.paidThrough ?? (zh ? "未登记" : "Non renseigné")) : "—";
  const occupancy =
    row.occupancy !== "leased" && !needsLeaseReview(row) ? occupancyLabel(row, zh) : null;

  return (
    <button
      type="button"
      data-room-id={row.unit.id}
      data-follow-up={followUp ?? undefined}
      className={styles.compactRoom}
      lang={locale}
      disabled={disabled}
      aria-label={[
        `${building} ${row.unit.unit_no}`,
        tenant,
        occupancy,
        `${paidThroughLabel} ${paidThrough}`,
        attention,
      ]
        .filter(Boolean)
        .join(" · ")}
      aria-haspopup="dialog"
      aria-pressed={selected}
      onClick={() => onSelect(row)}
    >
      <span className={styles.compactIdentity}>
        <strong title={row.unit.unit_no}>{row.unit.unit_no}</strong>
        <span title={tenant}>{tenant}</span>
        {occupancy ? <small title={occupancy}>{occupancy}</small> : null}
      </span>
      <span className={styles.compactRoomFacts}>
        <span className={styles.compactPaidThrough} title={`${paidThroughLabel} ${paidThrough}`}>
          {paidThroughLabel}{" "}
          {row.paidThrough ? <time dateTime={paidThrough}>{paidThrough}</time> : paidThrough}
        </span>
        {attention ? (
          <span className={styles.compactAttention} title={attention}>
            {attention}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function LeaseRoomOverview({
  rows,
  records,
  locale,
  loading,
  error,
  selectedUnitId,
  disabled = false,
  buildingBrowse,
  embedded,
  onSelectUnit,
  onSelectRecord,
  onRetry,
}: {
  rows: LeaseRoomOverviewRow[];
  records: LeaseRecordOverviewRow[];
  locale: Locale;
  loading: boolean;
  error: boolean;
  selectedUnitId?: string | null;
  disabled?: boolean;
  buildingBrowse?: BuildingBrowse;
  embedded?: { search: string; filter: LeaseRoomFilter };
  onSelectUnit: (row: LeaseRoomOverviewRow) => void;
  onSelectRecord: (row: LeaseRecordOverviewRow) => void;
  onRetry: () => void;
}) {
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const [filter, setFilter] = useState<LeaseRoomFilter>("all");
  const [search, setSearch] = useState("");
  const [followup, setFollowup] = useState(false);
  const [history, setHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("historical");
  const browseHeading = useRef<HTMLHeadingElement>(null);
  const navigationFocus = buildingBrowse?.focusOnNavigation;
  const activeBuildingId = buildingBrowse?.selectedId;
  useEffect(() => {
    if (!navigationFocus?.current || loading || error) return;
    navigationFocus.current = false;
    browseHeading.current?.focus({ preventScroll: true });
  }, [navigationFocus, activeBuildingId, loading, error]);

  const compact = Boolean(buildingBrowse && !embedded);
  const compactCards = compact || Boolean(embedded);
  const buildingIndex = compact && !activeBuildingId;
  const showAllRooms = !!embedded;
  const activeFilter = embedded?.filter ?? buildingBrowse?.filter ?? filter;
  const activeSearch = embedded?.search ?? search;
  const rentalRows = useMemo(
    () =>
      showAllRooms ? rows : rows.filter((row) => row.contract !== null || needsLeaseReview(row)),
    [rows, showAllRooms],
  );
  const { counts, locationTotals } = useMemo(() => {
    const counts = { all: rentalRows.length, overdue: 0, upcoming: 0, review: 0 };
    const locationTotals = new Map<string, { count: number; followUp: number; matching: number }>();
    for (const row of rentalRows) {
      const status = roomFollowUp(row, compact);
      if (status) counts[status]++;
      if (!buildingIndex) continue;
      const id = row.unit.building_id;
      const totals = locationTotals.get(id) ?? { count: 0, followUp: 0, matching: 0 };
      totals.count++;
      if (status) totals.followUp++;
      if (activeFilter === "all" || activeFilter === status) totals.matching++;
      locationTotals.set(id, totals);
    }
    return { counts, locationTotals };
  }, [rentalRows, compact, buildingIndex, activeFilter]);
  const filtered = useMemo(
    () =>
      rentalRows.filter(
        (row) =>
          leaseRoomMatchesSearch(row, activeSearch) &&
          (activeFilter === "all" || roomFollowUp(row, compact) === activeFilter),
      ),
    [rentalRows, activeSearch, activeFilter, compact],
  );
  const floors = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        building: string;
        buildingCode: string;
        floor: string;
        rows: LeaseRoomOverviewRow[];
      }
    >();
    for (const row of buildingIndex ? [] : filtered) {
      const floor = leaseRoomFloorLabel(row.unit, locale);
      const key = `${row.unit.building_id}/${floor}`;
      const group = groups.get(key) ?? {
        key,
        building: row.building?.display_name ?? row.building?.code ?? "—",
        buildingCode: row.building?.code ?? "",
        floor,
        rows: [],
      };
      group.rows.push(row);
      groups.set(key, group);
    }
    return [...groups.values()]
      .sort(
        (a, b) =>
          a.buildingCode.localeCompare(b.buildingCode, undefined, { numeric: true }) ||
          roomFloorSort(a.floor) - roomFloorSort(b.floor),
      )
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort((a, b) =>
          a.unit.unit_no.localeCompare(b.unit.unit_no, undefined, { numeric: true }),
        ),
      }));
  }, [filtered, locale, buildingIndex]);
  const followupRows = useMemo(
    () =>
      records
        .filter(
          (row) =>
            !search.trim() || recordSearchText(row).includes(search.trim().toLocaleLowerCase()),
        )
        .filter((row) => needsLeaseReview(row) || row.attention)
        .sort((a, b) => {
          const rank = (row: LeaseRecordOverviewRow) =>
            row.attention?.kind === "overdue"
              ? 0
              : row.attention?.kind === "upcoming"
                ? 1
                : row.attention?.kind === "unsettled"
                  ? 2
                  : 3;
          return (
            rank(a) - rank(b) ||
            (a.attention?.dueDate ?? "").localeCompare(b.attention?.dueDate ?? "") ||
            a.unit.unit_no.localeCompare(b.unit.unit_no, undefined, { numeric: true })
          );
        }),
    [records, search],
  );
  const historyRows = useMemo(() => {
    const query = historySearch.trim().toLocaleLowerCase();
    return records.filter(
      (row) =>
        (historyStatus === "all" ||
          (historyStatus === "historical"
            ? row.historical
            : historyStatus === "current"
              ? !row.historical
              : row.contract.status === historyStatus)) &&
        (!query || recordSearchText(row).includes(query)),
    );
  }, [records, historySearch, historyStatus]);
  const filters: { key: LeaseRoomFilter; label: string }[] = [
    { key: "all", label: text("全部租赁", "Toutes les locations") },
    { key: "overdue", label: text("已逾期", "En retard") },
    { key: "upcoming", label: text("15天内应缴", "Dû sous 15 jours") },
    { key: "review", label: text("待核事项", "À vérifier") },
  ];
  const activeBuilding = buildingBrowse?.locations.find(({ id }) => id === activeBuildingId);
  const historicalLocations =
    buildingIndex && activeFilter === "all"
      ? new Set(records.filter((row) => row.historical).map((row) => row.unit.building_id))
      : undefined;
  const buildingLocations = buildingIndex
    ? (buildingBrowse?.locations ?? []).flatMap(({ id, display_name, code }) => {
        const total = locationTotals.get(id);
        if (!total?.matching && !historicalLocations?.has(id)) return [];
        return [
          {
            id,
            name: display_name || code,
            countLabel: total
              ? text(`${total.count} 间租赁房源`, `${total.count} lots en location`)
              : text("仅历史租赁", "Historique uniquement"),
            followUpLabel: total
              ? text(`待跟进 ${total.followUp} 间`, `${total.followUp} à suivre`)
              : "",
            hasFollowUp: Boolean(total?.followUp),
          },
        ];
      })
    : [];
  if (error || loading)
    return (
      <section className={styles.unavailable} role={error ? "alert" : "status"} aria-busy={loading}>
        <h2>
          {error
            ? text("长租房源暂时无法读取", "Locations momentanément indisponibles")
            : text("正在读取长租房源…", "Chargement des locations…")}
        </h2>
        <p>
          {error
            ? text(
                "请重试读取当前楼栋；暂不显示旧租赁或旧缴费信息。",
                "Réessayez pour ce bâtiment ; les anciennes locations et paiements sont masqués.",
              )
            : text(
                "按当前楼栋核对房间与租赁记录。",
                "Rapprochement des lots et des locations du bâtiment.",
              )}
        </p>
        {error ? (
          <button type="button" onClick={onRetry}>
            {text("重试", "Réessayer")}
          </button>
        ) : null}
      </section>
    );
  return (
    <section
      className={cn(styles.overview, compactCards && styles.compactOverview)}
      aria-label={text("楼栋长租房源", "Locations par bâtiment")}
    >
      {compact && buildingBrowse ? (
        <header className={styles.browseHeader}>
          <div className={styles.browseTitle}>
            {activeBuildingId ? (
              <button
                type="button"
                className={styles.browseBack}
                aria-label={text("返回全部楼栋", "Revenir à tous les bâtiments")}
                disabled={disabled}
                onClick={() => buildingBrowse.onSelect(null)}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                {text("全部楼栋", "Tous les bâtiments")}
              </button>
            ) : null}
            <h2 ref={browseHeading} tabIndex={-1}>
              {activeBuilding?.display_name ||
                activeBuilding?.code ||
                text("楼栋一览", "Bâtiments")}
            </h2>
            <span>{text(`${counts.all} 间租赁房源`, `${counts.all} lots en location`)}</span>
          </div>
          <div className={styles.browseActions}>
            <LeaseBrowseStatusFilter
              label={text("房源跟进筛选", "Filtres de suivi")}
              value={activeFilter}
              options={filters.map(({ key, label }) => ({
                value: key,
                label,
                count: counts[key],
              }))}
              onChange={(value) => {
                const choice = filters.find(({ key }) => key === value);
                if (choice) buildingBrowse.onFilterChange(choice.key);
              }}
            />
            <button
              type="button"
              className={styles.browseHistory}
              aria-expanded={history}
              onClick={() => setHistory((value) => !value)}
            >
              {text("查看历史", "Voir l’historique")}
            </button>
          </div>
        </header>
      ) : null}
      {!embedded && !compact ? (
        <div className={styles.toolbar}>
          <div
            className={styles.filters}
            role="group"
            aria-label={text("房源跟进筛选", "Filtres de suivi")}
          >
            {filters.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
                className={cn(
                  filter === item.key && styles.activeFilter,
                  item.key === "overdue" && counts.overdue > 0 && styles.filterOverdue,
                )}
              >
                {item.label}
                <span>{counts[item.key]}</span>
              </button>
            ))}
          </div>
          <div className={styles.tools}>
            <label className={styles.search}>
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">
                {text("搜索房号或租客", "Rechercher un lot ou locataire")}
              </span>
              <input
                type="search"
                placeholder={text("搜索房号或租客", "Lot ou locataire")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button
              type="button"
              className={styles.followupButton}
              aria-expanded={followup}
              onClick={() => setFollowup((value) => !value)}
            >
              <CalendarClock size={15} aria-hidden="true" />
              {text("收款跟进", "Suivi des loyers")}
              <span>{followupRows.length}</span>
            </button>
            <button
              type="button"
              className={styles.followupButton}
              aria-expanded={history}
              onClick={() => setHistory((value) => !value)}
            >
              {text("查看历史", "Voir l’historique")}
            </button>
          </div>
        </div>
      ) : null}
      {!embedded && !compact && followup ? (
        <section
          className={styles.followup}
          aria-label={text("集中收款跟进", "Suivi des loyers regroupé")}
        >
          <div className={styles.followupHeading}>
            <h2>{text("收款跟进", "Suivi des loyers")}</h2>
            <p>
              {text(
                "包含历史租赁的未结清款；按每次租赁单独跟进，条目数可能多于当前房间数。",
                "Inclut les soldes non réglés des anciennes locations ; chaque location est suivie séparément, leur nombre peut dépasser celui des lots actuels.",
              )}
            </p>
          </div>
          {followupRows.length ? (
            <div className={styles.followupRows}>
              {followupRows.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  data-followup-record-id={row.id}
                  disabled={disabled}
                  onClick={() => onSelectRecord(row)}
                  className={styles.followupRow}
                >
                  <span>
                    <strong>
                      {row.building?.display_name} · {row.unit.unit_no}
                    </strong>
                    <small>
                      {row.customer?.name ?? text("租客待登记", "Locataire à compléter")}
                      {row.customer?.phone ? ` · ${row.customer.phone}` : ""}
                    </small>
                    <small>
                      {row.historical
                        ? text("历史租赁", "Ancienne location")
                        : text("当前租赁", "Location actuelle")}{" "}
                      · {row.contract.start_date || "—"}
                    </small>
                  </span>
                  <span
                    className={
                      row.attention?.kind === "overdue" ? styles.redText : styles.amberText
                    }
                  >
                    <strong>{attentionLabel(row, zh)}</strong>
                    <small>
                      {row.attention?.kind === "coverage" || needsLeaseReview(row)
                        ? text("查看资料核对", "Vérifier le dossier")
                        : row.attention?.dueDate}
                    </small>
                  </span>
                  <span className={styles.followupAmount}>
                    {attentionAmount(row, locale)}
                    <ArrowRight size={15} aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>
              {text("当前范围没有需要跟进的记录。", "Aucun suivi dans ce périmètre.")}
            </p>
          )}
        </section>
      ) : null}
      {!embedded && history ? (
        <section
          className={styles.followup}
          aria-label={text("租赁记录查询", "Recherche de locations")}
        >
          <div className={styles.followupHeading}>
            <h2>{text("租赁记录", "Dossiers de location")}</h2>
            <p>
              {text(
                "历史按每次租赁保留，点击查看该次租赁资料与已有收付款。",
                "Chaque location reste distincte. Ouvrez un dossier pour consulter ses données et paiements.",
              )}
            </p>
            <div className={styles.historyControls}>
              <label className={styles.search}>
                <Search size={15} aria-hidden="true" />
                <span className="sr-only">{text("搜索租赁记录", "Rechercher une location")}</span>
                <input
                  type="search"
                  value={historySearch}
                  placeholder={text("房号、租客或日期", "Lot, locataire ou date")}
                  onChange={(event) => setHistorySearch(event.target.value)}
                />
              </label>
              <select
                aria-label={text("租赁记录状态", "Statut des locations")}
                value={historyStatus}
                onChange={(event) => setHistoryStatus(event.target.value)}
              >
                {[
                  ["historical", text("历史租赁", "Anciennes locations")],
                  ["all", text("全部记录", "Tous les dossiers")],
                  ["current", text("当前租赁", "Locations actuelles")],
                  ["draft", text("草稿", "Brouillons")],
                  ["active", text("生效", "Actifs")],
                  ["terminated", text("已终止", "Résiliés")],
                  ["expired", text("已过期", "Expirés")],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span>
                {historyRows.length} {text("条", "dossiers")}
              </span>
            </div>
          </div>
          <div className={styles.followupRows}>
            {historyRows.map((row) => (
              <button
                type="button"
                key={row.id}
                data-history-record-id={row.id}
                disabled={disabled}
                className={styles.followupRow}
                onClick={() => onSelectRecord(row)}
                aria-label={`${text("查看租赁记录", "Voir la location")} ${row.building?.display_name ?? ""} ${row.unit.unit_no} · ${row.customer?.name ?? "—"} · ${row.contract.start_date || "—"}`}
              >
                <span>
                  <strong>
                    {row.building?.display_name} · {row.unit.unit_no}
                  </strong>
                  <small>{row.customer?.name ?? text("租客待登记", "Locataire à compléter")}</small>
                </span>
                <span>
                  <strong>{recordStatusLabel(row, zh)}</strong>
                  <small>{leaseRecordPeriodLabel(row.contract, locale)}</small>
                </span>
                <span className={styles.followupAmount}>
                  {attentionLabel(row, zh) ?? text("查看资料", "Voir le dossier")}
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
          {!historyRows.length ? (
            <p className={styles.empty}>
              {text("没有符合条件的租赁记录。", "Aucun dossier correspondant.")}
            </p>
          ) : null}
        </section>
      ) : null}
      {buildingIndex && buildingLocations.length && buildingBrowse ? (
        <LeaseLocationIndex
          label={text("长租楼栋", "Bâtiments en location")}
          locations={buildingLocations}
          onSelect={(id) => {
            if (!disabled) buildingBrowse.onSelect(id);
          }}
        />
      ) : !floors.length ? (
        embedded ? null : (
          <p className={styles.empty}>
            {rentalRows.length
              ? text(
                  "没有符合筛选条件的当前租赁。",
                  "Aucune location actuelle ne correspond aux filtres.",
                )
              : text(
                  "当前楼栋暂无当前租赁；可展开“查看历史”查阅此前租赁。",
                  "Aucune location actuelle dans ce bâtiment. Ouvrez l’historique pour consulter les anciennes locations.",
                )}
          </p>
        )
      ) : (
        floors.map((floor) => (
          <section
            key={floor.key}
            className={cn(styles.floor, compactCards && styles.compactFloor)}
            aria-label={`${floor.building} ${floor.floor}`}
          >
            <header>
              <h2>
                {compact ? (
                  floor.floor
                ) : (
                  <>
                    {floor.building}
                    <span>{floor.floor}</span>
                  </>
                )}
              </h2>
              <p>
                {floor.rows.length} {text("间", "lots")}
              </p>
            </header>
            <div className={compactCards ? styles.compactRoomGrid : styles.roomGrid}>
              {floor.rows.map((row) => {
                if (compactCards)
                  return (
                    <CompactRoomCard
                      key={row.unit.id}
                      row={row}
                      building={floor.building}
                      locale={locale}
                      selected={selectedUnitId === row.unit.id}
                      disabled={disabled}
                      includePeriodReview={compact}
                      onSelect={onSelectUnit}
                    />
                  );
                const attention = attentionLabel(row, zh);
                const periodReview =
                  !attention && row.reviewReasons.includes("registered_period_needs_review");
                return (
                  <button
                    type="button"
                    key={row.unit.id}
                    data-room-id={row.unit.id}
                    className={cn(
                      styles.room,
                      row.attention?.kind === "overdue" && !row.conflict
                        ? styles.overdueRoom
                        : row.attention?.kind === "upcoming"
                          ? styles.upcomingRoom
                          : null,
                      selectedUnitId === row.unit.id && styles.selectedRoom,
                    )}
                    disabled={disabled}
                    aria-label={`${floor.building} ${row.unit.unit_no} · ${tenantLabel(row, zh)}${attention ? ` · ${attention}` : periodReview ? ` · ${text("租期待核", "Période à vérifier")}` : ""}`}
                    aria-pressed={selectedUnitId === row.unit.id}
                    onClick={() => onSelectUnit(row)}
                  >
                    <span className={styles.roomHeading}>
                      <strong>{row.unit.unit_no}</strong>
                      <span
                        className={cn(
                          styles.occupancy,
                          row.occupancy === "available" && styles.available,
                        )}
                      >
                        {occupancyLabel(row, zh)}
                      </span>
                    </span>
                    <span className={styles.tenant} title={tenantLabel(row, zh)}>
                      {tenantLabel(row, zh)}
                    </span>
                    <span className={styles.fact}>
                      <span>{text("月租", "Loyer/mois")}</span>
                      <strong>{monthlyRent(row, locale)}</strong>
                    </span>
                    <span className={styles.fact}>
                      <span>{text("已交至", "Payé au")}</span>
                      <strong>
                        {row.contract ? (row.paidThrough ?? text("未登记", "Non renseigné")) : "—"}
                      </strong>
                    </span>
                    <span className={styles.roomFooter}>
                      {attention ? (
                        <span
                          className={cn(
                            styles.attention,
                            row.attention?.kind === "overdue" && !row.conflict
                              ? styles.overdueAttention
                              : row.attention?.kind === "upcoming"
                                ? styles.upcomingAttention
                                : styles.reviewAttention,
                          )}
                        >
                          {attention}
                        </span>
                      ) : periodReview ? (
                        <span className={cn(styles.attention, styles.reviewAttention)}>
                          {text("租期待核", "Période à vérifier")}
                        </span>
                      ) : (
                        <span className={styles.openHint}>
                          {text("查看资料", "Voir le dossier")}
                        </span>
                      )}
                      <ArrowRight size={14} aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
