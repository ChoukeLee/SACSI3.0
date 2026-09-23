import { describe,it,expect,vi } from 'vitest';
import { Readable,Writable } from 'node:stream';
// @ts-expect-error Standalone Node module.
import { dispatcher,serve } from '../operator-connector/mcp-server.mjs';
// @ts-expect-error Standalone Node module.
import { callTool,tools } from '../operator-connector/mcp-tools.mjs';
// @ts-expect-error Standalone Node module.
import { mcpConfig } from '../operator-connector/setup.mjs';
// @ts-expect-error Standalone Node module.
import { humanResult,humanError } from '../operator-connector/human-output.mjs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payment={requestId:id,bookingId:id,amountXof:640000,paymentDate:'2026-09-16',originalInstruction:'登记截图收款'};
const make=()=>({client:{capabilities:vi.fn().mockResolvedValue({identity:{email:'test@example.invalid'}}),execute:vi.fn().mockResolvedValue({status:'awaiting_account_confirmation'})},store:{lock:vi.fn(async(f:()=>unknown)=>f())}});
const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',clientInfo:{name:'test',version:'1'},capabilities:{}}};
async function start() {const x=make(), dispatch=dispatcher(x.client,x.store);await dispatch(initialize);await dispatch({jsonrpc:'2.0',method:'notifications/initialized'});return {...x,dispatch};}
describe('SACSI narrow MCP surface',()=>{
  it('rejects nested batch actor injection and never calls the client',async()=>{
    const client={collection:vi.fn()},store={lock:vi.fn((f:()=>unknown)=>f())};
    const args={requestId:id,originalInstruction:'test',totalXof:10,rows:[{lineId:'1',sourceText:'test',domain:'lease',targetId:id,totalXof:10,paymentDate:'2026-09-22',paymentMethod:'cash',allocations:[{receivableId:id,amountXof:10,actorId:id}]}]};
    await expect(callTool('prepare_collection_batch',args,client,store)).rejects.toThrow('invalid_tool_arguments');expect(client.collection).not.toHaveBeenCalled();
  });
  it('shows understandable identity and does not equate connection with payment release',()=>{
    const text=humanResult('capabilities',{identity:{displayName:'Ying',role:'admin',userId:id},actions:[{name:'record_daily_payment',authorized:true,availability:'implemented'}]});
    expect(text).toContain('Ying');expect(text).toContain('与 Codex 订阅账号无关');expect(text).toContain('不代表服务器截图确认功能已发布');expect(humanError('login_required')).toContain('本人');
    expect(humanError('outcome_unknown_keep_original_request_id')).toContain('不要重新编号');
  });
  it('only exposes bounded tools, no login, confirm, SQL or arbitrary action',()=>{
    expect(tools.map((t:{name:string})=>t.name)).toEqual(['query_booking_options','booking_operation_status','plan_booking_operation','prepare_booking_operation','list_pending','capture_pending','read_pending','recover_pending','daily_workflow_status','prepare_daily_workflow','search_daily_bookings','plan_daily_change','collection_status','query_collection_position','prepare_collection_batch','capabilities','new_request_id','query_daily_booking','prepare_daily_payment']);
    expect(tools.find((t:{name:string})=>t.name==='prepare_daily_payment').annotations.readOnlyHint).toBe(false);
  });
  it('retains stable request and predecessor, enforces screenshot scope',async()=>{
    const {client,store}=make();await callTool('prepare_daily_payment',{...payment,replacesConfirmationId:id},client,store);
    expect(client.execute).toHaveBeenCalledExactlyOnceWith({requestId:id,originalInstruction:payment.originalInstruction,replacesConfirmationId:id,
      actionName:'record_daily_payment',scope:'business_data',exceptionalBusinessCase:false,inputSource:'excel_screenshot',
      input:{bookingId:id,amountXof:640000,paymentDate:'2026-09-16'}});
  });
  it.each([{amountXof:1.5},{amountXof:-1},{amountXof:'64'},{amountXof:Infinity},{paymentDate:'2026-02-30'},{paymentDate:'2026-13-01'},{originalInstruction:''},{actorId:id},{password:'secret'},{inputSource:'manual_form'},{bookingId:'bad'}])('rejects invalid or privilege-injecting arguments %j',async change=>{
    const {client,store}=make();await expect(callTool('prepare_daily_payment',{...payment,...change},client,store)).rejects.toThrow();expect(client.execute).not.toHaveBeenCalled();
  });
  it.each([{}, {unitNo:'503'}, {buildingCode:'11'}, {bookingId:id,unitNo:'503'}, {bookingId:id,buildingCode:'11'}])('requires unambiguous query inputs %j',async args=>{
    const {client,store}=make();await expect(callTool('query_daily_booking',args,client,store)).rejects.toThrow();expect(client.execute).not.toHaveBeenCalled();
  });
  it('queries with allowed action and generates UUID v4',async()=>{
    const {client,store}=make();await callTool('query_daily_booking',{buildingCode:'11',unitNo:'503'},client,store);
    expect(client.execute.mock.calls[0][0]).toMatchObject({actionName:'query_daily_booking',scope:'business_data',exceptionalBusinessCase:false,input:{buildingCode:'11',unitNo:'503'}});
    const next=await callTool('new_request_id',{},client,store);expect(next.requestId).toMatch(/^[0-9a-f-]{14}4[0-9a-f-]{21}$/);
  });
  it('negotiates before tools and ignores notifications without executing them',async()=>{
    const {client,store}=make(), dispatch=dispatcher(client,store);
    expect((await dispatch({jsonrpc:'2.0',id:2,method:'tools/list'})).error.code).toBe(-32002);
    expect((await dispatch(initialize)).result.protocolVersion).toBe('2025-06-18');
    expect(await dispatch({jsonrpc:'2.0',method:'tools/call',params:{name:'prepare_daily_payment',arguments:payment}})).toBeNull();
    expect(client.execute).not.toHaveBeenCalled();
    expect((await dispatch({jsonrpc:'2.0',id:3,method:'tools/list'})).error.code).toBe(-32002);
  });
  it('lists tools, calls capabilities, rejects unknown tools and methods',async()=>{
    const {dispatch}=await start();
    expect((await dispatch({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools).toHaveLength(19);
    expect((await dispatch({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'capabilities'}})).result.content[0].text).toContain('test@example.invalid');
    expect((await dispatch({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'confirm_payment'}})).error.code).toBe(-32602);
    expect((await dispatch({jsonrpc:'2.0',id:5,method:'sql'})).error.code).toBe(-32601);
  });
  it('does not leak internal failures or retry failed writes',async()=>{
    const {dispatch,client}=await start();client.execute.mockRejectedValue(new Error('Bearer secret-token details'));
    const response=await dispatch({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'prepare_daily_payment',arguments:payment}});
    expect(response.result.isError).toBe(true);expect(JSON.stringify(response)).not.toContain('secret-token');expect(client.execute).toHaveBeenCalledTimes(1);
  });
  it('handles newline framing, parse errors, chunked UTF8, and notification silence',async()=>{
    const {dispatch}=await start();const text=Buffer.from('broken\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/test'})+'\n'+JSON.stringify({jsonrpc:'2.0',id:'中文',method:'ping'})+'\n');
    let output='';const sink=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});
    await serve(Readable.from([...text].map(b=>Buffer.from([b]))),sink,dispatch);
    const lines=output.trim().split('\n').map(line=>JSON.parse(line));expect(lines).toHaveLength(2);expect(lines[0].error.code).toBe(-32700);expect(lines[1]).toEqual({jsonrpc:'2.0',id:'中文',result:{}});
  });
  it('rejects oversized frames',async()=>{
    const {dispatch}=await start();const sink=new Writable({write(_c,_e,done){done();}});
    await expect(serve(Readable.from([Buffer.alloc(65537,65)]),sink,dispatch)).rejects.toThrow('input_too_large');
  });
  it('generates isolated, quoted config without passwords or global writes',()=>{
    const text=mcpConfig('C:\\Users\\Test\\SACSI 录入',true);
    expect(text).toContain('[mcp_servers.sacsi_operator_local]');expect(text).toContain('SACSI 录入/node.exe');expect(text).not.toMatch(/password|token|service_role/);
  });
});
