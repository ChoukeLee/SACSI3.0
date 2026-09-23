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
