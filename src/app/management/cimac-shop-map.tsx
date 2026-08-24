"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeftRight, ArrowRight, MapPin, Search, Store, X } from "lucide-react";
import { RightDrawer, controlClass } from "@/components/ui/operational";
import { routeFor, type Locale } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import type { CimacBuildingOverview, CimacOverview, CimacShopOverview } from "./management-data";
import { CIMAC_SITE_ROWS, matchesCimacShopQuery, orderCimacShopsForPlan } from "./cimac-site-layout";

type SelectedShop = {
  building: CimacBuildingOverview;
  shop: CimacShopOverview;
};

const positionLabels: Record<Locale, Record<number, string>> = {
  zh: {
    10: "中心广场北侧", 8: "中心广场北侧", 6: "中心广场北侧", 4: "中央大道北侧", 2: "中央大道北侧 · 临主干道",
    9: "中心广场南侧", 7: "中心广场南侧", 5: "中心广场南侧", 3: "中央大道南侧", 1: "中央大道南侧 · 临主干道",
  },
  fr: {
    10: "Nord de la place centrale", 8: "Nord de la place centrale", 6: "Nord de la place centrale", 4: "Nord de l'avenue centrale", 2: "Nord de l'avenue · route principale",
    9: "Sud de la place centrale", 7: "Sud de la place centrale", 5: "Sud de la place centrale", 3: "Sud de l'avenue centrale", 1: "Sud de l'avenue · route principale",
  },
};

function buildingNumber(code: string) {
  return Number(code.match(/\d+$/)?.[0] ?? 0);
}

function shopState(shop: CimacShopOverview) {
  return shop.hasActiveLease ? "leased" : shop.status === "reserved" ? "reserved" : "available";
}

