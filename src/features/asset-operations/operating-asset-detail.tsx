"use client";

import { useId, useState } from "react";
import { RightDrawer } from "@/components/ui/operational";
import { RecordDetailTabs } from "@/components/ui/record-detail-tabs";
import type { Locale } from "@/lib/i18n";
import { formatPropertyMoney, formatPropertyXof } from "@/lib/property-money";
import { assetReportPeriod, assetSourceLabel, isAssetDate } from "./asset-operations-model";
import {
  hasOperatingAssetLeaseEvidence,
  summarizeOperatingAssetCash,
  type OperatingAssetDirectoryAsset,
  type OperatingAssetDirectoryEntry,
  type OperatingAssetFollowUp,
} from "./operating-asset-directory-model";
import {
  followUpLabels,
  followUpReasons,
  operatingAssetCategoryLabel,
  recordedTenant,
  referenceRent,
} from "./operating-asset-display";
import styles from "./operating-asset-directory.module.css";
import drawerStyles from "./operating-asset-detail.module.css";

type CashSummary = ReturnType<typeof summarizeOperatingAssetCash>;
type CashLine = NonNullable<CashSummary["bookedXof"]>;

const receiptKindLabels: Record<OperatingAssetDirectoryEntry["kind"], [string, string]> = {
  income: ["经营收款", "Encaissement"],
  expense: ["经营支出", "Décaissement"],
  deposit_in: ["押金收取", "Dépôt reçu"],
  deposit_out: ["押金退还", "Dépôt remboursé"],
};

const receiptCategoryLabels: Partial<
  Record<NonNullable<OperatingAssetDirectoryEntry["category"]>, [string, string]>
> = {
  rent: ["租金", "Loyer"],
  property_fee: ["物业费", "Charges immobilières"],
  maintenance: ["维修", "Entretien"],
  utilities: ["水电", "Eau et électricité"],
  cleaning: ["保洁", "Nettoyage"],
  security: ["安保", "Sécurité"],
  payroll: ["工资", "Salaires"],
  tax: ["税费", "Taxes"],
  commission: ["佣金", "Commission"],
  insurance: ["保险", "Assurance"],
  other: ["其他", "Autres"],
};

const entryStatusLabels: Record<OperatingAssetDirectoryEntry["status"], [string, string]> = {
  pending: ["待核", "À vérifier"],
  verified: ["已确认", "Confirmé"],
  voided: ["已作废", "Annulé"],
};

