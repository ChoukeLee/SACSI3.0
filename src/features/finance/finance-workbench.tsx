"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Download, Filter, Loader2, Search, ScanSearch } from "lucide-react";
import { formatXof } from "@/lib/utils";
import {
  directionDisplayLabel,
  financialBusinessLabel,
  knownFinancialBusinessCodes,
  statusDisplayLabel,
} from "@/lib/display-labels";
import type { FinanceReadResult } from "./finance-read";
import { FinanceWorkbenchInspector } from "./finance-workbench-inspector";
import { FinanceWorkbenchTable } from "./finance-workbench-table";
import { FinanceManualEntry } from "./finance-manual-entry";
import {
  financeIssueLabels,
  financeWorkbenchHref,
  type FinanceBuildingOption,
  type FinanceProjectOption,
  type FinanceReconciliation,
  type FinanceWorkbenchMode,
  type FinanceWorkbenchQuery,
} from "./finance-workbench-model";
import styles from "./finance-workbench.module.css";

export interface FinanceWorkbenchProps {
  scopeKey: string;
  query: FinanceWorkbenchQuery;
  mode: FinanceWorkbenchMode;
  result: FinanceReadResult | null;
  projects: FinanceProjectOption[];
  buildings: FinanceBuildingOption[];
  reconciliation: FinanceReconciliation | null;
  locale: "zh" | "fr";
  canWrite: boolean;
  today: string;
  exportActions?: ReactNode;
}

