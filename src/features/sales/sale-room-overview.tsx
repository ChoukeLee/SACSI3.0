"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import type { Locale } from "@/lib/i18n";
import type { SaleRecordOverviewRow, SaleRoomOverviewRow } from "./sale-room-overview-model";
import styles from "./sale-room-overview.module.css";

type Filter = "all" | "overdue" | "upcoming" | "review";

function needsReview(row: SaleRoomOverviewRow) {
  return (
    row.conflict ||
    Boolean(row.record?.reviewReasons.length) ||
    row.record?.attention?.kind === "review"
  );
}

function searchText(record: SaleRecordOverviewRow) {
  return [
    record.unit.unit_no,
    record.unit.code,
    record.building?.display_name,
    record.customer?.name,
    record.customer?.phone,
    record.contract.contract_no,
    record.contract.signed_date,
    record.contract.transfer_date,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function amounts(values: SaleRecordOverviewRow["receivedNative"], locale: Locale) {
  return values
    .map(
      (value) =>
        `${formatMoney(value.amount, value.currency, locale)}${value.currency === "XOF" ? "" : ` ${value.currency}`}`,
    )
    .join(" · ");
}

function attentionLabel(record: SaleRecordOverviewRow, locale: Locale) {
  const zh = locale === "zh",
    value = record.attention;
  if (value?.kind === "overdue") return zh ? "已逾期" : "En retard";
  if (value?.kind === "upcoming")
    return value.days === 0
      ? zh
        ? "今日应付"
        : "Dû aujourd’hui"
      : zh
        ? "15天内应付"
        : "Dû sous 15 jours";
  if (value?.kind === "unsettled") return zh ? "历史待结清" : "Ancien solde à régler";
  if (record.conflict || value?.kind === "review" || record.reviewReasons.length)
    return zh ? "出售资料待核" : "Vente à vérifier";
  return null;
}

function statusLabel(record: SaleRecordOverviewRow, locale: Locale) {
  const zh = locale === "zh";
  if (record.contract.status === "terminated") return zh ? "已终止" : "Résilié";
  if (record.contract.status === "expired") return zh ? "已过期" : "Expiré";
  if (record.contract.registration_basis === "source_record")
    return zh ? "初始登记" : "Enregistrement initial";
  if (record.contract.status === "draft") return zh ? "草稿" : "Brouillon";
  return zh ? "当前出售" : "Vente actuelle";
}

function transferLabel(record: SaleRecordOverviewRow, locale: Locale) {
  const labels: Record<string, [string, string]> = {
    not_started: ["过户未开始", "Transfert non commencé"],
    in_progress: ["过户办理中", "Transfert en cours"],
    completed: ["已过户", "Transféré"],
  };
  return (
    labels[record.contract.transfer_status]?.[locale === "zh" ? 0 : 1] ??
    (locale === "zh" ? "过户待核" : "Transfert à vérifier")
  );
}

function floorLabel(row: SaleRoomOverviewRow, locale: Locale) {
  const label = row.unit.floor_label?.trim();
  if (label)
    return /^\d+\s*(?:F|楼|层)?$/i.test(label)
      ? normalizeFloorLabel(label, row.unit.unit_no)
      : label;
  const inferred = normalizeFloorLabel(null, row.unit.unit_no);
  return inferred && inferred !== "F"
    ? inferred
    : locale === "zh"
      ? "楼层待登记"
      : "Étage à renseigner";
}

function sortFloor(label: string) {
  const basement = label.match(/^(?:B|地下)\s*(\d+)/i);
  if (basement) return -Number(basement[1]);
  const chinese = label.match(/^(?:第)?([一二三四五六七八九十])[层楼]$/)?.[1];
  return chinese ? "一二三四五六七八九十".indexOf(chinese) + 1 : floorSortValue(label);
}

export function SaleRoomOverview({
  rows,
  records,
  locale,
  loading,
  error,
  selectedRecordId,
  busy = false,
  onSelectRecord,
  onRetry,
}: {
  rows: SaleRoomOverviewRow[];
  records: SaleRecordOverviewRow[];
  locale: Locale;
  loading: boolean;
  error: boolean;
  selectedRecordId?: string | null;
  busy?: boolean;
  onSelectRecord: (record: SaleRecordOverviewRow) => void;
  onRetry: () => void;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [followup, setFollowup] = useState(false);
  const [history, setHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("historical");
  const [conflictUnitId, setConflictUnitId] = useState<string | null>(null);
  const currentRows = useMemo(() => rows.filter((row) => row.record || row.conflict), [rows]);
  const counts = useMemo(
    () => ({
      all: currentRows.length,
      overdue: currentRows.filter(
        (row) => !row.conflict && row.record?.attention?.kind === "overdue",
      ).length,
      upcoming: currentRows.filter(
        (row) => !row.conflict && row.record?.attention?.kind === "upcoming",
      ).length,
      review: currentRows.filter(needsReview).length,
    }),
    [currentRows],
  );
  const matchingRooms = useMemo(
    () =>
      currentRows.filter(
        (row) =>
          (!search.trim() ||
            row.records.some(
              (record) =>
                !record.historical &&
                searchText(record).includes(search.trim().toLocaleLowerCase()),
            )) &&
          (filter === "all" ||
            (filter === "review"
              ? needsReview(row)
              : !row.conflict && row.record?.attention?.kind === filter)),
      ),
    [currentRows, search, filter],
  );
  const followupRows = useMemo(
    () =>
      records
        .filter((row) => row.attention || row.conflict)
        .filter(
          (row) => !search.trim() || searchText(row).includes(search.trim().toLocaleLowerCase()),
        )
        .sort((a, b) => {
          const rank = (record: SaleRecordOverviewRow) =>
            record.attention?.kind === "overdue"
              ? 0
              : record.attention?.kind === "upcoming"
                ? 1
                : record.attention?.kind === "unsettled"
                  ? 2
                  : 3;
          return (
            rank(a) - rank(b) ||
            (a.attention?.dueDate ?? "").localeCompare(b.attention?.dueDate ?? "") ||
            a.id.localeCompare(b.id)
          );
        }),
    [records, search],
  );
  const historyRows = useMemo(
    () =>
      records.filter(
        (row) =>
          (historyStatus === "all" ||
            (historyStatus === "historical"
              ? row.historical
              : historyStatus === "current"
                ? !row.historical
                : row.contract.status === historyStatus)) &&
          (!historySearch.trim() ||
            searchText(row).includes(historySearch.trim().toLocaleLowerCase())),
      ),
    [records, historySearch, historyStatus],
  );
  const floors = useMemo(() => {
    const grouped = new Map<
      string,
      { key: string; building: string; floor: string; rows: SaleRoomOverviewRow[] }
    >();
    for (const row of matchingRooms) {
      const floor = floorLabel(row, locale),
        key = `${row.unit.building_id}/${floor}`;
      const group = grouped.get(key) ?? {
        key,
        building: row.building?.display_name ?? "—",
        floor,
        rows: [],
      };
      group.rows.push(row);
      grouped.set(key, group);
    }
    return [...grouped.values()]
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort((a, b) =>
          a.unit.unit_no.localeCompare(b.unit.unit_no, undefined, { numeric: true }),
        ),
      }))
      .sort(
        (a, b) =>
          a.building.localeCompare(b.building, undefined, { numeric: true }) ||
          sortFloor(a.floor) - sortFloor(b.floor),
      );
  }, [matchingRooms, locale]);
  const conflict = currentRows.find((row) => row.unit.id === conflictUnitId && row.conflict);
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: text("全部出售", "Toutes les ventes") },
    { key: "overdue", label: text("已逾期", "En retard") },
    { key: "upcoming", label: text("15天内应付", "Dû sous 15 jours") },
    { key: "review", label: text("待核事项", "À vérifier") },
  ];
  if (loading || error)
    return (
      <section className={styles.empty} role={error ? "alert" : "status"} aria-busy={loading}>
        <h2>
          {error
            ? text("出售房源暂时无法读取", "Ventes momentanément indisponibles")
            : text("正在读取出售房源…", "Chargement des ventes…")}
        </h2>
        {error ? (
          <button type="button" className={styles.control} onClick={onRetry}>
            {text("重试", "Réessayer")}
          </button>
        ) : null}
      </section>
    );
  const recordList = (
    value: SaleRecordOverviewRow[],
    type: "history" | "followup" | "conflict",
  ) => (
    <div className={styles.recordList}>
      {value.map((record) => (
        <button
          key={record.id}
          type="button"
          disabled={busy}
          data-sale-history-record-id={type === "history" ? record.id : undefined}
          data-sale-followup-record-id={type === "followup" ? record.id : undefined}
          data-sale-conflict-record-id={type === "conflict" ? record.id : undefined}
          onClick={() => onSelectRecord(record)}
          className={styles.record}
        >
          <span>
            <strong>
              {record.building?.display_name} · {record.unit.unit_no}
            </strong>
            <small>{record.customer?.name ?? text("买方待登记", "Acquéreur à compléter")}</small>
          </span>
          <span>
            <strong>{statusLabel(record, locale)}</strong>
            <small>
              {record.contract.signed_date || text("签约未登记", "Signature non renseignée")} ·{" "}
              {transferLabel(record, locale)}
            </small>
            {record.attention?.dueDate && record.attention.kind !== "review" ? (
              <small>
                {text("到期", "Échéance")} {record.attention.dueDate}
              </small>
            ) : null}
          </span>
          <span className={record.attention?.kind === "overdue" ? styles.overdueText : undefined}>
            <strong>{attentionLabel(record, locale) ?? text("查看资料", "Voir le dossier")}</strong>
            <small>
              {record.attention?.amounts.length
                ? amounts(record.attention.amounts, locale)
                : record.attention
                  ? text("金额待核", "Montant à vérifier")
                  : ""}
            </small>
          </span>
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      ))}
      {!value.length ? (
        <p className={styles.emptyText}>
          {text("没有符合条件的记录。", "Aucun dossier correspondant.")}
        </p>
      ) : null}
    </div>
  );
  return (
    <section className={styles.overview} aria-label={text("出售房源", "Lots en vente")}>
      <div className={styles.toolbar}>
        <div
          className={styles.filters}
          role="group"
          aria-label={text("出售跟进筛选", "Filtres de suivi des ventes")}
        >
          {filters.map((item) => (
            <button
              type="button"
              key={item.key}
              aria-pressed={filter === item.key}
              className={cn(
                item.key === "overdue" && styles.overdueFilter,
                item.key === "upcoming" && styles.upcomingFilter,
              )}
              onClick={() => setFilter(item.key)}
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
              {text("搜索房号或买方", "Rechercher un lot ou acquéreur")}
            </span>
            <input
              type="search"
              value={search}
              placeholder={text("房号或买方", "Lot ou acquéreur")}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={styles.control}
            aria-expanded={followup}
            onClick={() => setFollowup((value) => !value)}
          >
            {text("出售款跟进", "Suivi des paiements")} {followupRows.length}
          </button>
          <button
            type="button"
            className={styles.control}
            aria-expanded={history}
            onClick={() => setHistory((value) => !value)}
          >
            {text("查看历史", "Voir l’historique")}
          </button>
        </div>
      </div>
      {followup ? (
        <section
          className={styles.panel}
          aria-label={text("集中出售款跟进", "Suivi des ventes regroupé")}
        >
          <header>
            <h2>{text("出售款跟进", "Suivi des paiements")}</h2>
            <p>
              {text(
                "包含历史出售的未结清款，按每次出售分别核对；未来总尾款不等于当前逾期。",
                "Inclut les soldes historiques par vente ; un solde futur n’est pas un retard actuel.",
              )}
            </p>
          </header>
          {recordList(followupRows, "followup")}
        </section>
      ) : null}
      {history ? (
        <section className={styles.panel} aria-label={text("出售记录查询", "Recherche des ventes")}>
          <header>
            <h2>{text("出售记录", "Dossiers de vente")}</h2>
            <div className={styles.tools}>
              <label className={styles.search}>
                <span className="sr-only">{text("搜索出售记录", "Rechercher une vente")}</span>
                <input
                  type="search"
                  placeholder={text("房号、买方或签约日期", "Lot, acquéreur ou date")}
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                />
              </label>
              <select
                className={styles.control}
                aria-label={text("出售记录状态", "Statut des ventes")}
                value={historyStatus}
                onChange={(event) => setHistoryStatus(event.target.value)}
              >
                {[
                  ["historical", text("历史出售", "Anciennes ventes")],
                  ["all", text("全部记录", "Tous les dossiers")],
                  ["current", text("当前出售", "Ventes actuelles")],
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
            </div>
          </header>
          {recordList(historyRows, "history")}
        </section>
      ) : null}
      {conflict ? (
        <section className={styles.panel} aria-label={text("出售记录待核", "Ventes à vérifier")}>
          <header>
            <h2>
              {conflict.building?.display_name} · {conflict.unit.unit_no}
            </h2>
            <p>
              {text(
                "同一房源有多条当前出售记录，请逐条核对。",
                "Plusieurs ventes actuelles pour ce lot : vérifiez chaque dossier.",
              )}
            </p>
          </header>
          {recordList(conflict.records, "conflict")}
        </section>
      ) : null}
      {floors.map((floor) => (
        <section
          key={floor.key}
          className={styles.floor}
          aria-label={`${floor.building} ${floor.floor}`}
        >
          <header>
            <h2>
              {floor.building} <span>{floor.floor}</span>
            </h2>
            <span>
              {floor.rows.length} {text("间", "lots")}
            </span>
          </header>
          <div className={styles.cards}>
            {floor.rows.map((row) => {
              const record = row.record;
              return (
                <button
                  type="button"
                  key={row.unit.id}
                  data-sale-room-id={row.unit.id}
                  disabled={busy}
                  aria-pressed={row.records.some((item) => item.id === selectedRecordId)}
                  onClick={() =>
                    record && !row.conflict
                      ? onSelectRecord(record)
                      : setConflictUnitId(row.unit.id)
                  }
                  className={cn(
                    styles.card,
                    record?.attention?.kind === "overdue" && !row.conflict && styles.overdueCard,
                    record?.attention?.kind === "upcoming" && !row.conflict && styles.upcomingCard,
                  )}
                >
                  <span className={styles.roomHeading}>
                    <strong>{row.unit.unit_no}</strong>
                    <small>
                      {row.conflict
                        ? text("出售待核", "Vente à vérifier")
                        : record
                          ? statusLabel(record, locale)
                          : "—"}
                    </small>
                  </span>
                  <span className={styles.buyer}>
                    {row.conflict
                      ? text("多条出售记录待核", "Plusieurs ventes à vérifier")
                      : (record?.customer?.name ?? text("买方待登记", "Acquéreur à compléter"))}
                  </span>
                  {record && !row.conflict ? (
                    <span className={styles.transfer}>{transferLabel(record, locale)}</span>
                  ) : null}
                  <span className={styles.fact}>
                    <span>{text("登记总价", "Prix enregistré")}</span>
                    <strong>
                      {record?.priceNative
                        ? amounts([record.priceNative], locale)
                        : record?.priceXof != null
                          ? formatMoney(record.priceXof, "XOF", locale)
                          : text("待核", "À vérifier")}
                    </strong>
                  </span>
                  <span className={styles.fact}>
                    <span>{text("已录房款实收", "Encaissements du bien")}</span>
                    <strong>
                      {row.conflict
                        ? text("按记录核对", "Vérifier par dossier")
                        : record?.receivedNative.length
                          ? amounts(record.receivedNative, locale)
                          : text("未有已核实收", "Aucun encaissement vérifié")}
                    </strong>
                  </span>
                  <span className={styles.fact}>
                    <span>
                      {record?.outstandingNative == null && record?.registeredBalance
                        ? text("登记余款（Excel）", "Solde enregistré (Excel)")
                        : text("应收未收", "Créances restantes")}
                    </span>
                    <strong>
                      {record?.outstandingNative == null
                        ? record?.registeredBalance
                          ? amounts([record.registeredBalance], locale)
                          : text("待核", "À vérifier")
                        : record.outstandingNative.length
                          ? amounts(record.outstandingNative, locale)
                          : text("已建应收已结清", "Créances soldées")}
                    </strong>
                  </span>
                  <span className={styles.fact}>
                    <span>{text("下一到期", "Prochaine échéance")}</span>
                    <strong>
                      {record?.nextDue ??
                        (record?.outstandingNative == null
                          ? text("待核", "À vérifier")
                          : text("无未结到期记录", "Aucune échéance ouverte"))}
                    </strong>
                  </span>
                  <span className={styles.cardFooter}>
                    <span
                      className={cn(
                        styles.cardStatus,
                        row.conflict
                          ? styles.reviewStatus
                          : record?.attention?.kind === "overdue"
                            ? styles.overdueStatus
                            : record?.attention?.kind === "upcoming"
                              ? styles.upcomingStatus
                              : record?.attention?.kind === "review" || record?.reviewReasons.length
                                ? styles.reviewStatus
                                : null,
                      )}
                    >
                      {row.conflict
                        ? text("选择记录核对", "Choisir un dossier")
                        : record
                          ? (attentionLabel(record, locale) ?? transferLabel(record, locale))
                          : text("待核", "À vérifier")}
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {!floors.length ? (
        <p className={styles.empty}>
          {currentRows.length
            ? text("没有符合筛选条件的当前出售。", "Aucune vente actuelle correspondante.")
            : text(
                "暂无当前出售；此前记录可在“查看历史”中查询。",
                "Aucune vente actuelle ; consultez les anciennes ventes dans l’historique.",
              )}
        </p>
      ) : null}
    </section>
  );
}
