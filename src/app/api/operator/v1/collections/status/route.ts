import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { batchUuid } from "@/features/business-actions/operator-batch";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";
import { confirmationReply as reply } from "@/features/business-actions/operator-confirmation-http";
import { collectionError } from "@/features/business-actions/operator-collection-http";
export async function GET(request: Request) {
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) { const f = operatorAuthFailure(auth.reason); return reply(f.body, f.status); }
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!batchUuid(requestId)) return reply({ code: "invalid_request_id" }, 400);
  try {
    const result = await auth.supabase.rpc("find_operator_collection", { p_request_id: requestId });
    if (result.error) return collectionError(result.error);
    return reply({ ...result.data, ...(result.data.id ? { confirmationPath: `/operator/collections/${result.data.id}` } : {}),
      notice: "未找到或未完成不等于可以换号重录。请保留原请求号，核对原批次。" }, 200);
  } catch { return collectionError({}); }
}
