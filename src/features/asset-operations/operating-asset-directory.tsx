"use client";

import { useId, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { RightDrawer } from "@/components/ui/operational";
import { RecordDetailTabs } from "@/components/ui/record-detail-tabs";
import { formatPropertyMoney, formatPropertyXof } from "@/lib/property-money";
import { assetReportPeriod, assetSourceLabel, isAssetDate } from "./asset-operations-model";
import {
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
  verified: ["已核", "Vérifié"],
  voided: ["已作废", "Annulé"],
};

const emptyEntries: OperatingAssetDirectoryEntry[] = [];

function referenceRent(asset: OperatingAssetDirectoryAsset, locale: Locale) {
  return asset.monthlyRentNative === null || asset.rentCurrency === null
    ? locale === "zh"
      ? "待核"
      : "À vérifier"
    : formatPropertyMoney(asset.monthlyRentNative, asset.rentCurrency, locale);
}

function latestRentCoverage(entries: OperatingAssetDirectoryEntry[], locale: Locale) {
  let latest: OperatingAssetDirectoryEntry | undefined;
  for (const entry of entries) {
    if (
      entry.status !== "voided" &&
      entry.kind === "income" &&
      entry.category === "rent" &&
      isAssetDate(entry.periodEnd) &&
      (!latest?.periodEnd || entry.periodEnd > latest.periodEnd)
    )
      latest = entry;
  }
  if (!latest) return null;
  const status = entryStatusLabels[latest.status][locale === "zh" ? 0 : 1];
  return locale === "zh"
    ? `租金来源记载至 ${latest.periodEnd} · ${status}`
    : `Loyer documenté jusqu’au ${latest.periodEnd} · ${status}`;
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
  today,
  locale,
  onClose,
}: {
  asset: OperatingAssetDirectoryAsset;
  entries: OperatingAssetDirectoryEntry[];
  today: string;
  locale: Locale;
  onClose: () => void;
}) {
  const zh = locale === "zh";
  const id = useId();
  const [tab, setTab] = useState("overview");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [pendingOnly, setPendingOnly] = useState(false);
  const period = assetReportPeriod("month", month);
  const cash = summarizeOperatingAssetCash([asset], entries, period);
  const historicalPending = entries.filter((entry) => entry.status === "pending").length;
  const rentCoverage = latestRentCoverage(entries, locale);
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
            {rentCoverage ? <p className={styles.note}>{rentCoverage}</p> : null}
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
                <dd>{entryStatusLabels[asset.verification][zh ? 0 : 1]}</dd>
              </div>
              <div>
                <dt>{zh ? "参考月租" : "Loyer mensuel indicatif"}</dt>
                <dd>{referenceRent(asset, locale)}</dd>
              </div>
              {rentCoverage ? (
                <div>
                  <dt>{zh ? "租客" : "Locataire"}</dt>
                  <dd>{zh ? "待核" : "À vérifier"}</dd>
                </div>
              ) : null}
            </dl>
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
}

export function OperatingAssetDirectory(props: OperatingAssetDirectoryProps) {
  return (
    <OperatingAssetDirectoryView
      key={JSON.stringify([props.data.projectId, props.category, props.selectedAssetId])}
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
}: OperatingAssetDirectoryProps) {
  const zh = locale === "zh";
  const [search, setSearch] = useState("");
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
  const thisMonth = assetReportPeriod("month", today.slice(0, 7));
  const term = search.trim().toLocaleLowerCase();
  const assetsInScope = data.assets.filter(
    (asset) => category === "all" || asset.category === category,
  );
  const visible = assetsInScope.filter((asset) =>
    [asset.displayName, asset.name, asset.code].some((value) =>
      value.toLocaleLowerCase().includes(term),
    ),
  );
  const groups = new Map<OperatingAssetCategory, OperatingAssetDirectoryAsset[]>();
  for (const asset of visible) {
    const group = groups.get(asset.category);
    if (group) group.push(asset);
    else groups.set(asset.category, [asset]);
  }
  const selected = assetsInScope.find((asset) => asset.id === selectedId);

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
      </div>
      {visible.length ? (
        Array.from(groups, ([group, assets]) => (
          <section key={group} className={styles.group}>
            {category === "all" ? <h2>{operatingAssetCategoryLabel(group, locale)}</h2> : null}
            <ul className={styles.cards}>
              {assets.map((asset) => {
                const entries = entriesByAsset.get(asset.id) ?? emptyEntries;
                return (
                  <AssetDirectoryCard
                    key={asset.id}
                    asset={asset}
                    entries={entries}
                    period={thisMonth}
                    locale={locale}
                    onSelect={() => setSelectedId(asset.id)}
                  />
                );
              })}
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
          key={selected.id}
          asset={selected}
          entries={entriesByAsset.get(selected.id) ?? emptyEntries}
          locale={locale}
          today={today}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </section>
  );
}

function AssetDirectoryCard({
  asset,
  entries,
  period,
  locale,
  onSelect,
}: {
  asset: OperatingAssetDirectoryAsset;
  entries: OperatingAssetDirectoryEntry[];
  period: ReturnType<typeof assetReportPeriod>;
  locale: Locale;
  onSelect: () => void;
}) {
  const zh = locale === "zh";
  const cash = summarizeOperatingAssetCash([asset], entries, period);
  const receipts = cash.originals.filter(({ income }) => income > 0);
  const pendingCount = entries.filter((entry) => entry.status === "pending").length;
  const rentCoverage = latestRentCoverage(entries, locale);
  return (
    <li>
      <button type="button" className={styles.card} aria-haspopup="dialog" onClick={onSelect}>
        <span className={styles.cardHeader}>
          <span>{asset.displayName}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </span>
        <span className={styles.cardCategory}>
          {operatingAssetCategoryLabel(asset.category, locale)}
          {asset.verification === "pending" ? (zh ? " · 资料待核" : " · Fiche à vérifier") : ""}
        </span>
        <span className={styles.cardFact}>
          <span>{zh ? "参考月租" : "Loyer indicatif"}</span>
          <span>{referenceRent(asset, locale)}</span>
        </span>
        <span className={styles.cardFact}>
          <span>{zh ? "本月已核实收" : "Encaissements vérifiés du mois"}</span>
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
        {rentCoverage ? <span className={styles.note}>{rentCoverage}</span> : null}
        {pendingCount > 0 ? (
          <span className={styles.status} data-status="pending">
            {zh ? `${pendingCount} 笔历史流水待核` : `${pendingCount} flux à vérifier`}
          </span>
        ) : null}
      </button>
    </li>
  );
}
