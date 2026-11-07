"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CalendarClock, Search } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn, floorSortValue, normalizeFloorLabel } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { leaseRentLabel, nativeLease } from "@/lib/native-money";
import type { LeaseRoomOverviewRow } from "./lease-room-overview-model";
import styles from "./lease-room-overview.module.css";

type Filter = "all" | "overdue" | "upcoming" | "review";

function needsLeaseReview(row: LeaseRoomOverviewRow) {
  return row.conflict || row.reviewReasons.includes("active_record_has_end");
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

function tenantLabel(row: LeaseRoomOverviewRow, zh: boolean) {
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

function attentionLabel(row: LeaseRoomOverviewRow, zh: boolean) {
  if (needsLeaseReview(row)) return zh ? "租赁资料待核" : "Dossier à vérifier";
  const attention = row.attention;
  if (!attention) return null;
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

function attentionAmount(row: LeaseRoomOverviewRow, locale: Locale) {
  if (needsLeaseReview(row)) return locale === "zh" ? "查看资料核对" : "Vérifier le dossier";
  const value = row.attention;
  if (value && value.kind !== "coverage" && value.amount === null)
    return locale === "zh" ? "多币种 · 查看明细" : "Plusieurs devises · voir le détail";
  if (!value || value.amount === null) return locale === "zh" ? "金额待核" : "Montant à vérifier";
  const currency = value.currency ?? "XOF";
  const label = formatMoney(value.amount, currency, locale);
  return currency === "XOF" ? label : `${label} ${currency}`;
}

function monthlyRent(row: LeaseRoomOverviewRow, locale: Locale) {
  if (!row.contract) return "—";
  const amount = nativeLease(row.contract)
    ? Number(row.contract.monthly_rent_amount)
    : Number(row.contract.monthly_rent_xof);
  return Number.isFinite(amount) && amount > 0
    ? leaseRentLabel(row.contract, locale)
    : locale === "zh"
      ? "待核"
      : "À vérifier";
}

export function LeaseRoomOverview({
  rows,
  locale,
  loading,
  error,
  selectedUnitId,
  disabled = false,
  onSelectUnit,
  onRetry,
}: {
  rows: LeaseRoomOverviewRow[];
  locale: Locale;
  loading: boolean;
  error: boolean;
  selectedUnitId?: string | null;
  disabled?: boolean;
  onSelectUnit: (row: LeaseRoomOverviewRow) => void;
  onRetry: () => void;
}) {
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [followup, setFollowup] = useState(false);
  const rentalRows = useMemo(
    () => rows.filter((row) => row.contract !== null || needsLeaseReview(row)),
    [rows],
  );
  const counts = useMemo(
    () => ({
      all: rentalRows.length,
      overdue: rentalRows.filter(
        (row) => !needsLeaseReview(row) && row.attention?.kind === "overdue",
      ).length,
      upcoming: rentalRows.filter(
        (row) => !needsLeaseReview(row) && row.attention?.kind === "upcoming",
      ).length,
      review: rentalRows.filter(
        (row) => needsLeaseReview(row) || row.attention?.kind === "coverage",
      ).length,
    }),
    [rentalRows],
  );
  const searched = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return !query
      ? rentalRows
      : rentalRows.filter((row) =>
          `${row.unit.unit_no} ${row.unit.code} ${row.building?.display_name ?? ""} ${row.customer?.name ?? ""}`
            .toLocaleLowerCase()
            .includes(query),
        );
  }, [rentalRows, search]);
  const filtered = useMemo(
    () =>
      searched.filter(
        (row) =>
          filter === "all" ||
          (filter === "review"
            ? needsLeaseReview(row) || row.attention?.kind === "coverage"
            : !needsLeaseReview(row) && row.attention?.kind === filter),
      ),
    [searched, filter],
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
    for (const row of filtered) {
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
  }, [filtered, locale]);
  const followupRows = useMemo(
    () =>
      searched
        .filter((row) => needsLeaseReview(row) || row.attention)
        .sort((a, b) => {
          const rank = (row: LeaseRoomOverviewRow) =>
            row.attention?.kind === "overdue" ? 0 : row.attention?.kind === "upcoming" ? 1 : 2;
          return (
            rank(a) - rank(b) ||
            (a.attention?.dueDate ?? "").localeCompare(b.attention?.dueDate ?? "") ||
            a.unit.unit_no.localeCompare(b.unit.unit_no, undefined, { numeric: true })
          );
        }),
    [searched],
  );
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: text("全部租赁", "Toutes les locations") },
    { key: "overdue", label: text("已逾期", "En retard") },
    { key: "upcoming", label: text("15天内应缴", "Dû sous 15 jours") },
    { key: "review", label: text("待核事项", "À vérifier") },
  ];
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
      className={styles.overview}
      aria-label={text("楼栋长租房源", "Locations par bâtiment")}
    >
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
        </div>
      </div>
      {followup ? (
        <section
          className={styles.followup}
          aria-label={text("集中收款跟进", "Suivi des loyers regroupé")}
        >
          <div className={styles.followupHeading}>
            <h2>{text("收款跟进", "Suivi des loyers")}</h2>
            <p>
              {text(
                "当前楼栋与搜索范围，先处理逾期，再核对近期应缴及缴费资料。",
                "Bâtiment et recherche actuels : retards, échéances proches, puis données à vérifier.",
              )}
            </p>
          </div>
          {followupRows.length ? (
            <div className={styles.followupRows}>
              {followupRows.map((row) => (
                <button
                  type="button"
                  key={row.unit.id}
                  disabled={disabled}
                  onClick={() => onSelectUnit(row)}
                  className={styles.followupRow}
                >
                  <span>
                    <strong>
                      {row.building?.display_name} · {row.unit.unit_no}
                    </strong>
                    <small>
                      {tenantLabel(row, zh)}
                      {row.customer?.phone ? ` · ${row.customer.phone}` : ""}
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
      {!floors.length ? (
        <p className={styles.empty}>
          {rentalRows.length
            ? text("没有符合筛选条件的租赁。", "Aucune location ne correspond aux filtres.")
            : text(
                "当前楼栋暂无租赁记录。历史资料可在明细核对中查阅。",
                "Aucune location actuelle dans ce bâtiment. Consultez l’historique dans le détail à vérifier.",
              )}
        </p>
      ) : (
        floors.map((floor) => (
          <section
            key={floor.key}
            className={styles.floor}
            aria-label={`${floor.building} ${floor.floor}`}
          >
            <header>
              <h2>
                {floor.building}
                <span>{floor.floor}</span>
              </h2>
              <p>
                {floor.rows.length} {text("间", "lots")}
              </p>
            </header>
            <div className={styles.roomGrid}>
              {floor.rows.map((row) => {
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
