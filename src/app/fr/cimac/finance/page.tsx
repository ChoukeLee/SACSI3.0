import { type CimacPageProps } from "@/features/cimac/cimac-workspace-pages";
import { CimacFinancePage } from "@/features/finance/cimac-finance-page";
export default function Page(props: CimacPageProps) {
  return <CimacFinancePage {...props} locale="fr" />;
}
