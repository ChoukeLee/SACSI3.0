"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Plus, Search, UsersRound } from "lucide-react";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";
import {
  customerDirectoryFilters,
  customerDirectoryHref,
  customerDirectoryQueryKey,
  type CustomerDirectoryData,
  type CustomerDirectoryProfile,
  type CustomerDirectoryQuery,
} from "./customer-directory-model";
import {
  CustomerWorkbenchInspector,
  customerRelationRoleLabel,
} from "./customer-workbench-inspector";
import { CustomerWorkbenchForm } from "./customer-workbench-form";
import styles from "./customer-workbench.module.css";

export function CustomerWorkbench({
  data,
  locale,
  canEdit,
  initialSelectedId,
  returnTo,
  projectLocked = false,
}: {
  data: CustomerDirectoryData;
  locale: "zh" | "fr";
  canEdit: boolean;
  initialSelectedId: string | null;
  returnTo: string | null;
  projectLocked?: boolean;
}) {
  const zh = locale === "zh";
  const text = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const query = data.query;
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [form, setForm] = useState<{ profile: CustomerDirectoryProfile | null } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [pending, startTransition] = useTransition();
  const inspectorRef = useRef<HTMLDivElement>(null);
  const inspectorFrame = useRef<number | null>(null);
  const inspectorId = useId();
  const cancelInspectorReveal = () => {
    if (inspectorFrame.current !== null && typeof window.cancelAnimationFrame === "function")
      window.cancelAnimationFrame(inspectorFrame.current);
    inspectorFrame.current = null;
  };
  useEffect(
    () => () => {
      if (inspectorFrame.current !== null && typeof window.cancelAnimationFrame === "function")
        window.cancelAnimationFrame(inspectorFrame.current);
    },
    [],
  );
  const revealInspector = () => {
    if (
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(max-width: 1199px)").matches ||
      typeof window.requestAnimationFrame !== "function"
    )
      return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cancelInspectorReveal();
    // User-triggered only: data refreshes and async detail responses never steal focus.
    inspectorFrame.current = window.requestAnimationFrame(() => {
      inspectorFrame.current = null;
      const target = inspectorRef.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
    });
  };
  const safeReturn = safeWorkbenchReturnTo(returnTo);
  const ownHref = customerDirectoryHref(query, locale, {}, selectedId ?? undefined, safeReturn);
  const projects = [
    ...new Map(
      data.buildings.flatMap((b) => (b.project ? [[b.project.id, b.project] as const] : [])),
    ).values(),
  ].sort(
    (a, b) =>
      Number(b.code === "SACSI") - Number(a.code === "SACSI") || a.code.localeCompare(b.code),
  );
  const buildings = data.buildings.filter(
    (b) => !query.projectId || b.project?.id === query.projectId,
  );
  const href = (patch: Partial<CustomerDirectoryQuery>) =>
    customerDirectoryHref(query, locale, patch, undefined, safeReturn);
  const clearSelection = () => {
    cancelInspectorReveal();
    setSelectedId(null);
    setForm(null);
  };
  const navigate = (target: string) => {
    clearSelection();
    startTransition(() => router.push(target));
  };
  const navigationClick = (event: React.MouseEvent<HTMLAnchorElement>, target: string) => {
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      navigate(target);
    }
  };
  const selectCustomer = (id: string) => {
    setSelectedId(id);
    setForm(null);
    window.history.replaceState(null, "", customerDirectoryHref(query, locale, {}, id, safeReturn));
    revealInspector();
  };
  const filterLabels = {
    all: text("全部档案", "Tous les dossiers"),
    contract: text("合同客户", "Clients contractuels"),
    guest: text("实际住客", "Clients hébergés"),
    contact: text("代订联系人", "Contacts de réservation"),
    unknown: text("身份待核", "Identité à vérifier"),
    blacklisted: text("黑名单", "Liste noire"),
  };
  return (
    <section
      className={styles.workbench}
      aria-label={text("客户关系档案", "Dossiers et relations clients")}
      aria-busy={pending}
    >
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>CUSTOMER RELATIONSHIPS</p>
          <h1>{text("客户关系档案", "Dossiers et relations clients")}</h1>
          <p className={styles.subtitle}>
            {text(
              "先找到人，再看他与合同、房源和业务的明确关系。",
              "Retrouvez une personne, puis ses liens explicites avec les contrats, lots et opérations.",
            )}
          </p>
        </div>
        <div className={styles.actions}>
          {selectedId && (
            <button
              type="button"
              className={`${styles.secondary} ${styles.mobileDetailJump}`}
              aria-controls={inspectorId}
              onClick={revealInspector}
            >
              {text("查看已选客户详情", "Voir le client sélectionné")}
            </button>
          )}
          {safeReturn && (
            <Link prefetch={false} className={styles.secondary} href={safeReturn}>
              <ArrowLeft size={13} aria-hidden="true" />
              {text("返回来源", "Retour à la source")}
            </Link>
          )}
          {canEdit && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setForm({ profile: null })}
            >
              <Plus size={13} aria-hidden="true" />
              {text("新建客户", "Nouveau client")}
            </button>
          )}
        </div>
      </header>
      <div className={styles.scope}>
        <label>
          {text("项目范围", "Projet")}
          <select
            value={query.projectId}
            onChange={(e) => navigate(href({ projectId: e.target.value, buildingId: "", page: 1 }))}
            disabled={pending}
          >
            {!projectLocked && (
              <option value="">
                {text("全部可见项目与未关联档案", "Tous les projets et dossiers sans lien")}
              </option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="__unassigned__">
              {text("未关联可见项目", "Sans projet visible associé")}
            </option>
          </select>
        </label>
        <label>
          {text("楼栋", "Bâtiment")}
          <select
            value={query.buildingId}
            disabled={pending || query.projectId === "__unassigned__"}
            onChange={(e) => navigate(href({ buildingId: e.target.value, page: 1 }))}
          >
            <option value="">{text("全部楼栋", "Tous les bâtiments")}</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.intro}>
        <div>
          <strong>{data.scopeCount}</strong>
          <span>{text("份档案 · 当前可见范围", "dossiers · périmètre visible")}</span>
        </div>
        <span>
          {text(
            "同名不自动合并 · 不根据姓名推断项目或欠款",
            "Pas de fusion par nom · aucun projet ni solde déduit du nom",
          )}
        </span>
      </div>
      <nav className={styles.tabs} aria-label={text("客户身份筛选", "Filtrer les rôles")}>
        {customerDirectoryFilters.map((filter) => (
          <Link
            key={filter}
            prefetch={false}
            href={href({ filter, page: 1 })}
            onClick={(event) => navigationClick(event, href({ filter, page: 1 }))}
            aria-current={query.filter === filter ? "page" : undefined}
          >
            {filterLabels[filter]}
          </Link>
        ))}
      </nav>
      <div className={styles.layout}>
        <section className={styles.panel} aria-label={text("客户名册", "Répertoire clients")}>
          <header className={styles.panelHead}>
            <h2>{text("客户名册", "Répertoire clients")}</h2>
            <span className={styles.hint}>
              {text(`${data.total} 份符合条件`, `${data.total} dossiers correspondants`)}
            </span>
          </header>
          <form
            onSubmit={clearSelection}
            className={styles.search}
            method="get"
            action={locale === "fr" ? "/fr/customers" : "/customers"}
          >
            {query.projectId && <input type="hidden" name="project" value={query.projectId} />}
            {query.buildingId && <input type="hidden" name="building" value={query.buildingId} />}
            {query.filter !== "all" && <input type="hidden" name="filter" value={query.filter} />}
            {safeReturn && <input type="hidden" name="returnTo" value={safeReturn} />}
            <input
              name="q"
              aria-label={text("搜索客户", "Rechercher un client")}
              defaultValue={query.search}
              placeholder={text(
                "姓名、企业、电话或关联房号",
                "Nom, société, téléphone ou lot associé",
              )}
              maxLength={200}
            />
            <button type="submit" className={styles.secondary}>
              <Search size={13} aria-hidden="true" />
              {text("查找", "Rechercher")}
            </button>
          </form>
          {data.rows.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{text("姓名 / 联系方式", "Nom / coordonnées")}</th>
                  <th>{text("明确身份", "Rôles explicites")}</th>
                  <th>{text("关联资产", "Lots associés")}</th>
                  <th>{text("最近业务日期", "Dernière date métier")}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id} data-selected={selectedId === c.id}>
                    <td>
                      <Link
                        prefetch={false}
                        href={customerDirectoryHref(query, locale, {}, c.id, safeReturn)}
                        className={styles.name}
                        aria-current={selectedId === c.id ? "true" : undefined}
                        onClick={(e) => {
                          if (
                            e.button === 0 &&
                            !e.metaKey &&
                            !e.ctrlKey &&
                            !e.shiftKey &&
                            !e.altKey
                          ) {
                            e.preventDefault();
                            selectCustomer(c.id);
                          }
                        }}
                      >
                        {c.name}
                        {c.isBlacklisted && (
                          <AlertTriangle
                            size={12}
                            className={styles.risk}
                            aria-label={text("黑名单", "Liste noire")}
                          />
                        )}
                        <ArrowUpRight size={12} aria-hidden="true" />
                      </Link>
                      <p className={styles.minor}>
                        {c.phone || text("电话未登记", "Téléphone non renseigné")}
                      </p>
                    </td>
                    <td data-label={text("明确身份", "Rôles explicites")}>
                      <div className={styles.tags}>
                        {c.roles.length ? (
                          c.roles.map((role) => (
                            <span className={styles.tag} key={role}>
                              {customerRelationRoleLabel(role, locale)}
                            </span>
                          ))
                        ) : (
                          <span className={styles.minor}>
                            {text("尚无可见业务关联", "Aucun lien métier visible")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label={text("关联资产", "Lots associés")}>
                      <span>
                        {c.rooms.join(" · ") || "—"}
                        {c.roomCount > c.rooms.length
                          ? text(` 等 ${c.roomCount} 项`, ` / ${c.roomCount} lots`)
                          : ""}
                      </span>
                    </td>
                    <td data-label={text("最近业务日期", "Dernière date métier")}>
                      {c.lastBusinessDate || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>
              <UsersRound size={24} strokeWidth={1.2} aria-hidden="true" />
              <strong>{text("没有符合当前条件的档案", "Aucun dossier correspondant")}</strong>
              <p>
                {text(
                  "可以扩大项目范围或清除搜索；未关联档案始终可从独立入口查找。",
                  "Élargissez le périmètre ou effacez la recherche. Les dossiers sans lien restent accessibles séparément.",
                )}
              </p>
            </div>
          )}
          <footer className={styles.footer}>
            <span>
              {text(
                `显示 ${data.rows.length} / ${data.total} 份档案`,
                `${data.rows.length} / ${data.total} dossiers affichés`,
              )}
            </span>
            <div className={styles.pageActions}>
              {query.page > 1 && (
                <Link
                  prefetch={false}
                  className={styles.secondary}
                  href={href({ page: query.page - 1 })}
                  onClick={(event) => navigationClick(event, href({ page: query.page - 1 }))}
                >
                  {text("上一页", "Précédent")}
                </Link>
              )}
              <span>
                {query.page} / {Math.max(1, Math.ceil(data.total / 40))}
              </span>
              {query.page * 40 < data.total && (
                <Link
                  prefetch={false}
                  className={styles.secondary}
                  href={href({ page: query.page + 1 })}
                  onClick={(event) => navigationClick(event, href({ page: query.page + 1 }))}
                >
                  {text("下一页", "Suivant")}
                </Link>
              )}
            </div>
          </footer>
        </section>
        <div
          id={inspectorId}
          ref={inspectorRef}
          tabIndex={-1}
          className={styles.inspectorTarget}
          data-selected={Boolean(selectedId)}
          role="region"
          aria-label={text("已选客户详情区", "Détail du client sélectionné")}
        >
          <CustomerWorkbenchInspector
            key={`${customerDirectoryQueryKey(query)}:${selectedId}`}
            id={selectedId}
            query={query}
            locale={locale}
            canEdit={canEdit}
            returnTo={ownHref}
            refreshVersion={refreshVersion}
            onEdit={(profile) => setForm({ profile })}
          />
        </div>
      </div>
      {form && canEdit && (
        <CustomerWorkbenchForm
          key={form.profile?.id ?? "new"}
          profile={form.profile}
          locale={locale}
          onClose={() => setForm(null)}
          onSaved={(id, created) => {
            setForm(null);
            setRefreshVersion((v) => v + 1);
            if (created)
              router.push(
                customerDirectoryHref(
                  { projectId: "", buildingId: "", search: "", filter: "all", page: 1 },
                  locale,
                  {},
                  id,
                  safeReturn,
                ),
              );
            else {
              setSelectedId(id);
              router.refresh();
            }
          }}
        />
      )}
    </section>
  );
}
