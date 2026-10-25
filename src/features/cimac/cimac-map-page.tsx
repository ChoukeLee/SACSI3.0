import "server-only";
import Link from "next/link";
import { getCimacOverview } from "./cimac-overview-data";
import { getCimacWorkspaceContext } from "./cimac-workspace-pages";
import { CimacProjectOverview } from "./cimac-project-overview";
import { CimacPageHeading } from "./cimac-view-parts";

export async function CimacMapPage({ locale }: { locale: "zh" | "fr" }) {
  const { scope } = await getCimacWorkspaceContext();
  const overview = await getCimacOverview();
  if (!overview || overview.project.id !== scope.project.id) throw new Error("CimacMapUnavailable");
  return (
    <div className="space-y-5">
      <CimacPageHeading
        overline="PARK MAP"
        title={locale === "zh" ? "商铺分布与资产库存" : "Plan des commerces et inventaire"}
        subtitle={
          locale === "zh"
            ? "保留现有商铺分布、搜索与详情查看；历史登记状态不代表实际开业或交付。"
            : "Plan, recherche et détails existants. L’état enregistré ne prouve ni ouverture ni livraison."
        }
        actions={
          <Link href={`${locale === "fr" ? "/fr" : ""}/cimac/assets`}>
            {locale === "zh" ? "资产目录" : "Répertoire des actifs"}
          </Link>
        }
      />
      <CimacProjectOverview overview={overview} locale={locale} />
    </div>
  );
}
