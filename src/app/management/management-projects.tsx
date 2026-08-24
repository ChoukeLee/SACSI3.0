import Link from "next/link";
import { ArrowRight, Building2, CircleDollarSign, Construction, LockKeyhole, MapPin, PackageOpen, Store, Warehouse } from "lucide-react";
import { MetricGrid, StatTile } from "@/components/ui/operational";
import { routeFor, type Locale } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import type { BuildingRow, ProjectRow } from "@/types/database";
import type { CimacOverview } from "./management-data";
import { CimacShopMap } from "./cimac-shop-map";

export function ProjectPortfolioCards({
  projects,
  buildings,
  cimac,
  selectedProjectCode,
  locale,
}: {
  projects: ProjectRow[];
  buildings: BuildingRow[];
  cimac: CimacOverview | null;
  selectedProjectCode: string;
  locale: Locale;
}) {
  const zh = locale === "zh";
  const sacsi = projects.find((project) => project.code === "SACSI");
  const sacsiBuildingCount = buildings.filter((building) => building.project_id === sacsi?.id).length;
  const portfolioCards = [
    {
      code: "SACSI",
      icon: Building2,
      title: zh ? "SACSI 公寓项目" : "Projet résidentiel SACSI",
      badge: zh ? "综合经营" : "Multi-activité",
      description: zh ? "公寓及配套资产" : "Appartements et actifs annexes",
      metrics: [
        { value: `${sacsiBuildingCount} ${zh ? "栋" : "bât."}`, label: zh ? "在管楼栋" : "Gérés" },
        { value: zh ? "日租" : "Jour", label: zh ? "住宿业务" : "Hébergement" },
        { value: zh ? "长租 · 出售" : "Bail · Vente", label: zh ? "资产经营" : "Exploitation" },
      ],
    },
    {
      code: "CIMAC",
      icon: Store,
      title: zh ? "科建建材城 CIMAC" : "CIMAC",
      badge: zh ? "只租不卖" : "Location uniquement",
      description: zh ? "商铺与仓库已建成可交付 · 其余分期建设" : "Commerces et entrepôt livrables · autres phases en cours",
      metrics: [
        { value: `${cimac?.buildingCount ?? 10} ${zh ? "栋" : "bât."}`, label: zh ? "商业楼栋" : "Bâtiments" },
        { value: `${cimac?.shopCount ?? 186} ${zh ? "间" : "lots"}`, label: zh ? "商业区商铺" : "Commerces" },
        { value: `${cimac?.primeCount ?? 50} ${zh ? "间" : "lots"}`, label: zh ? "优质地段" : "Premium", tone: "amber" },
      ],
    },
  ];
  const cardClass = "group flex min-h-[148px] flex-col rounded-xl border border-border bg-card p-4 text-left shadow-card outline-none transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-panel focus-visible:ring-2 focus-visible:ring-primary/30 motion-reduce:transform-none motion-reduce:transition-none sm:p-5";

  return (
    <section aria-labelledby="project-portfolio-title" className="space-y-3">
      <div className="flex items-end justify-between gap-4 px-1">
        <div>
          <h2 id="project-portfolio-title" className="text-[15px] font-semibold">{zh ? "项目总览" : "Portefeuille de projets"}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{zh ? "选择项目后查看对应的资产和经营口径" : "Sélectionnez un projet pour afficher son périmètre opérationnel"}</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {portfolioCards.map((project) => {
          const Icon = project.icon;
          const isSelected = selectedProjectCode === project.code;
          return (
            <Link
              key={project.code}
              href={routeFor(locale, `/management?project=${project.code}`)}
              className={cn(cardClass, isSelected && "border-primary/45 bg-primary/[0.025] ring-1 ring-primary/15")}
              aria-current={isSelected ? "page" : undefined}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-primary" aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-semibold leading-6">{project.title}</h3>
                    <span className="whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{project.badge}</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{project.description}</p>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground" aria-hidden="true">
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
                </span>
              </div>
              <div className="mt-auto grid grid-cols-3 divide-x divide-border border-t border-border pt-3">
                {project.metrics.map((metric) => (
                  <div key={metric.label} className="min-w-0 px-3 first:pl-0 last:pr-0">
                    <p className={cn("truncate text-sm font-semibold tabular-nums", metric.tone === "amber" && "text-amber-700")}>{metric.value}</p>
                    <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">{metric.label}</p>
                  </div>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function CimacProjectOverview({ overview, locale }: { overview: CimacOverview; locale: Locale }) {
  const zh = locale === "zh";
  const unitsHref = routeFor(locale, "/units?project=CIMAC");
  const assetCards = [
    { key: "shops", icon: Store, title: zh ? "商业区商铺" : "Commerces", value: `${overview.shopCount} ${zh ? "间" : "lots"}`, meta: zh ? "第一栋至第十栋 · 基础台账已建立" : "Bâtiments 1 à 10 · registre créé", ready: true },
    { key: "warehouses", icon: Warehouse, title: zh ? "仓储区" : "Entrepôts", value: zh ? "513㎡ 已登记" : "513 m² enregistré", meta: zh ? "已建成可交付 · 仓库编号与月租待确认" : "Livrable · numéro et loyer à confirmer", ready: true },
    { key: "apartments", icon: Building2, title: zh ? "公寓" : "Appartements", value: `128 ${zh ? "间规划" : "prévus"}`, meta: zh ? "一室 / 两室 · 详细台账待导入" : "1 / 2 chambres · registre à importer", ready: false },
    { key: "ground-shops", icon: PackageOpen, title: zh ? "公寓底商" : "Commerces en pied d’immeuble", value: zh ? "待编号" : "À numéroter", meta: zh ? "与186间商业区商铺分开统计" : "Comptés séparément des 186 commerces", ready: false },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4 shadow-card" aria-labelledby="cimac-scope-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="cimac-scope-title" className="text-[15px] font-semibold">{zh ? "商业区当前口径" : "Périmètre commercial actuel"}</h2>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{zh ? "商铺与仓库可交付" : "Commerces et entrepôt livrables"}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{zh ? "商铺与仓库已建成；开业活动为付一年赠一年。项目开业日及正式合同起始日待确认，暂不生成到期日和应收计划。" : "Actifs commerciaux achevés. Offre: 12 mois payés + 12 mois offerts. Début du bail à confirmer avant tout échéancier."}</p>
          </div>
          <Link href={unitsHref} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            {zh ? "查看商铺档案" : "Voir les commerces"}<ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <MetricGrid columns={4}>
        <StatTile icon={Store} label={zh ? "商业区商铺" : "Commerces"} value={overview.shopCount} caption={`${overview.buildingCount} ${zh ? "栋" : "bâtiments"}`} />
        <StatTile icon={Construction} label={zh ? "待核建设状态" : "État à vérifier"} value={overview.unverifiedCount} caption={zh ? "商铺已开放交付" : "Commerces ouverts à la livraison"} />
        <StatTile icon={MapPin} tone="amber" label={zh ? "中央大道优质地段" : "Axe central premium"} value={overview.primeCount} caption={`${overview.standardCount} ${zh ? "间普通地段" : "emplacements standard"}`} />
        <StatTile icon={CircleDollarSign} tone="blue" label={zh ? "标准满租月租" : "Loyer mensuel théorique"} value={formatXof(overview.standardMonthlyRentXof)} caption={zh ? "价格表口径，非实际应收" : "Tarif catalogue, hors créances réelles"} />
      </MetricGrid>

      <section className="rounded-xl border border-border bg-card p-4 shadow-card" aria-labelledby="cimac-assets-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="cimac-assets-title" className="text-[15px] font-semibold">{zh ? "资产组成" : "Composition des actifs"}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{zh ? "商铺、仓库已开放；公寓及公寓底商继续按建设进度管理" : "Commerces et entrepôt ouverts; logements suivis séparément"}</p>
          </div>
          <LockKeyhole className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {assetCards.map((asset) => {
            const Icon = asset.icon;
            return (
              <div key={asset.key} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <Icon className={cn("h-4 w-4", asset.ready ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", asset.ready ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground")}>{asset.ready ? (zh ? "已建档" : "Créé") : (zh ? "待资料" : "En attente")}</span>
                </div>
                <h3 className="mt-3 text-sm font-semibold">{asset.title}</h3>
                <p className="mt-1 text-lg font-semibold tabular-nums">{asset.value}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{asset.meta}</p>
              </div>
            );
          })}
        </div>
      </section>

      <CimacShopMap overview={overview} locale={locale} />
    </div>
  );
}
