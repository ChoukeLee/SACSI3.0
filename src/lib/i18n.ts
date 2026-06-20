import { zhDict } from "./dictionaries/zh";
import { frDict } from "./dictionaries/fr";

export type Locale = "zh" | "fr";

export const defaultLocale: Locale = "zh";
export const locales: Locale[] = ["zh", "fr"];

export function normalizeLocale(value: string | undefined): Locale {
  return value === "fr" ? "fr" : "zh";
}

export const dictionaries = { zh: zhDict, fr: frDict } as const;

export function routeFor(locale: Locale, href: string) {
  const path = href.startsWith("/fr/") ? href.slice(3) : href === "/fr" ? "/" : href;
  if (locale === "zh") return path;
  return path === "/" ? "/fr" : `/fr${path}`;
}

type Widen<T> = T extends string ? string : T extends readonly (infer U)[] ? Widen<U>[] : T extends object ? { [K in keyof T]: Widen<T[K]> } : T;

export type StatusesDict = Widen<typeof dictionaries.zh.statuses>;
export type ShellDict = Widen<typeof dictionaries.zh.shell>;
export type UnitsDict = Widen<typeof dictionaries.zh.units>;
export type DailyRentalsDict = Widen<typeof dictionaries.zh.dailyRentals>;
export type DailyOccupancyDict = Widen<typeof dictionaries.zh.dailyOccupancy>;
export type LeasesDict = Widen<typeof dictionaries.zh.leases>;
export type SalesDict = Widen<typeof dictionaries.zh.sales>;
export type CustomersDict = Widen<typeof dictionaries.zh.customers>;
export type FinanceDict = Widen<typeof dictionaries.zh.finance>;
export type ReceivablesDict = Widen<typeof dictionaries.zh.receivables>;
export type SettingsDict = Widen<typeof dictionaries.zh.settings>;
export type ManagementDict = Widen<typeof dictionaries.zh.management>;
export type MobileDict = Widen<typeof dictionaries.zh.mobile>;
