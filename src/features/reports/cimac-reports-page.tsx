import "server-only";
import { notFound } from "next/navigation";
import {
  getCimacWorkspaceContext,
  type CimacPageProps,
} from "@/features/cimac/cimac-workspace-pages";
import { canReadCimacAccount } from "@/features/cimac/cimac-workspace-access";
import { loadReportData } from "./report-data";
import { ReportsView } from "./reports-view";
import { parseReportQuery } from "./report-read";

export async function CimacReportsPage({
  searchParams,
  locale,
}: CimacPageProps & { locale: "zh" | "fr" }) {
  const { user, scope } = await getCimacWorkspaceContext();
  if (!canReadCimacAccount(user.role)) notFound();
  const params = await searchParams;
  let projectId: string;
  try {
    projectId = parseReportQuery(
      params,
      new Date().toISOString().slice(0, 10),
      scope.project.id,
    ).projectId;
  } catch {
    notFound();
  }
  if (projectId !== scope.project.id) notFound();
  const data = await loadReportData(params, { workArea: "cimac" });
  return <ReportsView data={data} locale={locale} />;
}
