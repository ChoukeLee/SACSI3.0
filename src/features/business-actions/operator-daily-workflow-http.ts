import { authenticateOperatorRequest } from "./operator-request-auth";
import { operatorAuthFailure } from "./operator-auth-failure";
import { batchUuid } from "./operator-batch";
import { parseDailyChangeRequest } from "./operator-daily-plan";
import { issuePreviewProof, validPreviewSecret, verifyPreviewProof } from "./operator-preview-proof";
import { confirmationReply as reply, confirmationDeployment, confirmationsEnabled, confirmationBrowserOriginMatches } from "./operator-confirmation-http";

export function workflowFeedback(code: string) {
  const messages: Record<string,string> = {
    workflowForbidden: "请使用创建本单的账号，并确认仍有房间及业务操作权限。",
    workflowChanged: "订单或账务已变化，请保留原请求号，重新核对后替换旧确认单。",
    workflowExpired: "确认单已过期或被替换，请保留原请求号重新准备。",
    workflowRequestConflict: "原请求已被使用或内容不同，请先查原单，不能换号重录。",
    workflowRoomConflict: "房间存在住期或其他业务冲突，请先核对。",
    workflowSpecialPricingOrState: "订单状态或计价不适用，请联系维护者协助核算。",
    workflowFinanceMismatch: "订单、应收与付款不一致，需要先对账。",
    workflowOverpayment: "付款超过调整后的应收，可能涉及退款，请先核对。",
    workflowInvalidDate: "请重新核对住期和付款日期。",
    workflowInvalidRequest: "确认资料不完整或格式有误。",
    confirmation_deployment_changed: "服务器版本已变化，请用原请求号重新准备确认单。",
  };
  return messages[code] ?? "操作结果尚未核实，请保留原请求号查询或联系维护者，切勿换号重录。";
}
function failure(error: {message?:string}) {
  const code = error.message?.match(/\bworkflow[A-Za-z]+\b/)?.[0] ?? "workflow_unavailable";
  return reply({code,message:workflowFeedback(code)},code === "workflowForbidden" ? 403 : code === "workflow_unavailable" ? 503 : 409);
}
export async function dailyWorkflowPost(request: Request, operation: "prepare" | "drafts") {
  if (!confirmationsEnabled()) return reply({code:"confirmations_not_enabled"},503);
  const auth=await authenticateOperatorRequest(request);
  if(!auth.authenticated){const f=operatorAuthFailure(auth.reason);return reply(f.body,f.status);}
  try {
    const raw=await request.text();if(new TextEncoder().encode(raw).length>16384)return reply({code:"request_too_large"},413);
    let body;try{body=JSON.parse(raw);}catch{return reply({code:"invalid_json"},400);}
    const candidate=operation==="drafts"?body?.request:body;
    if(!candidate || !batchUuid(candidate.requestId))return reply({code:"invalid_request_id"},400);
    const {requestId,...fields}=candidate;
    let input;try{input={...parseDailyChangeRequest(fields),requestId};}catch{return reply({code:"workflowInvalidRequest"},400);}
    if(!input.effectiveCheckOut||input.amountXof===undefined||!input.paymentDate||!input.paymentMethod)return reply({code:"workflowInvalidRequest"},400);
    const secret=process.env.SACSI_OPERATOR_PREVIEW_SECRET;if(!validPreviewSecret(secret))return reply({code:"preview_signing_unavailable"},503);
    const snapshot=await auth.supabase.rpc("preview_daily_workflow",{p_request:input});if(snapshot.error)return failure(snapshot.error);
    const binding={actorId:auth.user.id,request:input,snapshot:snapshot.data,deployment:confirmationDeployment()};
    if(operation==="prepare")return reply({status:"preview_requires_human_confirmation",preview:snapshot.data.plan,...issuePreviewProof(binding,secret)},200);
    if(body.replacesConfirmationId!==undefined&&!batchUuid(body.replacesConfirmationId))return reply({code:"invalid_confirmation_id"},400);
    const proof=verifyPreviewProof(body.previewProof,binding,secret);if(!proof.valid)return reply(proof,409);
    const expiresAt=new Date(JSON.parse(Buffer.from(body.previewProof.split('.')[0],'base64url').toString()).expiresAt).toISOString();
    const result=await auth.supabase.rpc("create_daily_workflow",{p_request:input,p_snapshot:snapshot.data,p_expires_at:expiresAt,p_deployment:binding.deployment,p_replaces_id:body.replacesConfirmationId??null});
    if(result.error)return failure(result.error);
    return reply({status:result.data.status==="completed"?"completed_previously":"awaiting_account_confirmation",requestId,confirmationPath:`/operator/daily-workflows/${result.data.id}`},200);
  }catch{return reply({code:"workflow_unavailable"},503);}
}
export async function confirmDailyWorkflow(request:Request,id:string){
  if(!confirmationsEnabled())return reply({code:"confirmations_not_enabled"},503);
  if(request.headers.has("authorization")||!confirmationBrowserOriginMatches(request))return reply({code:"browser_confirmation_required"},403);
  const auth=await authenticateOperatorRequest(request);if(!auth.authenticated){const f=operatorAuthFailure(auth.reason);return reply(f.body,f.status);}
  if(auth.mode!=="cookie")return reply({code:"browser_confirmation_required"},403);
  if(!batchUuid(id))return reply({code:"invalid_confirmation_id"},400);
  try{
    const current=await auth.supabase.rpc("get_daily_workflow",{p_id:id});if(current.error)return failure(current.error);
    if(current.data.deployment!==confirmationDeployment())return reply({code:"confirmation_deployment_changed"},409);
    const result=await auth.supabase.rpc("confirm_daily_workflow",{p_id:id});if(result.error)return failure(result.error);
    if(result.data?.verified!==true||result.data.requestId!==current.data.request_id||result.data.amountXof!==current.data.request_data.amountXof)return reply({code:"workflow_unknown_outcome"},503);
    return reply(result.data,200);
  }catch{return reply({code:"workflow_unknown_outcome"},503);}
}
