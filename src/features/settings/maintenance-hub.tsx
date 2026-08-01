import Link from "next/link";
import { Building2, DatabaseZap, ShieldCheck, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { routeFor, type Locale } from "@/lib/i18n";
import type { UserRole } from "@/lib/auth";
import type { BuildingRow } from "@/types/database";

interface AccountSummary {
  email: string;
  displayName: string;
  role: UserRole;
}

interface MaintenanceHubProps {
  locale: Locale;
  accounts: AccountSummary[];
  buildings: BuildingRow[];
}

const roleLabels: Record<Locale, Record<UserRole, string>> = {
  zh: {
    admin: "管理员",
    boss: "只读管理",
    finance: "财务",
    front_desk: "前台",
    rental_sales: "租售业务",
  },
  fr: {
    admin: "Administrateur",
    boss: "Direction (lecture)",
    finance: "Finance",
    front_desk: "Réception",
    rental_sales: "Location et vente",
  },
};

const roleScopes: Record<Locale, Record<UserRole, string>> = {
  zh: {
    admin: "全部功能与系统维护",
    boss: "首页、房源、日租、长租、出售、客户、财务及审计日志（只读）",
    finance: "客户与财务可登记；其他授权业务只读",
    front_desk: "日租操作；长租只读",
    rental_sales: "客户、日租、长租及出售业务操作",
  },
  fr: {
    admin: "Toutes les fonctions et la maintenance système",
    boss: "Accueil, biens, locations, ventes, clients, finance et audit (lecture seule)",
    finance: "Saisie clients et finance ; autres activités en lecture",
    front_desk: "Opérations journalières ; baux en lecture",
    rental_sales: "Clients, locations journalières, baux et ventes",
  },
};

export function MaintenanceHub({ locale, accounts, buildings }: MaintenanceHubProps) {
  const zh = locale === "zh";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {zh ? "系统维护" : "Maintenance système"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {zh
            ? "这里只保留管理员真正需要维护的基础信息和审计入口。"
            : "Uniquement les accès, les données de base et les contrôles utiles."}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UsersRound className="h-5 w-5 text-primary" />
            {zh ? "账号与权限" : "Comptes et droits"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            {zh
              ? "当前仍存在同一账号多人共用的情况。系统权限按登录账号生效，操作追溯只能定位到账号，不能准确区分实际操作人。"
              : "Les droits suivent le compte connecté. Un compte partagé ne permet pas d'identifier précisément l'opérateur réel."}
          </p>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">{zh ? "账号" : "Compte"}</th>
                  <th className="px-4 py-2.5">{zh ? "显示名" : "Nom"}</th>
                  <th className="px-4 py-2.5">{zh ? "系统身份" : "Rôle"}</th>
                  <th className="px-4 py-2.5">{zh ? "权限范围" : "Périmètre"}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {accounts.map((account) => (
                  <tr key={account.email}>
                    <td className="px-4 py-2.5 font-mono text-xs">{account.email}</td>
                    <td className="px-4 py-2.5">{account.displayName}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary">{roleLabels[locale][account.role]}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{roleScopes[locale][account.role]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5 text-primary" />
            {zh ? "楼栋与房源基础" : "Immeubles et logements"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {buildings.map((building) => (
              <div key={building.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                <div>
                  <p className="font-semibold">{building.display_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {building.code} · {building.floors_above_ground}{zh ? " 层" : " étages"}
                  </p>
                </div>
                <Badge variant={building.is_active && !building.business_paused ? "success" : "secondary"}>
                  {building.is_active && !building.business_paused
                    ? (zh ? "启用" : "Actif")
                    : (zh ? "停用" : "Inactif")}
                </Badge>
              </div>
            ))}
          </div>
          <Button asChild variant="outline">
            <Link href={routeFor(locale, "/units")}>
              {zh ? "进入房源基础信息" : "Ouvrir les logements"}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <DatabaseZap className="h-5 w-5 text-primary" />
              {zh ? "数据质量" : "Qualité des données"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              {zh ? "核对订单、房态、应收和流水之间是否一致。" : "Contrôler les réservations, statuts, créances et écritures."}
            </p>
            <Button asChild>
              <Link href={routeFor(locale, "/data-quality")}>
                {zh ? "查看数据质量" : "Voir les contrôles"}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {zh ? "审计日志" : "Journal d'audit"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              {zh ? "查看关键业务变更及其登录账号。" : "Voir les changements métier et le compte connecté."}
            </p>
            <Button asChild>
              <Link href={routeFor(locale, "/settings/audit-logs")}>
                {zh ? "查看审计日志" : "Voir le journal"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
