import Link from "next/link";
import { ArrowUpRight, CalendarClock, CircleDollarSign, ClipboardList } from "lucide-react";
import { routeFor, type Locale } from "@/lib/i18n";
import type { OperatingSnapshot } from "./operating-snapshot";
import { OperatingTrend } from "./operating-trend";
import styles from "./operating.module.css";

export function OperatingDashboard({
  snapshot: data,
  locale,
  allowsSale = true,
  allowsDaily = true,
  financeMode = false,
}: {
  snapshot: OperatingSnapshot;
  locale: Locale;
  allowsSale?: boolean;
  allowsDaily?: boolean;
  financeMode?: boolean;
}) {
  const zh = locale === "zh";
  const format = new Intl.NumberFormat(zh ? "zh-CN" : "fr-FR", { maximumFractionDigits: 2 });
  const amount = (value: number) => format.format(value);
  const baseFinance = `/finance?projectId=${data.projectId}`;
  const cashHref = routeFor(
    locale,
    `${baseFinance}&dateFrom=${data.monthStart}&dateTo=${data.asOf}`,
  );
  const dueHref = routeFor(
    locale,
    `${baseFinance}&kind=receivables&dateTo=${data.asOf}&outstandingOnly=true`,
  );
  const business = [
    {
      key: "lease",
      label: zh ? "长租经营" : "Location longue",
      value: `${data.leaseCount} ${zh ? "份生效合同" : "contrats actifs"}`,
      money: data.businessNet.lease,
      note: `${data.renewalCount} ${zh ? "份未来30天到期" : "à échéance sous 30 jours"}`,
      href: "/leases",
    },
    ...(allowsSale
      ? [
          {
            key: "sale",
            label: zh ? "出售业务" : "Ventes",
            value: `${data.saleCount} ${zh ? "份在管合同" : "contrats suivis"}`,
            money: data.businessNet.sale,
            note: `${data.saleAttention} ${zh ? "份资料待完善" : "à compléter"}`,
            href: "/sales",
          },
        ]
      : []),
    {
      key: "asset",
      label: zh ? "资产管理" : "Actifs",
      value: `${data.assetCount} ${zh ? "项已建档资产" : "actifs enregistrés"}`,
      money: data.businessNet.asset,
      note: `${data.assetAttention} ${zh ? "项条件或状态待核" : "états à examiner"}`,
      href: "/units",
    },
    ...(allowsDaily
      ? [
          {
            key: "daily",
            label: zh ? "日租服务" : "Courts séjours",
            value: `${data.dailyInHouse} ${zh ? "笔当前入住" : "séjours en cours"}`,
            money: data.dailyNet,
            note: zh ? "日历办理 · 收款分析" : "Calendrier · encaissements",
            href: "/daily-rentals",
          },
        ]
      : []),
  ];
  const taskItems = [
    {
      title: zh ? "到期收款跟进" : "Créances arrivées à échéance",
      caption: zh
        ? `逾期余额 ${amount(data.overdue)} XOF；不含历史待核对`
        : `En retard ${amount(data.overdue)} XOF; historique non confirmé exclu`,
      value: `${amount(data.dueOutstanding)} XOF`,
      href: dueHref,
      alert: data.overdue > 0,
    },
    {
      title: zh ? "租约续期安排" : "Renouvellements à préparer",
      caption: zh
        ? "仅统计已确认到期日的生效合同，未来30天"
        : "Contrats actifs avec fin confirmée, sous 30 jours",
      value: `${data.renewalCount}`,
      href: routeFor(locale, `/leases?project=${data.projectId}`),
      alert: false,
    },
    ...(allowsSale
      ? [
          {
            title: zh ? "出售合同资料核对" : "Dossiers de vente",
            caption: zh
              ? "草稿合同或总价尚未确认，不代表交付逾期"
              : "Brouillon ou prix non confirmé; pas un retard de livraison",
            value: `${data.saleAttention}`,
            href: routeFor(locale, `/sales?project=${data.projectId}`),
            alert: false,
          },
        ]
      : []),
    {
      title: zh ? "资产条件与核验" : "Conditions des actifs",
      caption: zh ? "维修、锁定、建设或占用状态待核验" : "Maintenance, blocage ou état non vérifié",
      value: `${data.assetAttention}`,
      href: routeFor(locale, `/units?project=${data.projectId}`),
      alert: false,
    },
  ];
  return (
    <section className={styles.surface} aria-label={zh ? "项目经营驾驶舱" : "Pilotage du projet"}>
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <div className={styles.metricLabel}>
            <CircleDollarSign size={15} />
            {zh ? "本月已录净收款" : "Encaissements nets du mois"}
          </div>
          <strong className={styles.metricValue}>
            {amount(data.netCollected)}
            <small>XOF</small>
          </strong>
          <Link href={cashHref}>
            {zh
              ? `截至 ${data.asOf.slice(5)} · 查看收支与凭证`
              : `Au ${data.asOf} · écritures et justificatifs`}{" "}
            ↗
          </Link>
        </div>
        <div className={styles.metric}>
          <div className={styles.metricLabel}>
            <CalendarClock size={15} />
            {zh ? "到期未收余额" : "Solde arrivé à échéance"}
          </div>
          <strong className={styles.metricValue}>
            {amount(data.dueOutstanding)}
            <small>XOF</small>
          </strong>
          <Link href={dueHref}>
            {zh
              ? `未来15天另有 ${amount(data.upcoming)} XOF 到期`
              : `${amount(data.upcoming)} XOF dus sous 15 jours`}{" "}
            ↗
          </Link>
        </div>
        <div className={styles.metric}>
          <div className={styles.metricLabel}>
            <ClipboardList size={15} />
            {zh ? "合同与资产关注项" : "Contrats et actifs à examiner"}
          </div>
          <strong className={styles.metricValue}>
            {data.attentionCount}
            <small>{zh ? "项" : "points"}</small>
          </strong>
          <span className={styles.note}>
            {zh
              ? "到期续约、合同资料、资产条件；不是自动判断的业务异常"
              : "Renouvellements, dossiers et conditions; pas des anomalies présumées"}
          </span>
        </div>
      </div>
      <div className={styles.grid}>
        <section>
          <div className={styles.panelHead}>
            <h2>{zh ? "收款趋势" : "Évolution des encaissements"}</h2>
            <Link href={cashHref}>{zh ? "财务工作区" : "Espace finance"} ↗</Link>
          </div>
          <OperatingTrend snapshot={data} locale={locale} />
        </section>
        <section aria-label={zh ? "当前关注事项" : "Points d’attention"}>
          <div className={styles.panelHead}>
            <h2>
              {financeMode
                ? zh
                  ? "收款与核对事项"
                  : "Encaissement et rapprochement"
                : zh
                  ? "当前关注事项"
                  : "Points d’attention"}
            </h2>
          </div>
          {taskItems.map((task) => (
            <Link key={task.title} href={task.href} className={styles.task}>
              <span
                className={styles.taskDot}
                style={task.alert ? { backgroundColor: "#bc4b4b" } : undefined}
              />
              <span>
                {task.title}
                <small>{task.caption}</small>
              </span>
              <strong>{task.value}</strong>
            </Link>
          ))}
        </section>
      </div>
      <section>
        <div className={styles.panelHead}>
          <h2>{zh ? "业务概览" : "Vue des activités"}</h2>
          <span className={styles.note}>
            {zh
              ? "收款按本月，合同与资产为当前状态"
              : "Encaissements du mois; contrats et actifs à date"}
          </span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.overview}>
            <thead>
              <tr>
                <th scope="col">{zh ? "业务" : "Activité"}</th>
                <th scope="col">{zh ? "当前规模" : "Périmètre actuel"}</th>
                <th scope="col" className={styles.amount}>
                  {zh ? "本月净收款 XOF" : "Net du mois XOF"}
                </th>
                <th scope="col">{zh ? "关注点" : "À suivre"}</th>
                <th scope="col">{zh ? "进入" : "Ouvrir"}</th>
              </tr>
            </thead>
            <tbody>
              {business.map((row) => (
                <tr key={row.key} data-business={row.key}>
                  <td>
                    <strong>{row.label}</strong>
                  </td>
                  <td>{row.value}</td>
                  <td className={styles.amount}>{amount(row.money)}</td>
                  <td>{row.note}</td>
                  <td>
                    <Link
                      href={routeFor(locale, `${row.href}?project=${data.projectId}`)}
                      aria-label={`${row.label} · ${zh ? "进入工作区" : "ouvrir"}`}
                    >
                      <ArrowUpRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={styles.detailTable}>
        <div className={styles.panelHead}>
          <h2>{zh ? "优先跟进的到期应收" : "Créances à traiter en priorité"}</h2>
          <Link href={dueHref}>{zh ? "查看全部" : "Tout voir"} ↗</Link>
        </div>
        {!data.dueItems.length ? (
          <p className={styles.empty}>
            {zh
              ? "当前项目没有到期未收的系统管理应收。"
              : "Aucune créance gérée arrivée à échéance dans ce projet."}
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.overview}>
              <thead>
                <tr>
                  <th scope="col">{zh ? "事项 / 资产" : "Objet / actif"}</th>
                  <th scope="col">{zh ? "到期日" : "Échéance"}</th>
                  <th scope="col" className={styles.amount}>
                    {zh ? "未收 XOF" : "Solde XOF"}
                  </th>
                  <th scope="col">{zh ? "详情" : "Détail"}</th>
                </tr>
              </thead>
              <tbody>
                {data.dueItems.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.title}</strong>
                      <p className={styles.note}>
                        {[row.building, row.unit].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td>{row.date}</td>
                    <td className={styles.amount}>{amount(row.balance)}</td>
                    <td>
                      <Link href={dueHref}>{zh ? "核对" : "Vérifier"} ↗</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {(data.excludedCount > 0 || data.historicalPending > 0) && (
        <p className={styles.notice}>
          {zh
            ? `${data.excludedCount} 笔本月收款未纳入净收款；${data.historicalPending} 条历史待核对应收未纳入余额。`
            : `${data.excludedCount} écritures exclues du net; ${data.historicalPending} créances historiques non confirmées hors solde.`}{" "}
          <Link href={routeFor(locale, "/data-quality")}>
            {zh ? "查看核验说明" : "Voir les contrôles"} ↗
          </Link>
        </p>
      )}
      <p className={styles.note}>
        {zh
          ? "数据仅限当前项目及当前账号有权查看的记录。净收款不等于利润；应收已核销金额不等于当月现金。"
          : "Uniquement les données autorisées du projet. Encaissement net ≠ bénéfice; imputation des créances ≠ trésorerie mensuelle."}
      </p>
    </section>
  );
}
