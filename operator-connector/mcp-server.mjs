import { pathToFileURL } from 'node:url';
import { VERSION } from './core.mjs';
import { runtime } from './runtime.mjs';
import { tools, instructions, callTool } from './mcp-tools.mjs';

const failure=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
export function dispatcher(client,store) {
  let initialized=false,ready=false;
  return async message=>{
    const id=message?.id;
    if(!message || Array.isArray(message) || message.jsonrpc!=='2.0' || typeof message.method!=='string' ||
      (id!==undefined && typeof id!=='string' && !Number.isSafeInteger(id))) return failure(null,-32600,'Invalid request');
    if(id===undefined) {
      if(message.method==='notifications/initialized' && initialized) ready=true;
      return null; // Never execute a tool from a notification.
    }
    const result=value=>({jsonrpc:'2.0',id,result:value});
    if(message.method==='ping') return result({});
    if(message.method==='initialize') {
      if(initialized) return failure(id,-32600,'Already initialized');
      if(typeof message.params?.protocolVersion!=='string' || !message.params?.clientInfo || !message.params?.capabilities) return failure(id,-32602,'Invalid initialize parameters');
      initialized=true;
      return result({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'sacsi-operator',version:VERSION},instructions});
    }
    if(!ready) return failure(id,-32002,'Initialize first');
    if(message.method==='tools/list') return result({tools});
    if(message.method!=='tools/call') return failure(id,-32601,'Method not found');
    if(!tools.some(t=>t.name===message.params?.name)) return failure(id,-32602,'Unknown tool');
    try {
      const value=await callTool(message.params.name,message.params.arguments??{},client,store);
      return result({content:[{type:'text',text:JSON.stringify(value)}]});
    } catch(error) {
      const code=/^[a-zA-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'connector_failed';
      return result({isError:true,content:[{type:'text',text:JSON.stringify({error:code,notice:'结果不明请保留原请求号，不要换号重录。login_required 请本人双击 login.cmd，勿向 AI 提供密码。'})}]});
    }
  };
}

// Bounded newline framing with backpressure. stdout is reserved for JSON-RPC.
export async function serve(input,output,dispatch) {
  let pending=Buffer.alloc(0);
  const send=async response=>{if(response && !output.write(JSON.stringify(response)+'\n')) await new Promise(resolve=>output.once('drain',resolve));};
  for await(const chunk of input) {
    pending=Buffer.concat([pending,Buffer.from(chunk)]);
    let newline;
    while((newline=pending.indexOf(10))>=0) {
      if(newline>65536) throw new Error('input_too_large');
      const line=pending.subarray(0,newline).toString('utf8'); pending=pending.subarray(newline+1);
      if(!line.trim()) continue;
      let message;
      try { message=JSON.parse(line); } catch { await send(failure(null,-32700,'Parse error'));continue; }
      await send(await dispatch(message));
    }
    if(pending.length>65536) throw new Error('input_too_large');
  }
  if(pending.length) await send(failure(null,-32700,'Incomplete message'));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {const {client,store}=runtime();await serve(process.stdin,process.stdout,dispatcher(client,store));}
  catch {process.stderr.write('SACSI connector stopped; check package configuration.\n');process.exitCode=1;}
}
