"use client";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Inbox,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  OPERATOR_INBOX_KINDS,
  OPERATOR_INBOX_STATES,
  operatorInboxHref,
  operatorInboxItemHref,
  type OperatorInboxQuery,
  type OperatorInboxResult,
  type OperatorInboxState,
  type OperatorInboxKind,
} from "./operator-inbox-model";
import styles from "./operator-inbox-workbench.module.css";
export interface OperatorInboxWorkbenchProps {
  query: OperatorInboxQuery;
  result: OperatorInboxResult | null;
  locale: "zh" | "fr";
  actorLabel: string;
}
export function OperatorInboxWorkbench({
  query,
  result,
  locale,
  actorLabel,
}: OperatorInboxWorkbenchProps) {
  const router = useRouter(),
    [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.search),
    [dateFrom, setDateFrom] = useState(query.dateFrom),
    [dateTo, setDateTo] = useState(query.dateTo);
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const states: Record<"all" | OperatorInboxState, string> = {
    all: text("全部确认单", "Toutes"),
    pending: text("待本人确认", "À confirmer"),
    completed: text("已完成", "Terminées"),
    expired: text("已过期 · 未执行", "Expirées · non exécutées"),
    superseded: text("已替换", "Remplacées"),
    unknown: text("状态待核", "État à vérifier"),
  };
  const kinds: Record<"all" | OperatorInboxKind, string> = {
    all: text("全部业务类型", "Tous les types"),
    confirmations: text("日租收款", "Encaissement journalier"),
    collections: text("截图收款与分账", "Encaissements groupés"),
    "daily-workflows": text("续住 / 退房与收款", "Prolongation / départ et paiement"),
    "booking-operations": text("预订 / 更正 / 退款", "Réservation / correction / remboursement"),
  };
  const navigate = (patch: Partial<OperatorInboxQuery>) =>
    startTransition(() => router.push(operatorInboxHref(query, locale, patch)));
  const refresh = () => startTransition(() => router.refresh());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate({ search, dateFrom, dateTo, page: 1 });
  };
  const totalPages = result ? Math.max(1, Math.ceil(result.total / 30)) : 0;
  const timestamp = (value: string) =>
    new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Abidjan",
    }).format(new Date(value));
  return (
    <main className={styles.workbench} aria-busy={pending}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            {text("我的工作区 · 业务确认", "MON ESPACE · CONFIRMATIONS")}
          </p>
          <h1>{text("我的待办", "Mes opérations")}</h1>
          <p>
            {text(
              "先核对，再办理。已完成的确认单保留结果，不会因有效期过去而变成未执行。",
              "Vérifier avant d’exécuter. Une opération terminée reste terminée même après sa date d’expiration.",
            )}
          </p>
        </div>
        <button type="button" className={styles.refresh} disabled={pending} onClick={refresh}>
          <RefreshCw aria-hidden="true" className={pending ? styles.spinning : ""} />
          {text("刷新", "Actualiser")}
        </button>
      </header>
      <div className={styles.scope}>
        <ShieldCheck aria-hidden="true" />
        <p>
          {text("当前账号", "Compte connecté")}
          <strong>{actorLabel}</strong>
        </p>
        <span>
          {text(
            "仅本人创建、当前仍有权查看的确认单",
            "Uniquement vos confirmations actuellement accessibles",
          )}
        </span>
      </div>
      <nav className={styles.metrics} aria-label={text("确认单状态", "États des confirmations")}>
        {(["pending", "completed", "expired", "superseded"] as const).map((state) => (
          <button
            key={state}
            type="button"
            disabled={pending}
            aria-pressed={query.state === state}
            onClick={() => navigate({ state: query.state === state ? "all" : state, page: 1 })}
          >
            <span>{states[state]}</span>
            <strong>
              {pending || !result
                ? "—"
                : result.counts[state].toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR")}
            </strong>
          </button>
        ))}
      </nav>
      <section className={styles.panel} aria-labelledby="operator-inbox-heading">
        <div className={styles.toolbar}>
          <div className={styles.listHeading}>
            <h2 id="operator-inbox-heading">{text("确认单列表", "Vos confirmations")}</h2>
            <p>{text("整范围统计 · 每页 30 条", "Comptages complets · 30 lignes par page")}</p>
          </div>
          <form className={styles.filters} onSubmit={submit}>
            <label>
              <span>{text("业务类型", "Type d’opération")}</span>
              <select
                disabled={pending}
                value={query.kind}
                onChange={(event) =>
                  navigate({ kind: event.target.value as OperatorInboxQuery["kind"], page: 1 })
                }
              >
                {(["all", ...OPERATOR_INBOX_KINDS] as const).map((kind) => (
                  <option value={kind} key={kind}>
                    {kinds[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.search}>
              <span>{text("操作号搜索", "Rechercher un identifiant")}</span>
              <div>
                <Search aria-hidden="true" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={pending}
                  maxLength={36}
                  pattern="[a-fA-F0-9-]{1,36}"
                  placeholder={text("完整或部分请求编号", "Identifiant complet ou partiel")}
                />
              </div>
            </label>
            <label>
              <span>{text("创建日期从", "Créée à partir du")}</span>
              <input
                type="date"
                value={dateFrom}
                disabled={pending}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label>
              <span>{text("至（含当天）", "Jusqu’au inclus")}</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                disabled={pending}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
            <button type="submit" disabled={pending}>
              {text("查询", "Rechercher")}
            </button>
          </form>
          <div
            className={styles.tabs}
            role="group"
            aria-label={text("状态筛选", "Filtrer par état")}
          >
            {(["all", ...OPERATOR_INBOX_STATES] as const).map((state) => (
              <button
                key={state}
                type="button"
                disabled={pending}
                aria-pressed={query.state === state}
                onClick={() => navigate({ state, page: 1 })}
              >
                {states[state]}
                <span>{pending || !result ? "—" : result.counts[state]}</span>
              </button>
            ))}
          </div>
          <p className={styles.caption}>
            {text(
              "统计按当前业务、操作号和日期范围计算；日期使用阿比让时间。",
              "Comptages selon le type, l’identifiant et les dates choisis ; dates en heure d’Abidjan.",
            )}
          </p>
        </div>
        {pending ? (
          <div className={styles.empty} role="status">
            <RefreshCw className={styles.spinning} aria-hidden="true" />
            <h3>{text("正在读取最新确认单…", "Chargement des confirmations…")}</h3>
            <p>
              {text(
                "旧列表暂不展示，避免混淆筛选范围。",
                "L’ancienne liste est masquée pour ne pas mélanger les périmètres.",
              )}
            </p>
          </div>
        ) : !result ? (
          <div className={styles.empty} role="alert">
            <Inbox aria-hidden="true" />
            <h3>{text("确认单暂时无法读取", "Confirmations momentanément indisponibles")}</h3>
            <p>
              {text(
                "未将读取失败显示为零待办。请刷新重试；不要另起收款或丢弃原操作号。",
                "Un échec de lecture n’est pas présenté comme une liste vide. Actualisez sans recréer de paiement ni abandonner l’identifiant d’origine.",
              )}
            </p>
            <button type="button" className={styles.refresh} onClick={refresh}>
              {text("重新读取", "Réessayer")}
            </button>
          </div>
        ) : !result.items.length ? (
          <div className={styles.empty}>
            <Inbox aria-hidden="true" />
            <h3>
              {result.total > 0
                ? text("本页超出结果范围", "Page hors du résultat")
                : text("这个范围内没有确认单", "Aucune confirmation dans ce périmètre")}
            </h3>
            <p>
              {text(
                "这不代表所有业务都已处理；本页不汇总网页收款的本机未决请求。",
                "Cela ne signifie pas que toutes les tâches métier sont terminées. Les requêtes d’encaissement web en attente sur l’appareil ne figurent pas ici.",
              )}
            </p>
            {result.total > 0 ? (
              <Link href={operatorInboxHref(query, locale, { page: totalPages })}>
                {text("返回最后一页", "Aller à la dernière page")}
              </Link>
            ) : (
              <Link
                href={operatorInboxHref(
                  {
                    ...query,
                    state: "all",
                    kind: "all",
                    search: "",
                    dateFrom: "",
                    dateTo: "",
                    page: 1,
                  },
                  locale,
                )}
              >
                {text("清除筛选", "Réinitialiser les filtres")}
              </Link>
            )}
          </div>
        ) : (
          <ol className={styles.list}>
            {result.items.map((item) => {
              const href = operatorInboxItemHref(item, locale);
              return (
                <li key={`${item.kind}:${item.id}`} className={styles.item}>
                  <div className={styles.itemIcon}>
                    {item.state === "completed" ? (
                      <CheckCircle2 aria-hidden="true" />
                    ) : (
                      <Clock3 aria-hidden="true" />
                    )}
                  </div>
                  <div className={styles.itemMain}>
                    <div className={styles.itemHeading}>
                      <h3>{kinds[item.kind]}</h3>
                      <span className={styles.status} data-state={item.state}>
                        {states[item.state]}
                      </span>
                    </div>
                    <p className={styles.context}>
                      {item.unitNo
                        ? `${item.buildingLabel || text("楼栋待核", "Immeuble à vérifier")} · ${item.unitNo}`
                        : item.itemCount !== null
                          ? text(
                              `${item.itemCount} 项分账依据`,
                              `${item.itemCount} éléments de rapprochement`,
                            )
                          : text(
                              "具体内容请打开原确认单核对",
                              "Ouvrir la confirmation pour vérifier les détails",
                            )}
                    </p>
                    <p className={styles.requestId}>
                      {text("操作号", "Opération")} <code>{item.requestId}</code>
                    </p>
                    <p className={styles.dates}>
                      <span>
                        {text("创建", "Créée")} {timestamp(item.createdAt)}
                      </span>
                      <span>
                        {item.state === "completed"
                          ? text("原确认有效至", "Validité d’origine")
                          : text("确认有效至", "Valide jusqu’au")}{" "}
                        {timestamp(item.expiresAt)}
                      </span>
                    </p>
                    {item.state === "unknown" ? (
                      <p className={styles.unknown}>
                        {text(
                          `原状态：${item.sourceStatus}。无法安全判断，不提供执行入口，请保留操作号核对。`,
                          `État source : ${item.sourceStatus}. Impossible de conclure ; aucune exécution proposée. Faites vérifier l’identifiant.`,
                        )}
                      </p>
                    ) : null}
                  </div>
                  {href ? (
                    <Link className={styles.open} href={href}>
                      {item.state === "completed"
                        ? text("查看结果", "Voir le résultat")
                        : item.state === "pending"
                          ? text("打开核对", "Vérifier")
                          : text("查看原单", "Voir l’original")}
                      <ArrowUpRight aria-hidden="true" />
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {result && !pending ? (
          <footer className={styles.pagination}>
            <span>
              {text(
                `共 ${result.total} 条 · 第 ${query.page} / ${totalPages} 页`,
                `${result.total} résultat(s) · Page ${query.page} / ${totalPages}`,
              )}
            </span>
            <div>
              <button
                type="button"
                disabled={query.page <= 1}
                onClick={() => navigate({ page: query.page - 1 })}
              >
                {text("上一页", "Précédente")}
              </button>
              <button
                type="button"
                disabled={query.page >= totalPages}
                onClick={() => navigate({ page: query.page + 1 })}
              >
                {text("下一页", "Suivante")}
              </button>
            </div>
          </footer>
        ) : null}
      </section>
      <aside className={styles.boundary}>
        <ShieldCheck aria-hidden="true" />
        <div>
          <h2>
            {text(
              "这是本人确认箱，不是全公司的任务总表",
              "Votre boîte de confirmation, pas toutes les tâches de l’entreprise",
            )}
          </h2>
          <p>
            {text(
              "包含外部助手生成的日租收款、截图分账、日租流程及预订更正确认单。网页长租收款的本机未决请求在原合同收款页恢复；其他同事的单据、审计复核和线下 Excel 不在此自动合并。这里不批量批准，也不会点击列表就执行。",
              "Cette boîte contient vos confirmations préparées par l’assistant externe : paiements journaliers, rapprochements groupés et opérations de réservation. Les encaissements web de location en attente se récupèrent depuis le contrat d’origine. Les dossiers des collègues, l’audit et les fichiers Excel ne sont pas fusionnés ici. Aucun accord groupé ni exécution au clic dans la liste.",
            )}
          </p>
        </div>
      </aside>
    </main>
  );
}
