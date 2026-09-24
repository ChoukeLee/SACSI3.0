import { afterAll, afterEach, beforeAll, beforeEach, it, expect } from "vitest";
import type pg from "pg";
import { createNativePaymentPostgres, paymentAdapter } from "./helpers/native-payment-postgres";
import { installCollectionDatabase } from "./helpers/operator-collection-database";
import { seedPaymentDatabase, ids } from "./helpers/operator-payment-database";
let cluster:Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let owner:pg.Client,first:pg.Client,second:pg.Client;
let firstPid:number,secondPid:number;
async function begin(c:pg.Client){await c.query('begin');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.actor,role:'authenticated',email:'test@invalid'})]);await c.query('set local role authenticated');}
async function blocked(){for(let n=0;n<100;n++){if((await owner.query('select $2::int=any(pg_blocking_pids($1::int)) blocked',[secondPid,firstPid])).rows[0].blocked)return;await new Promise(r=>{setTimeout(r,20);});}throw new Error('Expected lock wait');}
const settle=(p:Promise<pg.QueryResult>)=>p.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
beforeAll(async()=>{cluster=await createNativePaymentPostgres();owner=await cluster.connect();first=await cluster.connect();second=await cluster.connect();
  firstPid=(await first.query('select pg_backend_pid() id')).rows[0].id;secondPid=(await second.query('select pg_backend_pid() id')).rows[0].id;
  await installCollectionDatabase(paymentAdapter(owner));});
afterAll(async()=>{await cluster?.close();});
afterEach(async()=>{await Promise.all([first.query('rollback'),second.query('rollback')]);});
beforeEach(async()=>{await owner.query('truncate public.audit_logs,public.ledger_entries,public.payments,public.receivables,public.daily_bookings,public.units,public.customers,public.buildings,public.user_profiles,auth.users cascade');await seedPaymentDatabase(paymentAdapter(owner));});
async function draft(requestId=ids.request){
  const r=(await owner.query("select id from public.receivables where source_id=$1",[ids.booking])).rows[0].id;
  const request={requestId,protocolVersion:'1.0',connectorVersion:'0.2.0',originalInstruction:'Synthetic native batch',totalXof:10000,rows:[{lineId:'1',sourceText:'Test',domain:'daily',targetId:ids.booking,totalXof:10000,paymentDate:'2026-09-22',paymentMethod:'cash',allocations:[{receivableId:r,amountXof:10000}]}]};
  await begin(first);
  const snapshot=(await first.query('select public.preview_operator_collection($1) s',[JSON.stringify(request)])).rows[0].s;
  const d=(await first.query("select public.create_operator_collection($1,$2,now()+interval '5 minutes','test') d",[JSON.stringify(request),JSON.stringify(snapshot)])).rows[0].d;
  await first.query('commit');return {id:d.id,request,snapshot};
}
it('concurrent same-batch confirmation posts once',async()=>{
  const d=await draft();await begin(first);const result=await first.query('select public.confirm_operator_collection($1) result',[d.id]);
  await begin(second);const pending=settle(second.query('select public.confirm_operator_collection($1) result',[d.id]));await blocked();await first.query('commit');
  const next=await pending;expect(next.ok).toBe(true);if(next.ok)expect(next.value?.rows).toEqual(result.rows);await second.query('commit');
  expect((await owner.query('select count(*)::int n from public.payments')).rows[0].n).toBe(1);
});
it('different batches against the same balance serialize and invalidate stale preview',async()=>{
  const one=await draft(),two=await draft(ids.secondRequest);await begin(first);await first.query('select public.confirm_operator_collection($1)',[one.id]);
  await begin(second);const pending=settle(second.query('select public.confirm_operator_collection($1)',[two.id]));await blocked();await first.query('commit');
  const next=await pending;expect(next.ok).toBe(false);if(!next.ok)expect(next.error.message).toContain('collectionSnapshotChanged');await second.query('rollback');
  expect((await owner.query('select count(*)::int n from public.payments')).rows[0].n).toBe(1);
});
it('concurrent reprepare cannot replace a completed batch',async()=>{
  const d=await draft();d.request.rows[0].sourceText='Corrected';await begin(first);await first.query('select public.confirm_operator_collection($1)',[d.id]);
  await begin(second);const pending=settle(second.query("select public.create_operator_collection($1,$2,now()+interval '5 minutes','test',$3)",[JSON.stringify(d.request),JSON.stringify(d.snapshot),d.id]));await blocked();await first.query('commit');
  const next=await pending;expect(next.ok).toBe(false);if(!next.ok)expect(next.error.message).toContain('collectionRequestConflict');await second.query('rollback');
});
