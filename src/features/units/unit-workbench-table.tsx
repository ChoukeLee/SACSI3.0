"use client";

import { ArrowRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { formatMoney } from "@/lib/currency";
import type { ReactNode } from "react";
import type {
  UnitBusinessMoney,
  UnitLeaseBrief,
  UnitSaleBrief,
} from "./unit-business-summary-model";
import { cn, compareFloorLabels } from "@/lib/utils";
import { conditionLabel } from "./operational-position";
import {
  unitNeedsVerification,
  unitOccupancyText,
  type UnitWorkbenchRecord,
} from "./unit-workbench-model";
import styles from "./unit-workbench.module.css";

function upcomingDays(date: string | null, today: string) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const due = Date.parse(`${date}T00:00:00Z`),
    current = Date.parse(`${today}T00:00:00Z`);
  if (
    !Number.isFinite(due) ||
    !Number.isFinite(current) ||
    new Date(due).toISOString().slice(0, 10) !== date ||
    new Date(current).toISOString().slice(0, 10) !== today
  )
    return null;
  const days = (due - current) / 86400000;
  return Number.isInteger(days) && days >= 0 && days <= 15 ? days : null;
}

function hasSaleBalance(party: UnitSaleBrief) {
  return (
    ["verified_bills", "registered"].includes(party.balance.basis) &&
    party.balance.amounts?.some((value) => value.amount > 0)
  );
}

function attention(record: UnitWorkbenchRecord, locale: Locale) {
  const zh = locale === "zh",
    position = record.position;
  if (position?.daily_occupied && position.lease_occupied)
    return { label: zh ? "占用冲突" : "Occupation conflictuelle", critical: true };
  if (position?.operational_condition === "locked")
    return { label: conditionLabel("locked", locale), critical: true };
  if (
    record.business?.status === "ready" &&
    record.business.leases.some((party) => party.overdue?.some((value) => value.amount > 0))
  )
    return { label: zh ? "租金逾期" : "Loyer en retard", critical: true };
  if (record.business?.status === "ready") {
    const dueDays = record.business.leases
      .filter((party) => party.dueUnpaid !== null)
      .map((party) => upcomingDays(party.nextDue, record.business!.today))
      .filter((value): value is number => value !== null);
    if (dueDays.length)
      return {
        label:
          Math.min(...dueDays) === 0
            ? zh
              ? "今日应缴"
              : "Dû aujourd’hui"
            : zh
              ? "15天内应缴"
              : "Dû sous 15 jours",
        critical: false,
      };
    if (record.business.sales.some(hasSaleBalance))
      return { label: zh ? "余款待跟进" : "Solde à suivre", critical: false };
  }
  if (position?.operational_condition === "maintenance")
    return { label: conditionLabel("maintenance", locale), critical: false };
  if (position?.cleaning_pending) return { label: zh ? "待保洁" : "À nettoyer", critical: false };
  if (unitNeedsVerification(record) || record.business?.reviewReasons.length)
    return { label: zh ? "待核实" : "À vérifier", critical: false };
  return null;
}

export function unitReviewText(reasons: readonly string[], locale: Locale) {
  const labels: Record<string, [string, string]> = {
    price_requires_review: ["登记价格待核", "Prix enregistré à vérifier"],
    payment_arrangement_requires_review: ["付款安排待核", "Échéancier à vérifier"],
    registered_balance_bill_conflict: [
      "登记余款与账单有差异",
      "Écart entre solde enregistré et créances",
    ],
    cash_record_requires_review: ["收款资料待核", "Encaissements à vérifier"],
    cash_exceeds_registered_price: [
      "已录房款超过登记总价，需核对来源",
      "Les encaissements enregistrés dépassent le prix enregistré ; sources à vérifier",
    ],
    refund_currency_or_amount_requires_review: [
      "退款币种或金额关系待核",
      "Devise ou montant des remboursements à vérifier",
    ],
    multiple_current_records: [
      "有多条当前记录，需分别核对",
      "Plusieurs dossiers actuels à vérifier séparément",
    ],
    registered_period_needs_review: ["登记租期待核", "Période locative enregistrée à vérifier"],
  };
  return [
    ...new Set(
      reasons.map(
        (reason) =>
          labels[reason]?.[locale === "zh" ? 0 : 1] ??
          (locale === "zh" ? "存在待核资料" : "Informations à vérifier"),
      ),
    ),
  ].join("；");
}

