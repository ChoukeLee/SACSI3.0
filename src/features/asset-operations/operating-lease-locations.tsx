import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { formatPropertyMoney } from "@/lib/property-money";
import { assetSourceLabel, isAssetDate } from "./asset-operations-model";
import type {
  OperatingAssetDirectoryAsset,
  OperatingAssetDirectoryEntry,
  OperatingAssetFollowUp,
} from "./operating-asset-directory-model";
import {
  followUpLabels,
  latestTwoVerifiedRentReceipts,
  operatingLeaseLocation,
  recordedTenant,
  referenceRent,
} from "./operating-asset-display";
import styles from "./operating-lease-locations.module.css";

interface OperatingLeaseSite {
  id: string;
  name: string;
  count: number;
  followUpCount: number;
}

interface OperatingLeaseRow {
  asset: OperatingAssetDirectoryAsset;
  followUp: OperatingAssetFollowUp;
  attention: "overdue" | "upcoming" | "review" | null;
}

interface OperatingLeaseLocationsProps {
  locale: Locale;
  sites: readonly OperatingLeaseSite[];
  activeSite: string;
  rows: readonly OperatingLeaseRow[];
  selectedAssetId: string | null;
  statusFilter: ReactNode;
  onSelectSite: (site: string) => void;
  onSelectAsset: (id: string) => void;
}

function siteUnitIdentifier(asset: OperatingAssetDirectoryAsset, siteName?: string) {
  const { displayName, displayGroup } = asset;
  if (!siteName || siteName !== displayGroup || !displayName.startsWith(siteName)) {
    return displayName;
  }
  const suffix = displayName.slice(displayGroup.length).replace(/^[\s·:：-]+/, "");
  return /^[a-z]?\d+(?:\.\d+)*(?:号)?$/i.test(suffix) ? suffix : displayName;
}

function statusLabel(row: OperatingLeaseRow, locale: Locale) {
  const zh = locale === "zh";
  const { attention, followUp } = row;
  const days = followUp.daysUntilDue;
  if (attention === "review") return followUpLabels.needs_evidence[zh ? 0 : 1];
  if (attention === "overdue")
    return days === null
      ? followUpLabels.overdue[zh ? 0 : 1]
      : zh
        ? `逾期 ${Math.abs(days)} 天`
        : `Retard de ${Math.abs(days)} j`;
  if (attention === "upcoming") {
    if (days === 0) return zh ? "今日应缴" : "Dû aujourd’hui";
    return days === null
      ? followUpLabels.upcoming[zh ? 0 : 1]
      : zh
        ? `${days} 天后应缴`
        : `Dû dans ${days} j`;
  }
  return null;
}

