import { CimacAssetPage, type CimacDetailPageProps } from "@/features/cimac/cimac-workspace-pages";
export default function Page(props: CimacDetailPageProps) {
  return <CimacAssetPage {...props} locale="fr" />;
}
