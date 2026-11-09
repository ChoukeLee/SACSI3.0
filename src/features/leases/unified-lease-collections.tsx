"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import styles from "@/features/asset-operations/operating-asset-directory.module.css";
import type { Locale } from "@/lib/i18n";
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

const filters = ["all", "overdue", "upcoming", "unsettled", "needs_evidence"] as const;
type StatusFilter = (typeof filters)[number];

function statusTone(status: CollectionStatus) {
  return status === "overdue" || status === "upcoming" ? status : "pending";
}

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
  const scopeUnavailable =
    category === "apartment"
      ? unavailable.apartments
      : category === "all"
        ? unavailable.apartments && unavailable.operatingAssets
        : unavailable.operatingAssets;
  const unregistered = zh ? "未登记" : "Non renseigné";

  return (
    <section
      className={styles.directory}
      aria-label={zh ? "集中收款跟进" : "Suivi des loyers regroupé"}
    >
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={zh ? "搜索收款跟进" : "Rechercher un suivi"}
            placeholder={zh ? "名称、房号或租户" : "Nom, lot ou locataire"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          className={styles.groupSelect}
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
      </div>
      <section
        className={styles.collectionPanel}
        aria-labelledby="unified-lease-collections-heading"
      >
        <header className={styles.collectionHeading}>
          <h2 id="unified-lease-collections-heading">{zh ? "收款跟进" : "Suivi des loyers"}</h2>
          <p className={styles.note}>
            {zh
              ? "付款日、已交至和未收金额分开列示。逾期与15天内应缴按可核实的付款日和未收依据判断。"
              : "Échéance, période couverte et solde sont affichés séparément. Les retards et échéances à 15 jours reposent sur des dates et soldes vérifiables."}
          </p>
          {unavailable.apartments ? (
            <p role="alert" className={styles.note}>
              {zh ? "公寓账单暂无法完整读取。" : "Les créances des appartements sont incomplètes."}
            </p>
          ) : null}
          {unavailable.operatingAssets ? (
            <p role="alert" className={styles.note}>
              {zh
                ? "经营资产资料暂无法完整读取。"
                : "Les données des autres actifs sont incomplètes."}
            </p>
          ) : null}
          <div
            className={styles.collectionFilters}
            role="group"
            aria-label={zh ? "收款跟进筛选" : "Filtres de suivi"}
          >
            {filters.map((key) => (
              <button
                type="button"
                key={key}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {collectionStatusLabels[key][lang]}
                <span>{scopeUnavailable ? "—" : counts[key]}</span>
              </button>
            ))}
          </div>
        </header>
        {visible.length ? (
          <ul className={styles.collectionRows}>
            {visible.map((row) => {
              const categoryLabel = collectionCategoryLabel(row.category, locale);
              return (
                <li key={row.id}>
                  <Link href={row.href} prefetch={false} className={styles.collectionRow}>
                    <span>
                      <span>{row.name}</span>
                      <small>
                        {row.group === categoryLabel
                          ? row.group
                          : `${categoryLabel} · ${row.group}`}
                      </small>
                      {row.tenant ? (
                        <small className={styles.collectionTenant}>{row.tenant}</small>
                      ) : null}
                    </span>
                    <span>
                      <span className={styles.status} data-status={statusTone(row.status)}>
                        {collectionStatusLabels[row.status][lang]}
                      </span>
                      {row.reason ? <small>{row.reason}</small> : null}
                    </span>
                    <span>
                      <span title={row.dueSource}>
                        {zh ? "付款日" : "Échéance"} {row.dueDate ?? unregistered}
                      </span>
                      <small title={row.paidThroughSource}>
                        {row.coveragePending
                          ? zh
                            ? "租金记载至"
                            : "Loyer documenté au"
                          : zh
                            ? "已交至"
                            : "Payé au"}{" "}
                        {row.paidThrough ?? unregistered}
                      </small>
                    </span>
                    <span className={styles.collectionAmount} title={row.amountSource}>
                      {row.amount ?? unregistered}
                      <small>{row.amountLabel}</small>
                    </span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.collectionEmpty}>
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
    </section>
  );
}
