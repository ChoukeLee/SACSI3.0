"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { LeaseBrowseStatusFilter, LeaseModeSelector } from "./lease-browse-content";
import {
  collectionCategoryLabel,
  collectionStatusLabels,
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
        [row.name, row.group ?? "", row.tenant ?? "", ...row.keywords].some((value) =>
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
      <div className={styles.scopeBar}>
        <LeaseModeSelector
          locale={locale}
          value={category === "all" ? null : category}
          onChange={setCategory}
        />
        <button
          className={styles.overview}
          type="button"
          aria-pressed={category === "all"}
          onClick={() => setCategory("all")}
        >
          {category === "all"
            ? collectionCategoryLabel("all", locale)
            : zh
              ? "返回汇总"
              : "Retour à la synthèse"}
        </button>
      </div>
      <div className={styles.toolbar}>
        <span className={styles.resultCount} aria-live="polite">
          {scopeUnavailable
            ? "—"
            : zh
              ? `${visible.length} 项跟进`
              : `${visible.length} dossier(s) à suivre`}
        </span>
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
                        <small>{[categoryLabel, row.group].filter(Boolean).join(" · ")}</small>
                        <span className={styles.party}>
                          <strong>{row.name}</strong>
                          {row.tenant ? <span>{row.tenant}</span> : null}
                        </span>
                      </span>
                      <span className={styles.field} title={row.paidThroughSource}>
                        <small>
                          {row.coveragePending
                            ? zh
                              ? "租金记载至"
                              : "Loyer documenté au"
                            : zh
                              ? "已交至"
                              : "Payé au"}
                        </small>
                        {row.paidThrough ? (
                          <time dateTime={row.paidThrough}>{row.paidThrough}</time>
                        ) : (
                          unregistered
                        )}
                      </span>
                      <span className={styles.field} title={row.dueSource}>
                        <small>{zh ? "约定付款日" : "Échéance prévue"}</small>
                        {row.dueDate ? (
                          <time dateTime={row.dueDate}>{row.dueDate}</time>
                        ) : (
                          unregistered
                        )}
                      </span>
                      <span className={styles.field} title={row.amountSource}>
                        <small>{row.amountLabel}</small>
                        <span>{row.amount ?? unregistered}</span>
                      </span>
                      <span className={styles.rowStatus} data-status={row.status}>
                        {row.reason ?? row.statusLabel ?? collectionStatusLabels[row.status][lang]}
                      </span>
                      <ArrowRight size={14} aria-hidden="true" />
                      {row.latestReceipt ? (
                        <span className={styles.receipt}>
                          <small>{zh ? "已确认收款" : "Encaissement confirmé"}</small>
                          <time dateTime={row.latestReceipt.date}>{row.latestReceipt.date}</time>
                          <span>{row.latestReceipt.amount}</span>
                          {row.latestReceipt.periodStart && row.latestReceipt.periodEnd ? (
                            <small>
                              {zh ? "覆盖" : "Période"} {row.latestReceipt.periodStart}{" "}
                              {zh ? "至" : "au"} {row.latestReceipt.periodEnd}
                            </small>
                          ) : null}
                        </span>
                      ) : null}
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
