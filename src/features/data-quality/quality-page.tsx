import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { routeFor, type Locale } from "@/lib/i18n";
import { BusinessRepairCenter } from "./business-repair-center";
import { QualityCenter } from "./quality-center";
import { loadQualityPage } from "./quality-page-data";

export async function QualityPage({ locale }: { locale: Locale }) {
  const user = await getCurrentUser();
  if (!user) redirect(routeFor(locale, "/login"));
  if (user.role !== "admin") redirect(routeFor(locale, "/"));
  const result = await loadQualityPage(locale, "admin");
  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {locale === "zh" ? "数据质量与受控修正" : "Qualité et corrections contrôlées"}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {locale === "zh"
            ? "先查看异常与来源，再核对是否需要处理；检查不会自动改账。"
            : "Vérifiez les anomalies et leurs sources avant toute correction. Le contrôle ne modifie aucune écriture automatiquement."}
        </p>
      </header>
      <BusinessRepairCenter locale={locale} userRole={user.role} />
      <QualityCenter
        locale={locale}
        userRole={user.role}
        issues={result.status === "complete" ? result.issues : []}
        loadError={result.status === "unavailable"}
        checkedAt={result.status === "complete" ? result.checkedAt : undefined}
      />
    </div>
  );
}