export function FinanceWorkbench({
  scopeKey,
  query,
  mode,
  result,
  projects,
  buildings,
  reconciliation,
  locale,
  canWrite,
  today,
  exportActions,
}: FinanceWorkbenchProps) {
  const zh = locale === "zh";
  const text = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selection, setSelection] = useState<{
    id: string;
    scope: string;
    rows: FinanceReadResult["rows"];
  } | null>(null);
  const [exportsOpen, setExportsOpen] = useState(false);
  const inspector = useRef<HTMLDivElement>(null);
  const ledger = query.kind === "ledger";
  const reviewing = mode === "reconciliation";
  const filters = query.filters;
  const base = locale === "fr" ? "/fr" : "";
  const formId = `finance-query-${locale}`;
  const scopeBuildings = buildings.filter(
    (b) => !filters.projectId || b.project_id === filters.projectId,
  );
  const project = projects.find((p) => p.id === filters.projectId);
  const building = buildings.find((b) => b.id === filters.buildingId);
  const selected =
    !pending && selection?.scope === scopeKey && selection.rows === result?.rows
      ? (result.rows.find((r) => r.id === selection.id) ?? null)
      : null;
  const href = (nextMode: FinanceWorkbenchMode, patch?: Record<string, string | undefined>) =>
    financeWorkbenchHref(query, locale, nextMode, patch);
  const navigateScope = (patch: Record<string, string | undefined>) => {
    setSelection(null);
    startTransition(() => router.push(href(mode, { ...patch, page: undefined })));
  };
  const select = (id: string) => {
    if (!result || pending) return;
    setSelection({ id, scope: scopeKey, rows: result.rows });
    if (window.matchMedia?.("(max-width: 1199px)").matches) {
      requestAnimationFrame(() =>
        inspector.current?.scrollIntoView({ behavior: "auto", block: "start" }),
      );
    }
  };
  const metrics = ledger
    ? [
        [
          "income",
          text("收入分录", "Écritures de revenus"),
          text("不含押金 · 非会计营收", "Hors dépôts · pas un résultat comptable"),
        ],
        ["expense", text("费用", "Dépenses"), text("费用独立列示", "Dépenses séparées")],
        [
          "liability_in",
          text("押金 / 负债流入", "Entrées de passif"),
          text("不是经营收入", "Pas un revenu d’exploitation"),
        ],
        [
          "liability_out",
          text("押金 / 负债流出", "Sorties de passif"),
          text("不是当前可退余额", "Pas le solde remboursable"),
        ],
      ]
    : [
        [
          "receivable",
          text("应收总额", "Créances"),
          text("有效管理应收", "Créances gérées valides"),
        ],
        [
          "paid",
          text("应收已核销", "Créances imputées"),
          text("不等于现金实收", "Distinct des encaissements"),
        ],
        [
          "outstanding",
          text("当前未收", "Solde à recevoir"),
          text("按筛选到期日期", "Selon les échéances filtrées"),
        ],
        [
          "overdue",
          text("其中已逾期", "Dont en retard"),
          text("不含取消、历史待核和排除项", "Hors annulations, historique et exclusions"),
        ],
      ];
  const advanced = ledger
    ? !!filters.category
    : !!(filters.category || filters.status || filters.management || filters.outstandingOnly);
  const scopeCaption = `${project?.display_name || project?.code || text("全部授权项目", "Tous les projets autorisés")} · ${building?.display_name || building?.code || text("全部楼栋", "Tous les bâtiments")}`;
  const dateCaption =
    filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom || text("不限起日", "Sans début")} → ${filters.dateTo || text("不限止日", "Sans fin")}`
      : text("全部日期", "Toutes dates");
  const exportHref = `/api/finance/export?${new URLSearchParams({ ...filters, kind: query.kind })}`;

  return (
    <div className={styles.workbench} aria-busy={pending}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>FINANCE WORKSPACE</p>
          <h1>{text("财务工作台", "Espace finance")}</h1>
          <p className={styles.subtitle}>
            {text(
              "查一笔钱，看清业务、分账和付款事实。",
              "Vérifier chaque écriture, son origine et les faits du paiement.",
            )}
          </p>
        </div>
        <div className={styles.headerActions}>
          {!reviewing && (
            <FinanceManualEntry
              locale={locale}
              canWrite={canWrite}
              projectId={filters.projectId}
              buildingId={filters.buildingId}
            />
          )}
          {!reviewing && (
            <button
              type="button"
              className={styles.primaryButton}
              aria-expanded={exportsOpen}
              aria-controls="finance-exports"
              onClick={() => setExportsOpen((v) => !v)}
            >
              <Download aria-hidden="true" size={15} />
              {text("导出", "Exporter")}
            </button>
          )}
        </div>
      </header>
      <form
        id={formId}
        action={`${base}/finance`}
        method="get"
        className={styles.scopeForm}
        onSubmit={() => setSelection(null)}
      >
        <input type="hidden" name="kind" value={query.kind} />
        <label>
          {text("项目", "Projet")}
          <select
            name="projectId"
            value={filters.projectId || ""}
            disabled={pending || reviewing}
            onChange={(e) => navigateScope({ projectId: e.target.value, buildingId: undefined })}
          >
            <option value="">{text("全部授权项目", "Tous les projets autorisés")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name || p.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("楼栋", "Bâtiment")}
          <select
            name="buildingId"
            value={filters.buildingId || ""}
            disabled={pending || reviewing}
            onChange={(e) => navigateScope({ buildingId: e.target.value })}
          >
            <option value="">{text("全部楼栋", "Tous les bâtiments")}</option>
            {scopeBuildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name || b.code}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.dateFields}>
          <label>
            {ledger
              ? text("流水日期 · 起", "Date d’écriture · du")
              : text("到期日期 · 起", "Échéance · du")}
            <input
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom || ""}
              disabled={reviewing}
            />
          </label>
          <span aria-hidden="true">—</span>
          <label>
            {ledger
              ? text("流水日期 · 止", "Date d’écriture · au")
              : text("到期日期 · 止", "Échéance · au")}
            <input
              type="date"
              name="dateTo"
              defaultValue={filters.dateTo || ""}
              disabled={reviewing}
            />
          </label>
        </div>
      </form>
      <nav className={styles.tabs} aria-label={text("财务视图", "Vues financières")}>
        {(
          [
            ["ledger", text("收支流水", "Écritures")],
            ["receivables", text("应收账", "Créances")],
            ["reconciliation", text("关联核对", "Rapprochement")],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={href(key)}
            prefetch={false}
            aria-current={mode === key ? "page" : undefined}
            onClick={() => setSelection(null)}
          >
            {label}
          </Link>
        ))}
        <Link href={`${base}/reports`} className={styles.reportLink}>
          {text("经营报表", "Rapports")}
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </nav>
      {exportsOpen && !reviewing && (
        <section
          id="finance-exports"
          aria-label={text("导出选项", "Options d’export")}
          className={styles.exports}
        >
          <div>
            <h2>{text("导出当前完整筛选结果", "Exporter tous les résultats filtrés")}</h2>
            <p>
              {scopeCaption} · {dateCaption}
            </p>
            <a href={exportHref} className={styles.secondaryButton}>
              <Download size={14} aria-hidden="true" />
              {text("完整筛选 CSV", "Résultats filtrés CSV")}
            </a>
          </div>
          {exportActions ? (
            <details>
              <summary>{text("专项导出与口径说明", "Exports spécialisés et périmètres")}</summary>
              {exportActions}
            </details>
          ) : null}
        </section>
      )}
      {reviewing ? (
        <section
          className={styles.reconciliation}
          aria-label={text("财务关联待核对", "Rapprochement financier")}
        >
          <div className={styles.reviewBanner}>
            <ScanSearch size={19} aria-hidden="true" />
            <div>
              <h2>
                {text("全部授权范围的关联核对", "Rapprochement de tout le périmètre autorisé")}
              </h2>
              <p>
                {text(
                  "不随上方项目与日期筛选变化；这是只读一致性检查，不是收款待审批。",
                  "Indépendant des filtres de projet et dates ; lecture seule, pas une file d’approbation.",
                )}
              </p>
            </div>
          </div>
          {!reconciliation?.available ? (
            <div role="alert" className={styles.reviewError}>
              <h3>{text("核对结果暂时无法读取", "Rapprochement indisponible")}</h3>
              <p>
                {text(
                  "没有将读取失败显示为“零异常”，流水与应收账仍可独立查看。",
                  "L’échec n’est pas présenté comme zéro anomalie. Les écritures et créances restent accessibles.",
                )}
              </p>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => router.refresh()}
              >
                {text("重新读取", "Recharger")}
              </button>
            </div>
          ) : (
            <>
              <div className={styles.panelHeading}>
                <h2>{text("财务关联待核对", "Éléments à examiner")}</h2>
                <span>
                  {reconciliation.count} {text("项", "éléments")}
                </span>
              </div>
              {reconciliation.issues.length ? (
                <ul className={styles.issueList}>
                  {reconciliation.issues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.entity_id}-${index}`}>
                      <h3>{financeIssueLabels[locale][issue.code] || issue.code}</h3>
                      <p className={styles.issueId}>
                        {text("问题对象编号", "Identifiant de l’objet")} · {issue.entity_id}
                      </p>
                      <p>
                        {text(
                          "先核实原业务与关联记录；不根据缺失链接推断欠款，不自动补账。",
                          "Vérifier l’activité et ses liens ; aucune dette déduite d’un lien manquant, aucune correction automatique.",
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.empty}>
                  {text(
                    "当前检查范围内未发现这类关联问题。",
                    "Aucune incohérence de ces types détectée dans ce périmètre.",
                  )}
                </div>
              )}
              <p className={styles.dataNote}>
                {text(
                  `显示 ${reconciliation.issues.length} 项，最多 100 项。此检查不等于完整财务审计。`,
                  `${reconciliation.issues.length} éléments affichés, 100 maximum. Ce contrôle n’est pas un audit financier complet.`,
                )}
              </p>
            </>
          )}
        </section>
      ) : (
        result && (
          <>
            <section
              className={styles.summary}
              aria-label={text("当前筛选范围汇总", "Synthèse des filtres appliqués")}
            >
              {metrics.map(([key, label, note]) => (
                <div key={key} className={styles.stat}>
                  <p>{label}</p>
                  <div className={styles.statValue}>
                    {formatXof(result.summary[key]).replace(/\s*XOF$/, "")}
                    <small>XOF</small>
                  </div>
                  <span>{note}</span>
                </div>
              ))}
            </section>
            <div className={styles.appliedScope}>
              <span>
                {text("当前结果", "Résultats appliqués")}：{scopeCaption} · {dateCaption}
              </span>
              <span>
                {pending ? (
                  <>
                    <Loader2 className="animate-spin" size={13} />
                    {text("正在切换范围…", "Changement de périmètre…")}
                  </>
                ) : (
                  `${result.total} ${text("条", "lignes")}`
                )}
              </span>
            </div>
            <div className={styles.grid}>
              <section
                className={styles.listPanel}
                aria-label={ledger ? text("收支流水", "Écritures") : text("应收账", "Créances")}
              >
                <div className={styles.panelHeading}>
                  <h2>
                    {ledger
                      ? text("收支流水", "Écritures")
                      : text("应收明细", "Détail des créances")}
                  </h2>
                  <span>{text("金额单位 XOF", "Montants en XOF")}</span>
                </div>
                <div className={styles.toolbar}>
                  <label className={styles.search}>
                    <Search size={15} aria-hidden="true" />
                    <input
                      name="search"
                      form={formId}
                      defaultValue={filters.search || ""}
                      maxLength={150}
                      aria-label={text(
                        "搜索说明、事项或房号",
                        "Rechercher une description, un objet ou un lot",
                      )}
                      placeholder={text("搜索说明、事项或房号", "Description, objet ou lot")}
                    />
                  </label>
                  {ledger && (
                    <select
                      name="direction"
                      form={formId}
                      defaultValue={filters.direction || ""}
                      aria-label={text("收支方向", "Sens de l’écriture")}
                    >
                      <option value="">{text("所有收支", "Tous les flux")}</option>
                      {["income", "expense", "liability_in", "liability_out"].map((d) => (
                        <option key={d} value={d}>
                          {directionDisplayLabel(d, locale)}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    form={formId}
                    className={styles.secondaryButton}
                    disabled={pending}
                  >
                    {text("查询", "Filtrer")}
                  </button>
                  <details className={styles.advanced} open={advanced || undefined}>
                    <summary>
                      <Filter size={13} aria-hidden="true" />
                      {text("更多筛选", "Autres filtres")}
                    </summary>
                    <div className={styles.advancedFields}>
                      <label>
                        {text("类别", "Catégorie")}
                        <select name="category" form={formId} defaultValue={filters.category || ""}>
                          <option value="">{text("全部类别", "Toutes les catégories")}</option>
                          {knownFinancialBusinessCodes.map((c) => (
                            <option value={c} key={c}>
                              {financialBusinessLabel(c, locale)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!ledger && (
                        <>
                          <label>
                            {text("登记状态", "État enregistré")}
                            <select name="status" form={formId} defaultValue={filters.status || ""}>
                              <option value="">{text("全部状态", "Tous les états")}</option>
                              {["pending", "partial", "paid", "overdue", "cancelled"].map((s) => (
                                <option key={s} value={s}>
                                  {statusDisplayLabel(s, locale)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            {text("管理范围", "Périmètre de gestion")}
                            <select
                              name="management"
                              form={formId}
                              defaultValue={filters.management || "managed"}
                            >
                              {[
                                ["managed", text("系统管理", "Gérées")],
                                ["historical_pending", text("历史待核对", "Historique à vérifier")],
                                ["excluded", text("已排除", "Exclues")],
                                ["all", text("全部管理范围", "Tous périmètres")],
                              ].map(([v, label]) => (
                                <option key={v} value={v}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.checkbox}>
                            <input
                              type="checkbox"
                              name="outstandingOnly"
                              value="true"
                              form={formId}
                              defaultChecked={filters.outstandingOnly === "true"}
                            />
                            {text("仅未结清", "Non soldées uniquement")}
                          </label>
                        </>
                      )}
                    </div>
                  </details>
                </div>
                <p className={styles.dataNote}>
                  {ledger
                    ? text(
                        "按流水日期筛选；每行是一笔分录，不是一张完整收款凭证。",
                        "Filtre par date d’écriture ; une ligne est une écriture, pas un paiement complet.",
                      )
                    : text(
                        "按到期日期筛选；取消、历史待核和排除记录不计入有效欠款。",
                        "Filtre par échéance ; les annulations, historiques et exclusions ne sont pas des dettes gérées valides.",
                      )}
                </p>
                <FinanceWorkbenchTable
                  result={result}
                  query={query}
                  locale={locale}
                  today={today}
                  pending={pending}
                  selectedId={typeof selected?.id === "string" ? selected.id : null}
                  onSelect={select}
                  onPageNavigate={() => setSelection(null)}
                />
              </section>
              <div ref={inspector} className={styles.inspector}>
                <FinanceWorkbenchInspector
                  row={selected}
                  kind={query.kind}
                  locale={locale}
                  canWrite={canWrite}
                  scopeKey={scopeKey}
                  onClose={() => setSelection(null)}
                />
              </div>
            </div>
            <p className={styles.scopeNote}>
              {text(
                "汇总覆盖全部匹配记录，不由当前分页推算。付款总额按付款记录计一次；分录、现金、应收核销、押金各自独立，不重复相加。",
                "La synthèse couvre tous les résultats, pas seulement la page. Un paiement ne se compte qu’une fois ; écritures, encaissements, imputations et dépôts restent distincts.",
              )}
            </p>
            <Link href={`${base}/daily-rentals/receipts`} className={styles.relatedLink}>
              {text("日租历史收款与增长分析", "Historique des encaissements courts séjours")}
              <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </>
        )
      )}
    </div>
  );
}
