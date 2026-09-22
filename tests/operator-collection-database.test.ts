import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { seedPaymentDatabase, asCaller, ids } from "./helpers/operator-payment-database";
import { installCollectionDatabase } from "./helpers/operator-collection-database";
import { parseCollectionRequest, suggestCollectionAllocation, suggestMonthlyLeaseSplit, type CollectionRequest } from "@/features/business-actions/operator-batch";
const lease="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sale="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rent="cccccccc-cccc-4ccc-8ccc-cccccccccccc", fee="dddddddd-dddd-4ddd-8ddd-dddddddddddd", saleDue="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
let db: PGlite;
const request = (): CollectionRequest => ({requestId:ids.request,protocolVersion:"1.0",connectorVersion:"0.2.0",originalInstruction:"合成截图：租金360万，物业24万西法",totalXof:3840000,rows:[{
  lineId:"1",sourceText:"4#408租金及物业费384万西法",domain:"lease",targetId:lease,totalXof:3840000,paymentDate:"2026-09-22",paymentMethod:"bank_transfer",paidThroughDate:"2027-02-25",receiptNo:"TEST",
  allocations:[{receivableId:rent,amountXof:3600000},{receivableId:fee,amountXof:240000}]}]});
async function snapshot(q=request()) { return (await db.query<{v:unknown}>("select public.preview_operator_collection($1) v",[JSON.stringify(q)])).rows[0].v; }
async function draft(q=request(), replaces:string|null=null) {
  const s=await snapshot(q);
  return (await db.query<{v:{id:string;status:string}}>("select public.create_operator_collection($1,$2,clock_timestamp()+interval '9 minutes','test',$3) v",[JSON.stringify(q),JSON.stringify(s),replaces])).rows[0].v;
}
async function confirm(id:string) {return (await db.query<{v:{status:string;verified:boolean;items:unknown[]}}>("select public.confirm_operator_collection($1) v",[id])).rows[0].v;}
beforeAll(async()=>{ db=await PGlite.create(); await installCollectionDatabase(db); },30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec("reset role; truncate public.audit_logs,public.ledger_entries,public.receivables,public.payments,public.daily_bookings,public.lease_contracts,public.sale_contracts,public.sale_payment_schedule,public.property_fee_rules,private.operator_collection_batches,public.units,public.customers,public.buildings,public.user_profiles,auth.users cascade; select set_config('test.deny_unit','no',false);");
  await seedPaymentDatabase(db);
  await db.query(`insert into public.lease_contracts(id,unit_id,customer_id,contract_no,payment_cycle,payment_day,monthly_rent_xof,status,start_date) values($1,$2,$3,'TEST-LEASE','monthly',26,600000,'active','2026-08-26')`,[lease,ids.unit,ids.agent]);
  await db.query(`insert into public.sale_contracts(id,unit_id,customer_id,contract_no,signed_date,payment_plan_type,total_amount_xof,status) values($1,$2,$3,'TEST-SALE','2026-08-01','installment',1000000,'active')`,[sale,ids.unit,ids.agent]);
  for(const [id,target,category,amount,source] of [[rent,lease,"lease_rent",3600000,"lease_contract"],[fee,lease,"property_fee",240000,"lease_contract"],[saleDue,sale,"sale_installment",1000000,"sale_contract"]]) {
    await db.query(`insert into public.receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,due_date,amount_xof,status) values($1,$2,$3,$4,$5,$6,$7,'2026-08-26',$8,'pending')`,[id,ids.building,ids.unit,ids.agent,source,target,category,amount]);
  }
  await db.query(`insert into public.sale_payment_schedule(sale_contract_id,installment_no,due_date,amount_xof) values($1,1,'2026-08-26',1000000)`,[sale]);
});
describe('stage 4 actual transaction SQL',()=>{
  it('posts a combined 384万 receipt, verifies and retries without duplicate payments',async()=>{
    await asCaller(db,async()=>{ const d=await draft(); const result=await confirm(d.id); expect(result.verified).toBe(true); expect(result.items).toHaveLength(2); expect(await confirm(d.id)).toEqual(result); });
    expect((await db.query<{n:number}>("select count(*)::int n from public.payments")).rows[0].n).toBe(2);
    expect((await db.query<{n:string}>("select sum(amount)::text n from public.payments")).rows[0].n).toBe("3840000.00");
  });
  it('commits daily, lease and partial sale in one batch',async()=>{
    const q=request(); const daily=(await db.query<{id:string}>("select id from public.receivables where source_type='daily_booking'")).rows[0].id;
    q.rows.push({lineId:"2",sourceText:"日租1万",domain:"daily",targetId:ids.booking,totalXof:10000,paymentDate:"2026-09-22",paymentMethod:"cash",allocations:[{receivableId:daily,amountXof:10000}]},
      {lineId:"3",sourceText:"出售收款50万",domain:"sale",targetId:sale,totalXof:500000,paymentDate:"2026-09-22",paymentMethod:"check",allocations:[{receivableId:saleDue,amountXof:500000}]});
    q.totalXof+=510000;
    await asCaller(db,async()=>{const d=await draft(q);expect((await confirm(d.id)).items).toHaveLength(4);});
    expect((await db.query<{n:string}>("select paid_amount_xof::text n from public.receivables where id=$1",[saleDue])).rows[0].n).toBe("500000.00");
  });
  it('rejects changed balances before writing anything',async()=>{
    const d=await asCaller(db,()=>draft());
    await db.query("update public.receivables set paid_amount_xof=10 where id=$1",[fee]);
    await expect(asCaller(db,()=>confirm(d.id))).rejects.toThrow();
    expect((await db.query<{n:number}>("select count(*)::int n from public.payments")).rows[0].n).toBe(0);
  });
  it('rolls back the first allocation when the second write fails',async()=>{
    await db.exec(`create function public.test_fail_fee() returns trigger language plpgsql as $$ begin if new.source_type='property_fee' then raise exception 'synthetic_failure'; end if; return new; end $$; create trigger test_fail_fee before insert on public.payments for each row execute function public.test_fail_fee();`);
    try {await asCaller(db,async()=>{const d=await draft();await expect(confirm(d.id)).rejects.toThrow('synthetic_failure');});
      expect((await db.query<{n:number}>("select count(*)::int n from public.payments")).rows[0].n).toBe(0);
      expect((await db.query<{n:number}>("select count(*)::int n from public.audit_logs")).rows[0].n).toBe(0);
    } finally {await db.exec('drop trigger test_fail_fee on public.payments; drop function public.test_fail_fee();');}
  });
  it('rejects another actor and project-denied target',async()=>{
    const d=await asCaller(db,()=>draft());
    await expect(asCaller(db,()=>confirm(d.id),{actor:ids.otherActor})).rejects.toThrow('collectionNotFound');
    await db.exec("select set_config('test.deny_unit','yes',false)");
    await expect(asCaller(db,()=>snapshot())).rejects.toThrow('collectionForbidden');
  });
  it('reprepare supersedes old page with the same request; completed cannot be edited',async()=>{
    await asCaller(db,async()=>{const first=await draft(); const q=request();q.rows[0].receiptNo='CORRECTED'; const next=await draft(q,first.id);
      expect(next.id).not.toBe(first.id);await expect(confirm(first.id)).rejects.toThrow('collectionSuperseded');await confirm(next.id);
      q.rows[0].receiptNo='CHANGED';await expect(draft(q,next.id)).rejects.toThrow('collectionReceivableConflict');});
  });
  it.each(['amount','total','duplicate','historical','inactive','permission','schedule'])('rejects %s conflict at the database boundary',async mode=>{
    const q=request();
    if(mode==='amount')q.rows[0].allocations[0].amountXof=3600001;
    if(mode==='total')q.totalXof++;
    if(mode==='duplicate')q.rows.push(q.rows[0]);
    if(mode==='historical')await db.query("update public.receivables set management_status='excluded' where id=$1",[rent]);
    if(mode==='inactive')await db.query("update public.lease_contracts set status='draft' where id=$1",[lease]);
    if(mode==='permission')await db.query("update public.user_profiles set role='front_desk' where id=$1",[ids.actor]);
    if(mode==='schedule') {q.rows=[{...q.rows[0],domain:'sale',targetId:sale,totalXof:1000000,allocations:[{receivableId:saleDue,amountXof:1000000}]}];delete q.rows[0].paidThroughDate;q.totalXof=1000000;await db.exec('delete from public.sale_payment_schedule');}
    await expect(asCaller(db,()=>snapshot(q))).rejects.toThrow();
  });
  it('enforces expiry and checks persisted evidence on completed retry',async()=>{
    const d=await asCaller(db,()=>draft());await db.query("update private.operator_collection_batches set expires_at=now()-interval '1 minute' where id=$1",[d.id]);
    await expect(asCaller(db,()=>confirm(d.id))).rejects.toThrow('collectionExpired');
    await db.query("update private.operator_collection_batches set expires_at=now()+interval '5 minutes' where id=$1",[d.id]);
    await asCaller(db,()=>confirm(d.id));await db.exec('delete from public.ledger_entries');
    await expect(asCaller(db,()=>confirm(d.id))).rejects.toThrow('collectionResultInvalid');
  });
  it('cannot read drafts or invoke writes anonymously',async()=>{
    await expect(asCaller(db,()=>db.query('select * from private.operator_collection_batches'))).rejects.toThrow('permission denied');
    await expect(asCaller(db,()=>snapshot(),{role:'anon',actor:null})).rejects.toThrow('permission denied');
  });
  it('reserves parent request globally and restores its completed result',async()=>{
    await asCaller(db,async()=>{
      const d=await draft();await confirm(d.id);
      const status=(await db.query<{v:{status:string;verified:boolean}}>('select public.find_operator_collection($1) v',[ids.request])).rows[0].v;
      expect(status).toMatchObject({status:'completed',verified:true});
      await expect(db.query("select public.daily_record_payment_rpc($1,100,'2026-09-22',null,$2,'{}')",[ids.booking,ids.request])).rejects.toThrow('requestIdConflict');
    });
    expect((await db.query<{n:number}>('select count(*)::int n from public.payments where request_id=$1',[ids.request])).rows[0].n).toBe(1);
  });
});
describe('strict screenshot request and split suggestions',()=>{
  it('uses contract monthly price and dated fee rules for the six-month 384万 split',()=>{
    const c={status:'active',commencement_state:'started',start_date:'2026-08-26',monthly_rent_xof:600000};
    const rules=[{is_active:true,start_date:'2026-08-01',end_date:null,monthly_amount_xof:40000}];
    expect(suggestMonthlyLeaseSplit(c,rules,3840000,'2026-08-26','2027-02-25')).toMatchObject({status:'suggested',months:6,rentXof:3600000,propertyXof:240000});
    expect(suggestMonthlyLeaseSplit(c,[...rules,...rules],3840000,'2026-08-26','2027-02-25').status).toBe('clarification_required');
    expect(suggestMonthlyLeaseSplit({...c,free_months:1},rules,3840000,'2026-08-26','2027-02-25').status).toBe('clarification_required');
    expect(suggestMonthlyLeaseSplit(c,rules,3840000,'2026-08-26','2027-02-26').status).toBe('clarification_required');
  });
  it('reconciles 360万 rent plus 24万 fee and rejects missing money facts',()=>{
    expect(parseCollectionRequest(request()).totalXof).toBe(3840000);
    const q=request();q.rows[0].totalXof++;expect(()=>parseCollectionRequest(q)).toThrow('row_total_mismatch');
    expect(()=>parseCollectionRequest({...request(),actorId:ids.actor})).toThrow();
    const q2=request();q2.rows[0].paymentDate='2026-02-30';expect(()=>parseCollectionRequest(q2)).toThrow();
  });
  it('suggests only exact outstanding split, asks on partial mismatch',()=>{
    const selected=[{id:rent,title:'租金',category:'lease_rent',due_date:'2026-08-26',amount_xof:3600000,paid_amount_xof:0},{id:fee,title:'物业',category:'property_fee',due_date:'2026-08-26',amount_xof:240000,paid_amount_xof:0}];
    expect(suggestCollectionAllocation(3840000,selected).status).toBe('suggested');
    selected[0].paid_amount_xof=100;expect(suggestCollectionAllocation(3840000,selected).status).toBe('clarification_required');
  });
});
