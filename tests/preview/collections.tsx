import React from 'react';
import { createRoot } from 'react-dom/client';
import { OperatorCollectionPanel } from '@/features/business-actions/operator-collection-panel';
import '@/app/globals.css';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// Synthetic UI only: all requests are intercepted locally, no database connection.
window.fetch=async()=>new Response(JSON.stringify({status:'completed',verified:true}),{status:200,headers:{'Content-Type':'application/json'}});
const rows= [408,202].map((unit,index)=>({lineId:String(index+1),sourceText:`4#公寓${unit}租金及物业费2026.8.26–2027.2.25，384万西法`,domain:'lease' as const,targetId:id,totalXof:3840000,paymentDate:'2026-09-22',paymentMethod:'bank_transfer' as const,paidThroughDate:'2027-02-25',unitLabel:`SACSI4-${unit}`,customer:'合成测试客户',contractNo:`TEST-${unit}`,
  allocations:[{receivableId:`rent-${index}`,amountXof:3600000,category:'长租租金',title:'六个月租金',dueDate:'2026-08-26',outstandingBeforeXof:3600000,outstandingAfterXof:0},{receivableId:`fee-${index}`,amountXof:240000,category:'物业费',title:'六个月物业费',dueDate:'2026-08-26',outstandingBeforeXof:240000,outstandingAfterXof:0}]}));
createRoot(document.getElementById('root')!).render(<main><p className="bg-muted p-3 text-center text-sm">本地合成预览 · 无数据库连接 · 确认按钮仅演示</p><OperatorCollectionPanel id={id} rows={rows} totalXof={7680000} actor="local@example.invalid" requestId={id} expiresAt="2026-09-22T23:00:00Z" status="pending" /></main>);
