"use client";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Download, RefreshCw, ShieldCheck } from "lucide-react";
import type {
  ReceiptAnalysis,
  ReceiptFilters,
  ReceiptLine,
  ReceiptMethod,
} from "./receipt-analysis-types";
import {
  number,
  signed,
  formatDate,
  periodLabel,
  roomLabel,
  defaultFilters,
  queryString,
  kindLabel,
  methodLabel,
  comparisonText,
  errorLabel,
  type Locale,
} from "./receipt-analysis-format";
import { ReceiptTrendChart } from "./receipt-analysis-trend";
import { ReceiptAnalysisDetail } from "./receipt-analysis-detail";
import styles from "./receipt-analysis.module.css";

export function ReceiptAnalysisView({
  locale,
  initialData,
  initialError,
}: {
  locale: Locale;
  initialData: ReceiptAnalysis | null;
  initialError?: string;
}) {
  const fr = locale === "fr";
  const text = (zh: string, french: string) => (fr ? french : zh);
  const [filters, setFilters] = useState<ReceiptFilters>(() =>
    initialData
      ? {
          ...initialData.filters,
          month: initialData.filters.month || initialData.periods.current.from.slice(0, 7),
        }
      : defaultFilters(),
  );
  const [custom, setCustom] = useState(initialData?.periods.custom ?? false);
  const [dateMode, setDateMode] = useState(initialData?.periods.custom ?? false);
  const [dates, setDates] = useState({
    from: initialData?.periods.current.from ?? "",
    to: initialData?.periods.current.to ?? "",
  });
  const [search, setSearch] = useState(initialData?.filters.query ?? "");
  const [data, setData] = useState(initialData);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [loading, setLoading] = useState(!initialData && !initialError);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<ReceiptLine | null>(null);
  const first = useRef(true);
  const requestId = useRef(0);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const filterQuery = queryString(filters, custom);
  const changeFilters = (patch: Partial<ReceiptFilters>) => {
    setSelected(null);
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  };

  useEffect(() => {
    const timeout = setTimeout(
      () =>
        setFilters((current) =>
          current.query === search ? current : { ...current, query: search, page: 1 },
        ),
      350,
    );
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (initialData || initialError) return;
    }
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const read = async () => {
      try {
        const response = await fetch(`/api/daily-rentals/receipts?${filterQuery}`, {
          signal: controller.signal,
          cache: "no-store",
          credentials: "same-origin",
        });
        const body = await response.json();
        if (controller.signal.aborted || id !== requestId.current) return;
        if (
          !response.ok ||
          !Array.isArray(body.rows) ||
          !body.summary ||
          !body.filters ||
          !body.comparisons
        )
          throw new Error(
            typeof body.error === "string" ? body.error : "receiptHistoryUnavailable",
          );
        setData(body as ReceiptAnalysis);
        if (!custom) setDates({ from: body.periods.current.from, to: body.periods.current.to });
      } catch (cause) {
        if (controller.signal.aborted || id !== requestId.current) return;
        setError(cause instanceof Error ? cause.message : "receiptHistoryUnavailable");
      } finally {
        if (!controller.signal.aborted && id === requestId.current) setLoading(false);
      }
    };
    void read();
    return () => controller.abort();
  }, [filterQuery, retry, initialData, initialError]);

  const selectMonth = (month: string) => {
    setCustom(false);
    setDateMode(false);
    changeFilters({ month, dateFrom: "", dateTo: "" });
  };
  const methods: ReceiptMethod[] = [
    "all",
    "cash",
    "check",
    "bank_transfer",
    "offset",
    "other",
    "unknown",
  ];
  const kinds: ReceiptFilters["kind"][] = ["all", "collection", "refund", "reversal", "excluded"];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const busy = loading || search !== filters.query;
  const exportQuery = new URLSearchParams(filterQuery);
  exportQuery.set("export", "1");
  exportQuery.set("locale", locale);
  exportQuery.delete("page");
  const unavailable = busy || error || !data;

  return (
    <div className={styles.page} data-receipt-analysis>
      <header className={styles.heading}>
        <div>
          <h1>{text("日租收款分析", "Encaissements · courts séjours")}</h1>
          <p className={styles.description}>
            {text(
              "历史收款、退款与同期变化，在同一处核对。",
              "Consultez l’historique, les remboursements et les évolutions comparables.",
            )}
          </p>
        </div>
        <span className={styles.readonly}>
          <ShieldCheck size={14} aria-hidden="true" />
          {text("只读分析", "Consultation seule")}
        </span>
      </header>
      <form
        className={styles.toolbar}
        onSubmit={(event) => {
          event.preventDefault();
          if (dateMode && dates.from && dates.to) {
            setCustom(true);
            changeFilters({ dateFrom: dates.from, dateTo: dates.to });
          }
        }}
      >
        <label className={styles.field}>
          {text("统计方式", "Période")}
          <select
            className={styles.control}
            value={dateMode ? "custom" : "month"}
            onChange={(event) => {
              const mode = event.target.value === "custom";
              setDateMode(mode);
              if (!mode) {
                setCustom(false);
                changeFilters({ dateFrom: "", dateTo: "" });
              }
            }}
          >
            <option value="month">{text("按月查看", "Par mois")}</option>
            <option value="custom">{text("自选日期", "Dates personnalisées")}</option>
          </select>
        </label>
        {!dateMode ? (
          <label className={styles.field}>
            {text("月份", "Mois")}
            <input
              className={styles.control}
              type="month"
              value={filters.month}
              onChange={(event) => {
                if (event.target.value) selectMonth(event.target.value);
              }}
            />
          </label>
        ) : (
          <>
            <label className={styles.field}>
              {text("开始日期", "Du")}
              <input
                className={styles.control}
                type="date"
                required
                value={dates.from}
                onChange={(event) =>
                  setDates((current) => ({ ...current, from: event.target.value }))
                }
              />
            </label>
            <label className={styles.field}>
              {text("结束日期", "Au")}
              <input
                className={styles.control}
                type="date"
                required
                min={dates.from || undefined}
                value={dates.to}
                onChange={(event) =>
                  setDates((current) => ({ ...current, to: event.target.value }))
                }
              />
            </label>
            <button className={styles.button} type="submit">
              {text("应用日期", "Appliquer")}
            </button>
          </>
        )}
        <label className={styles.field}>
          {text("楼栋", "Bâtiment")}
          <select
            className={styles.control}
            value={filters.buildingId}
            onChange={(event) => changeFilters({ buildingId: event.target.value })}
          >
            <option value="all">{text("全部日租楼栋", "Tous les bâtiments")}</option>
            {data?.buildings.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name || building.code}
              </option>
            ))}
          </select>
        </label>
      </form>
      <div className={styles.ledgerTools}>
        <input
          className={`${styles.control} ${styles.search}`}
          type="search"
          aria-label={text("搜索房号、住客或收据号", "Rechercher logement, client ou reçu")}
          placeholder={text("搜索房号 / 住客 / 收据号", "Logement / client / reçu")}
          value={search}
          onChange={(event) => {
            setSelected(null);
            setSearch(event.target.value);
          }}
        />
        <select
          className={styles.control}
          aria-label={text("收款方式", "Mode d’encaissement")}
          value={filters.method}
          onChange={(event) => changeFilters({ method: event.target.value as ReceiptMethod })}
        >
          {methods.map((method) => (
            <option key={method} value={method}>
              {method === "all" ? text("全部方式", "Tous les modes") : methodLabel(method, fr)}
            </option>
          ))}
        </select>
        <select
          className={styles.control}
          aria-label={text("记录类型", "Type d’écriture")}
          value={filters.kind}
          onChange={(event) =>
            changeFilters({ kind: event.target.value as ReceiptFilters["kind"] })
          }
        >
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind === "all" ? text("全部类型", "Tous les types") : kindLabel(kind, fr)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.button}
          disabled={
            !search &&
            filters.method === "all" &&
            filters.kind === "all" &&
            filters.buildingId === "all"
          }
          onClick={() => {
            setSearch("");
            changeFilters({ query: "", method: "all", kind: "all", buildingId: "all" });
          }}
        >
          {text("清除筛选", "Effacer les filtres")}
        </button>
        {busy || error || !data || data.total > 10000 ? (
          <button
            type="button"
            className={`${styles.button} ${styles.export}`}
            disabled
            title={
              data && data.total > 10000
                ? text(
                    "请缩小筛选范围后导出，最多 10,000 笔",
                    "Affinez les filtres : 10 000 écritures maximum",
                  )
                : undefined
            }
          >
            <Download size={15} aria-hidden="true" />
            {text("导出 CSV", "Exporter CSV")}
          </button>
        ) : (
          <a
            className={`${styles.button} ${styles.export}`}
            href={`/api/daily-rentals/receipts?${exportQuery}`}
            download
          >
            <Download size={15} aria-hidden="true" />
            {text("导出 CSV", "Exporter CSV")}
          </a>
        )}
      </div>
      {!unavailable && (
        <p className={styles.period}>
          {periodLabel(data.periods.current)} ·{" "}
          {data.periods.custom
            ? text(
                "自选日期 · 上期为前一个等长区间",
                "Période personnalisée · période précédente de même durée",
              )
            : data.periods.partial
              ? text(
                  "截至昨日 · 未完成月按同期比较",
                  "Jusqu’à hier · comparaison à durée équivalente",
                )
              : text("完整月份", "Mois complet")}
        </p>
      )}

      {unavailable ? (
        <div className={styles.state} role={error ? "alert" : "status"} aria-live="polite">
          {busy ? (
            <>
              <RefreshCw size={22} style={{ margin: "0 auto 12px" }} aria-hidden="true" />
              <p>{text("正在读取完整历史账务记录…", "Chargement de l’historique comptable…")}</p>
            </>
          ) : (
            <>
              <h2>{text("暂时无法显示收款数据", "Données indisponibles")}</h2>
              <p>{errorLabel(error, fr)}</p>
              <button
                type="button"
                className={styles.button}
                onClick={() => setRetry((value) => value + 1)}
              >
                <RefreshCw size={15} />
                {text("重新读取", "Réessayer")}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {data.summary.excludedCount > 0 && (
            <div className={styles.warning} role="status">
              <AlertCircle size={16} aria-hidden="true" />
              <span>
                {text(
                  `本期间有 ${data.summary.excludedCount} 笔记录未纳入 XOF 净收款，请筛选“未纳入统计”核对原因。`,
                  `${data.summary.excludedCount} écritures de cette période sont hors calcul du net XOF. Filtrez « Hors calcul » pour les vérifier.`,
                )}
              </span>
            </div>
          )}
          <dl
            className={styles.metrics}
            aria-label={text("收款概览", "Synthèse des encaissements")}
          >
            <div className={styles.metric}>
              <dt>{text("净收款", "Encaissements nets")}</dt>
              <dd className={styles.value}>
                {number(data.summary.net, locale)} <small>XOF</small>
              </dd>
              <dd className={styles.deltas}>
                {(["previous", "year"] as const).map((key) => {
                  const comparison = data.comparisons[key];
                  return (
                    <div className={styles.delta} key={key} title={periodLabel(comparison.period)}>
                      <span>
                        {key === "year"
                          ? text("同比", "Année précédente")
                          : data.periods.custom
                            ? text("较上期", "Période précédente")
                            : data.periods.partial
                              ? text("同期环比", "Mois précédent à date")
                              : text("环比", "Mois précédent")}
                      </span>
                      <span
                        className={
                          comparison.status === "available" && comparison.amount !== null
                            ? comparison.amount >= 0
                              ? styles.positive
                              : styles.negative
                            : undefined
                        }
                      >
                        {comparisonText(comparison, locale)}
                      </span>
                    </div>
                  );
                })}
              </dd>
            </div>
            <div className={styles.metric}>
              <dt>{text("正向收款", "Encaissements bruts")}</dt>
              <dd className={styles.value}>
                {number(data.summary.gross, locale)} <small>XOF</small>
              </dd>
              <dd className={styles.metricNote}>
                {text(
                  "按记录日期，不含押金及非现金抵扣",
                  "Par date comptable, hors dépôts et compensations",
                )}
              </dd>
            </div>
            <div className={styles.metric}>
              <dt>{text("实际退款", "Remboursements réels")}</dt>
              <dd className={styles.value}>
                {number(data.summary.refund, locale)} <small>XOF</small>
              </dd>
              <dd className={styles.metricNote}>
                {text("实际退回客户的钱款", "Sommes réellement rendues au client")}
              </dd>
            </div>
            <div className={styles.metric}>
              <dt>{text("冲正调整", "Contrepassations")}</dt>
              <dd className={styles.value}>
                {signed(data.summary.adjustment, locale)} <small>XOF</small>
              </dd>
              <dd className={styles.metricNote}>
                {text(
                  "录错冲回，与实际退款分开",
                  "Corrections d’erreurs, distinctes des remboursements",
                )}
              </dd>
            </div>
          </dl>
          <section className={styles.section} aria-labelledby="receipt-trend-title">
            <div className={styles.sectionHead}>
              <h2 id="receipt-trend-title">
                {text("最近 12 个完整月", "Les 12 derniers mois complets")}
              </h2>
              <span className={styles.meta}>{text("净收款 · 万 XOF", "Net · 10 000 XOF")}</span>
            </div>
            <ReceiptTrendChart data={data} locale={locale} onMonth={selectMonth} />
            <div className={`${styles.chartFoot} ${styles.meta}`}>
              <span>{periodLabel(data.periods.trend)}</span>
              <span>
                {text(
                  "点击月份查看流水 · 当前未完成月不纳入趋势",
                  "Cliquez sur un mois · le mois en cours est exclu",
                )}
              </span>
            </div>
            {data.trend.some((month) => month.excludedCount > 0) && (
              <p className={styles.metricNote}>
                {text(
                  "标有 ! 的月份存在未纳入记录；柱形仅表示可纳入部分，不代表完整收款。",
                  "Les mois marqués ! contiennent des exclusions ; la barre ne représente que les montants inclus.",
                )}
              </p>
            )}
          </section>
          <section className={styles.section} aria-labelledby="receipt-ledger-title">
            <div className={styles.sectionHead}>
              <h2 id="receipt-ledger-title">{text("收款流水", "Écritures d’encaissement")}</h2>
              <span className={styles.meta}>
                {text(
                  "逐笔列示，不按订单合并",
                  "Écritures individuelles, sans fusion par réservation",
                )}
              </span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{text("记录日期", "Date")}</th>
                    <th>{text("房号 / 住客", "Logement / client")}</th>
                    <th>{text("类型 / 方式", "Type / mode")}</th>
                    <th>{text("收据号", "N° de reçu")}</th>
                    <th className={styles.amount}>{text("金额 · XOF", "Montant · XOF")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={styles.empty}>
                        {text("当前筛选下没有收款记录。", "Aucune écriture pour ces filtres.")}
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.date)}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.rowButton}
                            onClick={(event) => {
                              detailTrigger.current = event.currentTarget;
                              setSelected(row);
                            }}
                            aria-label={text(
                              `查看 ${roomLabel(row, fr)} ${row.guestName ?? ""} 收款记录`,
                              `Voir l’écriture ${roomLabel(row, fr)} ${row.guestName ?? ""}`,
                            )}
                          >
                            {roomLabel(row, fr)}
                          </button>
                          <span className={styles.subline}>
                            {row.guestName ?? text("住客未记录", "Client non renseigné")}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              row.kind === "excluded"
                                ? styles.excluded
                                : row.kind !== "collection"
                                  ? styles.negative
                                  : undefined
                            }
                          >
                            {kindLabel(row.kind, fr)}
                          </span>
                          <span className={styles.subline}>
                            {methodLabel(row.paymentMethod, fr)}
                          </span>
                        </td>
                        <td>{row.receiptNo ?? "—"}</td>
                        <td className={styles.amount}>
                          {row.amountXof === null ? (
                            <>
                              <span className={styles.excluded}>
                                {number(row.amount, locale)} {row.currency || "?"}
                              </span>
                              <span className={styles.subline}>
                                {text("未计入 XOF", "Hors total XOF")}
                              </span>
                            </>
                          ) : (
                            <span className={row.amountXof < 0 ? styles.negative : undefined}>
                              {number(row.amountXof, locale)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className={styles.pagination}>
              <span className={styles.meta}>
                {text(
                  `共 ${number(data.total, locale)} 笔 · 每页 ${data.pageSize} 笔`,
                  `${number(data.total, locale)} écritures · ${data.pageSize} par page`,
                )}
              </span>
              <div className={styles.pages}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy || data.filters.page <= 1}
                  onClick={() =>
                    setFilters((current) => ({ ...current, page: data.filters.page - 1 }))
                  }
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                  {text("上一页", "Précédent")}
                </button>
                <span className={styles.meta}>
                  {data.filters.page} / {pages}
                </span>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy || data.filters.page >= pages}
                  onClick={() =>
                    setFilters((current) => ({ ...current, page: data.filters.page + 1 }))
                  }
                >
                  {text("下一页", "Suivant")}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
          <div className={styles.comparisonPeriods}>
            <span>
              {text("本期", "Période")} <strong>{periodLabel(data.periods.current)}</strong>
            </span>
            <span>
              {text("上期", "Précédente")} <strong>{periodLabel(data.periods.previous)}</strong>
            </span>
            <span>
              {text("去年同期", "Année précédente")}{" "}
              <strong>{periodLabel(data.periods.year)}</strong>
            </span>
          </div>
          <p className={styles.scope}>
            {text(
              "口径：按账务记录日期，不按入住日期重述历史。净收款 = 正向收款 − 实际退款 + 冲正调整；不等同于营业收入或利润。历史完整性尚未人工验收，未记录的数据不作推算。筛选同时影响统计、对比、趋势和导出。",
              "Base : date comptable, sans réaffectation aux dates de séjour. Net = encaissements − remboursements + contrepassations ; ce n’est ni le chiffre d’affaires ni le bénéfice. L’exhaustivité de l’historique reste à vérifier ; les données manquantes ne sont pas estimées. Les filtres s’appliquent aux totaux, comparaisons, tendances et exports.",
            )}
          </p>
          <p className={styles.metricNote}>
            {text("记录覆盖", "Dates des écritures disponibles")}{" "}
            {formatDate(data.coverage.firstDate)} – {formatDate(data.coverage.lastDate)} ·{" "}
            {text("不代表所有历史期间已完整入账", "ne garantit pas un historique exhaustif")}
          </p>
        </>
      )}
      <ReceiptAnalysisDetail
        row={selected}
        locale={locale}
        onClose={() => setSelected(null)}
        trigger={detailTrigger.current}
      />
    </div>
  );
}
