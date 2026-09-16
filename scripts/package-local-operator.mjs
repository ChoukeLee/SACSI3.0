import { cpSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { localCredentials, root, safeFailure } from './lib/local-supabase-runtime.mjs';
import { VERSION, validateConfig } from '../operator-connector/core.mjs';
try {
  // Deliberately local-only. Release packaging requires a reviewed production config.
  const status=localCredentials();
  const config=validateConfig({formatVersion:1,localTest:true,appUrl:'http://127.0.0.1:3100',supabaseUrl:status.API_URL,publishableKey:status.ANON_KEY});
  mkdirSync(join(root,'work'),{recursive:true});
  const target=mkdtempSync(join(root,`work/operator-${VERSION}-local-`));
  const files=['core.mjs','session-store.mjs','SessionProtection.cs','cli.mjs','login-prompt.mjs','README.md'];
  for(const file of files) cpSync(join(root,'operator-connector',file),join(target,file));
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
  writeFileSync(join(target,'config.json'),JSON.stringify(config,null,2));
  const checksums=Object.fromEntries([...files,'node.exe','SessionProtection.exe','NODE-LICENSE.txt','config.json'].map(f=>[f,createHash('sha256').update(readFileSync(join(target,f))).digest('hex')]));
  writeFileSync(join(target,'manifest.json'),JSON.stringify({version:VERSION,purpose:'local acceptance only; not employee production package',nodeVersion:process.version,checksums},null,2));
  console.log(target);
} catch(error) { safeFailure(error); }
