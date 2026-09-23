import { authenticateOperatorRequest } from '@/features/business-actions/operator-request-auth';
import { operatorAuthFailure } from '@/features/business-actions/operator-auth-failure';
import { confirmationReply as reply } from '@/features/business-actions/operator-confirmation-http';
import { DAILY_BOOKING_AGENT_NAMES } from '@/features/daily-rentals/daily-booking-agents';
export async function POST(request:Request){
  const auth=await authenticateOperatorRequest(request);if(!auth.authenticated){const f=operatorAuthFailure(auth.reason);return reply(f.body,f.status);}
  try{
    const raw=await request.text();if(raw.length>2000)return reply({code:'request_too_large'},413);
    const q=JSON.parse(raw);
    if(!q||Object.keys(q).some(k=>!['buildingCode','unitNo'].includes(k))||['buildingCode','unitNo'].some(k=>typeof q[k]!=='string'||!q[k].trim()||q[k].length>40))return reply({code:'invalid_query'},400);
    const allowed=await auth.supabase.rpc('can_execute_operator_action',{p_action_name:'query_daily_booking',p_risk_level:'L0'});
    if(allowed.error||allowed.data!==true)return reply({code:'operationForbidden'},403);
    const units=await auth.supabase.from('units').select('id,code,unit_no,status,buildings!inner(code),unit_business_flags(business_type,is_enabled)').eq('buildings.code',q.buildingCode).eq('unit_no',q.unitNo).limit(21);
    const agents=await auth.supabase.from('customers').select('id,name,is_blacklisted').in('name',[...DAILY_BOOKING_AGENT_NAMES]).limit(101);
    if(units.error||agents.error)return reply({code:'options_unavailable'},503);
    return reply({units:units.data.slice(0,20),bookingAgents:agents.data.slice(0,100),truncated:units.data.length>20||agents.data.length>100,notice:'业务经办人不是入住客人，也不是登录账号。多候选必须核对，不自动选第一个；此查询不预留房间。'},200);
  }catch{return reply({code:'options_unavailable'},503);}
}
