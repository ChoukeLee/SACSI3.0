import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { LeaseLocationIndex } from "@/features/leases/lease-browse-content";
import type { Locale } from "@/lib/i18n";
import type {
  OperatingAssetCategory,
  OperatingAssetDirectoryAsset,
  OperatingAssetFollowUp,
} from "./operating-asset-directory-model";
import { followUpLabels, recordedTenant } from "./operating-asset-display";
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
  category: OperatingAssetCategory;
  sites: readonly OperatingLeaseSite[];
  activeSite: string;
  rows: readonly OperatingLeaseRow[];
  selectedAssetId: string | null;
  statusFilter: ReactNode;
  onSelectSite: (site: string) => void;
  onSelectAsset: (id: string) => void;
}

function warehouseIdentifier(asset: OperatingAssetDirectoryAsset, siteName?: string) {
  const { displayName, displayGroup } = asset;
  if (
    asset.category !== "warehouse" ||
    !siteName ||
    siteName !== displayGroup ||
    !displayName.startsWith(siteName)
  ) {
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
  selected,
  onSelect,
}: {
  row: OperatingLeaseRow;
  locale: Locale;
  siteName?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { asset, attention, followUp } = row;
  const zh = locale === "zh";
  const identifier = warehouseIdentifier(asset, siteName);
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
  const status = statusLabel(row, locale);

  return (
    <li>
      <button
        type="button"
        className={styles.card}
        aria-haspopup="dialog"
        aria-pressed={selected}
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
            {qualifier && !asset.leaseEvidence?.selfUse ? <small>{qualifier} </small> : null}
            {tenantName}
          </span>
        </span>
        <span className={styles.cardDetails}>
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
          {status ? <span className={styles.status}>{status}</span> : null}
        </span>
      </button>
    </li>
  );
}

export function OperatingLeaseLocations({
  locale,
  category,
  sites,
  activeSite,
  rows,
  selectedAssetId,
  statusFilter,
  onSelectSite,
  onSelectAsset,
}: OperatingLeaseLocationsProps) {
  const zh = locale === "zh";
  const warehouse = category === "warehouse";
  const heading = useRef<HTMLHeadingElement>(null);
  const focusOnNavigation = useRef(false);
  const activeLocation = sites.find(({ id }) => id === activeSite);
  const siteName = activeLocation?.name ?? activeSite;
  const headingText = activeSite ? siteName : zh ? "场地总览" : "Vue des sites";
  const empty = (
    <p className={styles.empty}>
      {zh ? "没有符合条件的资产。" : "Aucun actif ne correspond aux critères."}
    </p>
  );

  useEffect(() => {
    if (!focusOnNavigation.current) return;
    focusOnNavigation.current = false;
    heading.current?.focus({ preventScroll: true });
  }, [activeSite]);

  function changeSite(site: string) {
    focusOnNavigation.current = true;
    onSelectSite(site);
  }

  return (
    <section aria-label={headingText}>
      <header className={styles.siteHeading}>
        <div className={styles.siteIdentity}>
          {activeSite ? (
            <button type="button" className={styles.back} onClick={() => changeSite("")}>
              <ArrowLeft size={15} aria-hidden="true" />
              {zh ? "返回全部场地" : "Retour à tous les sites"}
            </button>
          ) : null}
          <h2 ref={heading} tabIndex={-1}>
            {headingText}
          </h2>
          {activeLocation ? (
            <span>{zh ? `${activeLocation.count} 项资产` : `${activeLocation.count} actifs`}</span>
          ) : null}
        </div>
        {statusFilter}
      </header>
      {!activeSite && sites.length ? (
        <LeaseLocationIndex
          label={
            warehouse
              ? zh
                ? "仓库场地"
                : "Sites d’entrepôts"
              : zh
                ? "经营场地"
                : "Sites d’exploitation"
          }
          locations={sites.map(({ id, name, count, followUpCount }) => ({
            id,
            name,
            countLabel: zh ? `${count} 项资产` : `${count} actifs`,
            followUpLabel: zh ? `待跟进 ${followUpCount} 项` : `${followUpCount} à suivre`,
            hasFollowUp: followUpCount > 0,
          }))}
          onSelect={changeSite}
        />
      ) : rows.length ? (
        <ul
          className={styles.cards}
          aria-label={
            warehouse
              ? zh
                ? "仓库卡片"
                : "Fiches des entrepôts"
              : zh
                ? "经营资产卡片"
                : "Fiches des actifs d’exploitation"
          }
        >
          {rows.map((row) => (
            <OperatingLeaseCard
              key={row.asset.id}
              row={row}
              locale={locale}
              siteName={siteName}
              selected={selectedAssetId === row.asset.id}
              onSelect={() => onSelectAsset(row.asset.id)}
            />
          ))}
        </ul>
      ) : (
        empty
      )}
    </section>
  );
}
