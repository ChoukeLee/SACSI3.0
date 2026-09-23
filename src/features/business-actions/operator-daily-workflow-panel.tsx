"use client";
import {useState} from "react";
export interface DailyWorkflowDisplay {
  unitCode:string;guestName:string|null;operation:string;checkIn:string;scheduledCheckOutBefore:string;scheduledCheckOutAfter:string;
  actualCheckOutAfter:string|null;totalBefore:number;totalAfter:number;paidBefore:number;paidAfter:number;outstandingAfter:number;
  amountXof:number;paymentDate:string;paymentMethod:string;cleaningRequired:boolean;
}
export function DailyWorkflowPanel({id,plan,requestId,actor,originalInstruction,expiresAt,status}:{id:string;plan:DailyWorkflowDisplay;requestId:string;actor:string;originalInstruction:string;expiresAt:string;status:string}){
  const [state,setState]=useState(status),[checked,setChecked]=useState(false),[message,setMessage]=useState('');
  async function confirm(){
    if(!checked||!['pending','unknown'].includes(state))return;
    setState('sending');setMessage('');
    try{
      const r=await fetch(`/api/operator/v1/bookings/confirmations/${id}`,{method:'POST',credentials:'same-origin'});const data=await r.json();
      if(r.ok&&data.status==='completed'&&data.verified===true){setState('completed');setMessage('整件业务已完成，收款及账务复查通过。');return;}
      setState(r.status>=500?'unknown':'blocked');setMessage(data.message||'尚未核实执行结果。请保留原请求号查询，勿换号重录；如需修改或重新准备，请让助手替换旧确认单。');
    }catch{setState('unknown');setMessage('网络中断，结果未知。请按原单重试，不要另建收款。');}
  }
  const money=(v:number)=>`${v.toLocaleString('zh-CN')} XOF`;
  return <section className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
    <h1 className="text-xl font-semibold">{plan.operation==='extend_and_collect'?'续住与收款':'退房与收款'} · 整件业务确认</h1>
    <p>{plan.unitCode} · {plan.guestName||'请核对订单客户'} · 当前账号：{actor}</p>
    <p className="whitespace-pre-wrap break-words rounded-xl border p-4">原始要求：{originalInstruction}</p>
    <dl className="grid grid-cols-1 gap-3 rounded-xl border p-4 sm:grid-cols-2">
      <div><dt>入住日期</dt><dd>{plan.checkIn}</dd></div>
      <div><dt>计划退房日期</dt><dd>{plan.scheduledCheckOutBefore} → {plan.scheduledCheckOutAfter}</dd></div>
      {plan.actualCheckOutAfter&&<div><dt>实际退房日期</dt><dd>{plan.actualCheckOutAfter}</dd></div>}
      <div><dt>订单应收</dt><dd>{money(plan.totalBefore)} → {money(plan.totalAfter)}</dd></div>
      <div><dt>订单已收</dt><dd>{money(plan.paidBefore)} → {money(plan.paidAfter)}</dd></div>
      <div><dt>变更后未收</dt><dd>{money(plan.outstandingAfter)}</dd></div>
      <div><dt>本次实收</dt><dd>{money(plan.amountXof)} · {plan.paymentDate}</dd></div>
      <div><dt>收款方式</dt><dd>{{cash:'现金',check:'支票',bank_transfer:'银行转账',offset:'抵扣/转款',other:'其他'}[plan.paymentMethod]||plan.paymentMethod}</dd></div>
    </dl>
    <p>{plan.cleaningRequired?'本单将办理退房并创建待清洁任务。':'本单将延长住期，房态保持入住中。'}其他订单和历史欠款不纳入本次收款。任一步失败，整件业务回滚。</p>
    <p className="break-all text-xs text-muted-foreground">请求号：{requestId} · 有效至：{new Date(expiresAt).toLocaleString('zh-CN',{timeZone:'Africa/Abidjan'})}（阿比让）</p>
    {state==='completed'?<p role="status">{message||'此单此前已完成，本页面未重新复核后续账务，请勿重复创建。'}</p>:state==='superseded'?<p role="alert">此单已被替换，不能执行。</p>:<>
      <label className="flex gap-2"><input type="checkbox" checked={checked} disabled={['sending','blocked'].includes(state)} onChange={e=>setChecked(e.target.checked)}/>我已核对客户、住期、应收变化和实际收款，确认整件业务。</label>
      <button className="min-h-11 rounded-lg bg-primary px-5 py-2 text-primary-foreground disabled:opacity-40" onClick={confirm} disabled={!checked||!['pending','unknown'].includes(state)}>{state==='sending'?'正在处理…':state==='unknown'?'按原单重试':'确认整件业务'}</button>
      {message&&<p role="alert">{message}</p>}
    </>}
  </section>;
}
