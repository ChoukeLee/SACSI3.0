import { ArrowLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import type {
  OperatingAssetDirectoryAsset,
  OperatingAssetFollowUp,
} from "./operating-asset-directory-model";
import { followUpLabels, recordedTenant } from "./operating-asset-display";
import styles from "./warehouse-lease-directory.module.css";

type Locale = "zh" | "fr";

interface WarehouseSite {
  id: string;
  name: string;
  count: number;
  followUpCount: number;
}

interface WarehouseRow {
  asset: OperatingAssetDirectoryAsset;
  followUp: OperatingAssetFollowUp;
  attention: "overdue" | "upcoming" | "review" | null;
}

interface WarehouseLeaseDirectoryProps {
  locale: Locale;
  sites: readonly WarehouseSite[];
  activeSite: string;
  rows: readonly WarehouseRow[];
  selectedAssetId: string | null;
  onSelectSite: (site: string) => void;
  onSelectAsset: (id: string) => void;
}

function warehouseIdentifier(asset: OperatingAssetDirectoryAsset, siteName?: string) {
  const { displayName, displayGroup } = asset;
  if (!siteName || siteName !== displayGroup || !displayName.startsWith(siteName)) {
    return displayName;
  }
  const suffix = displayName.slice(displayGroup.length).replace(/^[\s·:：-]+/, "");
  return /^[a-z]?\d+(?:\.\d+)*(?:号)?$/i.test(suffix) ? suffix : displayName;
}

function statusLabel(row: WarehouseRow, locale: Locale) {
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

export function WarehouseLeaseCard({
  row,
  locale,
  siteName,
  selected,
  onSelect,
}: {
  row: WarehouseRow;
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

export function WarehouseLeaseDirectory({
  locale,
  sites,
  activeSite,
  rows,
  selectedAssetId,
  onSelectSite,
  onSelectAsset,
}: WarehouseLeaseDirectoryProps) {
  const zh = locale === "zh";
  const heading = useRef<HTMLHeadingElement>(null);
  const siteList = useRef<HTMLUListElement>(null);
  const focusOnNavigation = useRef(false);
  const siteName = sites.find(({ id }) => id === activeSite)?.name ?? activeSite;
  const empty = (
    <p className={styles.empty}>
      {zh ? "没有符合条件的仓库。" : "Aucun entrepôt ne correspond aux critères."}
    </p>
  );

  useEffect(() => {
    if (!focusOnNavigation.current) return;
    focusOnNavigation.current = false;
    (activeSite ? heading : siteList).current?.focus({ preventScroll: true });
  }, [activeSite]);

  function changeSite(site: string) {
    focusOnNavigation.current = true;
    onSelectSite(site);
  }

  if (!activeSite) {
    if (!sites.length) return empty;
    return (
      <ul
        ref={siteList}
        tabIndex={-1}
        className={styles.sites}
        aria-label={zh ? "仓库场地" : "Sites d’entrepôts"}
      >
        {sites.map((site) => (
          <li key={site.id}>
            <button type="button" className={styles.site} onClick={() => changeSite(site.id)}>
              <span className={styles.siteIdentity}>
                <strong>{site.name}</strong>
                <span>{zh ? `${site.count} 项资产` : `${site.count} actifs`}</span>
              </span>
              <span className={styles.followUp} data-has-follow-up={site.followUpCount > 0}>
                {zh ? `待跟进 ${site.followUpCount} 项` : `${site.followUpCount} à suivre`}
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-label={siteName}>
      <header className={styles.siteHeading}>
        <h2 ref={heading} tabIndex={-1}>
          {siteName}
        </h2>
        <button type="button" className={styles.back} onClick={() => changeSite("")}>
          <ArrowLeft size={15} aria-hidden="true" />
          {zh ? "返回全部场地" : "Retour à tous les sites"}
        </button>
      </header>
      {rows.length ? (
        <ul className={styles.cards} aria-label={zh ? "仓库卡片" : "Fiches des entrepôts"}>
          {rows.map((row) => (
            <WarehouseLeaseCard
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
