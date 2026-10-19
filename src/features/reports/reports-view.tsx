"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import Form from "next/form";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  LockKeyhole,
  Search,
} from "lucide-react";
import {
  directionDisplayLabel,
  financialBusinessLabel,
  statusDisplayLabel,
} from "@/lib/display-labels";
import { reportHref, type ReportQuery, type ReportWorkspaceData } from "./report-read";
import { ReportInspector } from "./report-inspector";
import styles from "./reports-view.module.css";

type Locale = "zh" | "fr";
type Row = ReportWorkspaceData["result"]["rows"][number];

function money(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function numeric(value: Row[string]) {
  if ((typeof value !== "number" && typeof value !== "string") || value === "")
    throw new Error("Invalid report amount");
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid report amount");
  return number;
}

function rowText(row: Row, key: string) {
  return typeof row[key] === "string" && row[key] ? String(row[key]) : "—";
}

function HiddenScope({ query, omit = [] }: { query: ReportQuery; omit?: string[] }) {
  const params = new URL(reportHref(query), "https://reports.invalid").searchParams;
  return (
    <>
      {Array.from(params.entries()).map(([key, value]) =>
        key === "page" || omit.includes(key) ? null : (
          <input key={key} type="hidden" name={key} value={value} />
        ),
      )}
      <input type="hidden" name="page" value="1" />
    </>
  );
}

function MonthTrend({ data, locale }: { data: ReportWorkspaceData; locale: Locale }) {
  const zh = locale === "zh";
  const positive = Math.max(0, ...data.trend.map((item) => item.net));
  const negative = Math.max(0, ...data.trend.map((item) => -item.net));
  const extent = Math.max(1, positive + negative);
  const zeroPosition = (negative / extent) * 100;
  return (
    <section
      className={styles.trend}
      aria-label={zh ? "项目登记净额趋势" : "Tendance du solde inscrit"}
    >
      <div className={styles.trendCaption}>
        <div>
          <h2>{zh ? "近 12 个月 · 登记净额" : "12 mois · Solde inscrit"}</h2>
          <p>
            {zh
              ? "项目全量账务，不随下方搜索或方向筛选变化"
              : "Journal du projet ; indépendant de la recherche et du filtre de direction"}
          </p>
        </div>
        <span className={styles.currency}>XOF</span>
      </div>
      <div
        className={styles.trendBars}
        style={{ "--zero-position": `${zeroPosition}%` } as CSSProperties}
      >
        {data.trend.map((item) => {
          const selected = item.month === data.query.month;
          const label = `${item.month} · ${money(item.net, locale)} XOF`;
          return (
            <Link
              key={item.month}
              href={`${zh ? "" : "/fr"}${reportHref(data.query, { month: item.month, page: 1 })}`}
              aria-label={label}
              aria-current={selected ? "date" : undefined}
              title={label}
              className={`${styles.trendColumn} ${selected ? styles.trendCurrent : ""} ${item.net < 0 ? styles.trendNegative : ""}`}
            >
              <span
                className={styles.trendBar}
                style={
                  {
                    height: `${(Math.abs(item.net) / extent) * 100}%`,
                    bottom: item.net >= 0 ? `${zeroPosition}%` : "auto",
                    top: item.net < 0 ? `${100 - zeroPosition}%` : "auto",
                  } as CSSProperties
                }
              />
              <span className={styles.trendMonth}>{item.month.slice(5)}</span>
            </Link>
          );
        })}
      </div>
      <div className={styles.trendRange}>
        <span>{data.trend[0]?.month ?? "—"}</span>
        <span>{data.trend.at(-1)?.month ?? "—"}</span>
      </div>
    </section>
  );
}

export function ReportsView({ data, locale }: { data: ReportWorkspaceData; locale: Locale }) {
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const { query, result } = data;
  const ledger = query.kind === "ledger";
  const managed = query.management === "managed";
  const project = data.projects.find((item) => item.id === query.projectId);
  const cimac = project?.code.toUpperCase() === "CIMAC";
  const prefix = zh ? "" : "/fr";
  const href = (patch: Partial<ReportQuery>) => `${prefix}${reportHref(query, patch)}`;
  const scope = JSON.stringify(query);
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null);
  const selected =
    (selection?.scope === scope
      ? result.rows.find((row) => String(row.id) === selection.id)
      : null) ??
    result.rows[0] ??
    null;
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const first = result.rows.length ? (query.page - 1) * result.pageSize + 1 : 0;
  const last = result.rows.length ? first + result.rows.length - 1 : 0;
  const summary = result.summary;
  const metrics = ledger
    ? [
        [text("登记净额", "Solde inscrit"), Number(summary.income) - Number(summary.expense)],
        [text("登记收入", "Revenus inscrits"), Number(summary.income)],
        [text("登记支出", "Dépenses inscrites"), Number(summary.expense)],
      ]
    : [
        [text("管理应收未收", "Solde des créances gérées"), Number(summary.outstanding)],
        [text("其中已逾期", "Dont en retard"), Number(summary.overdue)],
        [text("应收已核销", "Créances imputées"), Number(summary.paid)],
      ];
  const exportHref = `${data.exportHref}${data.exportHref.includes("?") ? "&" : "?"}locale=${locale}`;

  return (
    <div className={styles.root} data-reports-checking>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            {text("财务分析 / 来源核查", "ANALYSE FINANCIÈRE / SOURCES")}
          </div>
          <h1>{text("财务核查台", "Contrôle financier")}</h1>
          <p>
            {text("看清账务，再回到每一笔来源。", "Du journal à la source de chaque écriture.")}
          </p>
        </div>
        <a className={styles.exportButton} href={exportHref}>
          <ArrowDownToLine size={15} aria-hidden="true" />
          {text("导出当前范围", "Exporter cette sélection")}
        </a>
      </header>

      <div className={styles.scopeBar}>
        <nav className={styles.projects} aria-label={text("核查项目", "Projet à contrôler")}>
          {data.projects.map((item) => (
            <Link
              key={item.id}
              href={href({ projectId: item.id, page: 1, search: "" })}
              aria-current={query.projectId === item.id ? "page" : undefined}
              className={query.projectId === item.id ? styles.projectActive : ""}
              title={item.display_name}
            >
              <span className={styles.projectDot} />
              {item.code}
              <span className={styles.projectName}>
                {item.display_name !== item.code ? item.display_name : ""}
              </span>
            </Link>
          ))}
        </nav>
        {ledger ? (
          <Form className={styles.monthForm} action={`${prefix}/reports`} key={`month-${scope}`}>
            <HiddenScope query={query} omit={["month"]} />
            <label className={styles.srOnly} htmlFor="report-month">
              {text("核查月份", "Mois du journal")}
            </label>
            <input
              id="report-month"
              name="month"
              type="month"
              defaultValue={query.month}
              required
            />
            <button type="submit">{text("查看", "Voir")}</button>
          </Form>
        ) : (
          <span className={styles.snapshot}>
            <span />
            {text("当前快照", "Situation actuelle")} · {data.asOf}
          </span>
        )}
      </div>

      <nav className={styles.tabs} aria-label={text("财务核查视图", "Vues de contrôle financier")}>
        <Link
          href={href({ kind: "ledger", page: 1, search: "" })}
          aria-current={ledger ? "page" : undefined}
        >
          {text("账务核查", "Journal")}
        </Link>
        <Link
          href={href({ kind: "receivables", page: 1, search: "" })}
          aria-current={!ledger ? "page" : undefined}
        >
          {text("应收核查", "Créances")}
        </Link>
        {!cimac ? (
          <Link className={styles.dailyLink} href={`${prefix}/daily-rentals/receipts`}>
            {text("日租收款专题", "Encaissements courts séjours")}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        ) : null}
      </nav>

      <div className={styles.content}>
        {!ledger && !managed ? (
          <div className={styles.pendingScope}>
            <div>
              <span className={styles.eyebrow}>{text("独立核查范围", "PÉRIMÈTRE SÉPARÉ")}</span>
              <h2>
                {query.management === "historical_pending"
                  ? text("历史待核对", "Historique à vérifier")
                  : text("已排除记录", "Écritures exclues")}
              </h2>
            </div>
            <p>
              {text(
                "这些记录不计入管理应收、未收或逾期指标；请逐笔核对来源，不能将其视为新增欠款。",
                "Ces écritures sont exclues des indicateurs de créances gérées. Vérifiez les sources ; elles ne constituent pas automatiquement de nouvelles dettes.",
              )}
            </p>
            <strong>
              {result.total}
              <span>{text("条记录", "écritures")}</span>
            </strong>
          </div>
        ) : (
          <div className={styles.metricRow}>
            {metrics.map(([label, amount], index) => (
              <div
                key={String(label)}
                className={`${styles.metric} ${index === 0 ? styles.primaryMetric : ""}`}
              >
                <span>{label}</span>
                <strong className={Number(amount) < 0 ? styles.negative : ""}>
                  {money(Number(amount), locale)}
                  <small>XOF</small>
                </strong>
                {index === 0 ? (
                  <p>
                    {ledger
                      ? text("登记收入 − 登记支出", "Revenus inscrits − dépenses inscrites")
                      : text(
                          "有效管理应收，不跨记录冲抵",
                          "Créances gérées valides, sans compensation entre lignes",
                        )}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <div className={styles.scopeNote}>
          <LockKeyhole size={13} aria-hidden="true" />
          <p>
            {ledger
              ? text(
                  "这是账务登记口径，不等于实际现金流或会计利润。押金 / 负债不计入上述净额。",
                  "Vue des écritures enregistrées, et non flux de trésorerie ni bénéfice comptable. Les passifs sont exclus du solde ci-dessus.",
                )
              : text(
                  "应收显示当前状态，不是所选月份的月末余额；历史待核对和已排除记录另列。",
                  "État actuel des créances, pas un solde de clôture mensuelle ; historique à vérifier et exclusions sont séparés.",
                )}
          </p>
          {ledger ? (
            <span>
              {text("负债流入", "Passifs entrants")} {money(Number(summary.liability_in), locale)} /{" "}
              {text("流出", "sortants")} {money(Number(summary.liability_out), locale)} XOF
            </span>
          ) : null}
        </div>

        {ledger && data.trend.length ? <MonthTrend data={data} locale={locale} /> : null}

        <section
          className={styles.workspace}
          aria-label={text("明细与来源", "Écritures et sources")}
        >
          <div className={styles.records}>
            <div className={styles.recordsHeading}>
              <div>
                <h2>
                  {ledger
                    ? text("账务明细", "Écritures du journal")
                    : text("应收明细", "Détail des créances")}
                </h2>
                <span>
                  {result.total} {text("条匹配记录", "écritures correspondantes")}
                </span>
              </div>
              <span className={styles.readonly}>
                <LockKeyhole size={11} aria-hidden="true" />
                {text("只读核查", "Lecture seule")}
              </span>
            </div>

            <Form className={styles.filters} action={`${prefix}/reports`} key={`filter-${scope}`}>
              <HiddenScope
                query={query}
                omit={["search", "direction", "management", "outstandingOnly"]}
              />
              <label className={styles.search}>
                <Search size={15} aria-hidden="true" />
                <span className={styles.srOnly}>
                  {text("搜索房号或事项", "Rechercher un lot ou un objet")}
                </span>
                <input
                  name="search"
                  defaultValue={query.search}
                  maxLength={150}
                  placeholder={text("搜索房号或事项", "Rechercher un lot ou un objet")}
                />
              </label>
              {ledger ? (
                <select
                  name="direction"
                  defaultValue={query.direction}
                  aria-label={text("账务方向", "Direction du journal")}
                >
                  <option value="">{text("全部方向", "Toutes directions")}</option>
                  {["income", "expense", "liability_in", "liability_out"].map((direction) => (
                    <option key={direction} value={direction}>
                      {directionDisplayLabel(direction, locale)}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <select
                    name="management"
                    defaultValue={query.management}
                    aria-label={text("应收管理范围", "Périmètre des créances")}
                  >
                    <option value="managed">{text("系统管理", "Créances gérées")}</option>
                    <option value="historical_pending">
                      {text("历史待核对", "Historique à vérifier")}
                    </option>
                    <option value="excluded">{text("已排除", "Exclues")}</option>
                  </select>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      name="outstandingOnly"
                      value="true"
                      defaultChecked={query.outstandingOnly}
                    />
                    {text("仅未结清", "Non soldées")}
                  </label>
                </>
              )}
              <button type="submit" className={styles.filterButton}>
                {text("筛选", "Filtrer")}
              </button>
              {query.search || query.direction || query.outstandingOnly ? (
                <Link
                  className={styles.resetLink}
                  href={href({ page: 1, search: "", direction: "", outstandingOnly: false })}
                >
                  {text("清除", "Effacer")}
                </Link>
              ) : null}
            </Form>

            {result.rows.length ? (
              <div
                className={styles.tableScroll}
                tabIndex={0}
                role="region"
                aria-label={text(
                  "账务明细表，可横向滚动",
                  "Tableau des écritures, défilement horizontal",
                )}
              >
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">
                        {ledger ? text("日期", "Date") : text("到期日", "Échéance")}
                      </th>
                      <th scope="col">{text("业务 / 事项", "Opération / objet")}</th>
                      <th scope="col" className={styles.number}>
                        {ledger
                          ? text("登记金额 · XOF", "Inscrit · XOF")
                          : text("未收 · XOF", "Solde · XOF")}
                      </th>
                      <th scope="col">
                        <span className={styles.srOnly}>
                          {text("核查来源", "Vérifier la source")}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => {
                      const isSelected = selected?.id === row.id;
                      const amount = ledger
                        ? numeric(row.amount_xof)
                        : Math.max(0, numeric(row.amount_xof) - numeric(row.paid_amount_xof));
                      const business = financialBusinessLabel(
                        String(row.source_type ?? row.category ?? ""),
                        locale,
                        String(row.category ?? ""),
                      );
                      return (
                        <tr key={String(row.id)} className={isSelected ? styles.selectedRow : ""}>
                          <td>
                            <span className={styles.date}>
                              {rowText(row, ledger ? "entry_date" : "due_date")}
                            </span>
                            <span className={styles.rowSecondary}>
                              {ledger
                                ? directionDisplayLabel(String(row.direction), locale)
                                : statusDisplayLabel(String(row.status), locale)}
                            </span>
                          </td>
                          <td>
                            <strong className={styles.rowTitle}>{business}</strong>
                            <span className={styles.rowSecondary}>
                              {[rowText(row, "building_label"), rowText(row, "unit_label")]
                                .filter((value) => value !== "—")
                                .join(" · ") || text("未关联房号", "Sans lot associé")}
                            </span>
                            <span className={styles.rowDescription}>
                              {rowText(row, ledger ? "description" : "title")}
                            </span>
                          </td>
                          <td className={`${styles.number} ${amount < 0 ? styles.negative : ""}`}>
                            <strong>
                              {!ledger && row.status === "cancelled" ? "—" : money(amount, locale)}
                            </strong>
                            {!ledger ? (
                              <span className={styles.rowSecondary}>
                                {text("应收", "Dû")} {money(numeric(row.amount_xof), locale)}
                              </span>
                            ) : null}
                          </td>
                          <td className={styles.inspectCell}>
                            <button
                              type="button"
                              className={styles.inspectButton}
                              aria-label={`${text("核查", "Vérifier")} ${rowText(row, "unit_label")} ${rowText(row, ledger ? "entry_date" : "due_date")}`}
                              aria-pressed={isSelected}
                              onClick={() => setSelection({ scope, id: String(row.id) })}
                            >
                              {text("核查", "Vérifier")}
                              <ChevronRight size={12} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.empty}>
                <FileSearch size={28} strokeWidth={1.3} aria-hidden="true" />
                <h3>
                  {result.total > 0
                    ? text("当前页无记录", "Aucune écriture sur cette page")
                    : text("没有匹配记录", "Aucune écriture correspondante")}
                </h3>
                <p>
                  {result.total > 0
                    ? text(
                        "筛选范围内仍有记录，请返回第一页查看。",
                        "Des écritures existent dans cette sélection. Revenez à la première page.",
                      )
                    : text(
                        "试试调整搜索或筛选范围；无记录不代表已结清。",
                        "Ajustez les filtres ; une liste vide ne prouve pas un règlement intégral.",
                      )}
                </p>
                {result.total > 0 ? (
                  <Link className={styles.financeLink} href={href({ page: 1 })}>
                    {text("返回第一页", "Revenir à la première page")}
                  </Link>
                ) : null}
              </div>
            )}

            <div className={styles.tableFooter}>
              <span>
                {first}–{last} / {result.total} · {text("每页", "Par page")} {result.pageSize}
              </span>
              <nav aria-label={text("明细分页", "Pagination des écritures")}>
                {query.page > 1 ? (
                  <Link
                    href={href({ page: query.page - 1 })}
                    aria-label={text("上一页", "Page précédente")}
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                  </Link>
                ) : (
                  <span className={styles.disabledPage}>
                    <ChevronLeft size={15} aria-hidden="true" />
                  </span>
                )}
                <span>
                  {query.page} / {pageCount}
                </span>
                {query.page < pageCount ? (
                  <Link
                    href={href({ page: query.page + 1 })}
                    aria-label={text("下一页", "Page suivante")}
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </Link>
                ) : (
                  <span className={styles.disabledPage}>
                    <ChevronRight size={15} aria-hidden="true" />
                  </span>
                )}
              </nav>
            </div>
          </div>
          <ReportInspector
            key={`${scope}/${String(selected?.id ?? "empty")}`}
            row={selected}
            data={data}
            locale={locale}
          />
        </section>

        <details className={styles.notes}>
          <summary>{text("统计口径与核查边界", "Périmètre et règles de contrôle")}</summary>
          <p>
            {text(
              "合计与明细使用相同筛选范围，合计覆盖全部匹配记录，不仅是当前页。趋势单独展示所选项目的月度登记净额。导出包含完整筛选结果，不仅是当前页。",
              "Les totaux couvrent toutes les écritures filtrées, pas seulement cette page. La tendance présente séparément le solde mensuel inscrit du projet. L’export couvre l’ensemble des résultats filtrés.",
            )}
          </p>
          <p>
            {text(
              "登记收入和支出不自动识别真实现金、冲正或非现金结算；不能将登记净额当作现金净收入或利润。付款事实中的原币金额和已关联应收供逐笔核查，不自动补写或改账。",
              "Le journal ne requalifie pas automatiquement trésorerie, annulations ou règlements non monétaires. Son solde n’est ni un flux net de trésorerie ni un bénéfice. Les faits de paiement servent uniquement à la vérification, sans correction automatique.",
            )}
          </p>
          <p>
            {text(
              "当前应收只按有效系统管理记录计算；每条未收最低为零，不用其他记录的多收相抵。到期日不等于服务账期；没有明确来源时不推断实际收款人或账期。",
              "Les créances sont calculées à partir des écritures gérées valides, sans compensation entre lignes. L’échéance ne remplace pas la période de service ; aucun encaisseur ni période n’est déduit sans source.",
            )}
          </p>
        </details>
      </div>
    </div>
  );
}