function AssetCashSummary({
  cash,
  locale,
  onShowEntries,
  historicalPending,
}: {
  cash: CashSummary;
  locale: Locale;
  onShowEntries: () => void;
  historicalPending: number;
}) {
  const zh = locale === "zh";
  const hasOperatingCash = cash.originals.some(({ income, expense }) => income > 0 || expense > 0);
  const hasIncome = cash.originals.some(({ income }) => income > 0);
  const hasExpense = cash.originals.some(({ expense }) => expense > 0);
  const hasDeposits = cash.originals.some(
    ({ depositIn, depositOut }) => depositIn > 0 || depositOut > 0,
  );

  function cashFacts(values: CashLine, format: (value: number) => string) {
    return (
      <dl className={styles.cashFacts}>
        <div>
          <dt>{zh ? "已核实收" : "Encaissements vérifiés"}</dt>
          <dd>{values.income > 0 ? format(values.income) : "—"}</dd>
        </div>
        <div>
          <dt>{zh ? "已核支出" : "Décaissements vérifiés"}</dt>
          <dd>{values.expense > 0 ? format(values.expense) : "—"}</dd>
        </div>
        <div>
          <dt>{zh ? "已核现金净额" : "Solde net vérifié"}</dt>
          <dd>{values.income > 0 || values.expense > 0 ? format(values.net) : "—"}</dd>
        </div>
      </dl>
    );
  }

  return (
    <>
      <section className={styles.detailSection}>
        <h3>{zh ? "经营现金" : "Trésorerie d’exploitation"}</h3>
        {hasOperatingCash ? (
          <p className={styles.note}>
            {zh
              ? "仅汇总期间内按收付日期已核实的经营流水。现金净额不含押金，费用资料可能尚未齐全。"
              : "Seuls les flux d’exploitation vérifiés à la date de paiement sont agrégés. Le solde exclut les dépôts et les charges peuvent être incomplètes."}
          </p>
        ) : null}
        <div className={styles.cashBasis}>
          <h4>{zh ? "原币实收与支出" : "Encaissements et décaissements en devise d’origine"}</h4>
          {hasOperatingCash ? (
            cash.originals
              .filter(({ income, expense }) => income > 0 || expense > 0)
              .map((values) => (
                <div key={values.currency} className={styles.currencyBlock}>
                  <p>{values.currency}</p>
                  {cashFacts(values, (value) =>
                    formatPropertyMoney(value, values.currency, locale),
                  )}
                </div>
              ))
          ) : (
            <p className={styles.note}>
              {zh
                ? "本期暂无已核经营实收或支出，现金净额待有流水后汇总。"
                : "Aucun encaissement ni décaissement d’exploitation vérifié sur cette période."}
            </p>
          )}
        </div>
        <div className={styles.cashBasis}>
          <h4>{zh ? "西法记账额" : "Montants comptabilisés en XOF"}</h4>
          {cash.bookedXof && (cash.bookedXof.income > 0 || cash.bookedXof.expense > 0) ? (
            cashFacts(cash.bookedXof, (value) => formatPropertyXof(value, locale))
          ) : (
            <p className={styles.note}>
              {zh
                ? "本期暂无已核经营记账额。"
                : "Aucun montant d’exploitation comptabilisé sur cette période."}
            </p>
          )}
          {cash.missingBookedXofCount > 0 ? (
            <p className={styles.note}>
              {zh
                ? `有 ${cash.missingBookedXofCount} 笔已核流水缺少西法记账额，记账汇总仅涵盖已有金额。`
                : `${cash.missingBookedXofCount} flux vérifiés sans montant comptabilisé en XOF. Le total couvre les montants disponibles.`}
            </p>
          ) : null}
        </div>
        {hasOperatingCash && (!hasIncome || !hasExpense) ? (
          <p className={styles.note}>
            {!hasIncome
              ? zh
                ? "本期暂无已核经营实收。"
                : "Aucun encaissement d’exploitation vérifié sur cette période."
              : zh
                ? "本期暂无已核经营支出。"
                : "Aucun décaissement d’exploitation vérifié sur cette période."}
          </p>
        ) : null}
      </section>
      {hasDeposits ? (
        <section className={styles.detailSection}>
          <h3>{zh ? "押金" : "Dépôts"}</h3>
          <dl className={styles.depositFacts}>
            {cash.originals
              .filter(({ depositIn, depositOut }) => depositIn > 0 || depositOut > 0)
              .map(({ currency, depositIn, depositOut }) => (
                <div key={currency}>
                  <dt>{zh ? `原币 ${currency}` : `Devise ${currency}`}</dt>
                  <dd>
                    {zh ? "收取" : "Reçus"}{" "}
                    {depositIn > 0 ? formatPropertyMoney(depositIn, currency, locale) : "—"}
                    {" · "}
                    {zh ? "退还" : "Remboursés"}{" "}
                    {depositOut > 0 ? formatPropertyMoney(depositOut, currency, locale) : "—"}
                  </dd>
                </div>
              ))}
            {cash.bookedXof && (cash.bookedXof.depositIn > 0 || cash.bookedXof.depositOut > 0) ? (
              <div>
                <dt>{zh ? "西法记账额" : "Comptabilisés en XOF"}</dt>
                <dd>
                  {zh ? "收取" : "Reçus"}{" "}
                  {cash.bookedXof.depositIn > 0
                    ? formatPropertyXof(cash.bookedXof.depositIn, locale)
                    : "—"}
                  {" · "}
                  {zh ? "退还" : "Remboursés"}{" "}
                  {cash.bookedXof.depositOut > 0
                    ? formatPropertyXof(cash.bookedXof.depositOut, locale)
                    : "—"}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
      {historicalPending > 0 ? (
        <section className={styles.detailSection}>
          <h3>{zh ? "来源待核" : "Sources à vérifier"}</h3>
          <p className={styles.note}>
            {zh
              ? `本期 ${cash.pendingEntryCount} 笔，全部历史 ${historicalPending} 笔。待核流水单独保留。`
              : `${cash.pendingEntryCount} sur cette période, ${historicalPending} au total. Les flux à vérifier restent séparés.`}
          </p>
          <button type="button" className={styles.textButton} onClick={onShowEntries}>
            {zh ? "查看待核流水" : "Voir les flux à vérifier"}
          </button>
        </section>
      ) : null}
    </>
  );
}

function AssetReceiptList({
  entries,
  locale,
  pendingOnly,
  setPendingOnly,
}: {
  entries: OperatingAssetDirectoryEntry[];
  locale: Locale;
  pendingOnly: boolean;
  setPendingOnly: (value: boolean) => void;
}) {
  const zh = locale === "zh";
  const visible = pendingOnly ? entries.filter((entry) => entry.status === "pending") : entries;
  return (
    <>
      <div className={styles.receiptFilters} aria-label={zh ? "流水筛选" : "Filtrer les flux"}>
        <button type="button" aria-pressed={!pendingOnly} onClick={() => setPendingOnly(false)}>
          {zh ? "全部历史" : "Tout l’historique"}
        </button>
        <button type="button" aria-pressed={pendingOnly} onClick={() => setPendingOnly(true)}>
          {zh ? "待核流水" : "Flux à vérifier"}
        </button>
      </div>
      {visible.length ? (
        <ul className={styles.receipts}>
          {visible.map((entry) => {
            const category = entry.category && receiptCategoryLabels[entry.category];
            return (
              <li key={entry.id}>
                <div className={styles.receiptHeader}>
                  <span>
                    {receiptKindLabels[entry.kind][zh ? 0 : 1]}
                    {category ? ` · ${category[zh ? 0 : 1]}` : ""}
                  </span>
                  <span className={styles.status} data-status={entry.status}>
                    {entryStatusLabels[entry.status][zh ? 0 : 1]}
                  </span>
                </div>
                <dl className={styles.receiptFacts}>
                  <div>
                    <dt>{zh ? "收付日期" : "Date de paiement"}</dt>
                    <dd>{entry.cashDate ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{zh ? "原币金额" : "Montant d’origine"}</dt>
                    <dd>{formatPropertyMoney(entry.amountNative, entry.currency, locale)}</dd>
                  </div>
                  <div>
                    <dt>{zh ? "西法记账额" : "Montant comptabilisé en XOF"}</dt>
                    <dd>
                      {entry.bookedAmountXof === null
                        ? zh
                          ? "未登记"
                          : "Non renseigné"
                        : formatPropertyXof(entry.bookedAmountXof, locale)}
                    </dd>
                  </div>
                </dl>
                {entry.periodStart && entry.periodEnd ? (
                  <p className={styles.note}>
                    {zh ? "记录期间" : "Période inscrite"} {entry.periodStart} — {entry.periodEnd}
                  </p>
                ) : null}
                {entry.description || entry.voidReason ? (
                  <details className={styles.source}>
                    <summary title={entry.sourceRef}>{assetSourceLabel(entry.sourceRef)}</summary>
                    {entry.description ? <p>{entry.description}</p> : null}
                    {entry.voidReason ? (
                      <p>
                        {zh ? "作废原因" : "Motif d’annulation"} · {entry.voidReason}
                      </p>
                    ) : null}
                  </details>
                ) : (
                  <p className={styles.source} title={entry.sourceRef}>
                    {assetSourceLabel(entry.sourceRef)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.note}>
          {pendingOnly
            ? zh
              ? "暂无待核流水。"
              : "Aucun flux à vérifier."
            : zh
              ? "暂无收付款流水。"
              : "Aucun flux enregistré."}
        </p>
      )}
    </>
  );
}

function AssetLeaseHistory({
  entries,
  tenant,
  today,
  locale,
  onShowEntries,
}: {
  entries: OperatingAssetDirectoryEntry[];
  tenant: ReturnType<typeof recordedTenant>;
  today: string;
  locale: Locale;
  onShowEntries: () => void;
}) {
  const zh = locale === "zh";
  const periods = entries
    .filter(
      (entry) =>
        entry.status === "verified" &&
        !entry.voidedAt &&
        entry.kind === "income" &&
        entry.category === "rent" &&
        entry.sourceRef.trim() &&
        isAssetDate(entry.cashDate) &&
        entry.cashDate <= today &&
        isAssetDate(entry.periodStart) &&
        isAssetDate(entry.periodEnd) &&
        entry.periodStart <= entry.periodEnd &&
        entry.periodEnd < today,
    )
    .sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""));
  const historicalTenant = tenant?.evidence.classification === "historical" ? tenant : null;

  return (
    <section className={styles.detailSection}>
      <h3>{zh ? "历史租赁依据" : "Justificatifs historiques"}</h3>
      {historicalTenant ? (
        <dl className={styles.depositFacts}>
          <div>
            <dt>{historicalTenant.label}</dt>
            <dd>{historicalTenant.names}</dd>
          </div>
          {historicalTenant.evidence.asOfSourceDate ? (
            <div>
              <dt>{zh ? "租户记录日期" : "Date d’enregistrement du locataire"}</dt>
              <dd>{historicalTenant.evidence.asOfSourceDate}</dd>
            </div>
          ) : null}
          <div>
            <dt>{zh ? "租户依据" : "Source du locataire"}</dt>
            <dd>{assetSourceLabel(historicalTenant.evidence.sourceRef)}</dd>
          </div>
        </dl>
      ) : null}
      {periods.length ? (
        <>
          <p className={styles.note}>
            {zh
              ? "以下是已确认租金流水记录的期间。已交至见概览，租户归属以各笔原始依据为准。"
              : "Périodes indiquées par les mouvements de loyer confirmés. Consultez l’aperçu pour la date de couverture et les justificatifs pour identifier le locataire."}
          </p>
          <ul className={styles.receipts}>
            {periods.map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.periodStart} — {entry.periodEnd}
                </span>
                <span className={styles.source} title={entry.sourceRef}>
                  {assetSourceLabel(entry.sourceRef)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.note}>
          {zh
            ? "暂无带有明确期间的已确认历史租金流水。"
            : "Aucun mouvement de loyer historique confirmé avec période renseignée."}
        </p>
      )}
      <button type="button" className={styles.textButton} onClick={onShowEntries}>
        {zh ? "查看收付款" : "Voir les paiements"}
      </button>
    </section>
  );
}

export function OperatingAssetDetail({
  asset,
  entries,
  followUp,
  today,
  locale,
  leaseView = false,
  onClose,
}: {
  asset: OperatingAssetDirectoryAsset;
  entries: OperatingAssetDirectoryEntry[];
  followUp: OperatingAssetFollowUp;
  today: string;
  locale: Locale;
  leaseView?: boolean;
  onClose: () => void;
}) {
  const zh = locale === "zh";
  const lang = zh ? 0 : 1;
  const id = useId();
  const [tab, setTab] = useState("overview");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [pendingOnly, setPendingOnly] = useState(false);
  const period = assetReportPeriod("month", month);
  const cash = summarizeOperatingAssetCash([asset], entries, period);
  const historicalPending = entries.filter((entry) => entry.status === "pending").length;
  const coverage = followUp.paidThrough;
  const rentCoverage = coverage
    ? `${zh ? "租金来源记载至" : "Loyer documenté jusqu’au"} ${coverage.date} · ${entryStatusLabels[coverage.status][lang]}`
    : null;
  const rent = referenceRent(asset, locale);
  const tenant = recordedTenant(asset, locale);
  const leaseListed = hasOperatingAssetLeaseEvidence(asset, entries);
  const rentCash = summarizeOperatingAssetCash(
    [asset],
    entries.filter(
      (entry) =>
        entry.kind === "income" &&
        entry.category === "rent" &&
        isAssetDate(entry.cashDate) &&
        entry.cashDate <= today,
    ),
  );
  const attention =
    leaseListed && followUp.status !== "current"
      ? followUp.status === "upcoming" && followUp.daysUntilDue === 0
        ? zh
          ? "今日应缴"
          : "Dû aujourd’hui"
        : followUpLabels[followUp.status][lang]
      : null;
  const outstanding = followUp.outstanding;
  const tabs = [
    { value: "overview", label: zh ? "概览" : "Aperçu" },
    { value: "receipts", label: zh ? "收付款" : "Paiements" },
    {
      value: "sources",
      label: zh
        ? leaseView
          ? "资产档案"
          : "资料"
        : leaseView
          ? "Fiche de l’actif"
          : "Informations",
    },
    { value: "history", label: zh ? "历史" : "Historique" },
  ];
  const showReceipts = (pending: boolean) => {
    setPendingOnly(pending);
    setTab("receipts");
    document.getElementById(`${id}-tab-receipts`)?.focus();
  };

  return (
    <RightDrawer
      open
      width="wide"
      title={asset.displayName}
      subtitle={leaseView ? undefined : operatingAssetCategoryLabel(asset.category, locale)}
      onClose={onClose}
    >
      <RecordDetailTabs
        id={id}
        label={zh ? "经营资产详情" : "Détail de l’actif d’exploitation"}
        items={tabs}
        value={tab}
        onChange={setTab}
      />
      <div
        className={styles.detailPanel}
        id={`${id}-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "overview" ? (
          <>
            <section className={styles.detailSection}>
              <dl className={drawerStyles.party}>
                <div>
                  <dt>{tenant?.label ?? (zh ? "登记租户" : "Locataire enregistré")}</dt>
                  <dd>{tenant?.names ?? (zh ? "未登记" : "Non renseigné")}</dd>
                </div>
              </dl>
              <dl className={styles.depositFacts}>
                <div>
                  <dt>{rent.label}</dt>
                  <dd>{rent.amount}</dd>
                </div>
              </dl>
              <dl className={drawerStyles.rentSummary}>
                <div>
                  <dt>{zh ? "累计已收租金（按资产）" : "Loyers reçus cumulés (actif)"}</dt>
                  <dd>
                    {rentCash.originals.length
                      ? rentCash.originals
                          .map(({ income, currency }) =>
                            formatPropertyMoney(income, currency, locale),
                          )
                          .join(" · ")
                      : zh
                        ? "暂无已确认流水"
                        : "Aucun flux confirmé"}
                  </dd>
                </div>
                <div>
                  <dt>{zh ? "原表登记未收" : "Solde enregistré dans la source"}</dt>
                  <dd title={outstanding ? assetSourceLabel(outstanding.sourceRef) : undefined}>
                    {outstanding
                      ? formatPropertyMoney(outstanding.amountNative, outstanding.currency, locale)
                      : zh
                        ? "未登记"
                        : "Non renseigné"}
                  </dd>
                </div>
              </dl>
              {attention ? (
                <p className={drawerStyles.attention} data-status={followUp.status}>
                  {attention}
                  {followUp.reason ? ` · ${followUpReasons[followUp.reason][lang]}` : ""}
                </p>
              ) : null}
              {coverage && rentCoverage ? (
                <p className={styles.note} title={assetSourceLabel(coverage.sourceRef)}>
                  {rentCoverage}
                </p>
              ) : leaseListed ? (
                <p className={styles.note}>
                  {zh ? "租金已交至未登记" : "Date de couverture du loyer non renseignée"}
                </p>
              ) : null}
              {followUp.dueDate ? (
                <p className={styles.note}>
                  {zh ? "登记付款日" : "Échéance enregistrée"} {followUp.dueDate}
                </p>
              ) : null}
              <button
                type="button"
                className={styles.textButton}
                onClick={() => showReceipts(false)}
              >
                {zh ? "查看收付款" : "Voir les paiements"}
              </button>
            </section>
            <div className={styles.periodPicker}>
              <label>
                {zh ? "收付月份" : "Mois des flux"}
                <input
                  type="month"
                  value={month}
                  max={today.slice(0, 7)}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (isAssetDate(`${next}-01`) && next <= today.slice(0, 7)) setMonth(next);
                  }}
                />
              </label>
              <span>
                {period.start} — {period.end}
              </span>
            </div>
            <AssetCashSummary
              cash={cash}
              locale={locale}
              historicalPending={historicalPending}
              onShowEntries={() => showReceipts(true)}
            />
          </>
        ) : null}
        {tab === "receipts" ? (
          <AssetReceiptList
            entries={entries}
            locale={locale}
            pendingOnly={pendingOnly}
            setPendingOnly={setPendingOnly}
          />
        ) : null}
        {tab === "sources" ? (
          <section className={styles.detailSection}>
            <h3>{zh ? "资产登记" : "Fiche de l’actif"}</h3>
            <dl className={styles.depositFacts}>
              {leaseView ? (
                <div>
                  <dt>{zh ? "物业类型" : "Type de bien"}</dt>
                  <dd>{operatingAssetCategoryLabel(asset.category, locale)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{zh ? "登记状态" : "État de vérification"}</dt>
                <dd>
                  {asset.verification === "verified"
                    ? zh
                      ? "已核实"
                      : "Vérifié"
                    : entryStatusLabels.pending[zh ? 0 : 1]}
                </dd>
              </div>
              <div>
                <dt>{rent.label}</dt>
                <dd>{rent.amount}</dd>
              </div>
              {tenant ? (
                <>
                  <div>
                    <dt>{tenant.label}</dt>
                    <dd>{tenant.names}</dd>
                  </div>
                  {tenant.evidence.asOfSourceDate ? (
                    <div>
                      <dt>{zh ? "租户记录日期" : "Date d’enregistrement du locataire"}</dt>
                      <dd>{tenant.evidence.asOfSourceDate}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{zh ? "租户依据" : "Source du locataire"}</dt>
                    <dd>{assetSourceLabel(tenant.evidence.sourceRef)}</dd>
                  </div>
                </>
              ) : null}
              {asset.referenceRent?.effectiveThrough ? (
                <div>
                  <dt>{zh ? "该租金适用至" : "Loyer applicable jusqu’au"}</dt>
                  <dd>{asset.referenceRent.effectiveThrough}</dd>
                </div>
              ) : null}
              {asset.referenceRent?.sourceRef ? (
                <div>
                  <dt>{zh ? "租金依据" : "Source du loyer"}</dt>
                  <dd>{assetSourceLabel(asset.referenceRent.sourceRef)}</dd>
                </div>
              ) : null}
              {coverage ? (
                <div>
                  <dt>{zh ? "覆盖日期依据" : "Source de la couverture"}</dt>
                  <dd>{assetSourceLabel(coverage.sourceRef)}</dd>
                </div>
              ) : null}
              {followUp.dueSourceRef ? (
                <div>
                  <dt>{zh ? "付款日依据" : "Source de l’échéance"}</dt>
                  <dd>{assetSourceLabel(followUp.dueSourceRef)}</dd>
                </div>
              ) : null}
              {followUp.outstanding ? (
                <div>
                  <dt>{zh ? "原表余款依据" : "Source du solde enregistré"}</dt>
                  <dd>{assetSourceLabel(followUp.outstanding.sourceRef)}</dd>
                </div>
              ) : null}
            </dl>
            {asset.leaseEvidence?.notes?.length ? (
              <ul className={styles.assetSources}>
                {asset.leaseEvidence.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
            {asset.sourceRefs.length ? (
              <ul className={styles.assetSources}>
                {asset.sourceRefs.map((source) => (
                  <li key={source} title={source}>
                    {assetSourceLabel(source)}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
        {tab === "history" ? (
          <AssetLeaseHistory
            entries={entries}
            tenant={asset.verification === "verified" ? tenant : null}
            today={today}
            locale={locale}
            onShowEntries={() => showReceipts(false)}
          />
        ) : null}
      </div>
    </RightDrawer>
  );
}
