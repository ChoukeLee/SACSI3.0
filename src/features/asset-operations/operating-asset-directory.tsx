"use client";

import { useId, useMemo, useState } from "react";
import { ArrowRight, CalendarClock, Search } from "lucide-react";
import { RightDrawer } from "@/components/ui/operational";
import { RecordDetailTabs } from "@/components/ui/record-detail-tabs";
import { formatPropertyMoney, formatPropertyXof } from "@/lib/property-money";
import { assetReportPeriod, assetSourceLabel, isAssetDate } from "./asset-operations-model";
import {
  getOperatingAssetFollowUp,
  hasOperatingAssetLeaseEvidence,
  summarizeOperatingAssetCash,
  type buildOperatingAssetDirectory,
  type OperatingAssetCategory,
  type OperatingAssetDirectoryAsset,
  type OperatingAssetDirectoryEntry,
} from "./operating-asset-directory-model";
import styles from "./operating-asset-directory.module.css";

type Locale = "zh" | "fr";
type CashSummary = ReturnType<typeof summarizeOperatingAssetCash>;
type CashLine = NonNullable<CashSummary["bookedXof"]>;
type FollowUp = ReturnType<typeof getOperatingAssetFollowUp>;
type FollowUpStatus = Exclude<FollowUp["status"], "current">;
type FollowUpFilter = "all" | FollowUpStatus;
type DirectoryRow = {
  asset: OperatingAssetDirectoryAsset;
  entries: OperatingAssetDirectoryEntry[];
  followUp: FollowUp;
};
type CollectionRow = DirectoryRow & { followUp: FollowUp & { status: FollowUpStatus } };

const categoryLabels: Record<OperatingAssetCategory, [string, string]> = {
  warehouse: ["仓库", "Entrepôts"],
  factory: ["厂房", "Usines"],
  commercial: ["商铺及营业场所", "Commerces"],
  land: ["土地及场地", "Terrains"],
  office: ["办公室", "Bureaux"],
  dormitory: ["宿舍", "Dortoirs"],
  other: ["其他经营资产", "Autres actifs d’exploitation"],
};

function operatingAssetCategoryLabel(category: OperatingAssetCategory, locale: Locale) {
  return categoryLabels[category][locale === "zh" ? 0 : 1];
}

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

const emptyEntries: OperatingAssetDirectoryEntry[] = [];

const rentLabels = {
  month: ["参考月租", "Loyer mensuel indicatif"],
  quarter: ["季租", "Loyer trimestriel"],
  year: ["年租", "Loyer annuel"],
} as const;

const followUpLabels: Record<FollowUpFilter, [string, string]> = {
  all: ["全部跟进", "Tous les suivis"],
  overdue: ["已逾期", "En retard"],
  upcoming: ["15天内应缴", "Dû sous 15 jours"],
  needs_evidence: ["待补资料", "Données à compléter"],
};

const followUpReasons: Record<NonNullable<FollowUp["reason"]>, [string, string]> = {
  due_date_missing: ["付款日未登记", "Date d’échéance non renseignée"],
  paid_through_missing: ["已交至未登记", "Date de couverture non renseignée"],
  unpaid_unconfirmed: ["未收金额待确认", "Solde à confirmer"],
  coverage_ended: ["已登记的租金覆盖已结束", "Période de loyer enregistrée terminée"],
  coverage_ending: ["已登记的租金覆盖即将结束", "Fin prochaine de la période enregistrée"],
  source_conflict: ["来源记录需核对", "Sources à rapprocher"],
};

const followUpPriority: Record<FollowUp["status"], number> = {
  overdue: 0,
  upcoming: 1,
  needs_evidence: 2,
  current: 3,
};

const nameCollators = {
  zh: new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" }),
  fr: new Intl.Collator("fr", { numeric: true, sensitivity: "base" }),
};

function referenceRent(asset: OperatingAssetDirectoryAsset, locale: Locale) {
  const zh = locale === "zh";
  const rent = asset.referenceRent;
  return {
    label: rentLabels[rent?.period ?? "month"][zh ? 0 : 1],
    amount: rent
      ? formatPropertyMoney(rent.amountNative, rent.currency, locale)
      : zh
        ? "未登记"
        : "Non renseigné",
  };
}

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

