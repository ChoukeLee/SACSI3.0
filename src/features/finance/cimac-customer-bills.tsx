"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CircleDashed } from "lucide-react";
import type { CimacAccountReceivable, CimacCustomerAccount } from "./cimac-billing-types";
import {
  billingCategory,
  billingNumber,
  billingStatus,
  receivableAmounts,
} from "./cimac-billing-display";
import styles from "./cimac-customer-workbench.module.css";

export function CimacCustomerBills({
  data,
  locale,
  today,
  kind,
  onClearKind,
  onShowRules,
}: {
  data: CimacCustomerAccount;
  locale: "zh" | "fr";
  today: string;
  kind: string;
  onClearKind: () => void;
  onShowRules: () => void;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const base = locale === "fr" ? "/fr" : "";
  const customer = data.customer!;
  const [currency, setCurrency] = useState("all");
  const [selection, setSelection] = useState<{ id: string; rows: CimacAccountReceivable[] } | null>(
    null,
  );
  const detailRef = useRef<HTMLElement>(null);
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const contracts = new Map(data.contracts.map((contract) => [contract.id, contract]));
  const unitLabel = (id: string | null) => {
    const unit = id ? units.get(id) : undefined;
    return unit
      ? `${unit.building_label || unit.building_code} · ${unit.unit_no}`
      : text("房屋关联待核", "Lot à vérifier");
  };
  const rows = data.receivables.filter(
    (row) =>
      (kind === "all" || (row.unit_id && units.get(row.unit_id)?.kind === kind)) &&
      (currency === "all" || row.currency === currency),
  );
  const selected =
    selection?.rows === data.receivables ? rows.find((row) => row.id === selection.id) : undefined;
  const selectBill = (id: string) => {
    setSelection({ id, rows: data.receivables });
    requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ behavior: "auto", block: "nearest" }),
    );
  };
  const leaseHref = (id: string) =>
    `${base}/leases?${new URLSearchParams({ project: data.project.id, contract: id, ...(units.get(contracts.get(id)?.unitId ?? "")?.building_id ? { building: units.get(contracts.get(id)!.unitId)!.building_id } : {}), returnTo: `${base}/finance?${new URLSearchParams({ view: "customers", customerId: data.selectedCustomerId! })}` })}`;
  return (
    <>
      <div className={styles.toolbar}>
        {kind !== "all" ? (
          <button type="button" className={styles.quietButton} onClick={onClearKind}>
            {text("查看全部物业", "Tous les biens")}
          </button>
        ) : (
          <span className={styles.note}>
            {text(
              "客户全部已建账单 · 不推算新应收",
              "Créances existantes du client · aucune nouvelle créance déduite",
            )}
          </span>
        )}
        <select
          className={styles.select}
          aria-label={text("筛选账单币种", "Filtrer par devise")}
          value={currency}
          onChange={(event) => {
            setCurrency(event.target.value);
            setSelection(null);
          }}
        >
          <option value="all">{text("全部币种 · 独立列示", "Toutes devises · séparées")}</option>
          {Array.from(new Set(data.receivables.map((row) => row.currency))).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <section className={styles.panel} aria-label={text("客户收费账单", "Créances du client")}>
        <div className={styles.sectionHead}>
          <h2>{text("收费账单", "Créances")}</h2>
          <span>
            {rows.length} {text("笔", "lignes")}
          </span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{text("费用 / 房屋 / 合同", "Frais / bien / contrat")}</th>
                <th>{text("收费期间", "Période de service")}</th>
                <th className={styles.number}>{text("应收", "Créance")}</th>
                <th className={styles.number}>{text("已核销", "Imputée")}</th>
                <th className={styles.number}>{text("有效未收", "Solde géré")}</th>
                <th>{text("状态", "État")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => {
                  const amounts = receivableAmounts(row);
                  const managed =
                    !row.reviewReason &&
                    row.management_status === "managed" &&
                    row.status !== "cancelled";
                  return (
                    <tr
                      key={row.id}
                      className={selected?.id === row.id ? styles.selectedRow : undefined}
                    >
                      <td>
                        <button
                          className={styles.rowButton}
                          type="button"
                          aria-label={`${text("查看账单", "Voir la créance")} ${row.title}`}
                          onClick={() => selectBill(row.id)}
                        >
                          <strong>
                            {billingCategory(row.category, locale)} · {unitLabel(row.unit_id)}
                          </strong>
                          <span className={styles.meta}>
                            {contracts.get(row.source_id ?? "")?.contractNo || row.title}
                          </span>
                        </button>
                      </td>
                      <td>
                        {row.service_period_start && row.service_period_end ? (
                          <>
                            {row.service_period_start}
                            <br />
                            {row.service_period_end}
                          </>
                        ) : (
                          <span className={styles.muted}>
                            {text("期间待核", "Période à vérifier")}
                          </span>
                        )}
                      </td>
                      <td className={styles.number}>
                        {billingNumber(amounts.amount, locale)}
                        <div className={styles.meta}>{row.currency}</div>
                      </td>
                      <td className={styles.number}>{billingNumber(amounts.paid, locale)}</td>
                      <td className={styles.number}>
                        {managed ? billingNumber(row.outstanding, locale) : "—"}
                      </td>
                      <td>
                        <span
                          className={`${styles.status} ${!managed ? styles.pending : row.status === "paid" ? styles.good : ""}`}
                        >
                          {billingStatus(row, today, locale)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    {text(
                      "没有符合筛选的已建账单。未确认收费约定不算欠款。",
                      "Aucune créance correspondante. Une convention non vérifiée n’est pas une dette.",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.tableFoot}>
          <span>
            {text(
              "金额按原币保留；押金不计入经营收入。",
              "Montants en devise d’origine ; les dépôts ne sont pas des revenus.",
            )}
          </span>
          <Link
            href={`${base}/finance?kind=receivables&projectId=${encodeURIComponent(data.project.id)}`}
          >
            {text("全部应收与原处理入口", "Toutes les créances et opérations existantes")} ↗
          </Link>
        </div>
      </section>
      {selected ? (
        <section
          ref={detailRef}
          tabIndex={-1}
          className={`${styles.panel} ${styles.detail}`}
          aria-label={text("所选账单详情", "Détail de la créance sélectionnée")}
        >
          <div className={styles.profileTop}>
            <div>
              <h3>{selected.title}</h3>
              <p className={styles.meta}>
                {unitLabel(selected.unit_id)} ·{" "}
                {contracts.get(selected.source_id ?? "")?.contractNo ||
                  text("合同关联待核", "Contrat à vérifier")}
              </p>
            </div>
            <button type="button" className={styles.quietButton} onClick={() => setSelection(null)}>
              {text("收起", "Fermer")}
            </button>
          </div>
          <div className={styles.detailGrid}>
            {selected.reviewReason ? (
              <p className={`${styles.note} ${styles.pending}`}>
                {text(
                  "金额或核销记录待核，不纳入有效欠款，保留原账务事实。",
                  "Montants ou imputations à vérifier, exclus du solde géré ; les faits d’origine sont conservés.",
                )}
              </p>
            ) : null}
            <dl>
              <div className={styles.detailLine}>
                <dt>{text("费用项目", "Nature")}</dt>
                <dd>{billingCategory(selected.category, locale)}</dd>
              </div>
              <div className={styles.detailLine}>
                <dt>{text("服务期间", "Période de service")}</dt>
                <dd>
                  {selected.service_period_start && selected.service_period_end
                    ? `${selected.service_period_start} — ${selected.service_period_end}`
                    : text(
                        "待核，不根据付款或到期日期推算",
                        "À vérifier, sans déduction des dates de paiement ou échéance",
                      )}
                </dd>
              </div>
              <div className={styles.detailLine}>
                <dt>{text("已有到期日", "Échéance enregistrée")}</dt>
                <dd>{selected.due_date || text("待核", "À vérifier")}</dd>
              </div>
              <div className={styles.detailLine}>
                <dt>{text("原始说明", "Note d’origine")}</dt>
                <dd>{selected.notes || "—"}</dd>
              </div>
            </dl>
            <div>
              <p className={styles.formula}>
                {text(
                  "保留原账务事实；统一参考价不覆盖历史金额。",
                  "Les faits comptables d’origine sont conservés ; le tarif de référence ne remplace pas les montants historiques.",
                )}
              </p>
              <div className={styles.detailLine}>
                <span className={styles.muted}>{text("关联核销", "Imputations liées")}</span>
                <span>
                  {
                    data.allocations.filter((allocation) => allocation.receivableId === selected.id)
                      .length
                  }{" "}
                  {text("笔", "lignes")}
                </span>
              </div>
              {contracts.get(selected.source_id ?? "")?.kind === "lease" ? (
                <Link className={styles.quietButton} href={leaseHref(selected.source_id!)}>
                  {text("查看原合同与业务操作", "Contrat et opérations existantes")} ↗
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <div className={`${styles.panel} ${styles.pendingList}`}>
        <CircleDashed size={15} aria-hidden="true" />
        <span>
          {customer.pendingCount}{" "}
          {text(
            "项待核 · 起算日、费率或历史依据不清楚，不自动出账",
            "à vérifier · aucune facturation déduite d’une base incertaine",
          )}
        </span>
        <button type="button" className={styles.quietButton} onClick={onShowRules}>
          {text("查看约定", "Voir les conventions")} ↗
        </button>
      </div>
    </>
  );
}
