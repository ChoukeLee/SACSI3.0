import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { OperatorClient, validateConfig, VERSION } from './core.mjs';
import { sessionStore } from './session-store.mjs';
import { loginPrompt } from './login-prompt.mjs';
try {
  const config=validateConfig(JSON.parse(readFileSync(new URL('./config.json',import.meta.url),'utf8')));
  const command=process.argv[2];
  if (!['login','logout','capabilities','execute','version'].includes(command)) throw new Error('usage_login_logout_capabilities_execute_version');
  const directory=join(process.env.LOCALAPPDATA,'SACSI','operator',createHash('sha256').update(config.appUrl).digest('hex').slice(0,16));
  const store=sessionStore(directory), client=new OperatorClient(config,store);
  const stdin=async()=>{let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>65536) throw new Error('input_too_large');}return JSON.parse(text);};
  const result=await store.lock(async()=>{
    if(command==='version') return {version:VERSION};
    if(command==='capabilities') return client.capabilities();
    if(command==='logout') return client.logout();
    if(command==='login') {const {email,password}=await (process.stdin.isTTY ? loginPrompt() : stdin());return client.login(email,password);}
    return client.execute(await stdin());
  });
  console.log(JSON.stringify(result));
} catch(error) {
  // Never print request bodies, credentials, tokens, child-process stdout or stack.
  const code=/^[a-z0-9_]{1,100}$/i.test(error.message ?? '') ? error.message : 'connector_failed';
  console.error(JSON.stringify({error:code,notice:'如发送收款后结果不明，请保留原请求号核查，不要换号重录。'})); process.exitCode=1;
}