export function UnitAmountValue({
  values,
  locale,
  empty,
}: {
  values: readonly UnitBusinessMoney[] | null;
  locale: Locale;
  empty?: string;
}) {
  if (values === null) return <>{locale === "zh" ? "待核" : "À vérifier"}</>;
  if (!values.length)
    return <>{empty ?? (locale === "zh" ? "未见实收" : "Aucun encaissement enregistré")}</>;
  return (
    <>
      {values.map((value, index) => (
        <span className={styles.moneyCurrency} key={`${value.currency}:${index}`}>
          {value.currency === "XOF"
            ? new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
                maximumFractionDigits: 6,
              }).format(value.amount / 10000)
            : formatMoney(value.amount, value.currency, locale)}
          <small className={styles.moneyUnit}>
            {value.currency === "XOF"
              ? locale === "zh"
                ? "万西法"
                : "× 10 000 XOF"
              : value.currency}
          </small>
        </span>
      ))}
    </>
  );
}

export function UnitPartyHeading({
  party,
  role,
  locale,
}: {
  party: UnitSaleBrief | UnitLeaseBrief;
  role: "sale" | "lease";
  locale: Locale;
}) {
  const zh = locale === "zh";
  return (
    <span className={styles.businessPerson}>
      <span className={styles.personRole}>
        {role === "sale" ? (zh ? "买方" : "Acquéreur") : zh ? "租客" : "Locataire"}
        {party.status === "draft"
          ? ` · ${zh ? "草稿" : "Brouillon"}`
          : party.historical
            ? ` · ${zh ? "状态待核" : "État à vérifier"}`
            : role === "lease" && (party as UnitLeaseBrief).occupancy === "scheduled"
              ? ` · ${zh ? "待起租" : "À venir"}`
              : ""}
      </span>
      <strong>{party.customerName || (zh ? "姓名待核" : "Identité à vérifier")}</strong>
      {party.reviewReasons.length ? (
        <small className={styles.partyReview} title={unitReviewText(party.reviewReasons, locale)}>
          {zh ? "待核" : "À vérifier"}
        </small>
      ) : null}
    </span>
  );
}

function MoneyRow({
  label,
  children,
  basis,
  title,
  alert = false,
}: {
  label: string;
  children: ReactNode;
  basis?: string;
  title?: string;
  alert?: boolean;
}) {
  return (
    <span className={styles.businessMoneyRow}>
      <span>{label}</span>
      <strong title={title} className={alert ? styles.moneyAlert : undefined}>
        {children}
        {basis ? <small className={styles.balanceBasis}>{basis}</small> : null}
      </strong>
    </span>
  );
}

