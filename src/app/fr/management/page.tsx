import { ManagementPageContent } from "@/features/management/management-page";
export default async function FrenchManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; month?: string }>;
}) {
  return <ManagementPageContent locale="fr" params={await searchParams} />;
}
