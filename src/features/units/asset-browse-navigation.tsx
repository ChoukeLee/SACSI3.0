import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import styles from "./unit-workbench.module.css";

export type AssetBrowseCategory = "apartment" | "multi-unit" | "whole";

export function parseAssetBrowseCategory(
  value: unknown,
  legacyOperations = false,
): AssetBrowseCategory {
  return value === "apartment" || value === "multi-unit" || value === "whole"
    ? value
    : legacyOperations
      ? "multi-unit"
      : "apartment";
}

export function AssetBrowseNavigation({
  locale,
  category = "apartment",
  canReadOperatingAssets = true,
  maintenance = false,
  project,
}: {
  locale: Locale;
  category?: AssetBrowseCategory;
  canReadOperatingAssets?: boolean;
  maintenance?: boolean;
  project?: string;
}) {
  const zh = locale === "zh";
  const href = (next: AssetBrowseCategory | "maintenance") => {
    const params = new URLSearchParams();
    if (project) params.set("project", project);
    if (next === "maintenance") params.set("assetView", "maintenance");
    else {
      params.set("assetCategory", next);
      if (next !== "apartment") params.set("assetView", "operations");
    }
    return routeFor(locale, `/units?${params}`);
  };
  const options: [AssetBrowseCategory, string][] = [
    ["apartment", zh ? "公寓" : "Appartements"],
    ...(canReadOperatingAssets
      ? ([
          ["multi-unit", zh ? "分单元出租" : "Location par lots"],
          ["whole", zh ? "整体出租" : "Location en entier"],
        ] as [AssetBrowseCategory, string][])
      : []),
  ];
  return (
    <nav className={styles.assetNavigation} aria-label={zh ? "资产浏览" : "Parcourir les actifs"}>
      <div className={styles.assetNavigationTabs}>
        {options.map(([value, label]) => (
          <Link
            key={value}
            href={href(value)}
            prefetch={false}
            aria-current={!maintenance && category === value ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </div>
      {canReadOperatingAssets ? (
        <Link
          className={styles.sourceMaintenance}
          href={href("maintenance")}
          prefetch={false}
          aria-current={maintenance ? "page" : undefined}
        >
          {zh ? "来源维护" : "Sources"}
        </Link>
      ) : null}
    </nav>
  );
}
