"use client";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, Search } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { UnitWorkbenchInspector } from "./unit-workbench-inspector";
import {
  unitWorkbenchHref,
  UNIT_WORKBENCH_PAGE_SIZE,
  type UnitWorkbenchData,
  type UnitWorkbenchFilter,
  type UnitWorkbenchQuery,
  type UnitWorkbenchRecord,
} from "./unit-workbench-model";
import { UnitFloorIndex, UnitWorkbenchRow } from "./unit-workbench-table";
import styles from "./unit-workbench.module.css";

const UnitConditionDrawer = dynamic(() =>
  import("./unit-detail-panel").then((module) => module.UnitDetailPanel),
);

export function UnitWorkbench({
  data,
  locale,
  canEdit,
}: {
  data: UnitWorkbenchData;
  locale: Locale;
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const selectionKey = `${JSON.stringify(data.query)}:${data.rows.map((row) => `${row.unit.id}:${row.unit.updated_at}`).join(",")}:${data.selected?.unit.updated_at ?? ""}`;
  const [selection, setSelection] = useState<{ key: string; record: UnitWorkbenchRecord | null }>({
    key: selectionKey,
    record: data.selected,
  });
  const selected = selection.key === selectionKey ? selection.record : data.selected;
  const [showCondition, setShowCondition] = useState(false);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const inspectorId = useId();
  const zh = locale === "zh";
  const t = dictionaries[locale].units;
  const { query, building } = data;
  const projects = [
    ...new Map(
      data.buildings.map((row) => [row.project_id, { id: row.project_id, name: row.project_name }]),
    ).values(),
  ];
  const projectBuildings = data.buildings.filter(
    (row) => row.project_id === (building?.project_id ?? query.project),
  );
  const sourceHref = `${pathname}${searchParams.size ? `?${searchParams}` : ""}`;
  const returnHref = safeWorkbenchReturnTo(query.returnTo);
  const focusInspector = (unitId: string) => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      typeof window.requestAnimationFrame !== "function" ||
      !window.matchMedia("(max-width: 1199px)").matches
    )
      return;
    window.requestAnimationFrame(() => {
      const target = inspectorRef.current;
      // A later selection or scope change must not focus the previous asset.
      if (!target || target.dataset.unitId !== unitId) return;
      target.focus({ preventScroll: true });
      if (typeof target.scrollIntoView === "function")
        target.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
    });
  };
  const navigate = (patch: Partial<UnitWorkbenchQuery>) => {
    setSelection({ key: selectionKey, record: null });
    setShowCondition(false);
    startTransition(() =>
      router.push(unitWorkbenchHref(locale, query, { unit: "", page: 1, ...patch }), {
        scroll: false,
      }),
    );
  };
  const select = (record: UnitWorkbenchRecord | null) => {
    setSelection({ key: selectionKey, record });
    setShowCondition(false);
    window.history.replaceState(
      null,
      "",
      unitWorkbenchHref(locale, query, { unit: record?.unit.id ?? "" }),
    );
    if (record) focusInspector(record.unit.id);
  };
  const pageCount = Math.max(1, Math.ceil(data.total / UNIT_WORKBENCH_PAGE_SIZE));
  return (
    <div className={styles.workbench} data-unit-workbench aria-busy={pending}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>ASSET DIRECTORY</p>
          <h1>{zh ? "资产目录" : "Répertoire des actifs"}</h1>
          <p className={styles.subtitle}>
            {zh
              ? "以一套房、一间商铺为入口，分开看权属、占用与运行条件。"
              : "Un actif à la fois : propriété, occupation et état opérationnel, séparément."}
          </p>
        </div>
        <div className={styles.scope}>
          <label>
            {zh ? "项目" : "Projet"}
            <select
              aria-label={zh ? "资产项目" : "Projet des actifs"}
              value={building?.project_id ?? query.project}
              onChange={(event) =>
                navigate({
                  project: event.target.value,
                  building: "",
                  q: "",
                  floor: "",
                  kind: "",
                  business: "",
                  filter: "all",
                })
              }
            >
              <option value="" disabled>
                {zh ? "选择项目" : "Choisir un projet"}
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {zh ? "楼栋 / 分区" : "Bâtiment / zone"}
            <select
              aria-label={zh ? "资产楼栋" : "Bâtiment des actifs"}
              value={building?.id ?? ""}
              onChange={(event) =>
                navigate({
                  building: event.target.value,
                  q: "",
                  floor: "",
                  kind: "",
                  business: "",
                  filter: "all",
                })
              }
            >
              <option value="" disabled>
                {zh ? "选择楼栋" : "Choisir un bâtiment"}
              </option>
              {projectBuildings.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.display_name || row.code}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {returnHref ? (
        <div>
          <Link className={styles.inlineLink} href={returnHref} prefetch={false}>
            <ArrowLeft size={12} />
            {zh ? "返回来源工作区" : "Retour à l’espace source"}
          </Link>
        </div>
      ) : null}
      {data.scopeUnavailable ? (
        <div className={styles.list} role="alert">
          <div className={styles.empty}>
            <Building2 size={28} />
            <h3>{zh ? "指定的项目或楼栋不可用" : "Projet ou bâtiment indisponible"}</h3>
            <p>
              {zh
                ? "可能不存在、已停用或不在当前账号权限内，不会自动替换为其他楼栋。"
                : "Inexistant, inactif ou hors périmètre autorisé ; aucun autre bâtiment n’est substitué."}
            </p>
            <Link className={styles.inlineLink} href={routeFor(locale, "/units")} prefetch={false}>
              {zh ? "重新选择授权范围" : "Choisir un périmètre autorisé"}
            </Link>
          </div>
        </div>
      ) : !building ? (
        <div className={styles.empty}>
          <h3>{zh ? "暂无可见的资产楼栋" : "Aucun bâtiment visible"}</h3>
          <p>
            {zh
              ? "请核对项目配置与当前账号权限。"
              : "Vérifiez la configuration et vos autorisations."}
          </p>
        </div>
      ) : (
        <>
          <div
            className={styles.summary}
            aria-label={zh ? "当前楼栋资产汇总" : "Synthèse du bâtiment"}
          >
            <Metric
              label={zh ? "楼栋资产" : "Actifs du bâtiment"}
              value={data.scopeTotal}
              caption={building.display_name}
            />
            <Metric
              label={zh ? "明确业务占用" : "Occupation métier explicite"}
              value={data.summary.occupied}
              caption={
                zh ? "日租入住或生效长租，按资产去重" : "Séjour ou bail actif, sans doublons"
              }
            />
            <Metric
              label={zh ? "需要关注" : "À examiner"}
              value={data.summary.attention}
              caption={
                zh
                  ? "维修、封锁、待保洁或状态待核实"
                  : "Maintenance, blocage, nettoyage ou vérification"
              }
              warn
            />
            <Metric
              label={zh ? "状态待核实" : "État à vérifier"}
              value={data.summary.unverified}
              caption={zh ? "不计作明确空置或可出租" : "Non considéré comme vacant ou prêt à louer"}
              warn={data.summary.unverified > 0}
            />
          </div>
          <p className={styles.note}>
            {zh
              ? "汇总为当前楼栋全部资产，不随下方筛选变化。权属、实际占用、运行条件独立记录；未知不等于空置，无占用不等于可出租。"
              : "Synthèse de tout le bâtiment, indépendante des filtres ci-dessous. Propriété, occupation et état sont distincts ; inconnu ne signifie pas vacant, ni sans occupation prêt à louer."}
            {building.project_code === "CIMAC"
              ? zh
                ? " CIMAC 只租不卖。"
                : " CIMAC : location uniquement."
              : ""}
          </p>
          {selected ? (
            <div className={styles.jumpDetail}>
              <button
                type="button"
                className={styles.secondary}
                aria-controls={inspectorId}
                onClick={() => focusInspector(selected.unit.id)}
              >
                {zh ? "查看选中资产详情" : "Voir le détail de l’actif sélectionné"}
              </button>
            </div>
          ) : null}
          <div className={cn(styles.layout, pending && styles.pending)}>
            <section className={styles.list} aria-label={zh ? "资产清单" : "Liste des actifs"}>
              <div className={styles.listHeading}>
                <h2>{zh ? "资产清单" : "Liste des actifs"}</h2>
                <span className={styles.counter}>
                  {data.total} / {data.scopeTotal} {zh ? "项" : "actifs"}
                </span>
              </div>
              <form method="get" action={routeFor(locale, "/units")}>
                <input type="hidden" name="project" value={query.project} />
                <input type="hidden" name="building" value={query.building} />
                {query.returnTo ? (
                  <input type="hidden" name="returnTo" value={query.returnTo} />
                ) : null}
                {query.view === "floor" ? <input type="hidden" name="view" value="floor" /> : null}
                <div className={styles.toolbar}>
                  <label className={styles.search}>
                    <Search aria-hidden="true" />
                    <input
                      type="search"
                      name="q"
                      aria-label={zh ? "搜索资产编号或楼层" : "Rechercher un numéro ou étage"}
                      placeholder={zh ? "房号、资产编号或楼层" : "N° d’actif ou étage"}
                      defaultValue={query.q}
                      maxLength={120}
                    />
                  </label>
                  <div
                    className={styles.viewSwitch}
                    aria-label={zh ? "资产视图" : "Affichage des actifs"}
                  >
                    {(
                      [
                        ["list", zh ? "清单" : "Liste"],
                        ["floor", zh ? "楼层" : "Étages"],
                      ] as const
                    ).map(([view, label]) => (
                      <button
                        key={view}
                        type="button"
                        aria-pressed={query.view === view}
                        onClick={() => navigate({ view })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.filters}>
                  <label>
                    {zh ? "状态维度" : "Dimension d’état"}
                    <select
                      name="filter"
                      aria-label={zh ? "资产状态筛选" : "Filtrer par état"}
                      defaultValue={query.filter}
                    >
                      {(
                        [
                          ["all", zh ? "全部资产" : "Tous les actifs"],
                          ["occupied", zh ? "明确业务占用" : "Occupation explicite"],
                          ["unoccupied", zh ? "核实无当前占用" : "Sans occupation vérifiée"],
                          ["attention", zh ? "需要关注" : "À examiner"],
                          ["sold", zh ? "已售（业务口径）" : "Vendu (métier)"],
                          ["maintenance", zh ? "维修中" : "Maintenance"],
                          ["locked", zh ? "封锁" : "Bloqué"],
                          ["cleaning", zh ? "待保洁" : "À nettoyer"],
                        ] satisfies [UnitWorkbenchFilter, string][]
                      ).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {zh ? "楼层" : "Étage"}
                    <select
                      name="floor"
                      aria-label={zh ? "资产楼层" : "Étage des actifs"}
                      defaultValue={query.floor}
                    >
                      <option value="">{zh ? "全部楼层" : "Tous les étages"}</option>
                      {data.floors.map((floor) => (
                        <option key={floor} value={floor}>
                          {floor}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {zh ? "类型" : "Type"}
                    <select
                      name="kind"
                      aria-label={zh ? "资产类型" : "Type d’actif"}
                      defaultValue={query.kind}
                    >
                      <option value="">{zh ? "全部类型" : "Tous les types"}</option>
                      {(["apartment", "parking", "storefront", "office", "warehouse"] as const).map(
                        (kind) => (
                          <option key={kind} value={kind}>
                            {t.kinds[kind]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    {zh ? "业务配置" : "Activité configurée"}
                    <select
                      name="business"
                      aria-label={zh ? "资产业务配置" : "Activité des actifs"}
                      defaultValue={query.business}
                    >
                      <option value="">{zh ? "全部配置" : "Toutes"}</option>
                      {(
                        [
                          "daily_rental",
                          "long_lease",
                          ...(building.allows_sale ? ["sale" as const] : []),
                        ] as const
                      ).map((business) => (
                        <option key={business} value={business}>
                          {t.businessTypes[business]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={styles.secondary}>
                    {zh ? "筛选" : "Filtrer"}
                  </button>
                </div>
              </form>
              {!data.rows.length ? (
                <div className={styles.empty}>
                  <Building2 size={26} />
                  <h3>{zh ? "当前条件下没有资产" : "Aucun actif pour ces filtres"}</h3>
                  <p>
                    {zh
                      ? "请核对楼栋与筛选；不表示整个项目没有资产。"
                      : "Vérifiez le bâtiment et les filtres ; le projet peut contenir d’autres actifs."}
                  </p>
                </div>
              ) : query.view === "floor" ? (
                <UnitFloorIndex
                  rows={data.rows}
                  locale={locale}
                  selectedId={selected?.unit.id ?? null}
                  onSelect={select}
                />
              ) : (
                <table className={styles.table} data-unit-workbench-table>
                  <colgroup>
                    <col style={{ width: "28%" }} />
                    <col style={{ width: "21%" }} />
                    <col style={{ width: "25%" }} />
                    <col style={{ width: "26%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {[
                        zh ? "资产 / 业务" : "Actif / activité",
                        zh ? "权属" : "Propriété",
                        zh ? "实际占用" : "Occupation",
                        zh ? "运行条件" : "État opérationnel",
                      ].map((label) => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((record) => (
                      <UnitWorkbenchRow
                        key={record.unit.id}
                        record={record}
                        locale={locale}
                        selected={selected?.unit.id === record.unit.id}
                        onSelect={() => select(record)}
                        allowsSale={building.allows_sale}
                      />
                    ))}
                  </tbody>
                </table>
              )}
              <footer className={styles.footer}>
                <span>
                  {data.total
                    ? `${(query.page - 1) * UNIT_WORKBENCH_PAGE_SIZE + 1}–${Math.min(query.page * UNIT_WORKBENCH_PAGE_SIZE, data.total)} / ${data.total}`
                    : "0 / 0"}
                  {query.view === "floor"
                    ? zh
                      ? " · 仅当前分页，非建筑平面图"
                      : " · Page actuelle, pas un plan"
                    : ""}
                </span>
                <div className={styles.pages}>
                  <span>
                    {query.page} / {pageCount}
                  </span>
                  {query.page > 1 ? (
                    <Link
                      className={styles.secondary}
                      href={unitWorkbenchHref(locale, query, { page: query.page - 1, unit: "" })}
                      onClick={() => {
                        setSelection({ key: selectionKey, record: null });
                        setShowCondition(false);
                      }}
                      prefetch={false}
                    >
                      {zh ? "上一页" : "Précédent"}
                    </Link>
                  ) : null}
                  {query.page < pageCount ? (
                    <Link
                      className={styles.secondary}
                      href={unitWorkbenchHref(locale, query, { page: query.page + 1, unit: "" })}
                      onClick={() => {
                        setSelection({ key: selectionKey, record: null });
                        setShowCondition(false);
                      }}
                      prefetch={false}
                    >
                      {zh ? "下一页" : "Suivant"}
                    </Link>
                  ) : null}
                </div>
              </footer>
            </section>
            <div
              ref={inspectorRef}
              id={inspectorId}
              className={styles.inspectorTarget}
              tabIndex={-1}
              role="region"
              aria-label={zh ? "选中资产详情区域" : "Détail de l’actif sélectionné"}
              data-unit-id={selected?.unit.id ?? ""}
            >
              {data.selectedUnavailable && !selected ? (
                <div role="alert" className={styles.callout}>
                  {zh
                    ? "指定资产不存在、不可见或与当前范围不符，未自动选中其他资产。"
                    : "Actif introuvable, non visible ou hors périmètre. Aucun autre actif n’est sélectionné."}
                </div>
              ) : null}
              <UnitWorkbenchInspector
                key={selected?.unit.id ?? "empty"}
                record={selected}
                building={building}
                locale={locale}
                canEdit={canEdit}
                returnTo={sourceHref}
                onClose={() => select(null)}
                onManage={() => setShowCondition(true)}
              />
            </div>
          </div>
          {selected && showCondition ? (
            <UnitConditionDrawer
              unit={selected.unit}
              position={selected.position ?? undefined}
              buildingName={building.display_name}
              businessFlags={selected.flags}
              locale={locale}
              canEdit={canEdit}
              onClose={() => setShowCondition(false)}
              onStatusChanged={() => {
                setShowCondition(false);
                startTransition(() => router.refresh());
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  caption,
  warn,
}: {
  label: string;
  value: number;
  caption: string;
  warn?: boolean;
}) {
  return (
    <div className={styles.metric}>
      <label>{label}</label>
      <strong className={warn ? styles.warn : undefined}>{value}</strong>
      <small>{caption}</small>
    </div>
  );
}
