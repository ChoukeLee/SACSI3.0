import {redirect,notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {createClient} from '@/lib/supabase/server';
import {confirmationsEnabled} from '@/features/business-actions/operator-confirmation-http';
import {batchUuid} from '@/features/business-actions/operator-batch';
import {BookingOperationPanel} from '@/features/business-actions/operator-booking-operation-panel';
export const dynamic='force-dynamic';
export default async function BookingOperationPage({params}:{params:Promise<{id:string}>}){
  if(!confirmationsEnabled())return <p>确认功能尚未启用。</p>;
  const {id}=await params;if(!batchUuid(id))notFound();const user=await getCurrentUser();
  if(!user)redirect(`/login?redirect=${encodeURIComponent(`/operator/booking-operations/${id}`)}`);
  const db=await createClient();const {data,error}=await db.rpc('operator_booking_operation',{p_mode:'get',p_id:id});
  if(error||!data)return <p>无法读取确认单，请使用创建本单的业务账号并保留原请求编号。</p>;
  return <BookingOperationPanel id={id} plan={data.expected_snapshot.plan} requestId={data.request_id} actor={user.email||user.id} originalInstruction={data.request_data.originalInstruction} expiresAt={data.expires_at} status={data.status}/>;
}
