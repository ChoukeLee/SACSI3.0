import { beforeEach, it, expect, vi } from "vitest";
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn()}));
vi.mock('@/features/business-actions/operator-request-auth',()=>({authenticateOperatorRequest:mock.auth}));
import { collectionPost, confirmCollection } from '@/features/business-actions/operator-collection-http';
import { GET as statusGet } from '@/app/api/operator/v1/collections/status/route';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input={requestId:id,protocolVersion:'1.0',connectorVersion:'0.2.0',originalInstruction:'合成凭证',totalXof:100,rows:[{lineId:'1',sourceText:'日租收款',domain:'daily',targetId:id,totalXof:100,paymentDate:'2026-09-22',paymentMethod:'cash',allocations:[{receivableId:id,amountXof:100}]}]};
const snapshot=[{lineId:'1',unit:{code:'TEST',unit_no:'1'},customer:{name:'Test'},contract:{},receivables:[{id,title:'Test',category:'daily_rental',due_date:'2026-09-22',amount_xof:100,paid_amount_xof:0}]}];
const request=(body:unknown)=>new Request('http://localhost/api/operator/v1/collections/prepare',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();process.env.SACSI_OPERATOR_CONFIRMATIONS_ENABLED='true';process.env.SACSI_OPERATOR_PREVIEW_SECRET='ab'.repeat(32);process.env.SACSI_OPERATOR_PUBLIC_ORIGIN='http://localhost';
  mock.auth.mockResolvedValue({authenticated:true,mode:'bearer',user:{id,email:'test@invalid'},supabase:{rpc:mock.rpc}});
  mock.rpc.mockImplementation(async name=>({error:null,data:name==='preview_operator_collection'?snapshot:{id,status:'pending'}}));});
it('signed preview and draft never call the payment confirmation RPC',async()=>{
  const preview=await (await collectionPost(request(input),'prepare')).json();
  const result=await collectionPost(request({request:input,previewProof:preview.previewProof}),'drafts');
  expect(result.status).toBe(200);expect((await result.json()).confirmationPath).toBe(`/operator/collections/${id}`);
  expect(mock.rpc.mock.calls.map(c=>c[0])).toEqual(['preview_operator_collection','preview_operator_collection','create_operator_collection']);
});
it('rejects a modified request with an old proof',async()=>{
  const preview=await (await collectionPost(request(input),'prepare')).json();
  const changed=structuredClone(input);changed.rows[0].sourceText='changed';
  const result=await collectionPost(request({request:changed,previewProof:preview.previewProof}),'drafts');
  expect(result.status).toBe(409);expect(mock.rpc.mock.calls.some(c=>c[0]==='create_operator_collection')).toBe(false);
});
it('rejects malformed nested allocation and client supplied actor',async()=>{
  expect((await collectionPost(request({...input,actorId:id}),'prepare')).status).toBe(409);
  expect(mock.rpc).not.toHaveBeenCalled();
});
it('denies bearer and cross-origin confirmation before any RPC',async()=>{
  for(const headers of [{authorization:'Bearer token',origin:'http://localhost'},{origin:'https://evil.invalid'}] as Record<string,string>[]) {
    expect((await confirmCollection(new Request('http://localhost',{method:'POST',headers}),id)).status).toBe(403);
  }expect(mock.rpc).not.toHaveBeenCalled();
});
it('denies a stale deployment and returns unknown after a lost execution response',async()=>{
  mock.auth.mockResolvedValue({authenticated:true,mode:'cookie',user:{id},supabase:{rpc:mock.rpc}});
  const req=()=>new Request('http://localhost',{method:'POST',headers:{origin:'http://localhost'}});
  mock.rpc.mockResolvedValueOnce({data:{deployment:'old'},error:null});expect((await confirmCollection(req(),id)).status).toBe(409);
  mock.rpc.mockResolvedValueOnce({data:{deployment:`${process.env.NEXT_PUBLIC_SUPABASE_URL}|${process.env.VERCEL_GIT_COMMIT_SHA??process.env.NEXT_PUBLIC_APP_VERSION??'local-development'}`,request_id:id,request_data:input},error:null}).mockRejectedValueOnce(new Error('secret transport detail'));
  const response=await confirmCollection(req(),id);expect(response.status).toBe(503);expect(await response.text()).toContain('collection_outcome_unknown');
});
it('recovers the original request without executing payments',async()=>{
  mock.rpc.mockResolvedValueOnce({error:null,data:{id,status:'pending',requestId:id}});
  const result=await statusGet(new Request(`http://localhost/api/operator/v1/collections/status?requestId=${id}`));
  expect((await result.json()).confirmationPath).toBe(`/operator/collections/${id}`);expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('find_operator_collection',{p_request_id:id});
});
it('rejects anonymous queries',async()=>{mock.auth.mockResolvedValue({authenticated:false,reason:'missing_or_invalid_session'});expect((await collectionPost(request({domain:'lease',targetId:id}),'query')).status).toBe(401);expect(mock.rpc).not.toHaveBeenCalled();});
