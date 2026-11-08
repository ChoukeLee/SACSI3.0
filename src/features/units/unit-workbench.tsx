"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Search } from "lucide-react";
import { RightDrawer } from "@/components/ui/operational";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { UnitWorkbenchInspector } from "./unit-workbench-inspector";
import {
  unitWorkbenchHref,
  type UnitWorkbenchData,
  type UnitWorkbenchFilter,
  type UnitWorkbenchQuery,
  type UnitWorkbenchRecord,
} from "./unit-workbench-model";
import { UnitFloorIndex } from "./unit-workbench-table";
import styles from "./unit-workbench.module.css";

const UnitConditionDrawer = dynamic(() =>
  import("./unit-condition-editor").then((module) => module.UnitConditionEditor),
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
  const [pending, startTransition] = useTransition();
  const { query, building } = data;
  const floorReady = query.view === "floor";
  const selectionKey = JSON.stringify(query);
  const [selection, setSelection] = useState<{ key: string; id: string | null }>({
    key: selectionKey,
    id: data.selected?.unit.id ?? null,
  });
  const selectedId =
    selection.key === selectionKey ? selection.id : (data.selected?.unit.id ?? null);
  const currentRecord =
    data.rows.find((row) => row.unit.id === selectedId) ??
    (data.selected?.unit.id === selectedId ? data.selected : null);
  const selected =
    floorReady && !data.scopeUnavailable && currentRecord?.unit.building_id === building?.id
      ? currentRecord
      : null;
  const [conditionTarget, setConditionTarget] = useState<string | null>(null);
  const selectedVersion = selected
    ? `${selectionKey}:${selected.unit.id}:${selected.unit.updated_at}`
    : null;
  const conditionOpen = Boolean(selected && canEdit && selectedVersion === conditionTarget);
  const filterForm = useRef<HTMLFormElement>(null);
  const zh = locale === "zh";
  const t = dictionaries[locale].units;
  const projects = [
    ...new Map(
      data.buildings.map((row) => [row.project_id, { id: row.project_id, name: row.project_name }]),
    ).values(),
  ];
  const projectBuildings = data.buildings.filter(
    (row) => row.project_id === (building?.project_id ?? query.project),
  );
  const returnHref = safeWorkbenchReturnTo(query.returnTo);
  const sourceHref = unitWorkbenchHref(locale, query, {
    view: "floor",
    page: 1,
    unit: selected?.unit.id ?? "",
  });
  const canonicalHref = unitWorkbenchHref(locale, query, { view: "floor", page: 1 });

  useEffect(() => {
    if (!floorReady && building && !data.scopeUnavailable)
      startTransition(() => router.replace(canonicalHref, { scroll: false }));
  }, [floorReady, building?.id, data.scopeUnavailable, canonicalHref, router]);
  useEffect(() => {
    setConditionTarget(null);
  }, [selectionKey]);
  useEffect(() => {
    if (!canEdit) setConditionTarget(null);
  }, [canEdit]);

  const navigate = (patch: Partial<UnitWorkbenchQuery>) => {
    setSelection({ key: selectionKey, id: null });
    setConditionTarget(null);
    startTransition(() =>
      router.push(
        unitWorkbenchHref(locale, query, {
          ...patch,
          view: "floor",
          page: 1,
          unit: "",
        }),
        { scroll: false },
      ),
    );
  };
  const select = (record: UnitWorkbenchRecord | null) => {
    if (pending || !floorReady) return;
    setSelection({ key: selectionKey, id: record?.unit.id ?? null });
    setConditionTarget(null);
    window.history.replaceState(
      window.history.state,
      "",
      unitWorkbenchHref(locale, query, {
        view: "floor",
        page: 1,
        unit: record?.unit.id ?? "",
      }),
    );
  };
  const formQuery = (): Partial<UnitWorkbenchQuery> => {
    const values = filterForm.current ? new FormData(filterForm.current) : null;
    return {
      q: String(values?.get("q") ?? query.q),
      floor: String(values?.get("floor") ?? query.floor),
      kind: String(values?.get("kind") ?? query.kind),
      business: String(values?.get("business") ?? query.business),
      filter: String(values?.get("filter") ?? query.filter) as UnitWorkbenchFilter,
    };
  };
  const categories: [UnitWorkbenchFilter, string][] = [
    ["all", zh ? "全部资产" : "Tous les actifs"],
    ["occupied", zh ? "使用中" : "En usage"],
    ["unoccupied", zh ? "暂无租住记录" : "Sans bail ni séjour"],
    ["attention", zh ? "需关注" : "À examiner"],
  ];
  const extraFilters: [UnitWorkbenchFilter, string][] = [
    ["sold", zh ? "已售" : "Vendus"],
    ["maintenance", zh ? "维修中" : "Maintenance"],
    ["locked", zh ? "封锁" : "Bloqués"],
    ["cleaning", zh ? "待保洁" : "À nettoyer"],
  ];

  return (
    <div className={styles.workbench} data-unit-workbench aria-busy={pending || !floorReady}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>ASSET OVERVIEW</p>
          <h1>{zh ? "资产总览" : "Vue des actifs"}</h1>
          <p className={styles.subtitle}>
            {zh
              ? "按楼层查看全部资产，选择房间查看资料。"
              : "Tous les actifs par étage. Sélectionnez un lot pour consulter son dossier."}
          </p>
        </div>
        <div className={styles.scope}>
          <label>
            {zh ? "项目" : "Projet"}
            <select
              aria-label={zh ? "资产项目" : "Projet des actifs"}
              disabled={pending}
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
              disabled={pending}
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
      ) : !floorReady ? (
        <div className={styles.empty} role="status">
          <h3>{zh ? "正在读取完整楼层房源…" : "Chargement de tous les actifs par étage…"}</h3>
        </div>
      ) : (
        <>
          <section className={styles.list} aria-label={zh ? "楼层资产总览" : "Actifs par étage"}>
            <div className={styles.listHeading}>
              <h2>{building.display_name}</h2>
              <span className={styles.counter}>
                {data.total} / {data.scopeTotal} {zh ? "项资产" : "actifs"}
              </span>
            </div>
            <form
              key={JSON.stringify(query)}
              ref={filterForm}
              method="get"
              action={routeFor(locale, "/units")}
              onSubmit={(event) => {
                event.preventDefault();
                navigate(formQuery());
              }}
            >
              <input type="hidden" name="project" value={query.project} />
              <input type="hidden" name="building" value={query.building} />
              <input type="hidden" name="view" value="floor" />
              {query.returnTo ? (
                <input type="hidden" name="returnTo" value={query.returnTo} />
              ) : null}
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
                    disabled={pending}
                  />
                </label>
                <button type="submit" className={styles.secondary} disabled={pending}>
                  {zh ? "搜索" : "Rechercher"}
                </button>
              </div>
              <div
                className={styles.categories}
                role="group"
                aria-label={zh ? "资产分类" : "Catégories des actifs"}
              >
                {categories.map(([filter, label]) => (
                  <button
                    key={filter}
                    type="button"
                    disabled={pending}
                    aria-pressed={query.filter === filter}
                    className={filter === "attention" ? styles.attentionFilter : undefined}
                    onClick={() => navigate({ ...formQuery(), filter })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <details
                className={styles.filterDetails}
                open={Boolean(
                  query.floor ||
                  query.kind ||
                  query.business ||
                  extraFilters.some(([filter]) => filter === query.filter),
                )}
              >
                <summary>{zh ? "更多筛选" : "Autres filtres"}</summary>
                <div className={styles.filters}>
                  <label>
                    {zh ? "楼层" : "Étage"}
                    <select
                      name="floor"
                      aria-label={zh ? "资产楼层" : "Étage des actifs"}
                      defaultValue={query.floor}
                      disabled={pending}
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
                      disabled={pending}
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
                      disabled={pending}
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
                  <label>
                    {zh ? "其他状态" : "Autres états"}
                    <select
                      name="filter"
                      aria-label={zh ? "资产状态筛选" : "Filtrer par état"}
                      defaultValue={query.filter}
                      disabled={pending}
                    >
                      {categories
                        .filter(([filter]) => filter === "all" || filter === query.filter)
                        .map(([filter, label]) => (
                          <option key={filter} value={filter}>
                            {label}
                          </option>
                        ))}
                      {extraFilters.map(([filter, label]) => (
                        <option key={filter} value={filter}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={styles.secondary} disabled={pending}>
                    {zh ? "应用筛选" : "Appliquer"}
                  </button>
                </div>
              </details>
            </form>
            <p className={styles.scopeNote}>
              {zh
                ? "买方、租客和收款按业务分别显示；房屋使用情况以核实记录为准。"
                : "Acquéreurs, locataires et encaissements sont présentés par activité ; l’usage du bien repose sur les informations vérifiées."}
              {building.project_code === "CIMAC"
                ? zh
                  ? " CIMAC只租不卖。"
                  : " CIMAC : location uniquement."
                : ""}
            </p>
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
            ) : (
              <UnitFloorIndex
                rows={data.rows}
                locale={locale}
                buildingName={building.display_name}
                selectedId={selected?.unit.id ?? null}
                onSelect={select}
                disabled={pending}
              />
            )}
          </section>
          {data.selectedUnavailable && !selected ? (
            <p role="alert" className={styles.callout}>
              {zh
                ? "指定资产不存在、不可见或与当前范围不符，未自动选中其他资产。"
                : "Actif introuvable, non visible ou hors périmètre. Aucun autre actif n’est sélectionné."}
            </p>
          ) : null}
          {selected && !conditionOpen ? (
            <RightDrawer
              open
              width="wide"
              className={styles.assetDrawer}
              badge={
                <span className={styles.drawerMarks}>
                  {selected.position?.ownership === "sold" ? (
                    <small className={styles.soldMark}>{zh ? "已售" : "Vendu"}</small>
                  ) : null}
                  {selected.position?.lease_occupied ? (
                    <small className={styles.rentedMark}>{zh ? "在租" : "Loué"}</small>
                  ) : null}
                  {selected.position?.daily_occupied ? (
                    <small className={styles.rentedMark}>
                      {zh ? "日租入住" : "Séjour en cours"}
                    </small>
                  ) : null}
                </span>
              }
              title={
                <span className={styles.drawerTitle}>
                  {building.display_name} · {selected.unit.unit_no}
                </span>
              }
              onClose={() => select(null)}
            >
              <UnitWorkbenchInspector
                key={`${selected.unit.id}:${selected.unit.updated_at}`}
                record={selected}
                building={building}
                locale={locale}
                canEdit={canEdit && !pending}
                embedded
                returnTo={sourceHref}
                onClose={() => select(null)}
                onManage={() => {
                  if (!pending && canEdit && selectedVersion) setConditionTarget(selectedVersion);
                }}
              />
            </RightDrawer>
          ) : null}
          {selected && conditionOpen && selectedVersion === conditionTarget && canEdit ? (
            <UnitConditionDrawer
              key={`${selected.unit.id}:${selected.unit.updated_at}`}
              unit={selected.unit}
              position={selected.position ?? undefined}
              buildingName={building.display_name}
              locale={locale}
              canEdit={canEdit}
              onClose={() => setConditionTarget(null)}
              onStatusChanged={() => {
                setConditionTarget(null);
                startTransition(() => router.refresh());
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
