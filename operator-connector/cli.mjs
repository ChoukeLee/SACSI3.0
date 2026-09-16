import { VERSION } from './core.mjs';
import { runtime } from './runtime.mjs';
import { loginPrompt } from './login-prompt.mjs';
import { humanResult, humanError } from './human-output.mjs';
try {
  const {store,client}=runtime();
  const command=process.argv[2];
  if (!['login','logout','capabilities','execute','version'].includes(command)) throw new Error('usage_login_logout_capabilities_execute_version');
  const stdin=async()=>{let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>65536) throw new Error('input_too_large');}return JSON.parse(text);};
  const result=await store.lock(async()=>{
    if(command==='version') return {version:VERSION};
    if(command==='capabilities') return client.capabilities();
    if(command==='logout') return client.logout();
    if(command==='login') {const {email,password}=await (process.stdin.isTTY ? loginPrompt() : stdin());return client.login(email,password);}
    return client.execute(await stdin());
  });
  console.log(process.argv.includes('--human')?humanResult(command,result):JSON.stringify(result));
} catch(error) {
  // Never print request bodies, credentials, tokens, child-process stdout or stack.
  const code=/^[a-z0-9_]{1,100}$/i.test(error.message ?? '') ? error.message : 'connector_failed';
  console.error(process.argv.includes('--human')?humanError(code):JSON.stringify({error:code,notice:'如发送收款后结果不明，请保留原请求号核查，不要换号重录。'})); process.exitCode=1;
}
