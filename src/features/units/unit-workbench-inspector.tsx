"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { formatXof } from "@/lib/utils";
import { conditionLabel } from "./operational-position";
import {
  constructionLabel,
  unitNeedsVerification,
  unitOccupancyText,
  type UnitWorkbenchBuilding,
  type UnitWorkbenchRecord,
} from "./unit-workbench-model";
import { UnitBusinessRelations, UnitStatusHistory } from "./unit-workbench-related";
import styles from "./unit-workbench.module.css";

export function UnitWorkbenchInspector({
  record,
  building,
  locale,
  canEdit,
  returnTo,
  onClose,
  onManage,
}: {
  record: UnitWorkbenchRecord | null;
  building: UnitWorkbenchBuilding;
  locale: Locale;
  canEdit: boolean;
  returnTo: string;
  onClose: () => void;
  onManage: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "business" | "history">("overview");
  const zh = locale === "zh";
  const t = dictionaries[locale].units;
  if (!record)
    return (
      <aside className={styles.inspector} aria-label={zh ? "资产档案" : "Dossier de l’actif"}>
        <div className={styles.empty}>
          <Building2 size={28} />
          <h3>{zh ? "选一项资产，展开档案" : "Sélectionnez un actif"}</h3>
          <p>
            {zh
              ? "权属、占用、运行条件与明确的业务关系，在这里分别查看。"
              : "Consultez séparément propriété, occupation, état et relations explicites."}
          </p>
        </div>
      </aside>
    );
  const { unit, position } = record;
  const isCimac = building.project_code === "CIMAC";
  return (
    <aside
      className={styles.inspector}
      aria-label={zh ? `资产 ${unit.unit_no} 的档案` : `Dossier de ${unit.unit_no}`}
    >
      <header className={styles.inspectorHeader}>
        <p className={styles.eyebrow}>
          {building.project_code} · {zh ? "资产档案" : "DOSSIER DE L’ACTIF"}
        </p>
        <div className={styles.titleRow}>
          <h2>{unit.unit_no}</h2>
          <button
            type="button"
            className={styles.close}
            aria-label={zh ? "关闭资产档案" : "Fermer le dossier"}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <p className={styles.sub}>
          {building.display_name} · {unit.floor_label} · {t.kinds[unit.kind]}
          {unit.area_sqm != null ? ` · ${Number(unit.area_sqm)} m²` : ""}
        </p>
      </header>
      <div
        className={styles.tabs}
        role="tablist"
        aria-label={zh ? "资产档案页签" : "Onglets du dossier"}
      >
        {(
          [
            ["overview", zh ? "概况" : "Aperçu"],
            ["business", zh ? "业务关联" : "Relations"],
            ["history", zh ? "状态历史" : "Historique"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`asset-${unit.id}-${value}`}
            id={`asset-tab-${unit.id}-${value}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className={styles.detailBody}
        role="tabpanel"
        id={`asset-${unit.id}-${tab}`}
        aria-labelledby={`asset-tab-${unit.id}-${tab}`}
      >
        {tab === "overview" ? (
          <>
            <section className={styles.section}>
              <h3>{zh ? "独立状态维度" : "Dimensions indépendantes"}</h3>
              <div className={styles.dimensions}>
                <Dimension
                  label={zh ? "权属 / 出售口径" : "Propriété / vente"}
                  value={
                    position?.ownership === "sold"
                      ? zh
                        ? "已售（业务口径）"
                        : "Vendu (projection métier)"
                      : zh
                        ? "权属未明确"
                        : "Propriété non précisée"
                  }
                />
                <Dimension
                  label={zh ? "实际占用" : "Occupation réelle"}
                  value={unitOccupancyText(record, locale)}
                />
                <Dimension
                  label={zh ? "运行条件" : "État opérationnel"}
                  value={conditionLabel(position?.operational_condition, locale)}
                />
                <Dimension
                  label={zh ? "建设 / 交付" : "Construction / livraison"}
                  value={constructionLabel(unit.construction_status, locale)}
                />
              </div>
              <div className={styles.callout}>
                {unitNeedsVerification(record)
                  ? zh
                    ? "状态尚未完成核实，不计作明确空置或可出租。"
                    : "État à vérifier : ne pas considérer comme vacant ou prêt à louer."
                  : position?.lease_pending
                    ? zh
                      ? "已关联未来长租，资产已预留；待起租不计作当前占用，也不代表可再次出租。"
                      : "Réservé pour un bail à venir ; exclu de l’occupation actuelle et indisponible à la relocation."
                    : position?.operational_condition !== "normal"
                      ? zh
                        ? "运行条件受限；无占用也不代表具备出租条件。"
                        : "État limité : sans occupation ne signifie pas prêt à louer."
                      : zh
                        ? "无占用不等于可出租；已售资产仍可以有独立的代管或租赁关系。"
                        : "Sans occupation ne signifie pas prêt à louer ; un bien vendu peut avoir un bail distinct."}
                <br />
                {zh
                  ? "“已售”沿用现有业务投影，不作为产权登记或过户完成凭证。"
                  : "« Vendu » est une projection métier, pas une preuve de titre ou de mutation."}
              </div>
            </section>
            <section className={styles.section}>
              <h3>{zh ? "资产基础资料" : "Informations de base"}</h3>
              <dl className={styles.facts}>
                <Fact
                  label={zh ? "面积" : "Surface"}
                  value={
                    unit.area_sqm == null
                      ? zh
                        ? "待核对"
                        : "À vérifier"
                      : `${Number(unit.area_sqm)} m²`
                  }
                />
                <Fact label={zh ? "户型 / 形态" : "Configuration"} value={unit.layout} />
                <Fact
                  label={zh ? "装修配置" : "Équipement"}
                  value={unit.furnishing ? t.furnishing[unit.furnishing] : null}
                />
                <Fact label={zh ? "位置分区" : "Zone"} value={unit.zone_label} />
                <Fact
                  label={zh ? "保洁" : "Nettoyage"}
                  value={
                    !position
                      ? zh
                        ? "待核实"
                        : "À vérifier"
                      : position.cleaning_pending
                        ? zh
                          ? "待保洁"
                          : "À nettoyer"
                        : zh
                          ? "无待办保洁"
                          : "Aucun nettoyage en attente"
                  }
                />
                <Fact
                  label={zh ? "状态核验" : "Vérification"}
                  value={
                    unit.occupancy_verified === true
                      ? zh
                        ? "占用已核实"
                        : "Occupation vérifiée"
                      : zh
                        ? "占用待核实"
                        : "Occupation à vérifier"
                  }
                />
              </dl>
            </section>
            <section className={styles.section}>
              <h3>{zh ? "业务配置与标准价" : "Activités et tarifs configurés"}</h3>
              {isCimac ? (
                <p className={styles.note}>
                  {zh
                    ? "CIMAC 只租不卖；建设交付与租赁状态分别查看。"
                    : "CIMAC : location uniquement, sans vente ; livraison et occupation restent distinctes."}
                </p>
              ) : null}
              {!record.flags.some(
                (flag) => building.allows_sale || flag.business_type !== "sale",
              ) ? (
                <p className={styles.note}>
                  {zh
                    ? "业务配置待核对；不推定默认价格。"
                    : "Configuration à vérifier ; aucun tarif déduit."}
                </p>
              ) : (
                <dl className={styles.facts}>
                  {record.flags
                    .filter((flag) => building.allows_sale || flag.business_type !== "sale")
                    .map((flag) => (
                      <Fact
                        key={flag.business_type}
                        label={`${t.businessTypes[flag.business_type]} · ${flag.is_enabled ? (zh ? "已启用" : "Activé") : zh ? "未启用" : "Désactivé"}`}
                        value={
                          flag.default_price_xof == null
                            ? zh
                              ? "未配置价格"
                              : "Tarif non renseigné"
                            : formatXof(flag.default_price_xof, locale)
                        }
                      />
                    ))}
                </dl>
              )}
              {!building.allows_sale &&
              record.flags.some((flag) => flag.business_type === "sale" && flag.is_enabled) ? (
                <p className={styles.callout}>
                  {zh
                    ? "存在历史出售配置冲突，请核对；本页不会据此开放出售。"
                    : "Une ancienne configuration de vente est à vérifier ; aucune vente n’est ouverte ici."}
                </p>
              ) : null}
            </section>
            {unit.notes ? (
              <section className={styles.section}>
                <h3>{zh ? "资产备注" : "Notes"}</h3>
                <p className={styles.note}>{unit.notes}</p>
              </section>
            ) : null}
          </>
        ) : tab === "business" ? (
          <UnitBusinessRelations
            key={unit.id}
            record={record}
            building={building}
            locale={locale}
            returnTo={returnTo}
          />
        ) : (
          <UnitStatusHistory key={unit.id} id={unit.id} locale={locale} />
        )}
        <div className={styles.actions}>
          <Link
            className={styles.secondary}
            href={`${routeFor(locale, `/units/${unit.id}`)}?${new URLSearchParams({ returnTo })}`}
            prefetch={false}
          >
            {zh ? "完整资产档案" : "Dossier complet"}
            <ArrowUpRight size={12} />
          </Link>
          {canEdit ? (
            <button className={styles.secondary} type="button" onClick={onManage}>
              {zh ? "核对 / 修改运行条件" : "Vérifier / modifier l’état"}
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
function Dimension({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.dimension}>
      <label>{label}</label>
      <span>{value}</span>
    </div>
  );
}
function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}
