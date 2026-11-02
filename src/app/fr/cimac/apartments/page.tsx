import { CimacApartmentsPage } from "@/features/cimac/cimac-apartment-page";
import type { CimacPageProps } from "@/features/cimac/cimac-workspace-pages";
export default function Page(props: CimacPageProps) {
  return <CimacApartmentsPage {...props} locale="fr" />;
}
