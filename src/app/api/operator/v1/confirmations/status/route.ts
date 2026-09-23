import {authenticateOperatorRequest} from '@/features/business-actions/operator-request-auth';
import {operatorAuthFailure} from '@/features/business-actions/operator-auth-failure';
import {confirmationReply as reply,confirmationError} from '@/features/business-actions/operator-confirmation-http';
import {batchUuid} from '@/features/business-actions/operator-batch';
export async function GET(request:Request){
  const auth=await authenticateOperatorRequest(request);
  if(!auth.authenticated){const f=operatorAuthFailure(auth.reason);return reply(f.body,f.status);}
  const id=new URL(request.url).searchParams.get('requestId');if(!batchUuid(id))return reply({code:'invalid_request_id'},400);
  try{
    const result=await auth.supabase.rpc('find_operator_payment_confirmation',{p_request_id:id});
    if(result.error)return confirmationError(result.error);
    return reply({...result.data,...(result.data?.id?{confirmationPath:`/operator/confirmations/${result.data.id}`}:{})},200);
  }catch{return confirmationError({});}
}