export function UnitPartyMoney({
  sale,
  lease,
  locale,
}: {
  sale?: UnitSaleBrief;
  lease?: UnitLeaseBrief;
  locale: Locale;
}) {
  const zh = locale === "zh";
  return (
    <span className={styles.businessMoney}>
      {sale ? (
        <>
          <MoneyRow label={zh ? "总价" : "Prix enregistré"}>
            <UnitAmountValue values={sale.total ? [sale.total] : null} locale={locale} />
          </MoneyRow>
          <MoneyRow
            label={
              sale.refundPaid?.length
                ? zh
                  ? "净收房款"
                  : "Prix net encaissé"
                : zh
                  ? "已收房款"
                  : "Prix encaissé"
            }
          >
            <UnitAmountValue
              values={sale.netReceived === undefined ? sale.received : sale.netReceived}
              locale={locale}
            />
          </MoneyRow>
          <MoneyRow
            label={zh ? "未收房款" : "Solde du prix"}
            alert={!!hasSaleBalance(sale)}
            basis={
              sale.balance.basis === "verified_bills" && sale.balance.amounts?.length
                ? zh
                  ? "账单"
                  : "Factures"
                : sale.balance.basis === "registered"
                  ? zh
                    ? "登记"
                    : "Enregistré"
                  : undefined
            }
            title={
              sale.balance.basis === "verified_bills"
                ? zh
                  ? "仅已核账单余额，不以总价减实收推算。"
                  : "Solde des seules créances vérifiées, sans déduction prix moins encaissements."
                : sale.balance.basis === "registered"
                  ? zh
                    ? "来源资料登记余款，与已核账单分别核对。"
                    : "Solde enregistré dans la source, distinct des créances vérifiées."
                  : undefined
            }
          >
            <UnitAmountValue
              values={sale.balance.basis === "unknown" ? null : sale.balance.amounts}
              locale={locale}
              empty={
                sale.balance.basis === "verified_bills"
                  ? zh
                    ? "账单结清"
                    : "Factures soldées"
                  : zh
                    ? "待核"
                    : "À vérifier"
              }
            />
          </MoneyRow>
        </>
      ) : lease ? (
        <>
          <MoneyRow label={zh ? "月租" : "Loyer mensuel"}>
            <UnitAmountValue
              values={lease.monthlyRent ? [lease.monthlyRent] : null}
              locale={locale}
            />
          </MoneyRow>
          <MoneyRow label={zh ? "已收租金" : "Loyers encaissés"}>
            <UnitAmountValue values={lease.rentReceived} locale={locale} />
          </MoneyRow>
          <MoneyRow
            label={zh ? "到期未收" : "Loyers dus"}
            basis={lease.dueUnpaid !== null ? (zh ? "账单" : "Factures") : undefined}
            alert={!!lease.overdue?.some((value) => value.amount > 0)}
          >
            <UnitAmountValue
              values={lease.dueUnpaid}
              locale={locale}
              empty={zh ? "无已核到期未收" : "Aucun impayé échu vérifié"}
            />
          </MoneyRow>
        </>
      ) : null}
    </span>
  );
}

export function UnitPaidThrough({
  party,
  locale,
  hero = false,
}: {
  party: UnitLeaseBrief;
  locale: Locale;
  hero?: boolean;
}) {
  const zh = locale === "zh";
  return (
    <span className={cn(styles.paidThrough, hero && styles.dateHero)}>
      <span>
        {zh ? "租金已交至" : "Loyer enregistré jusqu’au"}
        <small>{zh ? "登记" : "Enregistré"}</small>
      </span>
      <strong
        title={
          zh
            ? "登记交至日期，不代替逐笔实收或账单核对。"
            : "Date enregistrée, distincte des encaissements et créances."
        }
      >
        {party.paidThrough || (zh ? "待核" : "À vérifier")}
      </strong>
    </span>
  );
}

function UnitCardBusiness({ record, locale }: { record: UnitWorkbenchRecord; locale: Locale }) {
  const zh = locale === "zh",
    summary = record.business;
  if (!summary || summary.status !== "ready")
    return (
      <span id={`asset-business-${record.unit.id}`} className={styles.businessUnavailable}>
        {zh ? "客户与收款资料待核" : "Clients et paiements à vérifier"}
      </span>
    );
  return (
    <span id={`asset-business-${record.unit.id}`} className={styles.cardBusiness}>
      {summary.sales.map((party) => (
        <span
          key={`sale:${party.recordId}`}
          className={styles.businessBlock}
          data-unit-sale-record-id={party.recordId}
        >
          <UnitPartyHeading party={party} role="sale" locale={locale} />
          <UnitPartyMoney sale={party} locale={locale} />
        </span>
      ))}
      {summary.leases.map((party) => (
        <span
          key={`lease:${party.recordId}`}
          className={styles.businessBlock}
          data-unit-lease-record-id={party.recordId}
        >
          <UnitPartyHeading party={party} role="lease" locale={locale} />
          <UnitPartyMoney lease={party} locale={locale} />
          <UnitPaidThrough party={party} locale={locale} />
        </span>
      ))}
      {summary.daily.map((party) => (
        <span className={styles.businessBlock} key={`daily:${party.recordId}`}>
          <span className={styles.businessPerson}>
            <span className={styles.personRole}>{zh ? "日租住客" : "Client du séjour"}</span>
            <strong>{party.customerName || (zh ? "姓名待核" : "Identité à vérifier")}</strong>
          </span>
        </span>
      ))}
      {!summary.sales.length && !summary.leases.length && !summary.daily.length ? (
        <span className={styles.businessUnavailable}>
          {zh ? "尚未关联买方或租客" : "Aucun acquéreur ou locataire associé"}
        </span>
      ) : null}
    </span>
  );
}

