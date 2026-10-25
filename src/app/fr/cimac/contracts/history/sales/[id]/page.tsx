import { CimacHistoricalSalePage } from "@/features/cimac/cimac-historical-sale-page";
import type { CimacDetailPageProps } from "@/features/cimac/cimac-workspace-pages";
export default function Page(props: CimacDetailPageProps) {
  return <CimacHistoricalSalePage {...props} locale="fr" />;
}
