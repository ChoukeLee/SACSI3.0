// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {BookingOperationPanel} from '@/features/business-actions/operator-booking-operation-panel';
let root:Root,host:HTMLDivElement;const fetchMock=vi.fn();
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(operation='refund',status='pending'){await act(async()=>root.render(<BookingOperationPanel id="same-id" requestId="same-request" actor="synthetic" originalInstruction="Synthetic" plan={{operation,unitCode:'T01',amountXof:5000}} expiresAt="2026-09-23T23:59:00Z" status={status}/>));}
async function click(selector:string){await act(async()=>(host.querySelector(selector) as HTMLElement).click());}
it('requires two deliberate checks for real refund and keeps it distinct from reversal',async()=>{
 await render();expect(host.textContent).toContain('登记实际退款');expect(fetchMock).not.toHaveBeenCalled();
 await click('input');expect(host.querySelector('button')?.disabled).toBe(true);
 await click('input:nth-of-type(1)');
 const boxes=host.querySelectorAll('input');await act(async()=>{(boxes[0] as HTMLElement).click();(boxes[1] as HTMLElement).click();});
 fetchMock.mockResolvedValue({ok:true,json:async()=>({status:'completed',verified:true})});await click('button');
 expect(fetchMock).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('业务已完成');
});
it('unknown result only retries the same confirmation after another human click',async()=>{
 await render('check_in');fetchMock.mockRejectedValue(new Error('network'));await click('input');await click('button');expect(host.textContent).toContain('结果未知');
 await click('button');expect(fetchMock.mock.calls.map(([url])=>url)).toEqual(['/api/operator/v1/booking-operations/confirmations/same-id','/api/operator/v1/booking-operations/confirmations/same-id']);
});
it.each(['completed','superseded'])('never submits a %s historical page',async status=>{await render('refund',status);expect(host.querySelector('button')).toBeNull();expect(fetchMock).not.toHaveBeenCalled();});
it('shows the actual dates, gross fee, discount and final balance for a historical correction',async()=>{
 await act(async()=>root.render(<BookingOperationPanel id="same-id" requestId="same-request" actor="synthetic"
   originalInstruction="合成测试漏退房" expiresAt="2026-10-28T23:59:00Z" status="pending"
   plan={{operation:'correct_checkout',actualCheckOutBefore:'2026-10-28',actualCheckOutAfter:'2026-10-08',
     grossAfter:80000,discountAfter:40000,totalAfter:40000,paidAfter:40000,outstandingAfter:0}}/>));
 expect(host.textContent).toContain('更正已退房住期与优惠');expect(host.textContent).toContain('2026-10-08');
 expect(host.textContent).toContain('新房费（优惠前，XOF）');expect(host.textContent).toContain('新优惠（XOF）');
 expect(host.textContent).toContain('新欠款（XOF）');expect(host.querySelector('button')?.disabled).toBe(true);
 expect(fetchMock).not.toHaveBeenCalled();
});

const revisionSource = '11111111-1111-4111-8111-111111111111';
async function renderRevision(locale:'zh'|'fr',status='pending') {
 await act(async()=>root.render(<BookingOperationPanel id="same-id" requestId="new-revision-request" actor="synthetic"
   originalInstruction="修订先前退房记录，后来又收了四万；保留原收款，无优惠指令。"
   expiresAt="2026-10-29T23:59:00Z" status={status} locale={locale}
   plan={{operation:'revise_checkout_and_collect',correctsRequestId:revisionSource,correctionDateLimit:'2026-10-31',
     checkInBefore:'2026-10-17',checkInAfter:'2026-10-17',actualCheckOutBefore:'2026-10-18',actualCheckOutAfter:'2026-10-19',
     totalBefore:40000,totalAfter:80000,paidBefore:40000,paidAfter:80000,amountXof:40000,
     discountBefore:0,discountAfter:0,outstandingAfter:0,paymentDate:'2026-10-29',paymentMethod:'cash'}}/>));
}
it.each(['zh','fr'] as const)('labels the checkout revision as collection and displays the source and bound (%s)',async locale=>{
 await renderRevision(locale);
 const text=host.textContent??'';
 expect(text).toContain(locale==='zh'?'修订退房更正并补收':'Réviser le départ corrigé et encaisser un complément');
 expect(text).toContain(locale==='zh'?'来源原请求号':'Identifiant de la demande d’origine');
 expect(text).toContain(revisionSource);expect(text).toContain('2026-10-31');expect(text).toContain('2026-10-19');
 expect(text).toContain(locale==='zh'?'本次补收（XOF）':'Encaissement complémentaire (XOF)');
 expect(text).toContain(locale==='zh'?'收款日期':'Date d’encaissement');
 expect(text).toContain(locale==='zh'?'收款方式':'Moyen d’encaissement');
 expect(text).toContain(locale==='zh'?'现金':'Espèces');
 expect(text).not.toMatch(/退款|冲正|remboursement|extourne/i);
 const fields=new Map([...host.querySelectorAll('dl > div')].map(row=>[row.querySelector('dt')?.textContent,row.querySelector('dd')?.textContent]));
 expect(fields.get(locale==='zh'?'新应收（XOF）':'Nouveau montant dû (XOF)')).toBe('80000');
 expect(fields.get(locale==='zh'?'新净收款（XOF）':'Nouvel encaissement net (XOF)')).toBe('80000');
 expect(fields.get(locale==='zh'?'新欠款（XOF）':'Nouveau solde dû (XOF)')).toBe('0');
 expect(fields.get(locale==='zh'?'新优惠（XOF）':'Nouvelle remise (XOF)')).toBe('0');
 expect(host.querySelector('button')?.disabled).toBe(true);expect(fetchMock).not.toHaveBeenCalled();
});
it('requires both revision checks before a single request and preserves the confirmation id',async()=>{
 await renderRevision('zh');
 const boxes=host.querySelectorAll('input');
 await act(async()=>{(boxes[0] as HTMLElement).click();});
 expect(host.querySelector('button')?.disabled).toBe(true);expect(fetchMock).not.toHaveBeenCalled();
 expect(host.textContent).toContain('我确认修订后的退房日期、本次补收和剩余欠款；原收款记录保留。');
 await act(async()=>{(boxes[1] as HTMLElement).click();});
 expect(host.querySelector('button')?.disabled).toBe(false);
 fetchMock.mockResolvedValue({ok:true,json:async()=>({status:'completed',verified:true})});await click('button');
 expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/operator/v1/booking-operations/confirmations/same-id',
   {method:'POST',credentials:'same-origin'});
 expect(host.textContent).toContain('业务已完成并通过本次执行核验');
});
it.each(['completed','superseded'])('never submits a %s historical checkout revision',async status=>{
 await renderRevision('zh',status);expect(host.querySelector('button')).toBeNull();expect(fetchMock).not.toHaveBeenCalled();
});
