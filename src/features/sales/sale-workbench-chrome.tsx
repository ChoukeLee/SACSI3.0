"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { OperationalPage, SegmentedControl } from "@/components/ui/operational";
import { ContractListControls } from "@/features/contracts/contract-table";
import type { Locale } from "@/lib/i18n";
import styles from "./sale-workbench.module.css";

export interface SaleBuilding {
  id: string;
  code: string;
  display_name: string;
  project_id?: string | null;
  project?: { id: string; code: string; display_name: string; allows_sale?: boolean } | null;
}
export type SaleStatusFilter = "current" | "all" | "terminated" | "expired";
export type SaleStatKey =
  "active" | "total" | "received" | "receivable" | "due" | "overdue" | "transfer";

export function SaleWorkbenchScope({
  locale,
  buildings,
  projectId,
  buildingId,
  noSaleProject,
  returnTo,
  onProject,
  onBuilding,
}: {
  locale: Locale;
  buildings: SaleBuilding[];
  projectId?: string;
  buildingId: string;
  noSaleProject: boolean;
  returnTo: string | null;
  onProject: (id: string) => void;
  onBuilding: (id: string) => void;
}) {
  const zh = locale === "zh";
  const projects = [
    ...new Map(
      buildings
        .filter((row) => row.project_id && row.project)
        .map((row) => [row.project_id, row.project!]),
    ).values(),
  ];
  return (
    <div className={styles.scope}>
      <div className={styles.scopeFields}>
        {projects.length > 1 ? (
          <label>
            {zh ? "项目" : "Projet"}
            <select
              aria-label={zh ? "出售项目" : "Projet des ventes"}
              value={projectId ?? ""}
              onChange={(event) => onProject(event.target.value)}
            >
              <option value="">{zh ? "全部可售项目" : "Projets à vendre"}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.display_name || project.code}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!noSaleProject ? (
          <label>
            {zh ? "楼栋" : "Bâtiment"}
            <select
              aria-label={zh ? "出售楼栋" : "Bâtiment des ventes"}
              value={buildingId}
              onChange={(event) => onBuilding(event.target.value)}
            >
              <option value="">{zh ? "全部楼栋" : "Tous les bâtiments"}</option>
              {buildings
                .filter(
                  (row) =>
                    (!projectId || row.project_id === projectId) &&
                    row.project?.allows_sale !== false,
                )
                .map((building) => (
                  <option key={building.id} value={building.id}>
                    {building.display_name || building.code}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </div>
      {returnTo ? (
        <Link
          prefetch={false}
          className="text-xs text-blue-700 hover:underline dark:text-blue-300"
          href={returnTo}
        >
          {zh ? "← 返回上一处" : "← Revenir au dossier précédent"}
        </Link>
      ) : (
        <span className={styles.scopeHint}>
          {zh
            ? "合同价、现金收款与应收核销分开核对"
            : "Prix, encaissements et rapprochements distincts"}
        </span>
      )}
    </div>
  );
}

export function SaleWorkbenchToolbar({
  locale,
  count,
  search,
  view,
  status,
  onSearch,
  onView,
  onStatus,
}: {
  locale: Locale;
  count: string;
  search: string;
  view: "table" | "rooms";
  status: SaleStatusFilter;
  onSearch: (value: string) => void;
  onView: (value: "table" | "rooms") => void;
  onStatus: (value: SaleStatusFilter) => void;
}) {
  const zh = locale === "zh";
  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarTitle}>
        <h2>{zh ? "出售合同" : "Contrats de vente"}</h2>
        <span className={styles.note}>
          {count} {zh ? "份合同" : "contrats"}
        </span>
      </div>
      <ContractListControls
        locale={locale}
        query={search}
        onQueryChange={onSearch}
        view={view}
        onViewChange={onView}
      />
      <div className="mt-3">
        <SegmentedControl
          value={status}
          onChange={onStatus}
          ariaLabel={zh ? "出售合同状态" : "Statut des ventes"}
          items={[
            { value: "current", label: zh ? "当前合同" : "En cours" },
            { value: "all", label: zh ? "全部" : "Tous" },
            { value: "terminated", label: zh ? "已终止" : "Résiliés" },
            { value: "expired", label: zh ? "已过期" : "Expirés" },
          ]}
        />
      </div>
    </div>
  );
}

export function SaleWorkbenchSummary({
  locale,
  blocks,
  unavailable,
  active,
  onOpen,
}: {
  locale: Locale;
  blocks: { key: SaleStatKey; label: string; value: string; hint: string }[];
  unavailable: boolean;
  active: SaleStatKey | null;
  onOpen: (key: SaleStatKey) => void;
}) {
  return (
    <div
      className={styles.summary}
      aria-label={locale === "zh" ? "当前出售范围汇总" : "Synthèse des ventes"}
    >
      {blocks
        .filter((block) => ["active", "total", "due", "transfer"].includes(block.key))
        .map((block) => (
          <button
            key={block.key}
            type="button"
            disabled={unavailable}
            onClick={() => onOpen(block.key)}
            aria-pressed={active === block.key}
          >
            <span className={styles.summaryLabel}>{block.label}</span>
            <span className={styles.summaryValue}>{unavailable ? "—" : block.value}</span>
            <span className={styles.summaryHint}>
              {unavailable
                ? locale === "zh"
                  ? "正在读取或暂不可核验"
                  : "Lecture en cours ou indisponible"
                : block.hint}
            </span>
          </button>
        ))}
    </div>
  );
}

export function SaleNoSaleWorkspace({
  locale,
  projectId,
  scope,
}: {
  locale: Locale;
  projectId?: string;
  scope: ReactNode;
}) {
  const zh = locale === "zh",
    prefix = zh ? "" : "/fr";
  return (
    <OperationalPage
      className={styles.workbench}
      eyebrow="SALES WORKSPACE"
      title={zh ? "出售履约台" : "Suivi des ventes"}
      description={
        zh
          ? "合同、分期与过户，沿同一笔业务查看。"
          : "Contrats, échéances et transfert dans un même dossier."
      }
    >
      {scope}
      <section className="rounded-xl border bg-card p-8">
        <h2 className="text-lg font-semibold">
          {zh ? "当前项目不开展出售业务" : "Ce projet ne prévoit pas de ventes"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {zh
            ? "CIMAC 只租不卖。建设、交付与租赁关系在资产及长租工作区查看。"
            : "CIMAC est destiné à la location. Consultez les lots et les baux pour la construction et la livraison."}
        </p>
        <div className="mt-5 flex flex-wrap gap-5 text-sm text-blue-700 dark:text-blue-300">
          <Link
            prefetch={false}
            href={`${prefix}/units?project=${encodeURIComponent(projectId ?? "")}`}
          >
            {zh ? "查看项目资产 ↗" : "Voir les lots ↗"}
          </Link>
          <Link
            prefetch={false}
            href={`${prefix}/leases?project=${encodeURIComponent(projectId ?? "")}`}
          >
            {zh ? "查看长租 ↗" : "Voir les baux ↗"}
          </Link>
        </div>
      </section>
    </OperationalPage>
  );
}
