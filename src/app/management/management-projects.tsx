import Link from "next/link";
import { ArrowRight, Building2, CircleDollarSign, Construction, LockKeyhole, MapPin, PackageOpen, Store, Warehouse } from "lucide-react";
import { MetricGrid, StatTile } from "@/components/ui/operational";
import { routeFor, type Locale } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import type { BuildingRow, ProjectRow } from "@/types/database";
import type { CimacOverview } from "./management-data";

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
  const cardClass = "group relative overflow-hidden rounded-xl border bg-card p-4 text-left shadow-card outline-none transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-panel focus-visible:ring-2 focus-visible:ring-primary/30";

  return (
    <section aria-labelledby="project-portfolio-title" className="space-y-3">
      <div className="flex items-end justify-between gap-4 px-1">
        <div>
          <h2 id="project-portfolio-title" className="text-[15px] font-semibold">{zh ? "项目总览" : "Portefeuille de projets"}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{zh ? "选择项目后查看对应的资产和经营口径" : "Sélectionnez un projet pour afficher son périmètre opérationnel"}</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Link
          href={routeFor(locale, "/management?project=SACSI")}
          className={cn(cardClass, selectedProjectCode === "SACSI" && "border-primary/45 ring-2 ring-primary/10")}
          aria-current={selectedProjectCode === "SACSI" ? "page" : undefined}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">{zh ? "SACSI 公寓项目" : "Projet résidentiel SACSI"}</h3>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{zh ? "公寓及配套资产 · 日租 / 长租 / 出售" : "Appartements et annexes · jour / bail / vente"}</p>
              <p className="mt-3 text-sm font-medium tabular-nums">{sacsiBuildingCount} {zh ? "栋在管" : "bâtiments gérés"}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>

        <Link
          href={routeFor(locale, "/management?project=CIMAC")}
          className={cn(cardClass, "pt-5", selectedProjectCode === "CIMAC" && "border-primary/45 ring-2 ring-primary/10")}
          aria-current={selectedProjectCode === "CIMAC" ? "page" : undefined}
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-amber-500" aria-hidden="true" />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Store className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">{zh ? "科建建材城 CIMAC" : "CIMAC"}</h3>
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{zh ? "只租不卖" : "Location uniquement"}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{zh ? "综合建材商业园区 · 分期建设" : "Parc commercial de matériaux · construction par phases"}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium tabular-nums">
                <span>{cimac?.buildingCount ?? 10} {zh ? "栋" : "bâtiments"}</span>
                <span>{cimac?.shopCount ?? 186} {zh ? "间商铺" : "commerces"}</span>
                <span className="text-amber-700">{cimac?.primeCount ?? 50} {zh ? "间优质地段" : "premium"}</span>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
      </div>
    </section>
  );
}

export function CimacProjectOverview({ overview, locale }: { overview: CimacOverview; locale: Locale }) {
  const zh = locale === "zh";
  const unitsHref = routeFor(locale, "/units?project=CIMAC");
  const assetCards = [
    { key: "shops", icon: Store, title: zh ? "商业区商铺" : "Commerces", value: `${overview.shopCount} ${zh ? "间" : "lots"}`, meta: zh ? "第一栋至第十栋 · 基础台账已建立" : "Bâtiments 1 à 10 · registre créé", ready: true },
    { key: "warehouses", icon: Warehouse, title: zh ? "仓储区" : "Entrepôts", value: zh ? "约 20,000㎡" : "Env. 20 000 m²", meta: zh ? "等待仓库编号、面积和建设状态" : "Numéros, surfaces et état à fournir", ready: false },
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
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{zh ? "租赁状态未核实" : "Location non vérifiée"}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{zh ? "已录入编号、面积、标准月租和地段；未录入手写姓名、勾选、合同及财务。" : "Numéros, surfaces, loyers standard et emplacement saisis. Noms manuscrits, contrats et finances exclus."}</p>
          </div>
          <Link href={unitsHref} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            {zh ? "查看商铺档案" : "Voir les commerces"}<ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <MetricGrid columns={4}>
        <StatTile icon={Store} label={zh ? "商业区商铺" : "Commerces"} value={overview.shopCount} caption={`${overview.buildingCount} ${zh ? "栋" : "bâtiments"}`} />
        <StatTile icon={Construction} label={zh ? "建设 / 运营待核" : "État à vérifier"} value={overview.unverifiedCount} caption={zh ? "不计入空置率" : "Exclus du taux de vacance"} />
        <StatTile icon={MapPin} tone="amber" label={zh ? "中央大道优质地段" : "Axe central premium"} value={overview.primeCount} caption={`${overview.standardCount} ${zh ? "间普通地段" : "emplacements standard"}`} />
        <StatTile icon={CircleDollarSign} tone="blue" label={zh ? "标准满租月租" : "Loyer mensuel théorique"} value={formatXof(overview.standardMonthlyRentXof)} caption={zh ? "价格表口径，非实际应收" : "Tarif catalogue, hors créances réelles"} />
      </MetricGrid>

      <section className="rounded-xl border border-border bg-card p-4 shadow-card" aria-labelledby="cimac-assets-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="cimac-assets-title" className="text-[15px] font-semibold">{zh ? "资产组成" : "Composition des actifs"}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{zh ? "未建设完成的资产与可出租资产分开管理" : "Les actifs en construction restent séparés des actifs louables"}</p>
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

      <section aria-labelledby="cimac-buildings-title" className="space-y-3">
        <div className="px-1">
          <h2 id="cimac-buildings-title" className="text-[15px] font-semibold">{zh ? "第一栋至第十栋" : "Bâtiments 1 à 10"}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{zh ? "楼栋租赁状态统一保留为待核实" : "État locatif conservé comme non vérifié"}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {overview.buildings.map((building) => (
            <Link
              key={building.id}
              href={routeFor(locale, `/units?project=CIMAC&building=${building.code}`)}
              className="group rounded-xl border border-border bg-card p-3.5 shadow-card outline-none transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-panel focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{building.displayName}</h3>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{building.code}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-muted-foreground">{zh ? "商铺" : "Lots"}</p><p className="mt-0.5 font-semibold tabular-nums">{building.shopCount}</p></div>
                <div><p className="text-muted-foreground">{zh ? "优质地段" : "Premium"}</p><p className="mt-0.5 font-semibold tabular-nums text-amber-700">{building.primeCount}</p></div>
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-[11px] text-muted-foreground">{zh ? "标准满租月租" : "Loyer théorique"}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatXof(building.standardMonthlyRentXof)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{building.unverifiedCount} {zh ? "间状态待核实" : "lots à vérifier"}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