export function OperatingLeaseCard({
  row,
  locale,
  siteName,
  compactRow = false,
  selected,
  onSelect,
}: {
  row: OperatingLeaseRow;
  locale: Locale;
  siteName?: string;
  compactRow?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { asset, attention, followUp } = row;
  const zh = locale === "zh";
  const identifier = siteUnitIdentifier(asset, siteName);
  const tenant = recordedTenant(asset, locale);
  const qualifier =
    tenant && (tenant.evidence.scope === "group" || tenant.evidence.classification === "historical")
      ? tenant.label
      : null;
  const tenantName = asset.leaseEvidence?.selfUse
    ? zh
      ? "自用"
      : "Usage propre"
    : tenant?.names || (zh ? "租户未登记" : "Locataire non renseigné");
  const coverage = followUp.paidThrough;
  const pending = coverage?.status === "pending";
  const missingCoverage =
    compactRow && !coverage && attention === "review" && followUp.reason === "paid_through_missing";
  const status = missingCoverage
    ? zh
      ? "缴租日期待补"
      : "Date de couverture à renseigner"
    : statusLabel(row, locale);
  const showQualifier = qualifier && !asset.leaseEvidence?.selfUse;

  return (
    <li>
      <button
        type="button"
        className={styles.card}
        aria-haspopup="dialog"
        aria-pressed={selected}
        data-layout={compactRow ? "row" : undefined}
        data-status={attention ?? undefined}
        onClick={onSelect}
      >
        <span className={styles.identity}>
          <strong>
            {identifier !== asset.displayName ? (
              <span className="sr-only">{asset.displayGroup} · </span>
            ) : null}
            {identifier}
          </strong>
          <span className={styles.tenant}>
            {showQualifier && !compactRow ? <small>{qualifier} </small> : null}
            {tenantName}
            {showQualifier && compactRow ? <small> {qualifier}</small> : null}
          </span>
        </span>
        <span className={styles.cardDetails}>
          {missingCoverage ? null : (
            <span className={styles.coverage}>
              {pending ? (zh ? "租金记载至" : "Loyer documenté au") : zh ? "已交至" : "Payé au"}{" "}
              {coverage ? (
                <time dateTime={coverage.date}>{coverage.date}</time>
              ) : zh ? (
                "未登记"
              ) : (
                "Non renseigné"
              )}
              {pending ? (zh ? " · 待核" : " · À vérifier") : null}
            </span>
          )}
          {status ? <span className={styles.status}>{status}</span> : null}
        </span>
      </button>
    </li>
  );
}

export function OperatingWholeLeaseOverview({
  row,
  locale,
  today,
  onOpenDetail,
}: {
  row: OperatingLeaseRow & { entries: readonly OperatingAssetDirectoryEntry[] };
  locale: Locale;
  today: string;
  onOpenDetail: () => void;
}) {
  const { asset, attention, entries, followUp } = row;
  const zh = locale === "zh";
  const missing = zh ? "未登记" : "Non renseigné";
  const location = operatingLeaseLocation(asset);
  const tenant = recordedTenant(asset, locale);
  const selfUse = asset.leaseEvidence?.selfUse;
  const rent = referenceRent(asset, locale);
  const coverage = followUp.paidThrough;
  const receipts = latestTwoVerifiedRentReceipts(entries, today);
  const status = statusLabel(row, locale);

  return (
    <article className={styles.wholeOverview} aria-label={asset.displayName}>
      <header className={styles.wholeHeader} data-status={attention ?? undefined}>
        <div>
          <p className={styles.wholeMuted}>
            {location ? <>{location} · </> : null}
            {zh ? "租赁概况" : "Aperçu de la location"}
          </p>
          <h3>{asset.displayName}</h3>
        </div>
        {status ? <span className={styles.status}>{status}</span> : null}
      </header>
      <div className={styles.wholePanels}>
        <section className={styles.wholePanel} aria-label={zh ? "租户资料" : "Locataire"}>
          <h4>{zh ? "租户资料" : "Locataire"}</h4>
          <div className={styles.wholeTenant}>
            <p>{selfUse ? (zh ? "自用" : "Usage propre") : tenant?.names || asset.name}</p>
            {selfUse ? null : (
              <p className={styles.wholeMuted}>
                {tenant?.label ??
                  (zh ? "资产名称 · 系统租户未登记" : "Nom de l’actif · Locataire non renseigné")}
              </p>
            )}
          </div>
          <dl className={styles.wholeFacts}>
            <div>
              <dt>{rent.label}</dt>
              <dd>{rent.amount}</dd>
            </div>
            <div>
              <dt>{zh ? "下一约定付款日" : "Prochaine échéance convenue"}</dt>
              <dd>
                {followUp.dueDate ? (
                  <time dateTime={followUp.dueDate}>{followUp.dueDate}</time>
                ) : (
                  missing
                )}
              </dd>
            </div>
          </dl>
        </section>
        <section className={styles.wholePanel} aria-label={zh ? "付款进度" : "Suivi des paiements"}>
          <header className={styles.wholeProgressHeading}>
            <h4>{zh ? "付款进度" : "Suivi des paiements"}</h4>
            {coverage?.status === "verified" ? (
              <span className={styles.wholeConfirmed}>
                {zh ? "缴租截止已确认" : "Couverture confirmée"}
              </span>
            ) : null}
          </header>
          <p className={styles.wholeCutoff}>
            <span className={styles.wholeMuted}>
              {coverage?.status === "pending"
                ? zh
                  ? "租金记载至 · 待核"
                  : "Loyer documenté au · À vérifier"
                : zh
                  ? "已交至"
                  : "Payé au"}
            </span>
            {coverage ? (
              <time dateTime={coverage.date}>{coverage.date}</time>
            ) : (
              <span>{missing}</span>
            )}
          </p>
          {receipts.length ? (
            <div className={styles.wholeReceipts}>
              {[...receipts].reverse().map((receipt, index) => (
                <WholeLeaseReceipt
                  key={receipt.id}
                  receipt={receipt}
                  locale={locale}
                  latest={index === receipts.length - 1}
                />
              ))}
            </div>
          ) : (
            <p className={styles.wholeMuted}>
              {zh ? "暂无已确认的租金收款。" : "Aucun encaissement de loyer confirmé."}
            </p>
          )}
        </section>
      </div>
      <footer className={styles.wholeFooter}>
        {coverage ? (
          <p className={styles.wholeMuted}>
            {zh ? "缴租截止依据" : "Source de la couverture"} ·{" "}
            {assetSourceLabel(coverage.sourceRef)}
          </p>
        ) : null}
        <button type="button" className={styles.back} aria-haspopup="dialog" onClick={onOpenDetail}>
          {zh ? "查看流水与资产档案" : "Voir les opérations et la fiche de l’actif"}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

function WholeLeaseReceipt({
  receipt,
  locale,
  latest,
}: {
  receipt: OperatingAssetDirectoryEntry & { cashDate: string };
  locale: Locale;
  latest: boolean;
}) {
  const zh = locale === "zh";
  const { periodStart, periodEnd } = receipt;
  const original = formatPropertyMoney(receipt.amountNative, receipt.currency, locale);
  const booked =
    receipt.currency !== "XOF" && receipt.bookedAmountXof !== null
      ? formatPropertyMoney(receipt.bookedAmountXof, "XOF", locale)
      : null;

  return (
    <div
      className={styles.wholeReceipt}
      data-latest={latest ? "true" : undefined}
      title={assetSourceLabel(receipt.sourceRef)}
    >
      <p className={styles.wholeMuted}>
        {latest
          ? zh
            ? "最近一笔租金"
            : "Dernier loyer reçu"
          : zh
            ? "上一笔租金"
            : "Loyer précédent"}
      </p>
      {booked ? (
        <>
          <p>
            {zh ? "西法记账额" : "Montant comptabilisé"} {booked}
          </p>
          <p>
            {zh ? "原币实收" : "Reçu en devise"} {original}
          </p>
        </>
      ) : (
        <p>{original}</p>
      )}
      <p className={styles.wholeMuted}>
        {zh ? "收款" : "Reçu le"} <time dateTime={receipt.cashDate}>{receipt.cashDate}</time>
      </p>
      {isAssetDate(periodStart) && isAssetDate(periodEnd) && periodStart <= periodEnd ? (
        <p className={styles.wholeMuted}>
          {zh ? "覆盖" : "Période"} <time dateTime={periodStart}>{periodStart}</time>
          {" — "}
          <time dateTime={periodEnd}>{periodEnd}</time>
        </p>
      ) : null}
    </div>
  );
}

export function OperatingLeaseLocations({
  locale,
  sites,
  activeSite,
  rows,
  selectedAssetId,
  statusFilter,
  onSelectSite,
  onSelectAsset,
}: OperatingLeaseLocationsProps) {
  const zh = locale === "zh";
  const activeLocation = sites.find(({ id }) => id === activeSite);
  const headingText = activeLocation?.name ?? (zh ? "场地总览" : "Vue des sites");
  const empty = (
    <p className={styles.empty}>
      {zh ? "没有符合条件的资产。" : "Aucun actif ne correspond aux critères."}
    </p>
  );

  return (
    <section aria-label={headingText}>
      <header className={styles.siteHeading}>
        <div className={styles.siteTitle}>
          <p>{zh ? "按场地浏览" : "Parcourir par site"}</p>
          <h2>{headingText}</h2>
        </div>
        {activeLocation ? (
          <div className={styles.siteSummary}>
            <span>{zh ? `${activeLocation.count} 个单元` : `${activeLocation.count} unités`}</span>
            <span data-follow-up={activeLocation.followUpCount > 0}>
              {zh
                ? `待跟进 ${activeLocation.followUpCount} 项`
                : `${activeLocation.followUpCount} à suivre`}
            </span>
          </div>
        ) : null}
        {statusFilter}
      </header>
      {activeLocation ? (
        <div className={styles.siteLayout}>
          <section
            className={styles.siteRail}
            aria-label={zh ? "分单元场地" : "Sites de location par unité"}
          >
            <h3>{zh ? "场地" : "Sites"}</h3>
            <ul>
              {sites.map(({ id, name, count, followUpCount }) => (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={id === activeSite ? "true" : undefined}
                    onClick={() => onSelectSite(id)}
                  >
                    <strong>{name}</strong>
                    <small>
                      {zh
                        ? `${count} 个单元 · 待跟进 ${followUpCount} 项`
                        : `${count} unités · ${followUpCount} à suivre`}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className={styles.siteUnits}>
            <h3>
              {zh ? `${activeLocation.name} · 出租单元` : `Unités louées · ${activeLocation.name}`}
            </h3>
            {rows.length ? (
              <ul className={styles.unitRows} aria-label={zh ? "出租单元" : "Unités louées"}>
                {rows.map((row) => (
                  <OperatingLeaseCard
                    key={row.asset.id}
                    row={row}
                    locale={locale}
                    siteName={activeLocation.name}
                    compactRow
                    selected={selectedAssetId === row.asset.id}
                    onSelect={() => onSelectAsset(row.asset.id)}
                  />
                ))}
              </ul>
            ) : (
              empty
            )}
          </section>
        </div>
      ) : (
        empty
      )}
    </section>
  );
}
