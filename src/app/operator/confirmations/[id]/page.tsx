import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { confirmationIdValid, confirmationsEnabled } from "@/features/business-actions/operator-confirmation-http";
import { buildPaymentPreview } from "@/features/business-actions/operator-payment-preview";
import { OperatorConfirmationPanel } from "@/features/business-actions/operator-confirmation-panel";
export const dynamic = "force-dynamic";
export default async function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  if (!confirmationsEnabled()) return <p>截图确认流程尚未启用，请联系系统维护者。</p>;
  const { id } = await params; if (!confirmationIdValid(id)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/operator/confirmations/${id}`)}`);
  const supabase = await createClient();
  const result = await supabase.rpc("get_operator_payment_confirmation", { p_id: id });
  if (result.error || !result.data) return <p>无法读取确认单。请使用创建此单的 SACSI 账号登录，并保留原请求编号核查。</p>;
  const data = result.data;
  if (data.status === "superseded") return <section className="mx-auto max-w-2xl space-y-4 p-6"><h1 className="text-xl font-semibold">此确认单已作废</h1><p>内容已重新准备。旧页面不能再入账，请打开新单并重新核对。</p>{confirmationIdValid(data.replacementId) && <a className="underline" href={`/operator/confirmations/${data.replacementId}`}>查看新确认单</a>}</section>;
  const preview = buildPaymentPreview(data.request, data.snapshot);
  if (!preview.success) return <p>确认单内容无法安全展示，请保留原请求编号联系维护者。</p>;
  return <OperatorConfirmationPanel id={id} preview={preview.preview} actor={user.email || user.id} expiresAt={data.expiresAt} completed={data.status === "completed"} />;
}
