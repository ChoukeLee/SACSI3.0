import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CircleDollarSign,
  Construction,
  LockKeyhole,
  MapPin,
  PackageOpen,
  Store,
  Warehouse,
} from "lucide-react";
import { MetricGrid, StatTile } from "@/components/ui/operational";
import { routeFor, type Locale } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import type { CimacOverview } from "./management-data";
import { CimacShopMap } from "./cimac-shop-map";

export function CimacProjectOverview({
  overview,
  locale,
}: {
  overview: CimacOverview;
  locale: Locale;
}) {
  const zh = locale === "zh";
  const unitsHref = routeFor(locale, "/units?project=CIMAC");
  const types = [
    { key: "commercial_shop", icon: Store, title: zh ? "商业区商铺" : "Commerces" },
    { key: "warehouse", icon: Warehouse, title: zh ? "仓储区" : "Entrepôts" },
    { key: "apartment", icon: Building2, title: zh ? "公寓" : "Appartements" },
    {
      key: "apartment_ground_floor_shop",
      icon: PackageOpen,
      title: zh ? "公寓底商" : "Commerces en pied d’immeuble",
    },
  ];
  const assetCards = types.map((type) => {
    const inventory = overview.assetInventory.find((item) => item.subtype === type.key);
    return {
      key: type.key,
      icon: type.icon,
      title: type.title,
      ready: (inventory?.count ?? 0) > 0,
      value: inventory?.count
        ? `${inventory.count} ${zh ? "项已建档" : "actifs enregistrés"}`
        : zh
          ? "尚未建档"
          : "Registre à créer",
      meta: inventory?.count
        ? `${inventory.operational} ${zh ? "项建设状态为可运营" : "états opérationnels"} · ${inventory.unverified} ${zh ? "项待核" : "à vérifier"}${inventory.areaSqm === null ? "" : ` · ${inventory.areaSqm} m²`}`
        : zh
          ? "不以规划数代替实际已登记资产"
          : "Aucun nombre planifié substitué aux actifs enregistrés",
    };
  });

  return (
    <div className="space-y-4">
      <section
        className="rounded-xl border border-border bg-card p-4 shadow-card"
        aria-labelledby="cimac-scope-title"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="cimac-scope-title" className="text-[15px] font-semibold">
                {zh ? "商业区当前口径" : "Périmètre commercial actuel"}
              </h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {zh ? "只租不卖 · 台账口径" : "Location uniquement · registre"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {zh
                ? "建设状态、占用核验和正式租约分别管理。开业日、合同起始日或价格未经确认时，不据此生成到期日、应收或经营收入。"
                : "Construction, occupation vérifiée et bail sont distincts. Sans date ou tarif confirmé, aucun échéancier ou revenu n’est présumé."}
            </p>
          </div>
          <Link
            href={unitsHref}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {zh ? "查看商铺档案" : "Voir les commerces"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <MetricGrid columns={4}>
        <StatTile
          icon={Store}
          label={zh ? "商业区商铺" : "Commerces"}
          value={overview.shopCount}
          caption={`${overview.buildingCount} ${zh ? "栋" : "bâtiments"}`}
        />
        <StatTile
          icon={Construction}
          label={zh ? "建设或占用待核" : "État à vérifier"}
          value={overview.unverifiedCount}
          caption={`${overview.operationalCount} ${zh ? "项建设状态为可运营" : "états opérationnels"}`}
        />
        <StatTile
          icon={MapPin}
          tone="amber"
          label={zh ? "中央大道优质地段" : "Axe central premium"}
          value={overview.primeCount}
          caption={`${overview.standardCount} ${zh ? "间普通地段" : "emplacements standard"}`}
        />
        <StatTile
          icon={CircleDollarSign}
          tone="blue"
          label={zh ? "标准满租月租" : "Loyer mensuel théorique"}
          value={formatXof(overview.standardMonthlyRentXof)}
          caption={zh ? "价格表口径，非实际应收" : "Tarif catalogue, hors créances réelles"}
        />
      </MetricGrid>

      <section
        className="rounded-xl border border-border bg-card p-4 shadow-card"
        aria-labelledby="cimac-assets-title"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="cimac-assets-title" className="text-[15px] font-semibold">
              {zh ? "资产组成" : "Composition des actifs"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {zh
                ? "按实际已建档资产分类，未登记不等于没有规划；建设完成也不自动代表已经出租"
                : "Actifs enregistrés par catégorie; construction achevée ne signifie pas location effective"}
            </p>
          </div>
          <LockKeyhole className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {assetCards.map((asset) => {
            const Icon = asset.icon;
            return (
              <div key={asset.key} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      asset.ready ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      asset.ready
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {asset.ready ? (zh ? "已建档" : "Créé") : zh ? "待资料" : "En attente"}
                  </span>
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
