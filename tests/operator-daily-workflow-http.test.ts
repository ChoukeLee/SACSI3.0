import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn()}));
vi.mock('@/features/business-actions/operator-request-auth',()=>({authenticateOperatorRequest:mock.auth}));
import {dailyWorkflowPost,confirmDailyWorkflow} from '@/features/business-actions/operator-daily-workflow-http';
import {confirmationDeployment} from '@/features/business-actions/operator-confirmation-http';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input={requestId:id,bookingId:id,operation:'extend_and_collect',originalInstruction:'合成测试',effectiveCheckOut:'2026-10-01',amountXof:100,paymentDate:'2026-09-22',paymentMethod:'cash'};
const snapshot={snapshot:{booking:{id}},plan:{amountXof:100}};
const request=(body:unknown)=>new Request('http://localhost',{method:'POST',body:JSON.stringify(body)});
const confirmRequest=()=>new Request('http://localhost',{method:'POST',headers:{origin:'http://localhost'}});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('SACSI_OPERATOR_CONFIRMATIONS_ENABLED','true');vi.stubEnv('SACSI_OPERATOR_PREVIEW_SECRET','ab'.repeat(32));vi.stubEnv('SACSI_OPERATOR_PUBLIC_ORIGIN','http://localhost');
  mock.auth.mockResolvedValue({authenticated:true,mode:'bearer',user:{id},supabase:{rpc:mock.rpc}});
  mock.rpc.mockImplementation(async name=>({error:null,data:name==='preview_daily_workflow'?snapshot:{id,status:'pending'}}));});
afterEach(()=>vi.unstubAllEnvs());
it('only prepares a signed draft, never executes during preparation',async()=>{
  const preview=await(await dailyWorkflowPost(request(input),'prepare')).json();
  const result=await dailyWorkflowPost(request({request:input,previewProof:preview.previewProof}),'drafts');
  expect(result.status).toBe(200);expect((await result.json()).confirmationPath).toBe(`/operator/daily-workflows/${id}`);
  expect(mock.rpc.mock.calls.map(c=>c[0])).toEqual(['preview_daily_workflow','preview_daily_workflow','create_daily_workflow']);
});
it.each(['request','snapshot','actor','proof'])('rejects altered %s at draft creation',async what=>{
  const preview=await(await dailyWorkflowPost(request(input),'prepare')).json();
  if(what==='snapshot')mock.rpc.mockResolvedValue({error:null,data:{...snapshot,changed:true}});
  if(what==='actor')mock.auth.mockResolvedValue({authenticated:true,mode:'bearer',user:{id:'other'},supabase:{rpc:mock.rpc}});
  const response=await dailyWorkflowPost(request({request:what==='request'?{...input,amountXof:200}:input,previewProof:what==='proof'?'bad':preview.previewProof}),'drafts');
  expect(response.status).toBe(409);expect(mock.rpc.mock.calls.some(c=>c[0]==='create_daily_workflow')).toBe(false);
});
it.each([{...input,paymentDate:undefined},{...input,actorId:id},{...input,amountXof:0}])('rejects missing or injected inputs',async value=>{
  expect((await dailyWorkflowPost(request(value),'prepare')).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
});
it('rejects bearer and foreign-origin confirmation before authentication',async()=>{
  for(const headers of [{authorization:'Bearer test',origin:'http://localhost'},{origin:'https://evil.invalid'}] as Record<string,string>[])
    expect((await confirmDailyWorkflow(new Request('http://localhost',{method:'POST',headers}),id)).status).toBe(403);
  expect(mock.auth).not.toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalled();
});
it('blocks obsolete deployment and preserves unknown outcome after a lost response',async()=>{
  mock.auth.mockResolvedValue({authenticated:true,mode:'cookie',user:{id},supabase:{rpc:mock.rpc}});
  mock.rpc.mockResolvedValueOnce({data:{deployment:'old'},error:null});expect((await confirmDailyWorkflow(confirmRequest(),id)).status).toBe(409);
  mock.rpc.mockResolvedValueOnce({data:{deployment:confirmationDeployment(),request_id:id,request_data:input},error:null}).mockRejectedValueOnce(new Error('secret transport'));
  const response=await confirmDailyWorkflow(confirmRequest(),id);expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'workflow_unknown_outcome'});
});
it('requires exact verified payment identity in execution response',async()=>{
  mock.auth.mockResolvedValue({authenticated:true,mode:'cookie',user:{id},supabase:{rpc:mock.rpc}});
  mock.rpc.mockResolvedValueOnce({data:{deployment:confirmationDeployment(),request_id:id,request_data:input},error:null}).mockResolvedValueOnce({data:{verified:true,requestId:id,amountXof:99},error:null});
  expect((await confirmDailyWorkflow(confirmRequest(),id)).status).toBe(503);
});
