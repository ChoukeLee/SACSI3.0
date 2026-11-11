"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { RecordDetailTabs } from "@/components/ui/record-detail-tabs";
import { ArrowUpRight, Building2, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { buildWorkbenchRecordHref } from "@/lib/workbench-links";
import type {
  UnitBusinessReceipt,
  UnitLeaseBrief,
  UnitSaleBrief,
} from "./unit-business-summary-model";
import {
  UnitAmountValue,
  UnitPaidThrough,
  UnitPartyHeading,
  unitReviewText,
} from "./unit-workbench-table";
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
  embedded = false,
  onClose,
  onManage,
}: {
  record: UnitWorkbenchRecord | null;
  building: UnitWorkbenchBuilding;
  locale: Locale;
  canEdit: boolean;
  returnTo: string;
  embedded?: boolean;
  onClose: () => void;
  onManage: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const [historyTab, setHistoryTab] = useState("business");
  const tabsId = useId();
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
  const { unit } = record;
  return (
    <aside
      className={embedded ? styles.embeddedInspector : styles.inspector}
      aria-label={zh ? `资产 ${unit.unit_no} 的档案` : `Dossier de ${unit.unit_no}`}
    >
      {!embedded ? (
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
          </p>
        </header>
      ) : null}
      <div className={styles.detailBody}>
        <RecordDetailTabs
          id={tabsId}
          label={zh ? "房间详情" : "Détail de l’actif"}
          items={[
            { value: "overview", label: zh ? "概览" : "Aperçu" },
            { value: "payments", label: zh ? "收付款" : "Paiements" },
            { value: "info", label: zh ? "资料" : "Informations" },
            { value: "history", label: zh ? "历史" : "Historique" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div
          className={styles.inspectorPanel}
          role="tabpanel"
          id={tabsId + "-panel-" + tab}
          aria-labelledby={tabsId + "-tab-" + tab}
          tabIndex={0}
        >
          {tab === "overview" || tab === "payments" ? (
            <UnitCustomerOverview
              record={record}
              building={building}
              locale={locale}
              returnTo={returnTo}
              mode={tab}
              onReceipts={() => setTab("payments")}
            />
          ) : tab === "info" ? (
            <>
              <UnitAssetDetails record={record} building={building} locale={locale} />
              <UnitSourceNotes record={record} locale={locale} />
            </>
          ) : (
            <>
              <div
                className={styles.historyTabs}
                aria-label={zh ? "历史类型" : "Type d’historique"}
              >
                <button
                  type="button"
                  aria-pressed={historyTab === "business"}
                  onClick={() => setHistoryTab("business")}
                >
                  {zh ? "业务记录" : "Dossiers"}
                </button>
                <button
                  type="button"
                  aria-pressed={historyTab === "changes"}
                  onClick={() => setHistoryTab("changes")}
                >
                  {zh ? "变更记录" : "Changements"}
                </button>
              </div>
              {historyTab === "business" ? (
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
            </>
          )}
        </div>
        <details className={styles.inspectorMore}>
          <summary>{zh ? "更多操作" : "Autres opérations"}</summary>
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
        </details>
      </div>
    </aside>
  );
}

function UnitAssetDetails({
  record,
  building,
  locale,
}: {
  record: UnitWorkbenchRecord;
  building: UnitWorkbenchBuilding;
  locale: Locale;
}) {
  const zh = locale === "zh",
    t = dictionaries[locale].units;
  const { unit, position } = record;
  const isCimac = building.project_code === "CIMAC";
  return (
    <>
      <section className={styles.detailSection}>
        <h3>{zh ? "资产资料" : "Informations de l’actif"}</h3>
        <div className={styles.dimensions}>
          <Dimension
            label={zh ? "出售状态" : "Vente"}
            value={
              position?.ownership === "sold"
                ? zh
                  ? "已售"
                  : "Vendu"
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
        <p className={styles.callout}>
          {unitNeedsVerification(record)
            ? zh
              ? "状态待核，不视为空置或可出租。"
              : "État à vérifier ; ne pas considérer comme vacant ou prêt à louer."
            : position?.operational_condition !== "normal"
              ? zh
                ? "运行条件受限，需结合实际情况安排使用。"
                : "État limité ; vérifier la situation avant utilisation."
              : zh
                ? "出售与使用情况分别记录，房款和租金在对应业务明细中核对。"
                : "Vente et occupation sont distinctes ; consultez les paiements dans le dossier concerné."}
        </p>
        <dl className={styles.facts}>
          <Fact
            label={zh ? "面积" : "Surface"}
            value={
              unit.area_sqm == null ? (zh ? "待核对" : "À vérifier") : `${Number(unit.area_sqm)} m²`
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
      <section className={styles.detailSection}>
        <h3>{zh ? "业务配置与标准价" : "Activités et tarifs configurés"}</h3>
        {isCimac ? (
          <p className={styles.note}>
            {zh
              ? "CIMAC 只租不卖；建设交付与租赁状态分别查看。"
              : "CIMAC : location uniquement, sans vente ; livraison et occupation restent distinctes."}
          </p>
        ) : null}
        {!record.flags.some((flag) => building.allows_sale || flag.business_type !== "sale") ? (
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
                    flag.default_price_xof == null ? (
                      zh ? (
                        "未配置价格"
                      ) : (
                        "Tarif non renseigné"
                      )
                    ) : (
                      <UnitAmountValue
                        values={[{ currency: "XOF", amount: flag.default_price_xof }]}
                        locale={locale}
                      />
                    )
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
        <section className={styles.detailSection}>
          <h3>{zh ? "资产备注" : "Notes"}</h3>
          <p className={styles.note}>{unit.notes}</p>
        </section>
      ) : null}
    </>
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
function Fact({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

function HeroMetric({
  label,
  values,
  locale,
  note,
  empty,
  alert = false,
}: {
  label: string;
  values: UnitSaleBrief["received"];
  locale: Locale;
  note: string;
  empty?: string;
  alert?: boolean;
}) {
  return (
    <div className={styles.heroMetric}>
      <span>{label}</span>
      <strong
        className={cn(alert && styles.moneyAlert, (!values || !values.length) && styles.heroState)}
      >
        <UnitAmountValue values={values} locale={locale} empty={empty} />
      </strong>
      <small>{note}</small>
    </div>
  );
}

function PartyHero({
  party,
  role,
  locale,
  today,
}: {
  party: UnitSaleBrief | UnitLeaseBrief;
  role: "sale" | "lease";
  locale: Locale;
  today: string;
}) {
  const zh = locale === "zh";
  if (role === "sale") {
    const sale = party as UnitSaleBrief;
    const knownBalance =
      sale.balance.basis === "verified_bills" ||
      (sale.balance.basis === "registered" && sale.balance.amounts?.length)
        ? sale.balance.amounts
        : null;
    const positive = knownBalance?.some((value) => value.amount > 0);
    const settled = knownBalance !== null && knownBalance.every((value) => value.amount === 0);
    const pendingBalance = sale.pendingBalanceNative?.filter((value) => value.amount > 0) ?? [];
    const showPendingAsBalance = !positive && pendingBalance.length > 0;
    return (
      <>
        {sale.signedDate ? (
          <p className={styles.partyContext}>
            {zh ? "出售登记日" : "Date enregistrée"} {sale.signedDate}
          </p>
        ) : null}
        <div className={styles.heroMetrics}>
          <HeroMetric
            label={
              sale.refundPaid?.length
                ? zh
                  ? "净收房款"
                  : "Prix net encaissé"
                : zh
                  ? "已收房款"
                  : "Prix encaissé"
            }
            values={sale.netReceived === undefined ? sale.received : sale.netReceived}
            locale={locale}
            note={
              sale.refundPaid?.length
                ? zh
                  ? "已扣明确房款退款"
                  : "Après remboursements identifiés du prix"
                : zh
                  ? "实际收款"
                  : "Encaissements réels"
            }
          />
          <HeroMetric
            label={
              showPendingAsBalance
                ? zh
                  ? "登记待收出售款"
                  : "Solde de vente enregistré"
                : zh
                  ? "未收房款"
                  : "Solde du prix"
            }
            values={showPendingAsBalance ? pendingBalance : knownBalance}
            locale={locale}
            alert={!!positive}
            empty={zh ? "本金账单结清" : "Créances du prix du bien soldées"}
            note={
              showPendingAsBalance
                ? zh
                  ? "历史登记余额，含车位等款项"
                  : "Solde historique, pouvant inclure parking et frais"
                : sale.balance.basis === "verified_bills"
                  ? zh
                    ? "已核房款本金账单，不含车位等其他款项"
                    : "Créances vérifiées du prix du bien, hors parking et autres frais"
                  : sale.balance.basis === "registered"
                    ? zh
                      ? "来源登记余款"
                      : "Solde enregistré dans la source"
                    : zh
                      ? "余额依据待核"
                      : "Solde à vérifier"
            }
          />
        </div>
        <div className={styles.totalLine}>
          <span>{zh ? "登记总价" : "Prix enregistré"}</span>
          <strong>
            <UnitAmountValue values={sale.total ? [sale.total] : null} locale={locale} />
          </strong>
        </div>
        {pendingBalance.length > 0 ? (
          <>
            {!showPendingAsBalance ? (
              <div className={styles.totalLine}>
                <span>{zh ? "登记待收出售款" : "Solde de vente enregistré"}</span>
                <strong>
                  <UnitAmountValue values={pendingBalance} locale={locale} />
                </strong>
              </div>
            ) : null}
            <p className={styles.note}>
              {zh
                ? "登记待收与已核房款本金分开列示，未按历史账单日期判断逾期。"
                : "Solde enregistré distinct des créances vérifiées du prix ; les anciennes dates ne déterminent pas un retard."}
            </p>
            {sale.pendingBalanceSources?.length ? (
              <details className={styles.pendingSources}>
                <summary>{zh ? "登记待收依据" : "Justificatifs du solde enregistré"}</summary>
                {sale.pendingBalanceSources.map((source) => (
                  <p key={source.id}>
                    {source.title}
                    {source.notes ? ` · ${source.notes}` : ""}
                  </p>
                ))}
              </details>
            ) : null}
          </>
        ) : null}
        {positive ? (
          <div className={cn(styles.paymentBanner, styles.reviewBanner)}>
            {zh ? "余款待跟进" : "Solde à suivre"}
          </div>
        ) : settled && !pendingBalance.length && sale.balance.basis === "registered" ? (
          <div className={cn(styles.paymentBanner, styles.reviewBanner)}>
            {zh ? "来源登记余款为零。" : "La source indique un solde nul."}
          </div>
        ) : null}
      </>
    );
  }
  const lease = party as UnitLeaseBrief;
  const hasOverdue = !!lease.overdue?.some((value) => value.amount > 0);
  const candidateDate = hasOverdue ? lease.overdueDueDate : lease.nextDue;
  const distance = dayDistance(candidateDate, today);
  const dueDate = distance === null ? null : candidateDate;
  const dueSoon =
    !hasOverdue &&
    lease.dueUnpaid !== null &&
    distance !== null &&
    Number.isInteger(distance) &&
    distance <= 0 &&
    distance >= -15;
  return (
    <>
      <div className={cn(styles.totalLine, styles.monthlyLine)}>
        <span>{zh ? "月租" : "Loyer mensuel"}</span>
        <strong>
          <UnitAmountValue
            values={lease.monthlyRent ? [lease.monthlyRent] : null}
            locale={locale}
          />
        </strong>
      </div>
      <div className={styles.heroMetrics}>
        <HeroMetric
          label={zh ? "累计已收租金" : "Loyers encaissés"}
          values={lease.rentReceived}
          locale={locale}
          note={zh ? "不含押金、中介费" : "Hors dépôts et commissions"}
        />
        <HeroMetric
          label={zh ? "当前到期未收" : "Loyers échus impayés"}
          values={lease.dueUnpaid}
          locale={locale}
          alert={hasOverdue}
          empty={zh ? "无已核到期未收" : "Aucun impayé échu vérifié"}
          note={zh ? "已核租金账单" : "Créances de loyer vérifiées"}
        />
      </div>
      {hasOverdue ? (
        <div className={cn(styles.paymentBanner, styles.overdueBanner)}>
          <span>
            {dueDate ? `${dueDate} ${zh ? "应付" : "échéance"} · ` : ""}
            {distance !== null && Number.isInteger(distance) && distance > 0
              ? zh
                ? `逾期${distance}天`
                : `${distance} jours de retard`
              : zh
                ? "租金逾期"
                : "Loyer en retard"}{" "}
            · {zh ? "需跟进" : "À suivre"}
          </span>
          <strong>
            <UnitAmountValue values={lease.overdue} locale={locale} />
          </strong>
        </div>
      ) : dueSoon ? (
        <div className={cn(styles.paymentBanner, styles.reviewBanner)}>
          {distance === 0
            ? zh
              ? "今日应缴"
              : "Dû aujourd’hui"
            : zh
              ? "15天内应缴"
              : "Dû sous 15 jours"}{" "}
          · {dueDate}
        </div>
      ) : null}
    </>
  );
}

function dayDistance(from: string | null | undefined, to: string) {
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const start = Date.parse(`${from}T00:00:00Z`),
    end = Date.parse(`${to}T00:00:00Z`);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    new Date(start).toISOString().slice(0, 10) !== from ||
    new Date(end).toISOString().slice(0, 10) !== to
  )
    return null;
  return (end - start) / 86400000;
}

function UnitCustomerOverview({
  record,
  building,
  locale,
  returnTo,
  mode,
  onReceipts,
}: {
  record: UnitWorkbenchRecord;
  building: UnitWorkbenchBuilding;
  locale: Locale;
  returnTo: string;
  mode: "overview" | "payments";
  onReceipts: () => void;
}) {
  const zh = locale === "zh",
    summary = record.business;
  if (!summary || summary.status !== "ready")
    return (
      <section className={styles.businessMissing} role="status">
        <h3>{zh ? "客户与收款" : "Clients et paiements"}</h3>
        <p>
          {summary?.status === "unavailable"
            ? zh
              ? "当前客户与收款资料暂不可读取，未显示旧金额或零余额。"
              : "Clients et paiements indisponibles ; anciens montants et faux soldes nuls masqués."
            : zh
              ? "关联客户与收款资料待核，不据资产状态推算款项。"
              : "Clients et paiements à vérifier ; aucun montant déduit du statut de l’actif."}
        </p>
      </section>
    );
  const parties = [
    ...summary.sales.map((party) => ({ role: "sale" as const, party })),
    ...summary.leases.map((party) => ({ role: "lease" as const, party })),
  ];
  return (
    <div className={styles.customerOverview}>
      {parties.map(({ role, party }) => {
        const link = buildWorkbenchRecordHref({
          workspace: role === "sale" ? "sales" : "leases",
          id: party.recordId,
          locale,
          project: building.project_id,
          building: building.id,
          returnTo,
          workArea: building.project_code === "CIMAC" ? "cimac" : "sacsi",
        });
        return (
          <section
            key={role + ":" + party.recordId}
            className={styles.customerSection}
            data-unit-party-record-id={party.recordId}
            aria-label={
              role === "sale"
                ? zh
                  ? "买方与房款"
                  : "Acquéreur et prix du bien"
                : zh
                  ? "租客与租金"
                  : "Locataire et loyers"
            }
          >
            <UnitPartyHeading party={party} role={role} locale={locale} />
            {mode === "overview" ? (
              <>
                <PartyHero party={party} role={role} locale={locale} today={summary.today} />
                {role === "lease" ? (
                  <UnitPaidThrough party={party as UnitLeaseBrief} locale={locale} hero />
                ) : null}
                <div className={styles.auxiliaryGroup}>
                  {(role === "lease"
                    ? [
                        {
                          label: zh ? "另收押金" : "Dépôts reçus",
                          values: (party as UnitLeaseBrief).depositReceived,
                        },
                      ]
                    : []
                  )
                    .concat(
                      role === "sale" && party.refundPaid?.length
                        ? [
                            {
                              label: zh ? "累计房款入款" : "Encaissements bruts du prix",
                              values: (party as UnitSaleBrief).received,
                            },
                          ]
                        : [],
                    )
                    .concat([
                      {
                        label: zh ? "另收中介费" : "Commissions reçues",
                        values: party.agencyReceived,
                      },
                      {
                        label: zh ? "其他收款" : "Autres encaissements",
                        values: party.otherReceived,
                      },
                      {
                        label: zh ? "已退金额" : "Remboursements versés",
                        values: party.refundPaid,
                      },
                    ])
                    .filter((item) => item.values?.length)
                    .map((item) => (
                      <div className={styles.auxiliaryMoney} key={item.label}>
                        <span>{item.label}</span>
                        <strong>
                          <UnitAmountValue values={item.values} locale={locale} />
                        </strong>
                      </div>
                    ))}
                </div>
                {party.reviewReasons.length ? (
                  <p className={styles.callout}>{unitReviewText(party.reviewReasons, locale)}</p>
                ) : null}
                <button type="button" className={styles.overviewAction} onClick={onReceipts}>
                  {zh ? "查看收付款" : "Voir les paiements"}{" "}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <PartyReceipts party={party} role={role} locale={locale} />
                {link ? (
                  <Link href={link} prefetch={false} className={styles.inlineLink}>
                    {role === "sale"
                      ? zh
                        ? "打开出售记录"
                        : "Ouvrir le dossier de vente"
                      : zh
                        ? "打开租赁记录"
                        : "Ouvrir le dossier de location"}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                ) : null}
              </>
            )}
          </section>
        );
      })}
      {mode === "overview"
        ? summary.daily.map((party) => (
            <section className={styles.customerSection} key={"daily:" + party.recordId}>
              <span className={styles.businessPerson}>
                <span className={styles.personRole}>{zh ? "日租住客" : "Client du séjour"}</span>
                <strong>{party.customerName || (zh ? "姓名待核" : "Identité à vérifier")}</strong>
              </span>
              <p className={styles.note}>
                {zh ? "经办" : "Intermédiaire"}：
                {party.agentName || (zh ? "未登记" : "Non renseigné")}
              </p>
              <p className={styles.note}>
                {zh ? "入住" : "Arrivée"} {party.checkIn || "—"} · {zh ? "退房" : "Départ"}{" "}
                {party.checkOut || "—"}
              </p>
            </section>
          ))
        : null}
      {!parties.length && (mode === "payments" || !summary.daily.length) ? (
        <p className={styles.businessUnavailable}>
          {mode === "payments"
            ? zh
              ? "暂无可展示的租售收付款记录。"
              : "Aucun paiement locatif ou de vente à présenter."
            : zh
              ? "尚未关联买方或租客，未推定任何收款。"
              : "Aucun acquéreur ou locataire associé ; aucun encaissement présumé."}
        </p>
      ) : null}
    </div>
  );
}

function UnitSourceNotes({ record, locale }: { record: UnitWorkbenchRecord; locale: Locale }) {
  const zh = locale === "zh",
    summary = record.business;
  if (summary?.status !== "ready") return null;
  const parties = [
    ...summary.sales.map((party) => ({ role: "sale" as const, party })),
    ...summary.leases.map((party) => ({ role: "lease" as const, party })),
  ];
  if (!parties.length) return null;
  return (
    <section className={styles.detailSection}>
      <h3>{zh ? "核对依据" : "Sources et vérification"}</h3>
      {parties.map(({ role, party }) => (
        <div key={role + ":" + party.recordId} className={styles.recordBasis}>
          <UnitPartyHeading party={party} role={role} locale={locale} />
          <p className={styles.note}>
            {role === "sale"
              ? zh
                ? "总价、已录实收和已核账单分别核对；登记余款不自动当作已核应收。"
                : "Prix, encaissements enregistrés et créances sont distincts ; un solde enregistré ne devient pas une créance vérifiée."
              : zh
                ? "租金实收不含押金、中介费和其他收款；登记交至日期不代替实收或账单。"
                : "Les loyers encaissés excluent dépôts, commissions et autres recettes ; la date enregistrée ne remplace ni encaissements ni créances."}
          </p>
          {party.reviewReasons.length ? (
            <p className={styles.callout}>{unitReviewText(party.reviewReasons, locale)}</p>
          ) : null}
          {party.sourceRef ? <p className={styles.sourceReference}>{party.sourceRef}</p> : null}
          {role === "sale" && (party as UnitSaleBrief).balance.sourceRef ? (
            <p className={styles.sourceReference}>{(party as UnitSaleBrief).balance.sourceRef}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function PartyReceipts({
  party,
  role,
  locale,
}: {
  party: UnitSaleBrief | UnitLeaseBrief;
  role: "sale" | "lease";
  locale: Locale;
}) {
  const zh = locale === "zh";
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sourceId = useId();
  const rows = party.recentReceipts.filter(
    (row) => row.role === role && row.recordId === party.recordId && row.unitId === party.unitId,
  );
  const primaryKind = role === "sale" ? "purchase" : "rent";
  const isPrimary = (row: UnitBusinessReceipt) =>
    row.direction === "in" && row.kind === primaryKind;
  const shown = rows.filter(
    (row) => filter === "all" || (filter === "primary" ? isPrimary(row) : !isPrimary(row)),
  );
  const selected = shown.find((row) => row.id === selectedId);
  return (
    <div className={styles.recentReceipts}>
      <div className={styles.receiptsHeading}>
        <h3>{zh ? "收付款记录" : "Mouvements de paiement"}</h3>
        <span>
          {zh
            ? "已录" + party.receiptCount + "笔收付款"
            : party.receiptCount + " mouvements enregistrés"}
        </span>
      </div>
      <div className={styles.receiptFilters} aria-label={zh ? "款项类型" : "Type de mouvement"}>
        {[
          { value: "all", label: zh ? "全部" : "Tous" },
          {
            value: "primary",
            label: role === "sale" ? (zh ? "房款" : "Prix du bien") : zh ? "租金" : "Loyers",
          },
          { value: "other", label: zh ? "其他收支" : "Autres" },
        ].map((item) => (
          <button
            type="button"
            key={item.value}
            aria-pressed={filter === item.value}
            onClick={() => {
              setFilter(item.value);
              setSelectedId(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <table className={styles.receiptTable}>
        <caption className="sr-only">
          {(party.customerName || (zh ? "姓名待核" : "Identité à vérifier")) +
            (zh ? "的近期收付款" : " · paiements récents")}
        </caption>
        <thead>
          <tr>
            <th scope="col">{zh ? "日期" : "Date"}</th>
            <th scope="col">{zh ? "款项" : "Nature"}</th>
            <th scope="col">{zh ? "金额" : "Montant"}</th>
            <th scope="col">{zh ? "依据" : "Source"}</th>
          </tr>
        </thead>
        <tbody>
          {shown.length ? (
            shown.map((row) => (
              <tr key={row.id} data-unit-receipt-id={row.id}>
                <td>
                  <time dateTime={row.date}>{row.date}</time>
                </td>
                <td>{receiptLabel(row, locale)}</td>
                <td className={styles.receiptAmount}>
                  {row.direction === "out" ? "− " : ""}
                  <UnitAmountValue values={[row.amount]} locale={locale} />
                </td>
                <td>
                  {row.sourceRef ? (
                    <button
                      type="button"
                      className={styles.receiptView}
                      aria-expanded={selectedId === row.id}
                      aria-controls={sourceId}
                      aria-label={
                        (zh ? "查看依据 " : "Voir la source ") +
                        row.date +
                        " " +
                        receiptLabel(row, locale)
                      }
                      onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}
                    >
                      {zh ? "查看" : "Voir"}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4}>
                {zh
                  ? "最近记录中未见此类收付款。"
                  : "Aucun mouvement de ce type dans les enregistrements récents."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {selected ? (
        <div
          className={styles.receiptEvidence}
          id={sourceId}
          role="region"
          aria-label={zh ? "收付款依据" : "Source du paiement"}
        >
          <span>
            {selected.date} · {receiptLabel(selected, locale)}
          </span>
          <p>{selected.sourceRef}</p>
        </div>
      ) : null}
      {party.receiptCount > party.recentReceipts.length ? (
        <p className={styles.receiptLimit}>
          {zh
            ? "这里只列最近记录，全部流水见对应业务收支明细。"
            : "Seuls les mouvements récents sont présentés ; consultez les paiements du dossier pour la liste complète."}
        </p>
      ) : null}
    </div>
  );
}

function receiptLabel(receipt: UnitBusinessReceipt, locale: Locale) {
  const zh = locale === "zh";
  if (receipt.kind === "purchase") return zh ? "房款" : "Prix du bien";
  if (receipt.kind === "rent") return zh ? "租金" : "Loyer";
  if (receipt.kind === "deposit")
    return receipt.direction === "out"
      ? zh
        ? "押金退还"
        : "Dépôt remboursé"
      : zh
        ? "押金"
        : "Dépôt";
  if (receipt.kind === "agency")
    return receipt.direction === "out"
      ? zh
        ? "中介费支出"
        : "Commission versée"
      : zh
        ? "中介费收款"
        : "Commission reçue";
  if (receipt.kind === "refund") return zh ? "退款" : "Remboursement";
  return receipt.direction === "out"
    ? zh
      ? "其他支出"
      : "Autre décaissement"
    : zh
      ? "其他收款"
      : "Autre encaissement";
}