export function CimacShopMap({ overview, locale }: { overview: CimacOverview; locale: Locale }) {
  const zh = locale === "zh";
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedShop | null>(null);
  const buildingsByNumber = useMemo(
    () => new Map(overview.buildings.map((building) => [buildingNumber(building.code), building])),
    [overview.buildings],
  );
  const normalizedQuery = query.trim();
  const matchCount = useMemo(() => {
    if (!normalizedQuery) return overview.shopCount;
    return overview.buildings.reduce(
      (count, building) => count + building.shops.filter((shop) => matchesCimacShopQuery(shop, building, normalizedQuery)).length,
      0,
    );
  }, [normalizedQuery, overview.buildings, overview.shopCount]);

  const stateLabel = (shop: CimacShopOverview) => {
    const state = shopState(shop);
    if (state === "leased") return zh ? "已租" : "Loué";
    if (state === "reserved") return zh ? "已预留" : "Réservé";
    return zh ? "可租" : "Disponible";
  };

  const locateFirstMatch = () => {
    if (!normalizedQuery) return;
    const first = overview.buildings.flatMap((building) => building.shops.map((shop) => ({ building, shop })))
      .find(({ building, shop }) => matchesCimacShopQuery(shop, building, normalizedQuery));
    if (!first) return;
    document.getElementById(`cimac-shop-${first.shop.id}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  };

  return (
    <section aria-labelledby="cimac-buildings-title" className="space-y-3">
      <div className="flex flex-col gap-3 px-1 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 id="cimac-buildings-title" className="text-[15px] font-semibold">{zh ? "商贸城楼栋分布" : "Plan des bâtiments"}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{zh ? "按现场位置排列，点击商铺查看完整档案" : "Disposition réelle du site, cliquez sur un commerce pour ouvrir sa fiche"}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form
            className="relative w-full sm:w-[320px]"
            onSubmit={(event) => {
              event.preventDefault();
              locateFirstMatch();
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={cn(controlClass, "w-full pl-9 pr-9")}
              placeholder={zh ? "搜索房号、商户或主营业务" : "Rechercher numéro, client ou activité"}
              aria-label={zh ? "搜索商铺" : "Rechercher un commerce"}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={zh ? "清除搜索" : "Effacer la recherche"}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </form>
          <div className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
            {normalizedQuery ? (zh ? `${matchCount} 间匹配` : `${matchCount} résultat(s)`) : (zh ? `${overview.shopCount} 间商铺` : `${overview.shopCount} commerces`)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-muted-foreground" aria-label={zh ? "商铺状态图例" : "Légende des commerces"}>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-slate-300 bg-slate-200" aria-hidden="true" />{zh ? "已租" : "Loué"}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-sky-300 bg-sky-100" aria-hidden="true" />{zh ? "已预留" : "Réservé"}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-slate-200 bg-white" aria-hidden="true" />{zh ? "可租" : "Disponible"}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />{zh ? "优质地段" : "Premium"}</span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />{zh ? "右侧为科特迪瓦主干道" : "Route principale à droite"}
        </span>
      </div>

      <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-[#F5F7FA] grid-cols-[minmax(0,1fr)_36px] sm:grid-cols-[minmax(0,1fr)_44px]">
        <div className="min-w-0 overflow-x-auto p-3 sm:p-4">
          <div className="min-w-[1040px]">
            {(["north", "south"] as const).map((row, rowIndex) => (
              <div key={row}>
                {rowIndex === 1 && (
                  <div className="my-3 flex min-h-10 items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 text-sky-900" aria-label={zh ? "中央大道，东西向内部道路" : "Avenue centrale, axe intérieur est-ouest"}>
                    <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="text-xs font-semibold">{zh ? "中央大道" : "Avenue centrale"}</span>
                    <span className="ml-auto text-xs font-medium text-sky-700">E ↔ W</span>
                  </div>
                )}
                <div className="grid grid-cols-5 items-start gap-3">
                  {CIMAC_SITE_ROWS[row].map((number) => {
                    const building = buildingsByNumber.get(number);
                    if (!building) return null;
                    const shops = orderCimacShopsForPlan(number, building.shops);
                    const numberRange = building.firstShopNo && building.lastShopNo
                      ? building.firstShopNo === building.lastShopNo ? building.firstShopNo : `${building.firstShopNo}–${building.lastShopNo}`
                      : zh ? "待核实" : "À vérifier";
                    return (
                      <article key={building.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <div className="border-b border-slate-200 bg-white px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">{building.displayName}</h3>
                            <span className="text-xs font-semibold tabular-nums text-muted-foreground">{building.shopCount}{zh ? "间" : " lots"}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="truncate">{positionLabels[locale][number]}</span>
                            <span className="shrink-0 font-mono tabular-nums">{numberRange}</span>
                          </div>
                        </div>
                        <div className={cn("grid gap-1.5 bg-slate-100 p-1.5", number <= 4 ? "grid-cols-2" : "grid-cols-1")}>
                          {shops.map((shop) => {
                            const state = shopState(shop);
                            const matches = matchesCimacShopQuery(shop, building, normalizedQuery);
                            return (
                              <button
                                id={`cimac-shop-${shop.id}`}
                                key={shop.id}
                                type="button"
                                onClick={() => setSelected({ building, shop })}
                                className={cn(
                                  "relative min-h-20 rounded-lg border p-2 text-left text-[#17324D] outline-none transition-[opacity,border-color,background-color,box-shadow] hover:z-10 hover:border-slate-400 hover:shadow-sm focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary/40",
                                  state === "leased" && "border-slate-300 bg-slate-200",
                                  state === "reserved" && "border-sky-200 bg-sky-50",
                                  state === "available" && "border-slate-200 bg-white",
                                  normalizedQuery && !matches && "opacity-30",
                                  normalizedQuery && matches && "z-10 ring-2 ring-primary/50",
                                )}
                                aria-label={`${building.displayName} ${shop.unitNo}，${stateLabel(shop)}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="font-mono text-xs font-bold tabular-nums">{shop.unitNo}</span>
                                  <span className={cn(
                                    "inline-flex items-center gap-1 text-xs font-semibold",
                                    state === "leased" && "text-slate-700",
                                    state === "reserved" && "text-sky-800",
                                    state === "available" && "text-emerald-700",
                                  )}>
                                    <span className={cn("h-1.5 w-1.5 rounded-full", state === "leased" && "bg-slate-500", state === "reserved" && "bg-sky-500", state === "available" && "bg-emerald-500")} aria-hidden="true" />
                                    {stateLabel(shop)}
                                  </span>
                                </div>
                                <p className="mt-2 break-words text-xs font-semibold leading-4">{shop.tenantName ?? (state === "reserved" ? (zh ? "商户待补" : "Client à compléter") : (zh ? "开放招商" : "Ouvert à la location"))}</p>
                                {shop.mainBusiness && <p className="mt-0.5 break-words text-xs leading-4 text-[#4D6780]">{shop.mainBusiness}</p>}
                                {shop.isPrime && <span className="absolute bottom-2 right-2 h-2 w-2 rounded-full bg-amber-500" title={zh ? "优质地段" : "Premium"} aria-label={zh ? "优质地段" : "Premium"} />}
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <aside className="flex items-center justify-center border-l border-slate-700 bg-slate-900 px-1 text-white" aria-label={zh ? "科特迪瓦主干道" : "Route principale de Côte d'Ivoire"}>
          <span className="text-center text-xs font-semibold [writing-mode:vertical-rl]">{zh ? "科特迪瓦主干道" : "ROUTE PRINCIPALE"}</span>
        </aside>
      </div>

      <RightDrawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.building.displayName} · ${selected.shop.unitNo}` : ""}
        subtitle={selected ? `${selected.building.code} · ${positionLabels[locale][buildingNumber(selected.building.code)]}` : undefined}
        badge={selected ? (
          <span className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold",
            shopState(selected.shop) === "leased" && "bg-slate-100 text-slate-700",
            shopState(selected.shop) === "reserved" && "bg-sky-100 text-sky-800",
            shopState(selected.shop) === "available" && "bg-emerald-50 text-emerald-700",
          )}>{stateLabel(selected.shop)}</span>
        ) : undefined}
      >
        {selected && (
          <div className="space-y-5">
            <section className="border-b border-border pb-5">
              <h3 className="text-[15px] font-semibold">{zh ? "商户信息" : "Informations du commerce"}</h3>
              <dl className="mt-3 grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
                <dt className="text-muted-foreground">{zh ? "商户名称" : "Client"}</dt><dd className="font-medium">{selected.shop.tenantName ?? (zh ? "暂无资料" : "Aucune donnée")}</dd>
                <dt className="text-muted-foreground">{zh ? "主营业务" : "Activité"}</dt><dd className="font-medium">{selected.shop.mainBusiness ?? (zh ? "暂无资料" : "Aucune donnée")}</dd>
              </dl>
            </section>
            <section className="border-b border-border pb-5">
              <h3 className="text-[15px] font-semibold">{zh ? "铺位信息" : "Informations du local"}</h3>
              <dl className="mt-3 grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
                <dt className="text-muted-foreground">{zh ? "所在楼栋" : "Bâtiment"}</dt><dd className="font-medium">{selected.building.displayName}</dd>
                <dt className="text-muted-foreground">{zh ? "现场位置" : "Position"}</dt><dd className="font-medium">{positionLabels[locale][buildingNumber(selected.building.code)]}</dd>
                <dt className="text-muted-foreground">{zh ? "铺位面积" : "Surface"}</dt><dd className="font-medium tabular-nums">{selected.shop.areaSqm == null ? (zh ? "待核实" : "À vérifier") : `${Number(selected.shop.areaSqm).toLocaleString(zh ? "zh-CN" : "fr-FR")}㎡`}</dd>
                <dt className="text-muted-foreground">{zh ? "标准月租" : "Loyer mensuel"}</dt><dd className="font-semibold tabular-nums">{formatXof(selected.shop.standardMonthlyRentXof)}</dd>
                <dt className="text-muted-foreground">{zh ? "地段" : "Emplacement"}</dt><dd className="font-medium">{selected.shop.isPrime ? (zh ? "优质地段" : "Premium") : (zh ? "普通地段" : "Standard")}</dd>
              </dl>
            </section>
            <Link href={routeFor(locale, `/units/${selected.shop.id}`)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
              <Store className="h-4 w-4" />{zh ? "打开商铺档案" : "Ouvrir la fiche"}<ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </RightDrawer>
    </section>
  );
}
