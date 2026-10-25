import { CimacContractsPage } from "@/features/leases/cimac-contract-page";
import type { CimacPageProps } from "@/features/cimac/cimac-workspace-pages";

export default function Page(props: CimacPageProps) {
  return <CimacContractsPage {...props} locale="fr" />;
}
