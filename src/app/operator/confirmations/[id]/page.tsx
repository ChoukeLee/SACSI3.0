import { OperatorInboxDetailPage } from "@/features/business-actions/operator-inbox-detail-page";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorInboxDetailPage id={id} kind="confirmations" locale="zh" />;
}
