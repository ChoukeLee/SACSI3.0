import type { Locale } from "@/lib/i18n";

/** Slim nav-only labels — avoids bundling the full 1400-line dictionary into client nav components. */

export interface DesktopNavLabels {
  brand: string;
  building: string;
  nav: Record<string, string>;
  roles: Record<string, string>;
}

export interface MobileNavLabels {
  workbench: string;
  daily: string;
  units: string;
  profile: string;
}

const desktop: Record<Locale, DesktopNavLabels> = {
  zh: {
    brand: "科建地产",
    building: "SASCI11 · 11#",
    roles: { admin: "管理员", boss: "老板", finance: "财务", front_desk: "前台" },
    nav: {
      dashboard: "仪表盘",
      units: "11#房源",
      dailyRentals: "日租",
      dailyOccupancy: "日租占用",
      leases: "长租",
      sales: "出售",
      customers: "客户",
      finance: "财务",
      reports: "报表",
      settings: "设置",
      management: "经营驾驶舱",
    },
  },
  fr: {
    brand: "Kejian Immobilier",
    building: "SASCI11 · Phase 1",
    roles: { admin: "Administrateur", boss: "Proprietaire", finance: "Comptable", front_desk: "Reception" },
    nav: {
      dashboard: "Tableau de bord",
      units: "Lots 11#",
      dailyRentals: "Location jour",
      dailyOccupancy: "Occupation jour",
      leases: "Location longue",
      sales: "Vente",
      customers: "Clients",
      finance: "Finance",
      reports: "Rapports",
      settings: "Parametres",
      management: "Direction",
    },
  },
};

const mobile: Record<Locale, MobileNavLabels> = {
  zh: { workbench: "工作台", daily: "日租", units: "房源", profile: "我的" },
  fr: { workbench: "Accueil", daily: "Jour", units: "Lots", profile: "Moi" },
};

export function getDesktopNavLabels(locale: Locale): DesktopNavLabels {
  return desktop[locale];
}

export function getMobileNavLabels(locale: Locale): MobileNavLabels {
  return mobile[locale];
}
