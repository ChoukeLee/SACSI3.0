import Link from "next/link";
import { CalendarClock, Clock3, ArrowUpRight } from "lucide-react";
import { routeFor, type Locale } from "@/lib/i18n";
import { formatPropertyMoney } from "@/lib/property-money";
import {
  sortCollectionRows,
  type UnifiedLeaseCollectionRow,
} from "@/features/leases/unified-lease-collections-model";
import styles from "./rental-first-dashboard.module.css";

export interface RentalHomeCash {
  rentIncomeXof: number;
  expenseXof: number;
  unknownBookedCount: number;
  unverifiedLedgerCount?: number;
  costCoverageComplete: boolean;
  rentCount: number;
  expenseCount: number;
  originals: { currency: string; income: number; expense: number }[];
}

export interface RentalHomeData {
  rows: UnifiedLeaseCollectionRow[];
  unavailable: { apartments: boolean; operatingAssets: boolean };
  cash: RentalHomeCash | null;
  month: string;
}

export function RentalFirstDashboard({
  data,
  locale,
  today,
  projectId,
  allowsSale,
}: {
  data: RentalHomeData;
  locale: Locale;
  today: string;
  projectId: string;
  allowsSale: boolean;
}) {
  const zh = locale === "zh";
  const text = (a: string, b: string) => (zh ? a : b);
  const rows = sortCollectionRows(data.rows, locale);
  const overdue = rows.filter((row) => row.status === "overdue");
  const upcoming = rows.filter((row) => row.status === "upcoming");
  const partial = data.unavailable.apartments || data.unavailable.operatingAssets;
  const periodStart = `${data.month}-01`;
  const monthEnd = new Date(
    Date.UTC(Number(data.month.slice(0, 4)), Number(data.month.slice(5)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const periodEnd = monthEnd > today ? today : monthEnd;
  const finance = routeFor(
    locale,
    `/finance?${new URLSearchParams({ projectId, dateFrom: periodStart, dateTo: periodEnd })}`,
  );
  const followup = routeFor(locale, "/leases?assetCategory=followup");
  const cash = data.cash;
  const value = (amount: number) => formatPropertyMoney(amount, "XOF", locale);
  function collectionPanel(
    title: string,
    status: "overdue" | "upcoming",
    list: UnifiedLeaseCollectionRow[],
  ) {
    const Icon = status === "overdue" ? Clock3 : CalendarClock;
    return (
      <section className={styles.panel} aria-label={title}>
        <header className={styles.followHeading}>
          <h2>
            <Icon size={16} aria-hidden="true" />
            {title}
          </h2>
          <Link href={`${followup}#lease-collection-${status}`} prefetch={false}>
            {partial ? text("已读取 ", "Chargés : ") : ""}
            {list.length} {text("项", "dossier(s)")}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </header>
        {list.length ? (
          <ul className={styles.followList}>
            {list.slice(0, 2).map((row) => (
              <li key={row.id}>
                <Link href={row.href} prefetch={false} className={styles.followRow}>
                  <span className={styles.party}>
                    <span className={styles.assetName}>
                      {[row.group, row.name].filter(Boolean).join(" · ")}
                    </span>
                    {row.tenant ? <span className={styles.tenant}>{row.tenant}</span> : null}
                    <span className={styles.timing}>
                      {[row.dueDate, row.statusLabel].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={styles.rowAmount}>
                    {row.amount ?? text("金额待补", "Montant à compléter")}
                    {/测算|estimation/i.test(row.amountLabel) ? (
                      <small>{text("含租金测算", "Estimation incluse")}</small>
                    ) : null}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            {partial
              ? text("当前已读取范围内暂无此类记录。", "Aucun dossier dans les données chargées.")
              : text("当前没有此类租金跟进。", "Aucun loyer à suivre dans cette catégorie.")}
          </p>
        )}
        {list.length > 2 ? (
          <Link
            className={styles.moreLink}
            href={`${followup}#lease-collection-${status}`}
            prefetch={false}
          >
            {text("查看全部", "Tout voir")} ↗
          </Link>
        ) : null}
      </section>
    );
  }
  return (
    <section
      className={styles.workspace}
      aria-label={text("租赁优先经营首页", "Accueil des locations")}
    >
      <div className={styles.scopeLine}>
        <span>
          {text("截至", "Au")} {today}
        </span>
        <Link href={routeFor(locale, "/leases")} prefetch={false}>
          {text("进入长租", "Ouvrir les locations")} <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <div className={styles.priority}>
        {collectionPanel(text("逾期租金", "Loyers en retard"), "overdue", overdue)}
        {collectionPanel(text("15天内应缴", "À payer sous 15 jours"), "upcoming", upcoming)}
      </div>
      <p className={styles.note}>
        {text(
          "含已确认的租赁相关费用，逐项以收付款明细为准。",
          "Y compris les frais locatifs confirmés ; consulter le détail de chaque paiement.",
        )}
      </p>
      {partial ? (
        <p className={styles.note} role="status">
          {text(
            "部分租赁资料暂不可用，以上数量仅含已成功读取的记录。",
            "Certaines données locatives sont indisponibles ; seuls les dossiers chargés sont comptés.",
          )}
        </p>
      ) : null}
      <section aria-label={text("月度实际收支", "Encaissements et dépenses du mois")}>
        <div className={styles.cashHeading}>
          <h2>
            {data.month === today.slice(0, 7)
              ? text("本月收支", "Flux du mois")
              : text("月度收支", "Flux mensuels")}
          </h2>
          <form action={routeFor(locale, "/management")} method="get" className={styles.period}>
            <input type="hidden" name="project" value={projectId} />
            <label>
              <span className="sr-only">{text("选择月份", "Choisir le mois")}</span>
              <input
                name="month"
                type="month"
                defaultValue={data.month}
                min="2000-01"
                max={today.slice(0, 7)}
                required
              />
            </label>
            <button type="submit">{text("查看", "Afficher")}</button>
            <Link href={finance} prefetch={false}>
              {text("查看流水", "Voir les flux")} ↗
            </Link>
          </form>
        </div>
        <div className={styles.cashGrid}>
          <div className={styles.cashCard}>
            <span className={styles.label}>
              {text("已录租金实收", "Loyers encaissés enregistrés")}
            </span>
            <span className={styles.cashValue}>
              {cash
                ? cash.rentCount
                  ? cash.rentIncomeXof === 0 && cash.unknownBookedCount > 0
                    ? text("原币收款 · 见明细", "Encaissements en devise · voir le détail")
                    : value(cash.rentIncomeXof)
                  : text("暂无已录收款", "Aucun encaissement enregistré")
                : text("暂无法读取", "Indisponible")}
            </span>
            <span className={styles.note}>
              {cash
                ? `${cash.rentCount} ${text("笔已确认记录 · 西法记账额", "écriture(s) confirmée(s) · montant XOF")}`
                : text("不按零收入处理", "Sans présumer un montant nul")}
            </span>
          </div>
          <div className={styles.cashCard}>
            <span className={styles.label}>
              {text("已录实际支出", "Dépenses effectives enregistrées")}
            </span>
            <span className={styles.cashValue}>
              {cash
                ? cash.expenseCount
                  ? cash.expenseXof === 0 && cash.unknownBookedCount > 0
                    ? text("原币支出 · 见明细", "Dépenses en devise · voir le détail")
                    : value(cash.expenseXof)
                  : text("暂无已录支出", "Aucune dépense enregistrée")
                : text("暂无法读取", "Indisponible")}
            </span>
            <span className={styles.note}>
              {cash
                ? `${cash.expenseCount} ${text("笔已确认记录 · 按实际付出日", "écriture(s) confirmée(s) · date réelle")}`
                : text("支出资料状态未知", "État des dépenses inconnu")}
            </span>
          </div>
        </div>
        {cash?.originals.length ? (
          <details className={styles.originals}>
            <summary>
              {text("查看原币收付款（含押金等）", "Flux en devises, dépôts compris")}
            </summary>
            <dl>
              {cash.originals.map((row) => (
                <div key={row.currency}>
                  <dt>{row.currency}</dt>
                  <dd>
                    {text("实收", "Reçu")} {formatPropertyMoney(row.income, row.currency, locale)} ·{" "}
                    {text("支出", "Payé")} {formatPropertyMoney(row.expense, row.currency, locale)}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
        <p className={styles.note}>
          {text(
            "按系统已确认到账与付出记录统计，押金及非现金结算分开列示；支出资料未齐时不计算经营收益。",
            "Flux confirmés enregistrés ; dépôts et règlements non monétaires séparés. Aucun bénéfice sans coûts complets.",
          )}
          {cash?.unknownBookedCount
            ? ` ${text("部分原币记录尚无西法记账额，以上为已记账部分。", "Certains flux en devise ne disposent pas de montant XOF ; total partiel.")}`
            : ""}
        </p>
        {cash?.unverifiedLedgerCount ? (
          <p className={styles.note}>
            {text(
              `另有 ${cash.unverifiedLedgerCount} 条分录缺少可关联的实际付款记录，可在财务的“分录与应收”中查看。`,
              `${cash.unverifiedLedgerCount} écritures ne disposent pas de paiement effectif associé ; consulter les écritures et créances.`,
            )}
          </p>
        ) : null}
      </section>
      {allowsSale ? (
        <details className={styles.saleSection}>
          <summary>
            {text("出售尾款", "Soldes des ventes")}
            <span>{text("单独查看", "Consulter séparément")}</span>
          </summary>
          <div className={styles.saleContent}>
            <p>
              {text(
                "查看买方、已收房款和待收尾款；未约定付款日的款项保留待收状态。",
                "Acheteurs, montants reçus et soldes dus ; sans date convenue, le solde reste à recevoir.",
              )}
            </p>
            <Link
              href={routeFor(locale, `/sales?project=${projectId}&saleFollowup=unpaid`)}
              prefetch={false}
            >
              {text("进入出售跟进", "Suivre les soldes des ventes")}{" "}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </details>
      ) : null}
    </section>
  );
}
