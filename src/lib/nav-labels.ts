import type { Locale } from "@/lib/i18n";

export interface DesktopNavLabels {
  brand: string;
  building: string;
  groups: Record<string, string>;
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
    groups: {
      home: "首页",
      business: "租售业务",
      financeCenter: "财务中心",
      operations: "运营中心",
      systemTools: "系统工具",
    },
    nav: {
      workbench: "工作台",
      management: "经营驾驶舱",
      units: "房源总览",
      dailyRentals: "日租业务",
      leases: "长租业务",
      sales: "出售业务",
      customers: "客户档案",
      finance: "应收与收款",
      reports: "财务报表",
      todos: "待办提醒",
      documents: "单据打印",
      dataQuality: "数据质量",
      auditLogs: "审计日志",
      dataExchange: "导入导出",
      bulkActions: "批量操作",
      targets: "经营目标",
      settings: "系统设置",
      security: "安全备份",
    },
  },
  fr: {
    brand: "Kejian Immobilier",
    building: "SASCI11 · Phase 1",
    roles: { admin: "Administrateur", boss: "Proprietaire", finance: "Comptable", front_desk: "Reception" },
    groups: {
      home: "Accueil",
      business: "Activites",
      financeCenter: "Finance",
      operations: "Operations",
      systemTools: "Outils",
    },
    nav: {
      workbench: "Tableau de bord",
      management: "Direction",
      units: "Lots",
      dailyRentals: "Location jour",
      leases: "Baux",
      sales: "Ventes",
      customers: "Clients",
      finance: "Creances",
      reports: "Rapports",
      todos: "Taches",
      documents: "Documents",
      dataQuality: "Qualite",
      auditLogs: "Audit",
      dataExchange: "Echange",
      bulkActions: "Actions",
      targets: "Objectifs",
      settings: "Parametres",
      security: "Securite",
    },
  },
};

const mobile: Record<Locale, MobileNavLabels> = {
  zh: { workbench: "工作台", daily: "日租", units: "房源", profile: "客户" },
  fr: { workbench: "Accueil", daily: "Jour", units: "Lots", profile: "Clients" },
};

export function getDesktopNavLabels(locale: Locale): DesktopNavLabels {
  return desktop[locale];
}

export function getMobileNavLabels(locale: Locale): MobileNavLabels {
  return mobile[locale];
}