function OperatingAssetDetail({
  asset,
  entries,
  followUp,
  today,
  locale,
  onClose,
}: {
  asset: OperatingAssetDirectoryAsset;
  entries: OperatingAssetDirectoryEntry[];
  followUp: FollowUp;
  today: string;
  locale: Locale;
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
  const tabs = [
    { value: "overview", label: zh ? "概览" : "Aperçu" },
    { value: "receipts", label: zh ? "收付款" : "Flux" },
    { value: "sources", label: zh ? "资料" : "Informations" },
  ];

  return (
    <RightDrawer
      open
      width="wide"
      title={asset.displayName}
      subtitle={operatingAssetCategoryLabel(asset.category, locale)}
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
            {coverage && rentCoverage ? (
              <p className={styles.note} title={assetSourceLabel(coverage.sourceRef)}>
                {rentCoverage}
              </p>
            ) : null}
            {followUp.dueDate ? (
              <p className={styles.note}>
                {zh ? "登记付款日" : "Échéance enregistrée"} {followUp.dueDate}
              </p>
            ) : null}
            <AssetCashSummary
              cash={cash}
              locale={locale}
              historicalPending={historicalPending}
              onShowEntries={() => {
                setPendingOnly(true);
                setTab("receipts");
                document.getElementById(`${id}-tab-receipts`)?.focus();
              }}
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
      </div>
    </RightDrawer>
  );
}

interface OperatingAssetDirectoryProps {
  locale: Locale;
  data: ReturnType<typeof buildOperatingAssetDirectory>;
  today: string;
  category: OperatingAssetCategory | "all";
  selectedAssetId?: string | null;
  enableCollections?: boolean;
  initialView?: "cards" | "collections";
}

export function OperatingAssetDirectory(props: OperatingAssetDirectoryProps) {
  return (
    <OperatingAssetDirectoryView
      key={JSON.stringify([
        props.data.projectId,
        props.category,
        props.selectedAssetId,
        props.initialView,
      ])}
      {...props}
    />
  );
}

function OperatingAssetDirectoryView({
  locale,
  data,
  today,
  category,
  selectedAssetId,
  enableCollections = false,
  initialView = "cards",
}: OperatingAssetDirectoryProps) {
  const zh = locale === "zh";
  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [view, setView] = useState(initialView);
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>("all");
  const [selectedId, setSelectedId] = useState(selectedAssetId ?? null);
  const entriesByAsset = useMemo(() => {
    const grouped = new Map<string, OperatingAssetDirectoryEntry[]>();
    for (const entry of data.entries) {
      const entries = grouped.get(entry.assetId);
      if (entries) entries.push(entry);
      else grouped.set(entry.assetId, [entry]);
    }
    for (const entries of grouped.values()) {
      entries.sort(
        (a, b) =>
          (b.cashDate ?? b.periodStart ?? "").localeCompare(a.cashDate ?? a.periodStart ?? "") ||
          a.id.localeCompare(b.id),
      );
    }
    return grouped;
  }, [data.entries]);
  const rows = useMemo(() => {
    const scoped = data.assets
      .filter((asset) => category === "all" || asset.category === category)
      .map((asset): DirectoryRow => {
        const entries = entriesByAsset.get(asset.id) ?? emptyEntries;
        return { asset, entries, followUp: getOperatingAssetFollowUp(asset, entries, today) };
      });
    if (category !== "all") {
      const warehouseOrder = new Map([
        ["老仓库", 0],
        ["新仓库", 1],
        ["孵化园库房", 2],
      ]);
      scoped.sort((a, b) => {
        const groupOrder =
          category === "warehouse"
            ? (warehouseOrder.get(a.asset.displayGroup) ?? 3) -
              (warehouseOrder.get(b.asset.displayGroup) ?? 3)
            : 0;
        return (
          groupOrder || nameCollators[locale].compare(a.asset.displayName, b.asset.displayName)
        );
      });
    }
    return scoped;
  }, [category, data.assets, entriesByAsset, locale, today]);
  const showCollections = enableCollections && view === "collections";
  const thisMonth = assetReportPeriod("month", today.slice(0, 7));
  const term = search.trim().toLocaleLowerCase();
  const groupOptions = new Map<string, string>();
  for (const { asset } of rows) {
    if (category === "all" && showCollections) {
      groupOptions.set(asset.category, operatingAssetCategoryLabel(asset.category, locale));
    } else if (category !== "all" && asset.displayGroup) {
      groupOptions.set(asset.displayGroup, asset.displayGroup);
    }
  }
  const visible = rows.filter(
    ({ asset }) =>
      (!groupOptions.has(selectedGroup) ||
        (category === "all" ? asset.category : asset.displayGroup) === selectedGroup) &&
      [asset.displayName, asset.name, asset.code, asset.displayGroup].some((value) =>
        value.toLocaleLowerCase().includes(term),
      ),
  );
  const groups = new Map<string, DirectoryRow[]>();
  for (const row of visible) {
    const label =
      category === "all"
        ? operatingAssetCategoryLabel(row.asset.category, locale)
        : row.asset.displayGroup || operatingAssetCategoryLabel(category, locale);
    const group = groups.get(label);
    if (group) group.push(row);
    else groups.set(label, [row]);
  }
  const collectionRows = enableCollections
    ? visible.filter(
        (row): row is CollectionRow =>
          row.followUp.status !== "current" &&
          hasOperatingAssetLeaseEvidence(row.asset, row.entries),
      )
    : [];
  const selected = rows.find(({ asset }) => asset.id === selectedId);

  return (
    <section
      className={styles.directory}
      aria-label={zh ? "经营资产目录" : "Répertoire des actifs"}
    >
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={zh ? "搜索经营资产" : "Rechercher un actif"}
            placeholder={zh ? "搜索名称或编号" : "Nom ou numéro"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <span className={styles.note}>
          {zh ? `${visible.length} 项资产` : `${visible.length} actifs`}
        </span>
        {groupOptions.size > 1 || enableCollections ? (
          <div className={styles.toolbarTools}>
            {groupOptions.size > 1 ? (
              <select
                aria-label={
                  category === "all"
                    ? zh
                      ? "资产类别"
                      : "Catégorie d’actifs"
                    : zh
                      ? "资产分组"
                      : "Groupe d’actifs"
                }
                className={styles.groupSelect}
                value={selectedGroup}
                onChange={(event) => setSelectedGroup(event.target.value)}
              >
                <option value="">
                  {category === "all"
                    ? zh
                      ? "全部类别"
                      : "Toutes les catégories"
                    : zh
                      ? "全部分组"
                      : "Tous les groupes"}
                </option>
                {Array.from(groupOptions, ([group, label]) => (
                  <option key={group} value={group}>
                    {label}
                  </option>
                ))}
              </select>
            ) : null}
            {enableCollections ? (
              <button
                type="button"
                className={styles.collectionToggle}
                aria-pressed={showCollections}
                onClick={() => setView(showCollections ? "cards" : "collections")}
              >
                <CalendarClock size={15} aria-hidden="true" />
                {zh ? "收款跟进" : "Suivi des loyers"}
                <span>{collectionRows.length}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {showCollections ? (
        <AssetCollectionFollowUp
          rows={collectionRows}
          filter={followUpFilter}
          locale={locale}
          onFilter={setFollowUpFilter}
          onSelect={setSelectedId}
        />
      ) : visible.length ? (
        Array.from(groups, ([group, assets]) => (
          <section key={group} className={styles.group}>
            {category === "all" ? (
              <h2>{group}</h2>
            ) : (
              <header className={styles.groupHeading}>
                <h2 className={styles.groupTitle}>{group}</h2>
                <span>{zh ? `${assets.length} 项资产` : `${assets.length} actifs`}</span>
              </header>
            )}
            <ul className={styles.cards}>
              {assets.map(({ asset, entries, followUp }) => (
                <AssetDirectoryCard
                  key={asset.id}
                  asset={asset}
                  entries={entries}
                  followUp={followUp}
                  period={thisMonth}
                  locale={locale}
                  selected={selected?.asset.id === asset.id}
                  onSelect={() => setSelectedId(asset.id)}
                />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className={styles.empty}>
          {term
            ? zh
              ? "未找到匹配的经营资产。"
              : "Aucun actif ne correspond à la recherche."
            : zh
              ? "此分类暂无经营资产。"
              : "Aucun actif dans cette catégorie."}
        </p>
      )}
      {selected ? (
        <OperatingAssetDetail
          key={selected.asset.id}
          asset={selected.asset}
          entries={selected.entries}
          followUp={selected.followUp}
          locale={locale}
          today={today}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </section>
  );
}

function AssetCollectionFollowUp({
  rows,
  filter,
  locale,
  onFilter,
  onSelect,
}: {
  rows: CollectionRow[];
  filter: FollowUpFilter;
  locale: Locale;
  onFilter: (filter: FollowUpFilter) => void;
  onSelect: (assetId: string) => void;
}) {
  const zh = locale === "zh";
  const lang = zh ? 0 : 1;
  const counts = { all: rows.length, overdue: 0, upcoming: 0, needs_evidence: 0 };
  for (const { followUp } of rows) {
    counts[followUp.status]++;
  }
  const visible = rows
    .filter(({ followUp }) => filter === "all" || filter === followUp.status)
    .sort(
      (a, b) =>
        followUpPriority[a.followUp.status] - followUpPriority[b.followUp.status] ||
        (a.followUp.status === "needs_evidence"
          ? Number(Boolean(b.followUp.outstanding)) - Number(Boolean(a.followUp.outstanding))
          : 0) ||
        (a.followUp.dueDate ?? a.followUp.paidThrough?.date ?? "9999-12-31").localeCompare(
          b.followUp.dueDate ?? b.followUp.paidThrough?.date ?? "9999-12-31",
        ) ||
        nameCollators[locale].compare(a.asset.displayName, b.asset.displayName),
    );
  const unregistered = zh ? "未登记" : "Non renseigné";
  return (
    <section
      className={styles.collectionPanel}
      aria-label={zh ? "集中收款跟进" : "Suivi des loyers regroupé"}
    >
      <header className={styles.collectionHeading}>
        <h2>{zh ? "收款跟进" : "Suivi des loyers"}</h2>
        <p className={styles.note}>
          {zh
            ? "根据已登记的付款日和未收金额跟进。租金覆盖日期和待补资料单独展示。"
            : "Le suivi s’appuie sur les échéances et soldes enregistrés. Les périodes couvertes et les données à compléter sont indiquées séparément."}
        </p>
        <div
          className={styles.collectionFilters}
          role="group"
          aria-label={zh ? "收款跟进筛选" : "Filtres de suivi"}
        >
          {(Object.keys(followUpLabels) as FollowUpFilter[]).map((key) => (
            <button
              type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => onFilter(key)}
            >
              {followUpLabels[key][lang]}
              <span>{counts[key]}</span>
            </button>
          ))}
        </div>
      </header>
      {visible.length ? (
        <ul className={styles.collectionRows}>
          {visible.map(({ asset, followUp }) => (
            <li key={asset.id}>
              <button
                type="button"
                className={styles.collectionRow}
                aria-haspopup="dialog"
                onClick={() => onSelect(asset.id)}
              >
                <span>
                  <span>{asset.displayName}</span>
                  <small>
                    {asset.displayGroup || operatingAssetCategoryLabel(asset.category, locale)}
                  </small>
                </span>
                <span>
                  <span
                    className={styles.status}
                    data-status={followUp.status === "needs_evidence" ? "pending" : followUp.status}
                  >
                    {followUpLabels[followUp.status][lang]}
                  </span>
                  {followUp.reason &&
                  followUp.reason !== "due_date_missing" &&
                  followUp.reason !== "paid_through_missing" ? (
                    <small>{followUpReasons[followUp.reason][lang]}</small>
                  ) : null}
                </span>
                <span>
                  <span
                    title={
                      followUp.dueSourceRef ? assetSourceLabel(followUp.dueSourceRef) : undefined
                    }
                  >
                    {zh ? "付款日" : "Échéance"} {followUp.dueDate ?? unregistered}
                  </span>
                  <small
                    title={
                      followUp.paidThrough
                        ? assetSourceLabel(followUp.paidThrough.sourceRef)
                        : undefined
                    }
                  >
                    {followUp.paidThrough?.status === "pending"
                      ? zh
                        ? "租金记载至"
                        : "Loyer documenté au"
                      : zh
                        ? "已交至"
                        : "Payé au"}{" "}
                    {followUp.paidThrough?.date ?? unregistered}
                  </small>
                </span>
                <span
                  className={styles.collectionAmount}
                  title={
                    followUp.outstanding
                      ? assetSourceLabel(followUp.outstanding.sourceRef)
                      : undefined
                  }
                >
                  {followUp.outstanding
                    ? formatPropertyMoney(
                        followUp.outstanding.amountNative,
                        followUp.outstanding.currency,
                        locale,
                      )
                    : unregistered}
                  <small>
                    {followUp.outstanding
                      ? zh
                        ? "原表余款"
                        : "Solde enregistré"
                      : zh
                        ? "未收金额"
                        : "Solde à recevoir"}
                  </small>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.collectionEmpty}>
          {zh ? "当前筛选没有需要跟进的记录。" : "Aucun suivi dans cette sélection."}
        </p>
      )}
    </section>
  );
}

function AssetDirectoryCard({
  asset,
  entries,
  followUp,
  period,
  locale,
  selected,
  onSelect,
}: {
  asset: OperatingAssetDirectoryAsset;
  entries: OperatingAssetDirectoryEntry[];
  followUp: FollowUp;
  period: ReturnType<typeof assetReportPeriod>;
  locale: Locale;
  selected: boolean;
  onSelect: () => void;
}) {
  const zh = locale === "zh";
  const lang = zh ? 0 : 1;
  const cash = summarizeOperatingAssetCash([asset], entries, period);
  const receipts = cash.originals.filter(({ income }) => income > 0);
  const pendingCount = entries.filter((entry) => entry.status === "pending").length;
  const coverage = followUp.paidThrough;
  const rent = referenceRent(asset, locale);
  const coverageReview =
    followUp.reason === "coverage_ended" ||
    followUp.reason === "coverage_ending" ||
    followUp.reason === "source_conflict" ||
    followUp.reason === "unpaid_unconfirmed" ||
    followUp.outstanding !== null;
  const needsReview = asset.verification === "pending" || pendingCount > 0 || coverageReview;
  const paymentStatus =
    followUp.status === "overdue" || followUp.status === "upcoming" ? followUp.status : null;
  const reviewLabel = pendingCount
    ? zh
      ? `${pendingCount} 笔历史流水待核`
      : `${pendingCount} flux à vérifier`
    : coverageReview
      ? followUpLabels.needs_evidence[lang]
      : zh
        ? "资料待核"
        : "Fiche à vérifier";
  return (
    <li>
      <button
        type="button"
        className={styles.card}
        aria-haspopup="dialog"
        aria-pressed={selected}
        data-review={(needsReview && !paymentStatus) || undefined}
        data-collection-status={paymentStatus ?? undefined}
        onClick={onSelect}
      >
        <span className={styles.cardHeader}>
          <strong>{asset.displayName}</strong>
          <span className={styles.cardCategory}>
            {asset.leaseEvidence?.selfUse
              ? zh
                ? "自用"
                : "Usage propre"
              : operatingAssetCategoryLabel(asset.category, locale)}
          </span>
        </span>
        <span className={styles.cardFact}>
          <span>{rent.label}</span>
          <span>{rent.amount}</span>
        </span>
        <span className={styles.cardFact}>
          <span>
            {coverage?.status === "pending"
              ? zh
                ? "租金记载至"
                : "Loyer documenté au"
              : zh
                ? "已交至"
                : "Payé au"}
          </span>
          <span>
            {coverage?.date ?? (zh ? "未登记" : "Non renseigné")}
            {coverage?.status === "pending" ? (zh ? " · 待核" : " · À vérifier") : ""}
          </span>
        </span>
        <span className={styles.cardFact}>
          <span>{zh ? "本月实收" : "Encaissé ce mois"}</span>
          <span>
            {receipts.length
              ? receipts
                  .map(({ income, currency }) => formatPropertyMoney(income, currency, locale))
                  .join(" · ")
              : zh
                ? "暂无"
                : "Aucun"}
          </span>
        </span>
        <span className={styles.cardFooter}>
          {paymentStatus || needsReview ? (
            <span className={styles.status} data-status={paymentStatus ?? "pending"}>
              {paymentStatus ? followUpLabels[paymentStatus][lang] : reviewLabel}
            </span>
          ) : (
            <span className={styles.openHint}>{zh ? "查看资料" : "Voir le dossier"}</span>
          )}
          <span className={styles.cardAction}>
            {paymentStatus || needsReview ? (
              <span className={styles.openHint}>{zh ? "查看资料" : "Voir le dossier"}</span>
            ) : null}
            <ArrowRight size={14} aria-hidden="true" />
          </span>
        </span>
      </button>
    </li>
  );
}
