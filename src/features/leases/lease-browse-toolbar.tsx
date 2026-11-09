"use client";

import { useEffect, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Search } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import {
  leaseBrowseCategories,
  leaseBrowseCategoryLabel,
  leaseBrowseCookieName,
  leaseBrowseHref,
  leaseCollectionHref,
  leaseSearchHref,
  leaseSearchLimit,
  parseLeaseBrowseCategory,
  type LeaseBrowseCategory,
} from "./lease-browse-model";
import styles from "./lease-workbench.module.css";

export type { LeaseBrowseCategory } from "./lease-browse-model";

export function LeaseBrowsePreference({
  viewerId,
  category,
}: {
  viewerId: string;
  category: LeaseBrowseCategory;
}) {
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${leaseBrowseCookieName(viewerId)}=${category}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }, [category, viewerId]);
  return null;
}

export function LeaseBrowseToolbar({
  locale,
  category,
  location,
  searchQuery,
}: {
  locale: Locale;
  category: LeaseBrowseCategory;
  location?: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
    label: string;
  };
  searchQuery?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const zh = locale === "zh";
  const searchLabel = zh ? "跨类别搜索" : "Rechercher dans toutes les catégories";

  function switchCategory(value: string) {
    const next = parseLeaseBrowseCategory(value);
    if (!next) return;
    startTransition(() => router.push(leaseBrowseHref(locale, next)));
  }

  function searchAssets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("q");
    if (typeof query !== "string" || (!query.trim() && !searchQuery)) return;
    startTransition(() => router.push(leaseSearchHref(locale, category, query)));
  }

  return (
    <div
      className={styles.browseToolbar}
      role="group"
      aria-label={zh ? "长租浏览工具栏" : "Outils de navigation des locations"}
      aria-busy={pending}
    >
      <select
        aria-label={zh ? "资产类别" : "Catégorie d’actifs"}
        className={styles.browseSelect}
        value={category}
        onChange={(event) => switchCategory(event.target.value)}
        disabled={pending}
      >
        {leaseBrowseCategories.map((option) => (
          <option key={option} value={option}>
            {leaseBrowseCategoryLabel(option, locale)}
          </option>
        ))}
      </select>
      {location ? (
        <select
          aria-label={location.label}
          className={styles.browseSelect}
          value={location.value}
          onChange={(event) => location.onChange(event.target.value)}
          disabled={pending}
        >
          {location.options.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      ) : null}
      <form className={styles.browseSearch} onSubmit={searchAssets}>
        <input
          key={searchQuery ?? ""}
          type="search"
          name="q"
          aria-label={searchLabel}
          placeholder={zh ? "搜索房号、资产名称或租户" : "Lot, nom du bien ou locataire"}
          defaultValue={searchQuery}
          maxLength={leaseSearchLimit}
        />
        <button type="submit" aria-label={searchLabel} title={searchLabel} disabled={pending}>
          <Search size={16} aria-hidden="true" />
        </button>
      </form>
      {searchQuery ? (
        <Link
          className={styles.browseAction}
          href={leaseBrowseHref(locale, category)}
          prefetch={false}
        >
          {zh ? "返回分类" : "Revenir à la catégorie"}
        </Link>
      ) : null}
      <Link className={styles.browseAction} href={leaseCollectionHref(locale)} prefetch={false}>
        <CalendarClock size={16} aria-hidden="true" />
        {zh ? "收款跟进" : "Suivi des loyers"}
      </Link>
    </div>
  );
}
