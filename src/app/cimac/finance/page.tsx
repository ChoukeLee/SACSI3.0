import { CimacCustomersPage, type CimacPageProps } from "@/features/cimac/cimac-workspace-pages";
export default function Page(props: CimacPageProps) {
  return <CimacCustomersPage {...props} locale="zh" accounts />;
}
