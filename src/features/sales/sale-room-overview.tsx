"use client";

import { formatPropertyMoney } from "@/lib/property-money";

import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { cn, normalizeFloorLabel, floorSortValue } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import type { SaleRecordOverviewRow, SaleRoomOverviewRow } from "./sale-room-overview-model";
import styles from "./sale-room-overview.module.css";

type Filter = "all" | "unpaid" | "settled";
type AttentionFilter = "all" | "overdue" | "upcoming" | "review";

function knownBalance(record: SaleRecordOverviewRow) {
  if (
    record.registeredBalance &&
    record.registeredBalance.amount > 0 &&
    !record.outstandingNative?.length
  )
    return [record.registeredBalance];
  return record.outstandingNative ?? (record.registeredBalance ? [record.registeredBalance] : null);
}

function hasOutstanding(record: SaleRecordOverviewRow) {
  return knownBalance(record)?.some((value) => value.amount > 0) === true;
}

function hasClearedBalance(row: SaleRoomOverviewRow) {
  if (!row.record || needsReview(row)) return false;
  const values = knownBalance(row.record);
  return values !== null && values.every((value) => value.amount === 0);
}

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
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function amounts(values: SaleRecordOverviewRow["receivedNative"], locale: Locale) {
  return values
    .map(
      (value) =>
        `${formatPropertyMoney(value.amount, value.currency, locale)}${value.currency === "XOF" ? "" : ` ${value.currency}`}`,
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
  if (hasOutstanding(record))
    return record.nextDue
      ? zh
        ? "待收尾款"
        : "Solde à recevoir"
      : zh
        ? "待收 · 未约定付款日"
        : "Solde · date non convenue";
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
  search: controlledSearch,
  onSearchChange,
  recordStatus,
  onRecordStatusChange,
  initialRecordsOpen = false,
  initialFollowup = false,
  onBrowseChange,
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
  search?: string;
  onSearchChange?: (value: string) => void;
  recordStatus?: string;
  onRecordStatusChange?: (value: string) => void;
  initialRecordsOpen?: boolean;
  initialFollowup?: boolean;
  onBrowseChange?: () => void;
  onSelectRecord: (record: SaleRecordOverviewRow) => void;
  onRetry: () => void;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [filter, setFilter] = useState<Filter>(initialFollowup ? "unpaid" : "all");
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>("all");
  const [localSearch, setLocalSearch] = useState("");
  const search = controlledSearch ?? localSearch;
  const [followup, setFollowup] = useState(initialFollowup);
  const [history, setHistory] = useState(initialRecordsOpen);
  const [localHistoryStatus, setLocalHistoryStatus] = useState("all");
  const historyStatus = recordStatus ?? localHistoryStatus;
  const [conflictUnitId, setConflictUnitId] = useState<string | null>(null);
  const browse = () => {
    setConflictUnitId(null);
    onBrowseChange?.();
  };
  const changeRecordStatus = (value: string) => {
    browse();
    setLocalHistoryStatus(value);
    onRecordStatusChange?.(value);
  };
  const currentRows = useMemo(() => rows.filter((row) => row.record || row.conflict), [rows]);
  const counts = useMemo(
    () => ({
      all: currentRows.length,
      unpaid: currentRows.filter((row) => !row.conflict && row.record && hasOutstanding(row.record))
        .length,
      settled: currentRows.filter(hasClearedBalance).length,
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
            (filter === "unpaid"
              ? !row.conflict && !!row.record && hasOutstanding(row.record)
              : hasClearedBalance(row))) &&
          (attentionFilter === "all" ||
            (attentionFilter === "review"
              ? needsReview(row)
              : !row.conflict && row.record?.attention?.kind === attentionFilter)),
      ),
    [currentRows, search, filter, attentionFilter],
  );
  const followupRows = useMemo(
    () =>
      records
        .filter((row) => row.attention || row.conflict || hasOutstanding(row))
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
          (!search.trim() || searchText(row).includes(search.trim().toLocaleLowerCase())),
      ),
    [records, search, historyStatus],
  );
  const matchingHistoryCount = useMemo(
    () =>
      search.trim()
        ? records.filter(
            (row) => row.historical && searchText(row).includes(search.trim().toLocaleLowerCase()),
          ).length
        : 0,
    [records, search],
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
    { key: "unpaid", label: text("待收尾款", "Soldes à recevoir") },
    { key: "settled", label: text("已结清", "Soldées") },
  ];
  const attentionFilters: { key: AttentionFilter; label: string }[] = [
    { key: "all", label: text("全部状态", "Tous les états") },
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
              {record.contract.signed_date || text("签约未登记", "Signature non renseignée")}
            </small>
            {record.attention?.dueDate && record.attention.kind !== "review" ? (
              <small>
                {text("到期", "Échéance")} {record.attention.dueDate}
              </small>
            ) : null}
          </span>
          <span className={record.attention?.kind === "overdue" ? styles.overdueText : undefined}>
            <strong>{attentionLabel(record, locale) ?? text("查看资料", "Voir le dossier")}</strong>
            {type === "history" ? (
              <>
                <small>
                  {text("登记价", "Prix enregistré")}{" "}
                  {record.priceNative
                    ? amounts([record.priceNative], locale)
                    : record.priceXof !== null
                      ? amounts([{ currency: "XOF", amount: record.priceXof }], locale)
                      : text("待核", "À vérifier")}
                </small>
                <small>
                  {record.outstandingNative === null
                    ? record.registeredBalance
                      ? `${text("登记余款（Excel）", "Solde enregistré (Excel)")} ${amounts([record.registeredBalance], locale)}`
                      : text("应收待核", "Créances à vérifier")
                    : record.outstandingNative.length
                      ? `${text("已核未收", "Solde vérifié")} ${amounts(record.outstandingNative, locale)}`
                      : text("已建应收已结清", "Créances enregistrées soldées")}
                </small>
              </>
            ) : (
              <small>
                {record.attention?.amounts.length
                  ? amounts(record.attention.amounts, locale)
                  : hasOutstanding(record)
                    ? amounts(knownBalance(record)!, locale)
                    : record.attention
                      ? text("金额待核", "Montant à vérifier")
                      : ""}
              </small>
            )}
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
              disabled={busy}
              aria-pressed={filter === item.key}
              title={
                item.key === "settled"
                  ? text(
                      "已登记余款为零或已核账单结清；各房卡保留对应依据。",
                      "Solde enregistré nul ou factures vérifiées soldées ; la base reste indiquée par lot.",
                    )
                  : undefined
              }
              onClick={() => {
                browse();
                setFilter(item.key);
                setAttentionFilter("all");
              }}
            >
              {item.label}
              <span>{counts[item.key]}</span>
            </button>
          ))}
        </div>
        <details className={styles.advancedFilters}>
          <summary>{text("更多筛选", "Autres filtres")}</summary>
          <div
            className={styles.filters}
            role="group"
            aria-label={text("出售付款状态", "État des paiements")}
          >
            {attentionFilters.map((item) => (
              <button
                type="button"
                key={item.key}
                disabled={busy}
                aria-pressed={attentionFilter === item.key}
                className={cn(
                  item.key === "overdue" && styles.overdueFilter,
                  item.key === "upcoming" && styles.upcomingFilter,
                )}
                onClick={() => {
                  browse();
                  setFilter("all");
                  setAttentionFilter(item.key);
                }}
              >
                {item.label}
                <span>{counts[item.key === "all" ? "all" : item.key]}</span>
              </button>
            ))}
          </div>
        </details>
        <div className={styles.tools}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">
              {text("搜索房号、买方或合同编号", "Rechercher un lot, acquéreur ou contrat")}
            </span>
            <input
              type="search"
              disabled={busy}
              value={search}
              placeholder={text("房号、买方或合同编号", "Lot, acquéreur ou contrat")}
              onChange={(event) => {
                browse();
                setLocalSearch(event.target.value);
                onSearchChange?.(event.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className={styles.control}
            disabled={busy}
            aria-expanded={followup}
            onClick={() => {
              browse();
              setFollowup((value) => !value);
            }}
          >
            {text("出售款跟进", "Suivi des paiements")} {followupRows.length}
          </button>
          <button
            type="button"
            className={styles.control}
            disabled={busy}
            aria-expanded={history}
            onClick={() => {
              browse();
              setHistory((value) => !value);
            }}
          >
            {text("出售记录", "Dossiers de vente")}
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
            <p>
              {text(
                "当前、草稿和历史出售都在这里查询，点击记录打开同一份房间详情。",
                "Consultez les ventes actuelles, brouillons et anciennes ; chaque dossier ouvre les mêmes détails du lot.",
              )}
            </p>
            <div className={styles.tools}>
              <select
                className={styles.control}
                disabled={busy}
                aria-label={text("出售记录状态", "Statut des ventes")}
                value={historyStatus}
                onChange={(event) => changeRecordStatus(event.target.value)}
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
              const attention = record ? attentionLabel(record, locale) : null;
              const cardAttention = needsReview(row) ? text("待核", "À vérifier") : attention;
              const registeredBalanceShown =
                record?.registeredBalance &&
                (record.outstandingNative == null ||
                  (!record.outstandingNative.length && record.registeredBalance.amount > 0));
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
                    record && hasOutstanding(record) && styles.unpaidCard,
                    needsReview(row) && styles.reviewCard,
                    record?.attention?.kind === "overdue" && !row.conflict && styles.overdueCard,
                    record?.attention?.kind === "upcoming" && !row.conflict && styles.upcomingCard,
                  )}
                >
                  <span className={styles.roomHeading}>
                    <strong>{row.unit.unit_no}</strong>
                    {record?.contract.status === "draft" ? (
                      <small>{text("草稿", "Brouillon")}</small>
                    ) : record && !row.conflict ? (
                      <small className={styles.soldStatus}>{text("已售", "Vendu")}</small>
                    ) : null}
                  </span>
                  <span className={cn(styles.fact, styles.buyerFact)}>
                    <span>{text("买方", "Acquéreur")}</span>
                    <strong className={styles.buyer}>
                      {row.conflict
                        ? text("多条出售记录待核", "Plusieurs ventes à vérifier")
                        : (record?.customer?.name ?? text("待登记", "À renseigner"))}
                    </strong>
                  </span>
                  <span className={styles.fact}>
                    <span>{text("总价", "Prix enregistré")}</span>
                    <strong>
                      {record?.priceNative
                        ? amounts([record.priceNative], locale)
                        : record?.priceXof != null
                          ? formatPropertyMoney(record.priceXof, "XOF", locale)
                          : text("待核", "À vérifier")}
                    </strong>
                  </span>
                  <span className={styles.fact}>
                    <span>{text("已收", "Encaissé")}</span>
                    <strong>
                      {row.conflict
                        ? text("按记录核对", "Vérifier par dossier")
                        : record?.receivedNative.length
                          ? amounts(record.receivedNative, locale)
                          : text("待核", "À vérifier")}
                    </strong>
                  </span>
                  <span className={styles.fact}>
                    <span>{text("未收", "Restant")}</span>
                    <strong
                      title={
                        registeredBalanceShown
                          ? `${text("Excel登记余款，不等同于已核应收；依据：", "Solde enregistré dans Excel, distinct des créances vérifiées ; source : ")}${record!.registeredBalance!.sourceRef}`
                          : record?.outstandingNative == null
                            ? text(
                                "现有资料不足，未据总价减已收推算余款。",
                                "Données insuffisantes ; aucun solde déduit du prix moins les encaissements.",
                              )
                            : text(
                                "仅已核账单的未收余额，不代表全部房款余款。",
                                "Solde des seules créances vérifiées, distinct du reste du prix du bien.",
                              )
                      }
                    >
                      {registeredBalanceShown
                        ? `${amounts([record!.registeredBalance!], locale)}${text("（登记）", " (enregistré)")}`
                        : record?.outstandingNative == null
                          ? text("待核", "À vérifier")
                          : record.outstandingNative.length
                            ? `${amounts(record.outstandingNative, locale)}${text("（账单）", " (factures)")}`
                            : text("账单结清", "Factures soldées")}
                    </strong>
                  </span>
                  <span className={styles.cardFooter}>
                    <span
                      className={cn(
                        row.conflict || cardAttention ? styles.cardStatus : styles.detailHint,
                        row.conflict
                          ? styles.reviewStatus
                          : record?.attention?.kind === "overdue"
                            ? styles.overdueStatus
                            : record?.attention?.kind === "upcoming"
                              ? styles.upcomingStatus
                              : record?.attention?.kind === "review" || record?.reviewReasons.length
                                ? styles.reviewStatus
                                : record && hasOutstanding(record)
                                  ? styles.upcomingStatus
                                  : null,
                      )}
                    >
                      {row.conflict
                        ? text("选择记录核对", "Choisir un dossier")
                        : record
                          ? (cardAttention ?? text("查看详情", "Voir les détails"))
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
        <div className={styles.empty}>
          <p>
            {currentRows.length
              ? text("没有符合筛选条件的当前出售。", "Aucune vente actuelle correspondante.")
              : text(
                  "暂无当前出售；此前记录可在“出售记录”中查询。",
                  "Aucune vente actuelle ; consultez les anciennes ventes dans l’historique.",
                )}
          </p>
          {matchingHistoryCount > 0 && !history ? (
            <button
              type="button"
              disabled={busy}
              className={styles.control}
              onClick={() => {
                changeRecordStatus("historical");
                setHistory(true);
              }}
            >
              {text(
                `查看 ${matchingHistoryCount} 条匹配的历史记录`,
                `Voir ${matchingHistoryCount} anciennes ventes correspondantes`,
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
