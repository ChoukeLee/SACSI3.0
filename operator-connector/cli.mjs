import { VERSION } from './core.mjs';
import { runtime } from './runtime.mjs';
import { loginPrompt } from './login-prompt.mjs';
import { humanResult, humanError } from './human-output.mjs';
import {createInterface} from 'node:readline/promises';
import {randomUUID} from 'node:crypto';
try {
  const {store,client}=runtime();
  const command=process.argv[2];
  if (!['login','logout','capabilities','execute','version','pending','capture','recover-lock'].includes(command)) throw new Error('usage_login_logout_capabilities_execute_version_pending');
  const stdin=async()=>{let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>65536) throw new Error('input_too_large');}return JSON.parse(text);};
  const result=command==='recover-lock'?store.recoverLock():await store.lock(async()=>{
    if(command==='version') return {version:VERSION};
    if(command==='pending') return client.pending('list');
    if(command==='capture'){
      if(!process.stdin.isTTY)throw new Error('interactive_capture_required');
      const session=store.load();if(!session)throw new Error('login_required');
      const rl=createInterface({input:process.stdin,output:process.stdout});
      try{
        console.log(`本地保存的 SACSI 账号标识：${session.userId}（离线未验证权限）。此功能仅记待办，不入账。`);
        if((await rl.question('确认是本人账号？输入 YES：')).trim()!=='YES')throw new Error('login_cancelled');
        const sourceText=(await rl.question('输入凭证说明（单行，不要输入密码；原图片另存）：')).trim();
        if(!sourceText||sourceText.length>4000)throw new Error('invalid_tool_arguments');
        return client.pending('capture',{requestId:randomUUID(),sourceText});
      }finally{rl.close();}
    }
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