/** Complete filtered assets are grouped by floor; ownership never substitutes for occupancy. */
export function UnitFloorIndex({
  rows,
  selectedId,
  locale,
  disabled = false,
  buildingName,
  onSelect,
}: {
  rows: UnitWorkbenchRecord[];
  selectedId: string | null;
  locale: Locale;
  disabled?: boolean;
  buildingName?: string;
  onSelect: (record: UnitWorkbenchRecord) => void;
}) {
  const zh = locale === "zh";
  const floorLabel = (record: UnitWorkbenchRecord) =>
    record.unit.floor_label?.trim() || (zh ? "楼层待登记" : "Étage à renseigner");
  const floors = [...new Set(rows.map(floorLabel))].sort(compareFloorLabels);
  return (
    <div className={styles.floorIndex} aria-label={zh ? "楼层资产" : "Actifs par étage"}>
      {floors.map((floor) => (
        <section className={styles.floorGroup} key={floor} aria-label={floor}>
          <header className={styles.floorHeading}>
            <h2>{floor}</h2>
            <span>
              {rows.filter((row) => floorLabel(row) === floor).length} {zh ? "项资产" : "actifs"}
            </span>
          </header>
          <div className={styles.assetCards}>
            {rows
              .filter((row) => floorLabel(row) === floor)
              .sort(
                (a, b) =>
                  a.unit.unit_no.localeCompare(b.unit.unit_no, undefined, { numeric: true }) ||
                  a.unit.id.localeCompare(b.unit.id),
              )
              .map((record) => {
                const { unit, position } = record,
                  warning = attention(record, locale);
                return (
                  <button
                    type="button"
                    key={unit.id}
                    data-unit-card-id={unit.id}
                    className={cn(
                      styles.assetCard,
                      warning && styles.attentionCard,
                      warning?.critical && styles.criticalCard,
                    )}
                    disabled={disabled}
                    aria-label={zh ? `查看资产 ${unit.unit_no}` : `Voir l’actif ${unit.unit_no}`}
                    aria-describedby={`asset-use-${unit.id} asset-business-${unit.id}${warning ? ` asset-attention-${unit.id}` : ""}`}
                    aria-pressed={unit.id === selectedId}
                    data-occupied={!!position?.daily_occupied || !!position?.lease_occupied}
                    data-unknown={unitNeedsVerification(record)}
                    onClick={() => onSelect(record)}
                  >
                    <span className={styles.assetCardHeading}>
                      <span className={styles.cardContext}>
                        {buildingName ? `${buildingName} · ` : ""}
                        {floor}
                      </span>
                      <span className={styles.assetCardMarks}>
                        {position?.ownership === "sold" ? (
                          <small className={styles.soldMark}>{zh ? "已售" : "Vendu"}</small>
                        ) : null}
                        {warning ? (
                          <small
                            id={`asset-attention-${unit.id}`}
                            className={cn(
                              styles.attentionMark,
                              warning.critical && styles.criticalMark,
                            )}
                          >
                            {warning.label}
                          </small>
                        ) : null}
                      </span>
                    </span>
                    <strong className={styles.roomNumber}>{unit.unit_no}</strong>
                    <span id={`asset-use-${unit.id}`} className={styles.assetUse}>
                      {unitOccupancyText(record, locale)}
                    </span>
                    <UnitCardBusiness record={record} locale={locale} />
                    <span className={styles.assetCardFooter}>
                      <span className={styles.detailHint}>
                        {zh ? "查看详情" : "Voir les détails"}
                      </span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
