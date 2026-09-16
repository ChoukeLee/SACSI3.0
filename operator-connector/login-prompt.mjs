import { createInterface, emitKeypressEvents } from 'node:readline';
export async function loginPrompt() {
  if(!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('interactive_terminal_required');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  const email=await new Promise(resolve=>rl.question('SACSI email: ',resolve));
  rl.close();
  process.stdout.write('Password (hidden): ');
  emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  const password=await new Promise((resolve,reject)=>{
    let value='';
    const finish=(error)=>{process.stdin.off('keypress',onKey);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);};
    const onKey=(text,key)=>{
      if(key?.ctrl && key.name==='c') return finish(new Error('login_cancelled'));
      if(key?.name==='return') return finish();
      if(key?.name==='backspace') {value=Array.from(value).slice(0,-1).join('');return;}
      if(!key?.ctrl && !key?.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value+=text;
    };
    process.stdin.on('keypress',onKey);
  });
  return {email:String(email).trim(),password};
}
