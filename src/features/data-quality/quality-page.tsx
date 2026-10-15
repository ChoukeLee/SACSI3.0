import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { routeFor, type Locale } from "@/lib/i18n";
import { DesktopOnly } from "@/features/mobile";
import { BusinessRepairCenter } from "./business-repair-center";
import { QualityCenter } from "./quality-center";
import { loadQualityPage } from "./quality-page-data";

export async function QualityPage({ locale }: { locale: Locale }) {
  const user = await getCurrentUser();
  if (!user) redirect(routeFor(locale, "/login"));
  if (user.role !== "admin") redirect(routeFor(locale, "/"));
  const result = await loadQualityPage(locale, "admin");
  return (
    <>
      <div className="lg:hidden">
        <DesktopOnly locale={locale} />
      </div>
      <div className="hidden space-y-5 lg:block">
        <BusinessRepairCenter locale={locale} userRole={user.role} />
        <QualityCenter
          locale={locale}
          userRole={user.role}
          issues={result.status === "complete" ? result.issues : []}
          loadError={result.status === "unavailable"}
          checkedAt={result.status === "complete" ? result.checkedAt : undefined}
        />
      </div>
    </>
  );
}
