// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {DailyWorkflowPanel} from '@/features/business-actions/operator-daily-workflow-panel';
let root:Root,host:HTMLDivElement;const fetchMock=vi.fn();
const plan={unitCode:'T01',guestName:'Synthetic',operation:'extend_and_collect',checkIn:'2026-09-20',scheduledCheckOutBefore:'2026-09-23',scheduledCheckOutAfter:'2026-09-25',actualCheckOutAfter:null,totalBefore:30000,totalAfter:50000,paidBefore:0,paidAfter:10000,outstandingAfter:40000,amountXof:10000,paymentDate:'2026-09-23',paymentMethod:'cash',cleaningRequired:false};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(status='pending'){await act(async()=>root.render(<DailyWorkflowPanel id="same-id" requestId="same-request" actor="synthetic" originalInstruction="Synthetic" plan={plan} expiresAt="2026-09-23T23:59:00Z" status={status}/>));}
async function click(selector:string){await act(async()=>(host.querySelector(selector) as HTMLElement).click());}
it('requires human check then reports verified completion',async()=>{await render();expect(fetchMock).not.toHaveBeenCalled();expect(host.querySelector('button')?.disabled).toBe(true);
  fetchMock.mockResolvedValue({ok:true,json:async()=>({status:'completed',verified:true})});await click('input');await click('button');expect(host.textContent).toContain('账务复查通过');expect(host.querySelector('button')).toBeNull();});
it('retries a lost response only on human click with unchanged confirmation id',async()=>{await render();fetchMock.mockRejectedValue(new Error('network'));await click('input');await click('button');expect(fetchMock).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('结果未知');await click('button');expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls.every(([url])=>url.endsWith('/same-id'))).toBe(true);});
it.each(['completed','superseded'])('does not execute a %s historical page',async status=>{await render(status);expect(fetchMock).not.toHaveBeenCalled();expect(host.querySelector('button')).toBeNull();});
