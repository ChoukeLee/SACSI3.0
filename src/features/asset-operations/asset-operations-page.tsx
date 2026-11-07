import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchAssetOperations } from "./asset-operations-server";
import { assetReportPeriod } from "./asset-operations-model";
import { AssetOperationsWorkspace } from "./asset-operations-workspace";

export async function AssetOperationsPage({ locale }: { locale: "zh" | "fr" }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect(locale === "zh" ? "/" : "/fr");
  const today = new Date().toISOString().slice(0, 10);
  let data;
  try {
    data = await fetchAssetOperations({});
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "AssetOperationsMigrationRequired")
      throw error;
    return (
      <section className="rounded-lg border bg-card p-6">
        <h1 className="text-xl font-semibold">
          {locale === "zh" ? "资产经营试点尚未安装" : "Le pilote n’est pas encore installé"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {locale === "zh"
            ? "数据库扩展完成并核验后，此页面将显示仓库资产和经营报表。现有资产和财务记录保持原样。"
            : "L’inventaire et les rapports seront disponibles après installation et vérification de l’extension. Les données existantes sont préservées."}
        </p>
      </section>
    );
  }
  return (
    <AssetOperationsWorkspace
      data={data}
      locale={locale}
      today={today}
      initialPeriod={assetReportPeriod("month", today.slice(0, 7))}
      canImport={user.role === "admin"}
    />
  );
}
