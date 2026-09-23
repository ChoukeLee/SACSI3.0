import { authenticateOperatorRequest } from "./operator-request-auth";
import { operatorAuthFailure } from "./operator-auth-failure";
import { batchUuid } from "./operator-batch";
import { issuePreviewProof, validPreviewSecret, verifyPreviewProof } from "./operator-preview-proof";
import { confirmationReply as reply, confirmationDeployment, confirmationsEnabled, confirmationBrowserOriginMatches } from "./operator-confirmation-http";

export const BOOKING_OPERATION_LABELS: Record<string, string> = {
  create: "新建预订", check_in: "办理入住（不收款）", cancel: "取消未入住预订", change_stay: "调整住期或房价",
  correct_room: "纠正录错房号", transfer: "转移未入住预订", reverse: "冲正错误收款", refund: "登记实际退款", void_checkin: "撤销误入住",
};
function failure(error: { message?: string }) {
  const code = error.message?.match(/\boperation[A-Za-z]+\b/)?.[0] ?? "operation_unavailable";
  const messages: Record<string,string> = {
    operationForbidden: "账号或业务权限不匹配，请使用本单的实际操作账号。",
    operationChanged: "业务记录已经变化，请保留原请求号，重新核对并替换旧确认单。",
    operationExpired: "确认单已过期、已替换或服务器版本变化，请用原请求号重新准备。",
    operationAssistanceRequired: "该情况不适用当前快捷流程，请联系 Chucke 核对，不能拆单绕过。",
    operationFinanceMismatch: "订单与账务不一致，请先对账，不要重复录入。",
    operationRefundReviewRequired: "请核对已退房订单的最终应收、已收和实际退款；不能超额退款或把冲正当退款。",
    operationRoomConflict: "房间存在冲突、清洁或不可用状态，请核对后处理。",
    operationRequestConflict: "请求号已用于其他业务，请核对原单，勿换号重录。",
  };
  return reply({code,message:messages[code] ?? "结果尚未核实，请保留原请求号查询；如需协助，请联系 Chucke。"}, code === "operationForbidden" ? 403 : code === "operation_unavailable" ? 503 : 409);
}
export async function bookingOperationPost(request: Request, mode: "prepare"|"drafts"|"preview") {
  if (!confirmationsEnabled()) return reply({code:"confirmations_not_enabled"},503);
  const auth=await authenticateOperatorRequest(request);
  if(!auth.authenticated){const f=operatorAuthFailure(auth.reason);return reply(f.body,f.status);}
  try {
    const raw=await request.text(); if(new TextEncoder().encode(raw).length>16384)return reply({code:"request_too_large"},413);
    let body;try{body=JSON.parse(raw);}catch{return reply({code:"invalid_json"},400);}
    const input=mode==='drafts'?body?.request:body;
    if(!input||!batchUuid(input.requestId)||!Object.hasOwn(BOOKING_OPERATION_LABELS,input.operation))return reply({code:"operationInvalidRequest"},400);
    const snapshot=await auth.supabase.rpc('operator_booking_operation',{p_mode:'preview',p_request:input});
    if(snapshot.error)return failure(snapshot.error);
    if(mode==='preview')return reply({status:'read_only_plan',plan:snapshot.data.plan,executionAllowed:false},200);
    const secret=process.env.SACSI_OPERATOR_PREVIEW_SECRET;if(!validPreviewSecret(secret))return reply({code:'preview_signing_unavailable'},503);
    const binding={actorId:auth.user.id,request:input,snapshot:snapshot.data,deployment:confirmationDeployment()};
    if(mode==='prepare')return reply({preview:snapshot.data.plan,...issuePreviewProof(binding,secret)},200);
    if(body.replacesConfirmationId!==undefined&&!batchUuid(body.replacesConfirmationId))return reply({code:'invalid_confirmation_id'},400);
    const proof=verifyPreviewProof(body.previewProof,binding,secret);if(!proof.valid)return reply(proof,409);
    const expiresAt=new Date(JSON.parse(Buffer.from(body.previewProof.split('.')[0],'base64url').toString()).expiresAt).toISOString();
    const result=await auth.supabase.rpc('operator_booking_operation',{p_mode:'create',p_request:input,p_snapshot:snapshot.data,p_expires_at:expiresAt,p_deployment:binding.deployment,p_replaces_id:body.replacesConfirmationId??null});
    if(result.error)return failure(result.error);
    return reply({status:result.data.status==='completed'?'completed_previously':'awaiting_account_confirmation',requestId:input.requestId,confirmationPath:`/operator/booking-operations/${result.data.id}`},200);
  }catch{return reply({code:'operation_unavailable'},503);}
}
export async function bookingOperationStatus(request: Request) {
  const auth=await authenticateOperatorRequest(request);
  if(!auth.authenticated){const f=operatorAuthFailure(auth.reason);return reply(f.body,f.status);}
  const requestId=new URL(request.url).searchParams.get('requestId');if(!batchUuid(requestId))return reply({code:'invalid_request_id'},400);
  try {
    const result=await auth.supabase.rpc('operator_booking_operation',{p_mode:'status',p_request:{requestId}});
    if(result.error)return failure(result.error);
    return reply({...result.data,...(result.data.id?{confirmationPath:`/operator/booking-operations/${result.data.id}`}:{})},200);
  }catch{return reply({code:'operation_unavailable'},503);}
}
export async function confirmBookingOperation(request:Request,id:string) {
  if(!confirmationsEnabled())return reply({code:'confirmations_not_enabled'},503);
  if(request.headers.has('authorization')||!confirmationBrowserOriginMatches(request))return reply({code:'browser_confirmation_required'},403);
  const auth=await authenticateOperatorRequest(request);if(!auth.authenticated){const f=operatorAuthFailure(auth.reason);return reply(f.body,f.status);}
  if(auth.mode!=='cookie')return reply({code:'browser_confirmation_required'},403);
  if(!batchUuid(id))return reply({code:'invalid_confirmation_id'},400);
  try{
    const result=await auth.supabase.rpc('operator_booking_operation',{p_mode:'confirm',p_id:id,p_deployment:confirmationDeployment()});
    if(result.error)return failure(result.error);
    if(!['completed','completed_previously'].includes(result.data?.status))return reply({code:'operation_unknown_outcome'},503);
    return reply(result.data,200);
  }catch{return reply({code:'operation_unknown_outcome'},503);}
}
