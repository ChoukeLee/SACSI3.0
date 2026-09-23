import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function protect(value, mode) {
  if (process.platform!=='win32') throw new Error('windows_dpapi_required');
  try {
    const output=execFileSync(fileURLToPath(new URL('./SessionProtection.exe',import.meta.url)),[mode],
      {input:Buffer.from(value).toString('base64'),encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:15000,maxBuffer:16*1024*1024});
    return Buffer.from(output.trim(),'base64');
  } catch { throw new Error('secure_session_storage_unavailable'); }
}
export function sessionStore(directory) {
  mkdirSync(directory,{recursive:true});
  const path=join(directory,'session.dpapi');
  return {
    recoverLock(){try{protect(join(directory,'operation.lock'),'recover-lock');}catch{throw new Error('connector_lock_not_recoverable');}return {status:'lock_recovered',notice:'仅恢复已退出进程的锁；请联网按原请求号查待办，不自动入账。'};},
    load() { try { return JSON.parse(protect(readFileSync(path),'unprotect').toString('utf8')); } catch(e) { if(e.code==='ENOENT') return null; throw new Error('secure_session_unreadable_login_again'); } },
    save(value) { const temp=path+'.tmp'; writeFileSync(temp,protect(JSON.stringify(value),'protect')); renameSync(temp,path); },
    remove() { for(const p of [path,path+'.tmp']) try { unlinkSync(p); } catch(e) { if(e.code!=='ENOENT') throw e; } },
    async lock(action) {
      let fd; const path=join(directory,'operation.lock');
      try { fd=openSync(path,'wx'); } catch { throw new Error('connector_busy_or_stale_lock'); }
      try { writeFileSync(fd,`sacsi-lock-v1\n${process.pid}\n`);fsyncSync(fd);return await action(); } finally { closeSync(fd); unlinkSync(path); }
    },
  };
}
