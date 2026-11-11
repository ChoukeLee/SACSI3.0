"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { RightDrawer } from "@/components/ui/operational";
import { formatPropertyMoney } from "@/lib/property-money";
import { financialBusinessLabel } from "@/lib/display-labels";
import type { FinanceWorkbenchProps } from "./finance-workbench";
import type { FinanceActualCashRow } from "./finance-actual-cash-model";
import { FinanceManualEntry } from "./finance-manual-entry";
import { FinanceWorkbenchInspector } from "./finance-workbench-inspector";
import styles from "./finance-actual-cash.module.css";

export function FinanceActualCashWorkbench({
  actualCash: data,
  actualCashUnavailable,
  query,
  locale,
  buildings,
  canWrite,
  today,
  scopeKey,
}: FinanceWorkbenchProps) {
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const router = useRouter();
  const [search, setSearch] = useState(query.filters.search ?? "");
  const [direction, setDirection] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prefix = locale === "fr" ? "/fr" : "";
  const money = (amount: number, currency = "XOF") => formatPropertyMoney(amount, currency, locale);
  const selected = data?.rows.find((row) => row.id === selectedId) ?? null;
  const currentMonth = query.filters.dateFrom?.slice(0, 7) || today.slice(0, 7);
  const selectedBuilding = buildings.find((building) => building.id === query.filters.buildingId);
  const cashHref = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams({ ...query.filters, kind: "ledger", view: "cash" });
    for (const [key, value] of Object.entries(patch))
      value ? params.set(key, value) : params.delete(key);
    return `${prefix}/finance?${params}`;
  };
  const ledgerParams = new URLSearchParams({ ...query.filters, kind: "ledger" });
  const allLedgerParams = new URLSearchParams({
    projectId: query.filters.projectId || "",
    kind: "ledger",
  });
  const label = (row: FinanceActualCashRow) =>
    row.category === "payment_bundle"
      ? text("合并收付款 · 分项见详情", "Paiement groupé · détail disponible")
      : financialBusinessLabel(row.category, locale);
  const rows = (data?.rows ?? []).filter((row) => {
    const matchDirection =
      direction === "all" ||
      (direction === "income"
        ? row.cashDirection === "in" && row.kind !== "deposit_in"
        : direction === "expense"
          ? row.kind === "expense"
          : row.kind === "deposit_in" || row.kind === "deposit_out");
    return (
      matchDirection &&
      `${row.assetLabel} ${row.description} ${label(row)}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase())
    );
  });
  const visible = rows.slice((page - 1) * 50, page * 50);
  const partial = !!data && (data.unknownBookedCount > 0 || data.unverifiedLedgerCount > 0);
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>{text("财务", "Finance")}</h1>
          <p>
            {text(
              "查看实际收支，再追溯资产、分账与付款事实。",
              "Consulter les mouvements réels, leurs actifs et leur origine.",
            )}
          </p>
        </div>
        {canWrite ? (
          <details className={styles.more}>
            <summary>{text("更多操作", "Autres actions")}</summary>
            <FinanceManualEntry
              locale={locale}
              canWrite={canWrite}
              projectId={query.filters.projectId}
              buildingId={query.filters.buildingId}
            />
          </details>
        ) : null}
      </header>
      <nav className={styles.tabs} aria-label={text("财务视图", "Vues financières")}>
        <Link href={cashHref({})} aria-current="page">
          {text("实际收支", "Mouvements réels")}
        </Link>
        <Link href={`${prefix}/finance?${ledgerParams}`}>
          {text("分录与应收", "Écritures et créances")}
        </Link>
        <Link href={`${prefix}/reports`} className={styles.reportLink}>
          {text("经营报表", "Rapports")}
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </nav>
      <div className={styles.toolbar} aria-label={text("收支筛选", "Filtres des mouvements")}>
        <label className={styles.month}>
          <span>{text("月份", "Mois")}</span>
          <input
            type="month"
            value={currentMonth}
            max={today.slice(0, 7)}
            onChange={(event) => {
              if (!/^\d{4}-\d{2}$/.test(event.target.value)) return;
              const month = event.target.value;
              const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
                .toISOString()
                .slice(0, 10);
              router.push(cashHref({ dateFrom: `${month}-01`, dateTo: end > today ? today : end }));
            }}
          />
        </label>
        <select
          aria-label={text("资产范围", "Périmètre des actifs")}
          value={query.filters.buildingId || ""}
          onChange={(event) => router.push(cashHref({ buildingId: event.target.value }))}
        >
          <option value="">
            {text("全部楼栋与独立资产", "Tous bâtiments et actifs indépendants")}
          </option>
          {buildings.map((building) => (
            <option key={building.id} value={building.id}>
              {building.display_name || building.code}
            </option>
          ))}
        </select>
        <label className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            aria-label={text("搜索实际收支", "Rechercher les mouvements")}
            placeholder={text("搜索资产、用途或说明", "Actif, objet ou description")}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
              setSelectedId(null);
            }}
          />
        </label>
        <select
          aria-label={text("收支方向", "Sens du mouvement")}
          value={direction}
          onChange={(event) => {
            setDirection(event.target.value);
            setPage(1);
            setSelectedId(null);
          }}
        >
          <option value="all">{text("全部收支", "Tous les mouvements")}</option>
          <option value="income">{text("收入", "Revenus")}</option>
          <option value="expense">{text("费用支出", "Dépenses")}</option>
          <option value="deposits">{text("押金与其他负债", "Dépôts et autres passifs")}</option>
        </select>
      </div>
      {actualCashUnavailable || !data ? (
        <section role="alert" className={styles.unavailable}>
          <h2>{text("实际收支暂时无法读取", "Mouvements réels indisponibles")}</h2>
          <p>
            {text(
              "未显示为零收支。可以重新读取，或查看原有分录。",
              "Aucun montant nul n’est substitué. Rechargez ou consultez les écritures.",
            )}
          </p>
          <button type="button" onClick={() => router.refresh()}>
            {text("重新读取", "Recharger")}
          </button>
          <Link href={`${prefix}/finance?${ledgerParams}`}>
            {text("查看分录", "Voir les écritures")}
          </Link>
        </section>
      ) : (
        <>
          <section
            className={styles.summary}
            aria-label={text("已录实际收支汇总", "Synthèse des mouvements enregistrés")}
          >
            <div>
              <span>{text("已录收入 · 不含押金", "Revenus enregistrés · hors dépôts")}</span>
              <p>
                {data.unknownBookedCount && !data.incomeXof
                  ? text("原币另列，西法未齐", "Devises séparées, total XOF incomplet")
                  : money(data.incomeXof)}
              </p>
              <small>
                {text("其中租金", "Dont loyers")}{" "}
                {data.unknownBookedCount && data.rentReceiptCount && !data.rentIncomeXof
                  ? text("原币见下方", "Voir les devises ci-dessous")
                  : money(data.rentIncomeXof)}
              </small>
            </div>
            <div>
              <span>{text("已录费用支出", "Dépenses enregistrées")}</span>
              <p>
                {data.expenseReceiptCount
                  ? data.unknownBookedCount && !data.expenseXof
                    ? text("原币另列，西法未齐", "Devises séparées, total XOF incomplet")
                    : money(data.expenseXof)
                  : text("暂无已确认支出", "Aucune dépense confirmée")}
              </p>
              <small>
                {text(
                  "费用资料未齐，不据此计算经营利润",
                  "Dossier des coûts incomplet ; bénéfice non calculé",
                )}
              </small>
            </div>
          </section>
          <details className={styles.native}>
            <summary>{text("原币收付款与押金", "Mouvements en devise et dépôts")}</summary>
            <p>
              {text(
                "原币分项包含押金等合款；收入、费用和押金分别统计。",
                "Les mouvements en devise incluent les paiements groupés et dépôts ; revenus, dépenses et passifs restent séparés.",
              )}
            </p>
            <div>
              {data.nativeTotals.map((row) => (
                <span key={row.currency}>
                  {row.currency} · {text("流入", "Entrées")} {money(row.incoming, row.currency)} ·{" "}
                  {text("流出", "Sorties")} {money(row.outgoing, row.currency)}
                </span>
              ))}
            </div>
            <p>
              {text("西法已录负债流入 / 流出", "Passifs enregistrés en XOF · entrées / sorties")}：
              {money(data.depositInXof)} / {money(data.depositOutXof)}
            </p>
          </details>
          {partial ? (
            <p className={styles.notice}>
              {text(
                `西法金额为已核验部分：${data.unknownBookedCount} 笔原币收支未纳入西法合计，${data.unverifiedLedgerCount} 条分录未核验为实际付款。`,
                `Montants XOF vérifiés uniquement : ${data.unknownBookedCount} mouvements en devise hors total XOF, ${data.unverifiedLedgerCount} écritures sans preuve de paiement vérifiée.`,
              )}
            </p>
          ) : null}
          <div className={styles.scope}>
            <span>
              {selectedBuilding?.display_name || text("全部授权资产", "Tous les actifs autorisés")}{" "}
              · {query.filters.dateFrom} — {query.filters.dateTo}
            </span>
            <span>
              {rows.length} {text("笔", "mouvements")}
            </span>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{text("收付日期", "Date")}</th>
                  <th>{text("资产 / 用途", "Actif / objet")}</th>
                  <th className={styles.amount}>
                    {text("原币实收 / 实付", "Montant réel en devise")}
                  </th>
                  <th className={styles.amount}>
                    {text("西法记账额", "Montant comptabilisé XOF")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.rowLink}
                        onClick={() => setSelectedId(row.id)}
                      >
                        {row.assetLabel || label(row)}
                      </button>
                      <small>{label(row)}</small>
                    </td>
                    <td className={styles.amount}>
                      {row.cashDirection === "out" ? "−" : "+"}
                      {money(row.amountNative, row.currency)}
                    </td>
                    <td className={styles.amount}>
                      {row.bookedAmountXof === null
                        ? text("原币结算 / 待补折算", "Devise / conversion non établie")
                        : money(row.bookedAmountXof)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length ? (
              <p className={styles.empty}>
                {text(
                  "当前筛选没有已确认的收付款记录。",
                  "Aucun mouvement confirmé pour ces filtres.",
                )}
              </p>
            ) : null}
            <footer className={styles.paging}>
              <span>
                {rows.length
                  ? `${(page - 1) * 50 + 1}–${Math.min(page * 50, rows.length)} / ${rows.length}`
                  : "0 / 0"}
              </span>
              <div>
                <button
                  type="button"
                  disabled={page === 1}
                  aria-label={text("上一页", "Page précédente")}
                  onClick={() => setPage((value) => value - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {page} / {Math.max(1, Math.ceil(rows.length / 50))}
                </span>
                <button
                  type="button"
                  disabled={page * 50 >= rows.length}
                  aria-label={text("下一页", "Page suivante")}
                  onClick={() => setPage((value) => value + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </footer>
          </div>
          <p className={styles.footnote}>
            {text(
              "只按已关联付款和已确认经营资产收支统计；同一付款只计一次。押金、非现金抵扣、冲正与待核记录单独保留，收支净额不等于利润。",
              "Paiements liés et mouvements d’actifs confirmés uniquement, sans double compte. Dépôts, compensations, corrections et éléments à vérifier restent distincts ; le solde de trésorerie n’est pas un bénéfice.",
            )}
          </p>
        </>
      )}
      <Link href={`${prefix}/finance?${allLedgerParams}`} className={styles.history}>
        {text("查看全部日期的分录与应收", "Consulter les écritures et créances de toutes dates")}
        <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
      <RightDrawer
        open={!!selected}
        title={text("收支详情", "Détail du mouvement")}
        onClose={() => setSelectedId(null)}
        className={styles.drawer}
      >
        {selected ? (
          <>
            <h2 className={styles.detailAsset}>{selected.assetLabel || label(selected)}</h2>
            <dl className={styles.facts}>
              <div>
                <dt>{text("实际收付日", "Date réelle")}</dt>
                <dd>{selected.date}</dd>
              </div>
              <div>
                <dt>{text("原币实收 / 实付", "Montant réel en devise")}</dt>
                <dd>{money(selected.amountNative, selected.currency)}</dd>
              </div>
              <div>
                <dt>{text("西法记账额", "Montant comptabilisé XOF")}</dt>
                <dd>
                  {selected.bookedAmountXof === null
                    ? text("未折算", "Non converti")
                    : money(selected.bookedAmountXof)}
                </dd>
              </div>
              <div>
                <dt>{text("用途", "Objet")}</dt>
                <dd>{label(selected)}</dd>
              </div>
            </dl>
            {selected.description ? (
              <p className={styles.description}>{selected.description}</p>
            ) : null}
            {selected.ledgerId ? (
              <details className={styles.proof}>
                <summary>
                  {text("来源、分账与付款核对", "Origine, répartition et preuve du paiement")}
                </summary>
                <FinanceWorkbenchInspector
                  row={{ id: selected.ledgerId, payment_id: selected.paymentId }}
                  kind="ledger"
                  locale={locale}
                  canWrite={canWrite}
                  scopeKey={scopeKey}
                />
              </details>
            ) : selected.operatingAssetId ? (
              <Link
                className={styles.history}
                href={`${prefix}/units?assetView=operations&operatingAsset=${encodeURIComponent(selected.operatingAssetId)}`}
              >
                {text("查看资产与完整流水", "Voir l’actif et son journal")}
                <ArrowUpRight size={14} />
              </Link>
            ) : null}
          </>
        ) : null}
      </RightDrawer>
    </div>
  );
}
