import { ArrowRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
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
  key?: string;
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
  statusKey: string;
  onSelectSite: (site: string) => void;
  onSelectAsset: (id: string) => void;
}

function siteUnitIdentifier(asset: OperatingAssetDirectoryAsset, siteName?: string) {
  const { displayName, displayGroup } = asset;
  if (!siteName || siteName !== displayGroup || !displayName.startsWith(siteName)) {
    return displayName;
  }
  const suffix = displayName.slice(displayGroup.length).replace(/^[\s·:：-]+/, "");
  const partition = /^([a-z]?\d+(?:\.\d+)*号)[\s·—–-]+(\d+(?:\.\d+)?)\s*㎡分区$/i.exec(suffix);
  if (partition) return `${partition[1]} · ${partition[2]}㎡`;
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
  const selfUse = asset.leaseEvidence?.selfUse;
  const qualifier =
    tenant && (tenant.evidence.scope === "group" || tenant.evidence.classification === "historical")
      ? tenant.label
      : null;
  const tenantName = selfUse
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
  const showQualifier = qualifier && !selfUse;
  const tenantTitle = showQualifier ? `${tenantName} · ${qualifier}` : tenantName;

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
          <strong
            className={styles.unitIdentifier}
            title={compactRow ? asset.displayName : undefined}
          >
            {identifier !== asset.displayName ? (
              <>
                <span className="sr-only">{asset.displayName}</span>
                <span aria-hidden="true">{identifier}</span>
              </>
            ) : (
              identifier
            )}
          </strong>
          <span className={styles.tenant} title={compactRow ? tenantTitle : undefined}>
            {showQualifier && !compactRow ? <small>{qualifier} </small> : null}
            {tenantName}
            {showQualifier && compactRow ? <small> {qualifier}</small> : null}
          </span>
        </span>
        <span className={styles.cardDetails}>
          {missingCoverage || (compactRow && selfUse) ? null : (
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
  statusKey,
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
    <section className={styles.siteBrowse} aria-label={headingText}>
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
          <OperatingLeaseUnitList
            key={`${activeSite}:${statusKey}`}
            locale={locale}
            siteName={activeLocation.name}
            rows={rows}
            selectedAssetId={selectedAssetId}
            onSelectAsset={onSelectAsset}
            empty={empty}
          />
        </div>
      ) : (
        empty
      )}
    </section>
  );
}

const unitsPerPage = 15;

function OperatingLeaseUnitList({
  locale,
  siteName,
  rows,
  selectedAssetId,
  onSelectAsset,
  empty,
}: Pick<OperatingLeaseLocationsProps, "locale" | "rows" | "selectedAssetId" | "onSelectAsset"> & {
  siteName: string;
  empty: ReactNode;
}) {
  const zh = locale === "zh";
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.ceil(rows.length / unitsPerPage);
  const page = Math.min(requestedPage, Math.max(0, pageCount - 1));
  const first = page * unitsPerPage;
  const end = Math.min(first + unitsPerPage, rows.length);

  return (
    <section className={styles.siteUnits}>
      <header className={styles.unitHeader}>
        <h3>{zh ? `${siteName} · 出租单元` : `Unités louées · ${siteName}`}</h3>
        {pageCount > 1 ? (
          <nav
            className={styles.unitPages}
            aria-label={zh ? "出租单元分页" : "Pagination des unités"}
          >
            <span aria-live="polite">{`${first + 1}–${end} / ${rows.length}`}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              {zh ? "上一页" : "Précédent"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              {zh ? "下一页" : "Suivant"}
            </Button>
          </nav>
        ) : null}
      </header>
      {rows.length ? (
        <ul className={styles.unitRows} aria-label={zh ? "出租单元" : "Unités louées"}>
          {rows.slice(first, end).map((row) => {
            const rowKey = row.key ?? row.asset.id;
            return (
              <OperatingLeaseCard
                key={rowKey}
                row={row}
                locale={locale}
                siteName={siteName}
                compactRow
                selected={selectedAssetId === rowKey}
                onSelect={() => onSelectAsset(rowKey)}
              />
            );
          })}
        </ul>
      ) : (
        empty
      )}
    </section>
  );
}
