"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { LeaseBrowseStatusFilter } from "./lease-browse-content";
import {
  collectionCategories,
  collectionCategoryLabel,
  collectionStatusLabels,
  parseCollectionCategory,
  sortCollectionRows,
  type CollectionCategory,
  type CollectionStatus,
  type UnifiedLeaseCollectionRow,
} from "./unified-lease-collections-model";
import styles from "./unified-lease-collections.module.css";

const statuses = ["overdue", "upcoming", "unsettled", "needs_evidence"] as const;
type StatusFilter = "all" | CollectionStatus;

export function UnifiedLeaseCollections({
  rows,
  locale,
  initialCategory,
  unavailable,
}: {
  rows: readonly UnifiedLeaseCollectionRow[];
  locale: Locale;
  initialCategory: CollectionCategory;
  unavailable: { apartments: boolean; operatingAssets: boolean };
}) {
  const zh = locale === "zh";
  const lang = zh ? 0 : 1;
  const [category, setCategory] = useState(initialCategory);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase(locale);
  const candidates = rows.filter(
    (row) =>
      (category === "all" || row.category === category) &&
      (!query ||
        [row.name, row.group, row.tenant ?? "", ...row.keywords].some((value) =>
          value.toLocaleLowerCase(locale).includes(query),
        )),
  );
  const counts: Record<StatusFilter, number> = {
    all: candidates.length,
    overdue: 0,
    upcoming: 0,
    unsettled: 0,
    needs_evidence: 0,
  };
  for (const row of candidates) counts[row.status]++;
  const visible = sortCollectionRows(
    candidates.filter((row) => filter === "all" || row.status === filter),
    locale,
  );
  const groups = new Map<CollectionStatus, UnifiedLeaseCollectionRow[]>();
  for (const row of visible) {
    const group = groups.get(row.status);
    if (group) group.push(row);
    else groups.set(row.status, [row]);
  }
  const scopeUnavailable =
    category === "apartment"
      ? unavailable.apartments
      : category === "all"
        ? unavailable.apartments && unavailable.operatingAssets
        : unavailable.operatingAssets;
  const unregistered = zh ? "未登记" : "Non renseigné";

  return (
    <section
      className={styles.workspace}
      aria-label={zh ? "集中收款跟进" : "Suivi des loyers regroupé"}
    >
      <div className={styles.toolbar}>
        <select
          className={styles.category}
          aria-label={zh ? "资产类别" : "Catégorie d’actifs"}
          value={category}
          onChange={(event) => setCategory(parseCollectionCategory(event.target.value))}
        >
          {(["all", ...collectionCategories] as const).map((key) => (
            <option key={key} value={key}>
              {collectionCategoryLabel(key, locale)}
            </option>
          ))}
        </select>
        <LeaseBrowseStatusFilter
          label={zh ? "收款状态" : "Statut du suivi"}
          value={filter}
          options={["all" as const, ...statuses].map((value) => ({
            value,
            label: collectionStatusLabels[value][lang],
            count: scopeUnavailable ? null : counts[value],
          }))}
          onChange={(value) => {
            const status = statuses.find((key) => key === value);
            setFilter(status ?? "all");
          }}
        />
        <label className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={zh ? "搜索收款跟进" : "Rechercher un suivi"}
            placeholder={zh ? "搜索房号、资产名称或租户" : "Lot, nom du bien ou locataire"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {unavailable.apartments ? (
        <p role="alert" className={styles.notice}>
          {zh ? "公寓账单暂无法完整读取。" : "Les créances des appartements sont incomplètes."}
        </p>
      ) : null}
      {unavailable.operatingAssets ? (
        <p role="alert" className={styles.notice}>
          {zh ? "经营资产资料暂无法完整读取。" : "Les données des autres actifs sont incomplètes."}
        </p>
      ) : null}
      {groups.size ? (
        Array.from(groups, ([status, items]) => (
          <section
            className={styles.group}
            key={status}
            aria-labelledby={`lease-collection-${status}`}
          >
            <header className={styles.groupHeading} data-status={status}>
              <h2 id={`lease-collection-${status}`}>{collectionStatusLabels[status][lang]}</h2>
              <span>{zh ? `${items.length} 项` : `${items.length} dossier(s)`}</span>
            </header>
            <ul className={styles.rows}>
              {items.map((row) => {
                const categoryLabel = collectionCategoryLabel(row.category, locale);
                return (
                  <li key={row.id}>
                    <Link href={row.href} prefetch={false} className={styles.row}>
                      <span className={styles.identity}>
                        <small>
                          {row.group === categoryLabel
                            ? row.group
                            : `${categoryLabel} · ${row.group}`}
                        </small>
                        <span className={styles.party}>
                          <strong>{row.name}</strong>
                          {row.tenant ? <span>{row.tenant}</span> : null}
                        </span>
                        {row.reason ? <small>{row.reason}</small> : null}
                      </span>
                      <span className={styles.dates}>
                        <span title={row.dueSource}>
                          <small>{zh ? "付款日" : "Échéance"}</small>
                          {row.dueDate ?? unregistered}
                        </span>
                        <span title={row.paidThroughSource}>
                          <small>
                            {row.coveragePending
                              ? zh
                                ? "租金记载至"
                                : "Loyer documenté au"
                              : zh
                                ? "已交至"
                                : "Payé au"}
                          </small>
                          {row.paidThrough ?? unregistered}
                        </span>
                      </span>
                      <span className={styles.amount} title={row.amountSource}>
                        <small>{row.amountLabel}</small>
                        <span>{row.amount ?? unregistered}</span>
                      </span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      ) : (
        <p className={styles.notice}>
          {scopeUnavailable
            ? zh
              ? "当前范围暂无法核对。"
              : "Cette sélection est temporairement indisponible."
            : zh
              ? "当前筛选没有需要跟进的记录。"
              : "Aucun suivi dans cette sélection."}
        </p>
      )}
    </section>
  );
}
