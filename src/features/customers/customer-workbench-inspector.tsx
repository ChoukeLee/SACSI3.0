"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Loader2, UsersRound } from "lucide-react";
import { buildWorkbenchRecordHref } from "@/lib/workbench-links";
import { statusDisplayLabel } from "@/lib/display-labels";
import {
  customerDirectoryQueryKey,
  decodeCustomerDirectory,
  type CustomerDirectoryData,
  type CustomerDirectoryProfile,
  type CustomerDirectoryQuery,
  type CustomerRelationRole,
} from "./customer-directory-model";
import styles from "./customer-workbench.module.css";

export function customerRelationRoleLabel(role: CustomerRelationRole, locale: "zh" | "fr") {
  const labels = {
    lease: ["合同承租人", "Locataire contractuel"],
    sale: ["合同买方", "Acheteur contractuel"],
    daily_guest: ["实际住客", "Client hébergé"],
    daily_agent: ["代订联系人", "Contact de réservation"],
    daily_unknown: ["日租身份待核", "Identité historique à vérifier"],
  };
  return labels[role][locale === "zh" ? 0 : 1];
}
export function CustomerWorkbenchInspector({
  id,
  query,
  locale,
  canEdit,
  returnTo,
  refreshVersion,
  onEdit,
}: {
  id: string | null;
  query: CustomerDirectoryQuery;
  locale: "zh" | "fr";
  canEdit: boolean;
  returnTo: string;
  refreshVersion: number;
  onEdit: (profile: CustomerDirectoryProfile) => void;
}) {
  const zh = locale === "zh";
  const text = (a: string, b: string) => (zh ? a : b);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; data: CustomerDirectoryData } | null>(null);
  const [failed, setFailed] = useState<{ key: string; status: number } | null>(null);
  const [tab, setTab] = useState<"relations" | "profile">("relations");
  const scopeKey = customerDirectoryQueryKey(query);
  const key = `${scopeKey}:${id}:${page}:${retry}:${refreshVersion}`;
  const data = loaded?.key === key ? loaded.data : null;
  const error = failed?.key === key ? failed.status : null;
  useEffect(() => {
    if (!id) return;
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      ...query,
      page: String(query.page),
      mode: "detail",
      customer: id,
      relationshipPage: String(page),
    });
    void (async () => {
      try {
        const response = await fetch(`/api/customers/directory?${params}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (active) setFailed({ key, status: response.status });
          return;
        }
        const result = decodeCustomerDirectory(await response.json(), query, "detail", id, page);
        if (active && !controller.signal.aborted) setLoaded({ key, data: result });
      } catch {
        if (active && !controller.signal.aborted) setFailed({ key, status: 503 });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [id, scopeKey, key, page, query]);
  if (!id)
    return (
      <aside className={styles.panel} aria-label={text("客户关系详情", "Relations client")}>
        <div className={styles.empty}>
          <UsersRound size={28} strokeWidth={1.2} aria-hidden="true" />
          <strong>{text("先选择一份客户档案", "Choisissez un dossier client")}</strong>
          <p>
            {text(
              "沿明确身份查看合同与资产；同名不自动合并。",
              "Consultez les liens explicites ; les homonymes ne sont pas fusionnés.",
            )}
          </p>
        </div>
      </aside>
    );
  const c = data?.profile;
  const row = data?.rows[0];
  return (
    <aside className={styles.panel} aria-label={text("客户关系详情", "Relations client")}>
      {error ? (
        <div className={styles.empty} role="alert">
          <strong>
            {error === 404 || error === 403
              ? text("此客户不在当前可见范围内", "Client absent du périmètre visible")
              : text("客户关系暂时无法读取", "Relations indisponibles")}
          </strong>
          <p>
            {text(
              "未读取完成时不展示旧档案或推算关系。",
              "Aucun ancien dossier ni lien déduit n'est affiché.",
            )}
          </p>
          <button className={styles.secondary} onClick={() => setRetry((v) => v + 1)}>
            {text("重新读取", "Recharger")}
          </button>
        </div>
      ) : !c || !row ? (
        <div className={styles.empty} role="status">
          <Loader2 className="animate-spin" size={20} aria-hidden="true" />
          {text("正在读取明确关联…", "Chargement des liens explicites…")}
        </div>
      ) : (
        <>
          <header className={styles.detailHeader}>
            <div className={styles.avatar} aria-hidden="true">
              {c.name.slice(0, 1)}
            </div>
            <div>
              <h2>{c.name}</h2>
              <p className={styles.minor}>
                {c.phone || text("联系电话未登记", "Téléphone non renseigné")}
              </p>
              <div className={styles.tags}>
                {row.roles.map((role) => (
                  <span key={role} className={styles.tag}>
                    {customerRelationRoleLabel(role, locale)}
                  </span>
                ))}
                {c.is_blacklisted && (
                  <span className={`${styles.tag} ${styles.risk}`}>
                    <AlertTriangle size={11} aria-hidden="true" />
                    {text("黑名单", "Liste noire")}
                  </span>
                )}
              </div>
            </div>
          </header>
          <nav
            className={styles.tabs}
            aria-label={text("客户档案视图", "Vue du dossier")}
            style={{ padding: "0 20px" }}
          >
            <a
              href="#customer-relations"
              aria-current={tab === "relations" ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setTab("relations");
              }}
            >
              {text("明确关系", "Relations explicites")}
            </a>
            <a
              href="#customer-profile"
              aria-current={tab === "profile" ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setTab("profile");
              }}
            >
              {text("档案资料", "Coordonnées")}
            </a>
          </nav>
          <div className={styles.detailBody}>
            {c.is_blacklisted && (
              <div className={`${styles.callout} ${styles.risk}`}>
                <strong>{text("黑名单风险提示", "Alerte liste noire")}</strong>
                <p>{c.blacklist_reason || text("原因未登记", "Motif non renseigné")}</p>
                <p>
                  {c.blacklist_date || text("日期未登记", "Date non renseignée")} ·{" "}
                  {c.blacklist_permanent ? text("永久", "Permanent") : text("临时", "Temporaire")}
                </p>
              </div>
            )}
            {tab === "relations" ? (
              <section id="customer-relations" className={styles.section}>
                <h3>{text("已确认身份分别查看", "Rôles distincts")}</h3>
                <p className={styles.hint}>
                  {text(
                    "买方、承租人、实际住客和代订联系人分别识别；联系人不等于住客或收款人。",
                    "Acheteur, locataire, client hébergé et contact restent distincts. Un contact n'est pas nécessairement le client ni l'encaisseur.",
                  )}
                </p>
                {data.relationships.length === 0 && (
                  <p className={styles.callout}>
                    {text(
                      "当前范围内尚无可见的明确业务关联；不推断项目归属。",
                      "Aucun lien métier visible dans ce périmètre ; aucun projet n'est déduit.",
                    )}
                  </p>
                )}
                {data.relationships.map((rel) => {
                  const workspace =
                    rel.role === "lease" ? "leases" : rel.role === "sale" ? "sales" : null;
                  const href = workspace
                    ? buildWorkbenchRecordHref({
                        workspace,
                        id: rel.id,
                        project: rel.projectId,
                        building: rel.buildingId,
                        locale,
                        returnTo,
                      })
                    : null;
                  const unitHref = buildWorkbenchRecordHref({
                    workspace: "units",
                    id: rel.unitId,
                    project: rel.projectId,
                    building: rel.buildingId,
                    locale,
                    returnTo,
                  });
                  return (
                    <article key={`${rel.role}:${rel.id}`} className={styles.relation}>
                      <div className={styles.relationTop}>
                        <strong>
                          {rel.buildingLabel} · {rel.unitNo}
                        </strong>
                        <span className={styles.tag}>
                          {customerRelationRoleLabel(rel.role, locale)}
                        </span>
                      </div>
                      <p className={styles.minor}>
                        {rel.code || text("日租订单", "Réservation")} ·{" "}
                        {statusDisplayLabel(rel.status, locale)}
                      </p>
                      <p className={styles.minor}>
                        {rel.startDate || text("起始日期待核", "Début à vérifier")}
                        {rel.endDate
                          ? ` → ${rel.endDateKind === "expected" ? text("预计 ", "prévu ") : text("实际 ", "effectif ")}${rel.endDate}`
                          : ""}
                      </p>
                      {rel.role === "daily_unknown" && (
                        <p className={styles.callout}>
                          {text(
                            "仅有旧 customer_id 关联，未认定为住客或代订人；不据此归集住宿欠款。",
                            "Ancien lien customer_id seulement : ni client hébergé ni contact confirmé. Aucune dette n'en est déduite.",
                          )}
                        </p>
                      )}
                      <div className={styles.relationLinks}>
                        {href && (
                          <Link prefetch={false} href={href} className={styles.inlineLink}>
                            {text("打开合同", "Ouvrir le contrat")}
                            <ArrowUpRight size={12} aria-hidden="true" />
                          </Link>
                        )}
                        {unitHref && (
                          <Link prefetch={false} href={unitHref} className={styles.inlineLink}>
                            {text("资产档案", "Fiche du lot")}
                            <ArrowUpRight size={12} aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    </article>
                  );
                })}
                {data.relationshipTotal > 25 && (
                  <div className={styles.footer}>
                    <span>
                      {text(
                        `共 ${data.relationshipTotal} 条关系`,
                        `${data.relationshipTotal} relations`,
                      )}
                    </span>
                    <div className={styles.pageActions}>
                      <button
                        className={styles.secondary}
                        disabled={page <= 1}
                        onClick={() => setPage((v) => v - 1)}
                      >
                        {text("上一页", "Précédent")}
                      </button>
                      <span>
                        {page} / {Math.ceil(data.relationshipTotal / 25)}
                      </span>
                      <button
                        className={styles.secondary}
                        disabled={page * 25 >= data.relationshipTotal}
                        onClick={() => setPage((v) => v + 1)}
                      >
                        {text("下一页", "Suivant")}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <section id="customer-profile" className={styles.section}>
                <h3>{text("原始资料", "Données du dossier")}</h3>
                <dl className={styles.facts}>
                  <dt>{text("姓名 / 企业", "Nom / société")}</dt>
                  <dd>{c.name}</dd>
                  <dt>{text("联系电话", "Téléphone")}</dt>
                  <dd>{c.phone || text("未登记", "Non renseigné")}</dd>
                  <dt>{text("性别", "Genre")}</dt>
                  <dd>{c.gender || text("未登记", "Non renseigné")}</dd>
                  <dt>{text("证件类型", "Pièce")}</dt>
                  <dd>{c.document_type || text("未登记", "Non renseigné")}</dd>
                  <dt>{text("证件资料", "Justificatif")}</dt>
                  <dd>
                    {c.hasDocument
                      ? text("已登记（此处不展示号码）", "Renseigné (numéro masqué)")
                      : text("未登记", "Non renseigné")}
                  </dd>
                  <dt>{text("备注", "Remarques")}</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>
                    {c.notes || text("未登记", "Non renseigné")}
                  </dd>
                </dl>
              </section>
            )}
            <div className={styles.actions}>
              {canEdit && (
                <button className={styles.secondary} type="button" onClick={() => onEdit(c)}>
                  {text("编辑资料", "Modifier")}
                </button>
              )}
              <Link
                prefetch={false}
                className={styles.secondary}
                href={`${locale === "fr" ? "/fr" : ""}/customers/${c.id}?returnTo=${encodeURIComponent(returnTo)}`}
              >
                {text("收款、单据与历史", "Paiements, documents et historique")}
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            </div>
            <p className={styles.hint}>
              {text(
                "收款、应收、凭证与历史记录在完整档案中按需查看。",
                "Paiements, échéances, justificatifs et historique sont disponibles dans le dossier complet.",
              )}
            </p>
          </div>
        </>
      )}
    </aside>
  );
}
