import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Building2, Store, Warehouse } from "lucide-react";
import { constructionLabel } from "@/features/units/unit-workbench-model";
import type { UnitPosition } from "@/features/units/operational-position";
import styles from "./cimac-workspace.module.css";

export type CimacViewLocale = "zh" | "fr";
export const cimacText = (locale: CimacViewLocale, zh: string, fr: string) =>
  locale === "zh" ? zh : fr;

export function CimacPanel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className}`}>
      <header className={styles.panelHead}>
        <h2>{title}</h2>
        {aside}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

export function CimacPageHeading({
  overline,
  title,
  subtitle,
  actions,
  avatar,
  children,
}: {
  overline: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  avatar?: string;
  children?: ReactNode;
}) {
  return (
    <header className={styles.heading}>
      <div className={avatar ? styles.identity : undefined}>
        {avatar ? (
          <span className={styles.avatar} aria-hidden="true">
            {avatar}
          </span>
        ) : null}
        <div className={styles.identityText}>
          <p className={styles.overline}>{overline}</p>
          <h1>{title}</h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          {children}
        </div>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}

export function CimacLink({
  href,
  children,
  button = false,
}: {
  href: string;
  children: ReactNode;
  button?: boolean;
}) {
  return (
    <Link prefetch={false} href={href} className={button ? styles.button : styles.link}>
      {children}
      <ArrowUpRight aria-hidden="true" />
    </Link>
  );
}

export function CimacBackLink({ href, locale }: { href: string; locale: CimacViewLocale }) {
  return (
    <Link prefetch={false} href={href} className={styles.button}>
      <ArrowLeft aria-hidden="true" />
      {cimacText(locale, "返回", "Retour")}
    </Link>
  );
}

export function CimacTabs({
  label,
  items,
  active,
}: {
  label: string;
  items: { key: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {items.map((item) => (
        <Link
          prefetch={false}
          key={item.key}
          href={item.href}
          className={styles.tab}
          aria-current={item.key === active ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function CimacFacts({
  rows,
  locale,
}: {
  rows: { label: string; value: ReactNode }[];
  locale: CimacViewLocale;
}) {
  return (
    <dl className={styles.facts}>
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>
            {row.value === null || row.value === undefined || row.value === ""
              ? cimacText(locale, "待核", "À vérifier")
              : row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CimacEmpty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

export function CimacPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "blue" | "amber" | "green";
}) {
  return (
    <span
      className={`${styles.pill} ${tone === "blue" ? styles.pillBlue : tone === "amber" ? styles.pillAmber : tone === "green" ? styles.pillGreen : ""}`}
    >
      {children}
    </span>
  );
}

export function CimacAssetIcon({ kind }: { kind: string }) {
  const Icon = kind === "warehouse" ? Warehouse : kind === "storefront" ? Store : Building2;
  return (
    <span className={styles.propertyIcon}>
      <Icon aria-hidden="true" />
    </span>
  );
}

export function cimacAssetKind(kind: string, locale: CimacViewLocale) {
  const labels: Record<string, [string, string]> = {
    storefront: ["商铺", "Boutique"],
    apartment: ["公寓", "Appartement"],
    warehouse: ["仓库", "Entrepôt"],
    parking: ["停车位", "Stationnement"],
    office: ["办公室", "Bureau"],
  };
  return (
    labels[kind]?.[locale === "zh" ? 0 : 1] ?? cimacText(locale, "类型待核", "Type à vérifier")
  );
}

export function cimacOccupancy(
  asset: { position: UnitPosition | null; occupancyVerified: boolean | null },
  locale: CimacViewLocale,
) {
  if (asset.position?.daily_occupied && asset.position.lease_occupied)
    return cimacText(locale, "占用冲突 · 待核", "Occupations incompatibles · à vérifier");
  if (asset.position?.lease_occupied)
    return asset.occupancyVerified === true
      ? cimacText(locale, "租约占用", "Occupation par bail")
      : cimacText(
          locale,
          "登记租约占用 · 现场待核",
          "Occupation par bail enregistrée · terrain à vérifier",
        );
  if (asset.position?.daily_occupied)
    return cimacText(locale, "日租占用 · 需核", "Séjour journalier · à vérifier");
  if (!asset.position || asset.occupancyVerified !== true)
    return cimacText(locale, "占用待核", "Occupation à vérifier");
  return cimacText(locale, "无当前占用", "Sans occupation actuelle");
}

export function cimacCondition(asset: { position: UnitPosition | null }, locale: CimacViewLocale) {
  const labels: Record<string, [string, string]> = {
    normal: ["正常", "Normal"],
    maintenance: ["维修中", "En maintenance"],
    locked: ["锁定", "Bloqué"],
  };
  return (
    labels[asset.position?.operational_condition ?? ""]?.[locale === "zh" ? 0 : 1] ??
    cimacText(locale, "状态待核", "État à vérifier")
  );
}

export function cimacConstruction(value: string | null | undefined, locale: CimacViewLocale) {
  if (value === "partially_operational")
    return cimacText(locale, "部分可投入使用", "Partiellement opérationnel");
  return constructionLabel(value ?? undefined, locale);
}

export function cimacContractStatus(status: string, locale: CimacViewLocale) {
  const labels: Record<string, [string, string]> = {
    active: ["生效中", "Actif"],
    signed_effective: ["合同资料已生效", "Dossier contractuel en vigueur"],
    unconfirmed: ["资料待核", "Dossier à vérifier"],
    draft: ["草稿", "Brouillon"],
    terminated: ["已终止", "Résilié"],
    expired: ["已到期（登记）", "Échu (enregistré)"],
    cancelled: ["已取消", "Annulé"],
    completed: ["已完成（登记）", "Terminé (enregistré)"],
  };
  return (
    labels[status]?.[locale === "zh" ? 0 : 1] ?? cimacText(locale, "状态待核", "État à vérifier")
  );
}

export function cimacDate(value: string | null | undefined, locale: CimacViewLocale) {
  if (!value || value >= "2099-01-01") return cimacText(locale, "待核", "À vérifier");
  return value;
}

export function cimacNumber(value: number | null | undefined, locale: CimacViewLocale) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
        maximumFractionDigits: 3,
      }).format(value);
}

export function CimacPagination({
  page,
  pageSize,
  total,
  previous,
  next,
  locale,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  previous?: string;
  next?: string;
  locale: CimacViewLocale;
  label: string;
}) {
  return (
    <nav className={styles.pagination} aria-label={label}>
      <span>
        {cimacText(
          locale,
          `共 ${total} 条 · 第 ${page} / ${Math.max(1, Math.ceil(total / pageSize))} 页`,
          `${total} entrées · page ${page} / ${Math.max(1, Math.ceil(total / pageSize))}`,
        )}
      </span>
      <div className={styles.actions}>
        {previous ? (
          <Link prefetch={false} className={styles.button} href={previous}>
            {cimacText(locale, "上一页", "Précédent")}
          </Link>
        ) : null}
        {next ? (
          <Link prefetch={false} className={styles.button} href={next}>
            {cimacText(locale, "下一页", "Suivant")}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function CimacPendingOperations({ locale }: { locale: CimacViewLocale }) {
  return (
    <>
      <div className={styles.sideItem}>
        <h3>
          {cimacText(locale, "交付与使用分别核实", "Livraison et usage à vérifier séparément")}
        </h3>
        <p>
          {cimacText(
            locale,
            "合同签约、建设条件或资产占用不代表已验收交付，也不代表已开业。当前没有独立交付与开业记录。",
            "Un bail, l’état du bâti ou l’occupation ne prouvent ni la réception ni l’ouverture. Aucun registre distinct de livraison et d’ouverture n’est disponible ici.",
          )}
        </p>
      </div>
      <div className={styles.sideItem}>
        <h3>{cimacText(locale, "事项与负责人", "Suivi et responsables")}</h3>
        <p>
          {cimacText(
            locale,
            "通用工单、负责人及处理期限尚未接入；不生成虚构待办或完成率。",
            "Les tâches générales, responsables et échéances ne sont pas encore intégrés. Aucun suivi ou taux d’achèvement n’est inventé.",
          )}
        </p>
      </div>
    </>
  );
}
