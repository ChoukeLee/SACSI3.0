import { CimacReportsPage } from "@/features/reports/cimac-reports-page";
import type { CimacPageProps } from "@/features/cimac/cimac-workspace-pages";
export default function Page(props: CimacPageProps) {
  return <CimacReportsPage {...props} locale="zh" />;
}
