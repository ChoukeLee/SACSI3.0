import { ManagementPageContent } from "@/features/management/management-page";
export default async function ManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; month?: string }>;
}) {
  return <ManagementPageContent locale="zh" params={await searchParams} />;
}
