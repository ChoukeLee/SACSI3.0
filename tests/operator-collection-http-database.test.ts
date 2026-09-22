import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { installCollectionDatabase } from './helpers/operator-collection-database';
import { seedPaymentDatabase,asCaller,ids } from './helpers/operator-payment-database';
vi.mock('server-only',()=>({}));
const state=vi.hoisted(()=>({rpc:vi.fn(),mode:'bearer',loseResponse:false}));
vi.mock('@/features/business-actions/operator-request-auth',()=>({authenticateOperatorRequest:async()=>({authenticated:true,mode:state.mode,user:{id:'11111111-1111-4111-8111-111111111111'},supabase:{rpc:state.rpc}})}));
import { collectionPost,confirmCollection } from '@/features/business-actions/operator-collection-http';
let db:PGlite;
beforeAll(async()=>{db=await PGlite.create();await installCollectionDatabase(db);await seedPaymentDatabase(db);
  process.env.SACSI_OPERATOR_CONFIRMATIONS_ENABLED='true';process.env.SACSI_OPERATOR_PREVIEW_SECRET='cd'.repeat(32);process.env.SACSI_OPERATOR_PUBLIC_ORIGIN='http://localhost';
  state.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
    const signatures:Record<string,string[]>={preview_operator_collection:['p_request'],create_operator_collection:['p_request','p_snapshot','p_expires_at','p_deployment','p_replaces_id'],get_operator_collection:['p_id'],confirm_operator_collection:['p_id']};
    const keys=signatures[name];if(!keys)throw new Error('Unexpected RPC');
    const result=await asCaller(db,()=>db.query<{v:unknown}>(`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) v`,keys.map(k=>typeof args[k]==='object' && args[k]!==null?JSON.stringify(args[k]):args[k])));
    if(name==='confirm_operator_collection' && state.loseResponse){state.loseResponse=false;throw new Error('Synthetic lost response after commit');}
    return {data:result.rows[0].v,error:null};
  });
},30000);
afterAll(async()=>{await db?.close();});
it('HTTP signed preparation → SQL draft → cookie confirmation → lost response → same-request recovery',async()=>{
  const receivable=(await db.query<{id:string}>("select id from public.receivables where source_id=$1",[ids.booking])).rows[0].id;
  const q={requestId:ids.request,protocolVersion:'1.0',connectorVersion:'0.2.0',originalInstruction:'Synthetic E2E receipt',totalXof:10000,rows:[{lineId:'1',sourceText:'TEST',domain:'daily',targetId:ids.booking,totalXof:10000,paymentDate:'2026-09-22',paymentMethod:'cash',allocations:[{receivableId:receivable,amountXof:10000}]}]};
  const post=(body:unknown)=>new Request('http://localhost',{method:'POST',body:JSON.stringify(body)});
  const preview=await collectionPost(post(q),'prepare');expect(preview.status).toBe(200);const p=await preview.json();
  const draft=await collectionPost(post({request:q,previewProof:p.previewProof}),'drafts');expect(draft.status).toBe(200);const d=await draft.json();
  expect((await db.query<{n:number}>('select count(*)::int n from public.payments')).rows[0].n).toBe(0);
  state.mode='cookie';state.loseResponse=true;
  const browser=()=>new Request('http://localhost',{method:'POST',headers:{origin:'http://localhost'}});
  const unknown=await confirmCollection(browser(),d.confirmation.id);expect(unknown.status).toBe(503);expect((await unknown.json()).code).toBe('collection_outcome_unknown');
  const recovered=await confirmCollection(browser(),d.confirmation.id);expect(recovered.status).toBe(200);expect((await recovered.json()).verified).toBe(true);
  expect((await db.query<{n:number}>('select count(*)::int n from public.payments')).rows[0].n).toBe(1);
});
