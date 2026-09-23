import {authenticateOperatorRequest} from "@/features/business-actions/operator-request-auth";
import {operatorAuthFailure} from "@/features/business-actions/operator-auth-failure";
import {confirmationReply as reply} from "@/features/business-actions/operator-confirmation-http";
import {batchUuid} from "@/features/business-actions/operator-batch";
export async function GET(request:Request){
  const auth=await authenticateOperatorRequest(request);if(!auth.authenticated){const f=operatorAuthFailure(auth.reason);return reply(f.body,f.status);}
  const id=new URL(request.url).searchParams.get('requestId');if(!batchUuid(id))return reply({code:'invalid_request_id'},400);
  try {const r=await auth.supabase.rpc('find_daily_workflow',{p_request_id:id});if(r.error)return reply({code:'workflow_unavailable'},503);
    return reply({...r.data,...(r.data.id?{confirmationPath:`/operator/daily-workflows/${r.data.id}`}:{})},200);
  }catch{return reply({code:'workflow_unavailable'},503);}
}
