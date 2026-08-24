import Link from "next/link";
import { ArrowLeftRight, ArrowRight, Building2, CircleDollarSign, Construction, LockKeyhole, MapPin, PackageOpen, Store, Warehouse } from "lucide-react";
import { MetricGrid, StatTile } from "@/components/ui/operational";
import { routeFor, type Locale } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import type { BuildingRow, ProjectRow } from "@/types/database";
import type { CimacOverview } from "./management-data";
import { CIMAC_SITE_ROWS, orderCimacShopsForPlan } from "./cimac-site-layout";

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
      description: zh ? "综合建材商业园区 · 分期建设" : "Parc de matériaux · construction par phases",
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
  const buildingNumber = (code: string) => Number(code.match(/\d+$/)?.[0] ?? 0);
  const buildingsByNumber = new Map(overview.buildings.map((building) => [buildingNumber(building.code), building]));
  const positionLabels: Record<number, string> = zh
    ? {
        10: "中心广场北侧",
        8: "中心广场北侧",
        6: "中心广场北侧",
        4: "中央大道北侧",
        2: "中央大道北侧 · 临主干道",
        9: "中心广场南侧",
        7: "中心广场南侧",
        5: "中心广场南侧",
        3: "中央大道南侧",
        1: "中央大道南侧 · 临主干道",
      }
    : {
        10: "Nord de la place centrale",
        8: "Nord de la place centrale",
        6: "Nord de la place centrale",
        4: "Nord de l’avenue centrale",
        2: "Nord de l’avenue · route principale",
        9: "Sud de la place centrale",
        7: "Sud de la place centrale",
        5: "Sud de la place centrale",
        3: "Sud de l’avenue centrale",
        1: "Sud de l’avenue · route principale",
      };
  const orderedShops = (number: number) => {
    return orderCimacShopsForPlan(number, buildingsByNumber.get(number)?.shops ?? []);
  };
  const shopRentLabel = (amount: number) => {
    const value = new Intl.NumberFormat(zh ? "zh-CN" : "fr-FR", { maximumFractionDigits: 2 }).format(amount / 10_000);
    return zh ? `${value}万/月` : `${value}万/mois`;
  };
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
        <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="cimac-buildings-title" className="text-[15px] font-semibold">{zh ? "商贸城楼栋分布" : "Plan des bâtiments"}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{zh ? "按现场地图排列 · 186间商铺全部平铺展示" : "Disposition du plan · 186 commerces affichés sans repli"}</p>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {zh ? "页面右侧为科特迪瓦主干道" : "Route principale à droite"}
          </div>
        </div>

        <div className="grid overflow-hidden rounded-xl border border-border bg-muted/25 shadow-card grid-cols-[minmax(0,1fr)_36px] sm:grid-cols-[minmax(0,1fr)_44px]">
          <div className="min-w-0 p-3 sm:p-4">
            {(["north", "south"] as const).map((row, rowIndex) => (
              <div key={row}>
                {rowIndex === 1 && (
                  <div className="my-3 flex min-h-11 items-center gap-3 border-y border-sky-200 bg-sky-50 px-3 text-sky-900" aria-label={zh ? "中央大道，东西向内部道路" : "Avenue centrale, axe intérieur est-ouest"}>
                    <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="text-xs font-semibold">{zh ? "中央大道" : "Avenue centrale"}</span>
                    <span className="hidden text-[11px] text-sky-700 sm:inline">{zh ? "东西向内部道路" : "Axe intérieur est-ouest"}</span>
                    <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.16em] text-sky-700">E ↔ W</span>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {CIMAC_SITE_ROWS[row].map((number) => {
                    const building = buildingsByNumber.get(number);
                    if (!building) return null;
                    const numberRange = building.firstShopNo && building.lastShopNo
                      ? building.firstShopNo === building.lastShopNo
                        ? building.firstShopNo
                        : `${building.firstShopNo}–${building.lastShopNo}`
                      : zh ? "待核实" : "À vérifier";
                    const shops = orderedShops(number);
                    const twoColumnPlan = number <= 4;
                    const buildingSummary = (
                      <Link
                        href={routeFor(locale, `/units?project=CIMAC&building=${building.code}`)}
                        className="group block p-3.5 outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold">{building.displayName}</h3>
                            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{building.code}</p>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                          <span><span className="text-muted-foreground">{zh ? "商铺" : "Lots"}</span> <strong className="tabular-nums">{building.shopCount}</strong></span>
                          <span><span className="text-muted-foreground">{zh ? "优质" : "Premium"}</span> <strong className="tabular-nums text-amber-700">{building.primeCount}</strong></span>
                          <span className="col-span-2 inline-flex items-start gap-1.5 text-muted-foreground">
                            <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{positionLabels[number]}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2 text-[10px]">
                          <span className="text-muted-foreground">{zh ? "编号" : "Nos"} <span className="font-mono font-semibold text-foreground">{numberRange}</span></span>
                          <span className="font-semibold tabular-nums">{formatXof(building.standardMonthlyRentXof)}</span>
                        </div>
                      </Link>
                    );
                    const shopDetails = (
                      <div className={cn("grid", row === "south" && "border-t border-border", twoColumnPlan ? "grid-cols-2" : "grid-cols-1")}>
                        {shops.map((shop, shopIndex) => (
                          <Link
                            key={shop.id}
                            href={routeFor(locale, `/units/${shop.id}`)}
                            className={cn(
                              "group/shop flex min-h-[112px] flex-col border-b border-border p-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                              twoColumnPlan && shopIndex % 2 === 0 && "border-r",
                              shop.isPrime && "bg-amber-50/80 hover:bg-amber-100/70",
                            )}
                            aria-label={`${building.displayName} ${shop.unitNo}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-mono text-sm font-bold tabular-nums">{shop.unitNo}</span>
                              {shop.isPrime && <span className="rounded-full border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">{zh ? "优质" : "Premium"}</span>}
                            </div>
                            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[10px]">
                              <span className="text-muted-foreground">{shop.areaSqm == null ? (zh ? "面积待核" : "Surface à vérifier") : `${Number(shop.areaSqm).toLocaleString(zh ? "zh-CN" : "fr-FR")}㎡`}</span>
                              <span className="font-semibold tabular-nums">{shopRentLabel(shop.standardMonthlyRentXof)}</span>
                            </div>
                            <dl className="mt-auto space-y-0.5 border-t border-border/70 pt-1.5 text-[10px] leading-4">
                              <div className="flex min-w-0 gap-1"><dt className="shrink-0 text-muted-foreground">{zh ? "租户" : "Loc."}</dt><dd className="min-w-0 truncate font-medium">{shop.tenantName ?? (zh ? "待核实" : "À vérifier")}</dd></div>
                              <div className="flex min-w-0 gap-1"><dt className="shrink-0 text-muted-foreground">{zh ? "主营" : "Activité"}</dt><dd className="min-w-0 truncate font-medium">{shop.mainBusiness ?? (zh ? "待补充" : "À compléter")}</dd></div>
                            </dl>
                          </Link>
                        ))}
                      </div>
                    );
                    return (
                      <article key={building.id} className="self-start overflow-hidden rounded-xl border border-border bg-card shadow-card">
                        {row === "north" ? <>{shopDetails}{buildingSummary}</> : <>{buildingSummary}{shopDetails}</>}
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <aside className="flex items-center justify-center border-l border-slate-700 bg-slate-900 px-1 text-white" aria-label={zh ? "科特迪瓦主干道" : "Route principale de Côte d’Ivoire"}>
            <span className="text-center text-[10px] font-semibold tracking-[0.12em] [writing-mode:vertical-rl] sm:text-[11px]">
              {zh ? "科特迪瓦主干道" : "ROUTE PRINCIPALE"}
            </span>
          </aside>
        </div>
        <p className="px-1 text-[11px] leading-5 text-muted-foreground">{zh ? "楼栋租赁与建设状态仍统一保留为待核实；位置与编号按已确认场地图及商铺台账展示。" : "Les états locatifs et de construction restent à vérifier ; positions et numéros suivent le plan et le registre confirmés."}</p>
      </section>
    </div>
  );
}
