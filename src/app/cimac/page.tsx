import { CimacHomePage, type CimacPageProps } from "@/features/cimac/cimac-workspace-pages";
export default function Page(props: CimacPageProps) {
  return <CimacHomePage {...props} locale="zh" />;
}
