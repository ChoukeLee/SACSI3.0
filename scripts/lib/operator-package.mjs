import { cpSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { VERSION, validateConfig } from '../../operator-connector/core.mjs';
export const packageFiles=['core.mjs','session-store.mjs','pending-store.mjs','pending-client.mjs','verify-package.mjs','SessionProtection.cs','cli.mjs','login-prompt.mjs','human-output.mjs','runtime.mjs','mcp-tools.mjs','mcp-server.mjs','setup.mjs','login.cmd','check.cmd','logout.cmd','pending.cmd','capture.cmd','recover-lock.cmd','setup.cmd','README.md','EMPLOYEE_GUIDE.md'];
export async function buildPackage(value,purpose) {
  if(process.platform!=='win32') throw new Error('windows_packaging_required');
  const config=validateConfig(value), root=fileURLToPath(new URL('../../',import.meta.url));
  mkdirSync(join(root,'work'),{recursive:true});
  const target=mkdtempSync(join(root,`work/operator-${VERSION}-${config.localTest?'local':'production-candidate'}-`));
  for(const file of packageFiles) {
    if(file.endsWith('.cmd')) writeFileSync(join(target,file),readFileSync(join(root,'operator-connector',file),'utf8').replace(/\r?\n/g,'\r\n'));
    else cpSync(join(root,'operator-connector',file),join(target,file));
  }
  cpSync(process.execPath,join(target,'node.exe'));
  execFileSync(join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo','/target:exe',`/out:${join(target,'SessionProtection.exe')}`,'/reference:System.Security.dll',join(target,'SessionProtection.cs')],
    {windowsHide:true,stdio:'pipe',timeout:30000});
  const licensePath=join(dirname(process.execPath),'LICENSE');
  if(existsSync(licensePath)) cpSync(licensePath,join(target,'NODE-LICENSE.txt'));
  else {
    const response=await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error('node_license_unavailable');
    const license=await response.text();
    if(!license.includes('Permission is hereby granted')) throw new Error('unexpected_node_license');
    writeFileSync(join(target,'NODE-LICENSE.txt'),license);
  }
  // No environment files, credentials, sessions or unknown config fields.
  writeFileSync(join(target,'config.json'),JSON.stringify({formatVersion:1,appUrl:config.appUrl,supabaseUrl:config.supabaseUrl,publishableKey:config.publishableKey,...(config.localTest?{localTest:true}:{})},null,2));
  const checksums=Object.fromEntries([...packageFiles,'node.exe','SessionProtection.exe','NODE-LICENSE.txt','config.json'].map(file=>[file,createHash('sha256').update(readFileSync(join(target,file))).digest('hex')]));
  writeFileSync(join(target,'manifest.json'),JSON.stringify({version:VERSION,purpose,nodeVersion:process.version,checksums},null,2));
  return target;
}
