import { CimacAssetsPage, type CimacPageProps } from "@/features/cimac/cimac-workspace-pages";
export default function Page(props: CimacPageProps) {
  return <CimacAssetsPage {...props} locale="fr" />;
}
