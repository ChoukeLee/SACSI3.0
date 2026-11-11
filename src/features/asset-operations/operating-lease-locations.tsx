import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  compact = false,
  selected,
  onSelect,
}: {
  row: OperatingLeaseRow;
  locale: Locale;
  siteName?: string;
  compact?: boolean;
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
    compact && !coverage && attention === "review" && followUp.reason === "paid_through_missing";
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
        data-layout={compact ? "unit" : undefined}
        data-status={attention ?? undefined}
        onClick={onSelect}
      >
        <span className={styles.identity}>
          <strong title={compact ? asset.displayName : undefined}>
            {identifier !== asset.displayName ? (
              <>
                <span className="sr-only">{asset.displayName}</span>
                <span aria-hidden="true">{identifier}</span>
              </>
            ) : (
              identifier
            )}
          </strong>
          {compact ? <ArrowRight size={15} aria-hidden="true" /> : null}
          <span className={styles.tenant} title={compact ? tenantTitle : undefined}>
            {showQualifier && !compact ? <small>{qualifier} </small> : null}
            {tenantName}
            {showQualifier && compact ? <small> {qualifier}</small> : null}
          </span>
        </span>
        <span className={styles.cardDetails}>
          {missingCoverage || (compact && selfUse) ? null : (
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

type WholeLeaseRow = OperatingLeaseRow & {
  entries: readonly OperatingAssetDirectoryEntry[];
  hasLeaseEvidence: boolean;
  pendingEntries: number;
};

type WholeLeaseBadge = { tone: "late" | "due" | "check" | "normal"; label: string };

function wholeTenant(asset: OperatingAssetDirectoryAsset, locale: Locale) {
  const zh = locale === "zh";
  if (asset.leaseEvidence?.selfUse) return { name: zh ? "自用" : "Usage propre", basis: null };
  const tenant = recordedTenant(asset, locale);
  if (tenant) return { name: tenant.names, basis: tenant.label };
  const operatingName =
    asset.sourceKey?.startsWith("vallon:") &&
    asset.sourceRefs.some((ref) => ref.includes("|sheet:VALLON|"))
      ? asset.name.replace(/^VALLON\s+/i, "").trim()
      : "";
  return operatingName
    ? { name: operatingName, basis: zh ? "原表经营名" : "Nom commercial dans la source" }
    : { name: zh ? "未登记" : "Non renseigné", basis: null };
}

function wholePaymentDateMissing(row: WholeLeaseRow, locale: Locale) {
  const noAgreement = [
    row.followUp.outstanding?.sourceRef,
    ...(row.asset.leaseEvidence?.notes ?? []),
  ].some((source) => source && /付款日未约定|未约定付款日/.test(source));
  if (locale === "zh") return noAgreement ? "未约定" : "未登记";
  return noAgreement ? "Non convenue" : "Non renseignée";
}

function wholeLeaseBadge(row: WholeLeaseRow, today: string, locale: Locale): WholeLeaseBadge {
  const zh = locale === "zh";
  const { asset, followUp, hasLeaseEvidence, pendingEntries } = row;
  const balance = followUp.outstanding;
  const amount = balance
    ? formatPropertyMoney(balance.amountNative, balance.currency, locale)
    : null;
  if (followUp.status === "overdue") {
    const label = zh ? "逾期" : "En retard";
    return { tone: "late", label: amount ? `${label} · ${amount}` : label };
  }
  if (amount && !followUp.dueDate) {
    const label = zh ? "待收" : "À recevoir";
    return { tone: "due", label: `${label} ${amount} · ${wholePaymentDateMissing(row, locale)}` };
  }
  if (followUp.status === "upcoming") {
    const label = statusLabel(row, locale) ?? followUpLabels.upcoming[zh ? 0 : 1];
    return { tone: "due", label: amount ? `${label} · ${amount}` : label };
  }
  if (followUp.reason === "coverage_ending" && followUp.paidThrough) {
    const days = (Date.parse(followUp.paidThrough.date) - Date.parse(today)) / 86_400_000;
    return {
      tone: "due",
      label: zh ? `缴租覆盖剩 ${days} 天` : `Couverture restante de ${days} j`,
    };
  }
  if (
    asset.verification === "pending" ||
    pendingEntries > 0 ||
    (hasLeaseEvidence && followUp.status === "needs_evidence")
  ) {
    const missingCoverage = followUp.reason === "paid_through_missing";
    return {
      tone: "check",
      label: missingCoverage
        ? zh
          ? "缴至待核"
          : "Couverture à vérifier"
        : zh
          ? "资料待核"
          : "Données à vérifier",
    };
  }
  return {
    tone: "normal",
    label: asset.leaseEvidence?.selfUse
      ? zh
        ? "自用"
        : "Usage propre"
      : followUp.paidThrough
        ? zh
          ? "租金已覆盖"
          : "Loyer couvert"
        : zh
          ? "租赁未登记"
          : "Location non renseignée",
  };
}

export function OperatingWholeLeases({
  rows,
  locale,
  today,
  initialAssetId,
  onOpenDetail,
}: {
  rows: readonly WholeLeaseRow[];
  locale: Locale;
  today: string;
  initialAssetId?: string | null;
  onOpenDetail: (assetId: string) => void;
}) {
  const zh = locale === "zh";
  const [needsFollowUp, setNeedsFollowUp] = useState(false);
  const [activeId, setActiveId] = useState(initialAssetId ?? null);
  const back = useRef<HTMLButtonElement>(null);
  const filters = useRef<HTMLButtonElement>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterChange = useRef<string | null>(null);
  const summaries = rows.map((row) => ({ row, badge: wholeLeaseBadge(row, today, locale) }));
  const active = summaries.find(({ row }) => row.asset.id === activeId);
  const attention = summaries.filter(({ badge }) => badge.tone !== "normal");
  const visible = needsFollowUp ? attention : summaries;

  useEffect(() => {
    const target = focusAfterChange.current;
    if (!target) return;
    focusAfterChange.current = null;
    if (target === "back") back.current?.focus();
    else (cards.current.get(target) ?? filters.current)?.focus();
  }, [activeId]);

  function returnToDirectory() {
    focusAfterChange.current = activeId;
    setActiveId(null);
  }

  if (active) {
    return (
      <section
        aria-label={zh ? "整体出租详情" : "Détail de la location entière"}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          returnToDirectory();
        }}
      >
        <button ref={back} type="button" className={styles.wholeBack} onClick={returnToDirectory}>
          <ArrowLeft size={15} aria-hidden="true" />
          {zh ? "返回整体出租" : "Retour aux locations entières"}
        </button>
        <OperatingWholeLeaseOverview
          row={active.row}
          badge={active.badge}
          locale={locale}
          today={today}
          onOpenDetail={() => onOpenDetail(active.row.asset.id)}
        />
      </section>
    );
  }

  return (
    <section aria-label={zh ? "整体出租" : "Location entière"}>
      <header className={styles.siteHeading}>
        <div className={styles.siteIdentity}>
          <h2>{zh ? "整体出租" : "Location entière"}</h2>
          <span>{zh ? `${rows.length} 项资产` : `${rows.length} actifs`}</span>
        </div>
      </header>
      <div
        className={styles.wholeFilters}
        role="group"
        aria-label={zh ? "跟进筛选" : "Filtres de suivi"}
      >
        <button
          ref={filters}
          type="button"
          aria-pressed={!needsFollowUp}
          onClick={() => setNeedsFollowUp(false)}
        >
          {zh ? "全部资产" : "Tous les actifs"} <span>{rows.length}</span>
        </button>
        <button type="button" aria-pressed={needsFollowUp} onClick={() => setNeedsFollowUp(true)}>
          {zh ? "需跟进" : "À suivre"} <span>{attention.length}</span>
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {zh ? `显示 ${visible.length} 项资产` : `${visible.length} actifs affichés`}
      </p>
      {visible.length ? (
        <ul
          className={styles.wholeGrid}
          aria-label={zh ? "整体出租资产" : "Actifs loués en entier"}
        >
          {visible.map(({ row, badge }) => {
            const { asset, followUp } = row;
            const tenant = wholeTenant(asset, locale);
            const coverage = followUp.paidThrough;
            const tenantLabel =
              tenant.basis && !asset.leaseEvidence?.tenantEvidence
                ? tenant.basis
                : zh
                  ? "租户"
                  : "Locataire";
            return (
              <li key={asset.id}>
                <button
                  type="button"
                  className={styles.wholeCard}
                  data-tone={badge.tone}
                  ref={(element) => {
                    if (element) cards.current.set(asset.id, element);
                    else cards.current.delete(asset.id);
                  }}
                  onClick={() => {
                    focusAfterChange.current = "back";
                    setActiveId(asset.id);
                  }}
                >
                  <span className={styles.wholeCardTitle}>
                    <strong>{asset.displayName}</strong>
                    <ArrowRight size={15} aria-hidden="true" />
                  </span>
                  <span className={styles.wholeCardTenant}>
                    {tenantLabel} {tenant.name}
                  </span>
                  <span className={styles.wholeCardFoot}>
                    <span className={styles.coverage}>
                      {coverage?.status === "pending"
                        ? zh
                          ? "租金记载至"
                          : "Loyer documenté au"
                        : zh
                          ? "已交至"
                          : "Payé au"}{" "}
                      {coverage ? (
                        <time dateTime={coverage.date}>{coverage.date}</time>
                      ) : zh ? (
                        "未登记"
                      ) : (
                        "Non renseigné"
                      )}
                    </span>
                    <span className={styles.wholeBadge} data-tone={badge.tone}>
                      {badge.label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.empty}>
          {zh ? "暂无符合条件的资产。" : "Aucun actif ne correspond aux critères."}
        </p>
      )}
    </section>
  );
}

function OperatingWholeLeaseOverview({
  row,
  badge,
  locale,
  today,
  onOpenDetail,
}: {
  row: WholeLeaseRow;
  badge: WholeLeaseBadge;
  locale: Locale;
  today: string;
  onOpenDetail: () => void;
}) {
  const { asset, entries, followUp } = row;
  const zh = locale === "zh";
  const missing = zh ? "未登记" : "Non renseigné";
  const location = operatingLeaseLocation(asset);
  const tenant = wholeTenant(asset, locale);
  const rent = referenceRent(asset, locale);
  const coverage = followUp.paidThrough;
  const receipts = latestTwoVerifiedRentReceipts(entries, today);
  const outstanding = followUp.outstanding;

  return (
    <article className={styles.wholeOverview} aria-label={asset.displayName}>
      <header className={styles.wholeHeader}>
        <div>
          <p className={styles.wholeMuted}>
            {location ? <>{location} · </> : null}
            {zh ? "租赁概况" : "Aperçu de la location"}
          </p>
          <h2>{asset.displayName}</h2>
        </div>
        <span className={styles.wholeBadge} data-tone={badge.tone}>
          {badge.label}
        </span>
      </header>
      <div className={styles.wholePanels}>
        <section className={styles.wholePanel} aria-label={zh ? "租户资料" : "Locataire"}>
          <h3>{zh ? "租户资料" : "Locataire"}</h3>
          <div className={styles.wholeTenant}>
            <p>{tenant.name}</p>
            {tenant.basis ? <p className={styles.wholeMuted}>{tenant.basis}</p> : null}
          </div>
          <dl className={styles.wholeFacts}>
            <div>
              <dt>{rent.label}</dt>
              <dd>{rent.amount}</dd>
            </div>
          </dl>
        </section>
        <section className={styles.wholePanel} aria-label={zh ? "付款进度" : "Suivi des paiements"}>
          <header className={styles.wholeProgressHeading}>
            <h3>{zh ? "付款进度" : "Suivi des paiements"}</h3>
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
          <dl className={styles.wholeFacts}>
            <div>
              <dt>{zh ? "付款日" : "Échéance"}</dt>
              <dd>
                {followUp.dueDate ? (
                  <time dateTime={followUp.dueDate}>{followUp.dueDate}</time>
                ) : (
                  wholePaymentDateMissing(row, locale)
                )}
              </dd>
            </div>
            <div>
              <dt>{zh ? "待收租金" : "Loyer à recevoir"}</dt>
              <dd>
                {outstanding
                  ? formatPropertyMoney(outstanding.amountNative, outstanding.currency, locale)
                  : missing}
              </dd>
            </div>
          </dl>
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
  const headingText = zh ? "租赁场地" : "Sites de location";
  const empty = (
    <p className={styles.empty}>
      {zh ? "没有符合条件的资产。" : "Aucun actif ne correspond aux critères."}
    </p>
  );

  return (
    <section aria-label={headingText}>
      <header className={styles.siteHeading}>
        <div className={styles.siteIdentity}>
          <h2>{headingText}</h2>
          <span>{zh ? `${sites.length} 处场地` : `${sites.length} sites`}</span>
        </div>
      </header>
      {sites.length ? (
        <ul
          className={styles.siteChoices}
          aria-label={zh ? "分单元场地" : "Sites de location par unité"}
        >
          {sites.map(({ id, name, count, followUpCount }) => (
            <li key={id}>
              <button
                type="button"
                aria-current={id === activeSite ? "true" : undefined}
                onClick={() => onSelectSite(id)}
              >
                <strong>{name}</strong>
                <small>
                  {zh ? `${count} 个单元` : `${count} unités`} ·{" "}
                  <span data-follow-up={followUpCount > 0}>
                    {zh ? `待跟进 ${followUpCount} 项` : `${followUpCount} à suivre`}
                  </span>
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {activeLocation ? (
        <section className={styles.siteUnits}>
          <h3 className={styles.unitHeading}>
            {zh ? `${activeLocation.name} · 出租单元` : `Unités louées · ${activeLocation.name}`}
          </h3>
          <div className={styles.unitFilter}>{statusFilter}</div>
          <OperatingLeaseUnitList
            key={`${activeSite}:${statusKey}`}
            locale={locale}
            siteName={activeLocation.name}
            rows={rows}
            selectedAssetId={selectedAssetId}
            onSelectAsset={onSelectAsset}
            empty={empty}
          />
        </section>
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
    <>
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
      {rows.length ? (
        <ul className={styles.unitGrid} aria-label={zh ? "出租单元" : "Unités louées"}>
          {rows.slice(first, end).map((row) => {
            const rowKey = row.key ?? row.asset.id;
            return (
              <OperatingLeaseCard
                key={rowKey}
                row={row}
                locale={locale}
                siteName={siteName}
                compact
                selected={selectedAssetId === rowKey}
                onSelect={() => onSelectAsset(rowKey)}
              />
            );
          })}
        </ul>
      ) : (
        empty
      )}
    </>
  );
}
