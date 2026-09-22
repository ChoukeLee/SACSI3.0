import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { confirmationsEnabled } from "@/features/business-actions/operator-confirmation-http";
import { batchUuid, collectionPreview, parseCollectionRequest } from "@/features/business-actions/operator-batch";
import { OperatorCollectionPanel } from "@/features/business-actions/operator-collection-panel";
export const dynamic = "force-dynamic";
export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!confirmationsEnabled()) return <p>收款确认尚未启用。</p>;
  const { id } = await params; if (!batchUuid(id)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/operator/collections/${id}`)}`);
  const db = await createClient();
  const { data, error } = await db.rpc("get_operator_collection", { p_id: id });
  if (error || !data) return <p>无法读取此批次，请使用创建本单的 SACSI 账号登录，并保留请求编号。</p>;
  try {
    const request = parseCollectionRequest(data.request_data);
    return <OperatorCollectionPanel id={id} rows={collectionPreview(request, data.expected_snapshot)} totalXof={request.totalXof} actor={user.email || user.id} requestId={request.requestId} expiresAt={data.expires_at} status={data.status} />;
  } catch { return <p>确认单内容不完整，请保留原编号联系维护者。</p>; }
}
