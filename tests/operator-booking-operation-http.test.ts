import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn()}));
vi.mock('@/features/business-actions/operator-request-auth',()=>({authenticateOperatorRequest:mock.auth}));
import {bookingOperationPost,confirmBookingOperation,bookingOperationStatus} from '@/features/business-actions/operator-booking-operation-http';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input={requestId:id,bookingId:id,operation:'cancel',originalInstruction:'合成测试',reason:'合成测试取消原因'};
const snapshot={snapshot:{booking:{id}},plan:{operation:'cancel'}};
const request=(body:unknown)=>new Request('http://localhost',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('SACSI_OPERATOR_CONFIRMATIONS_ENABLED','true');vi.stubEnv('SACSI_OPERATOR_PREVIEW_SECRET','ab'.repeat(32));vi.stubEnv('SACSI_OPERATOR_PUBLIC_ORIGIN','http://localhost');
 mock.auth.mockResolvedValue({authenticated:true,mode:'bearer',user:{id},supabase:{rpc:mock.rpc}});
 mock.rpc.mockImplementation(async(_name,args)=>({error:null,data:args.p_mode==='preview'?snapshot:{id,status:'pending'}}));});
afterEach(()=>vi.unstubAllEnvs());
it('previews without creating and prepares without confirming',async()=>{
 expect((await bookingOperationPost(request(input),'preview')).status).toBe(200);
 const preview=await(await bookingOperationPost(request(input),'prepare')).json();
 const result=await bookingOperationPost(request({request:input,previewProof:preview.previewProof}),'drafts');
 expect((await result.json()).confirmationPath).toBe(`/operator/booking-operations/${id}`);
 expect(mock.rpc.mock.calls.map(c=>c[1].p_mode)).toEqual(['preview','preview','preview','create']);
});
it.each(['actor','snapshot','request','proof'])('rejects altered %s',async what=>{
 const preview=await(await bookingOperationPost(request(input),'prepare')).json();
 if(what==='actor')mock.auth.mockResolvedValue({authenticated:true,mode:'bearer',user:{id:'other'},supabase:{rpc:mock.rpc}});
 if(what==='snapshot')mock.rpc.mockResolvedValue({error:null,data:{changed:true}});
 const result=await bookingOperationPost(request({request:what==='request'?{...input,reason:'新的修改原因'}:input,previewProof:what==='proof'?'bad':preview.previewProof}),'drafts');
 expect(result.status).toBe(409);expect(mock.rpc.mock.calls.some(c=>c[1].p_mode==='create')).toBe(false);
});
it('rejects bearer and cross-origin confirmation before authentication',async()=>{
 for(const headers of [{authorization:'Bearer test',origin:'http://localhost'},{origin:'https://other.invalid'}] as Record<string,string>[])
 expect((await confirmBookingOperation(new Request('http://localhost',{method:'POST',headers}),id)).status).toBe(403);
 expect(mock.auth).not.toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalled();
});
it('keeps lost confirmation outcomes unknown and does not leak transport details',async()=>{
 mock.auth.mockResolvedValue({authenticated:true,mode:'cookie',user:{id},supabase:{rpc:mock.rpc}});mock.rpc.mockRejectedValue(new Error('private transport'));
 const result=await confirmBookingOperation(new Request('http://localhost',{method:'POST',headers:{origin:'http://localhost'}}),id);
 expect(result.status).toBe(503);expect(await result.json()).toEqual({code:'operation_unknown_outcome'});
});
it('status lookup does not execute and preserves historical verified=false',async()=>{
 mock.rpc.mockResolvedValue({error:null,data:{id,status:'completed',verified:false}});
 const result=await bookingOperationStatus(new Request(`http://localhost?requestId=${id}`));
 expect((await result.json()).verified).toBe(false);expect(mock.rpc.mock.calls[0][1].p_mode).toBe('status');
});
