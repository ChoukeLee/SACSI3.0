import {
  CimacCustomerPage,
  type CimacDetailPageProps,
} from "@/features/cimac/cimac-workspace-pages";
export default function Page(props: CimacDetailPageProps) {
  return <CimacCustomerPage {...props} locale="fr" />;
}
