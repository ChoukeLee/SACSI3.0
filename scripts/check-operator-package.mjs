import assert from 'node:assert/strict';
import { readFileSync,readdirSync,mkdtempSync } from 'node:fs';
import { join,resolve,relative,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { packageFiles } from './lib/operator-package.mjs';
import { validateConfig,VERSION } from '../operator-connector/core.mjs';
try {
  const root=fileURLToPath(new URL('../',import.meta.url)),target=resolve(process.argv[2]??'');
  const work=join(root,'work'),rel=relative(work,target);
  assert.ok(!rel.startsWith('..') && !rel.includes('\\') && !rel.includes('/') && basename(target).startsWith(`operator-${VERSION}-production-candidate-`));
  const manifest=JSON.parse(readFileSync(join(target,'manifest.json'),'utf8'));
  const expected=[...packageFiles,'node.exe','SessionProtection.exe','NODE-LICENSE.txt','config.json'];
  assert.deepEqual(Object.keys(manifest.checksums).sort(),[...expected].sort());
  assert.deepEqual(readdirSync(target).sort(),[...expected,'manifest.json'].sort());
  const env=parseEnv(readFileSync(join(root,'.env.local'),'utf8'));
  const secrets=Object.entries(env).filter(([key,value])=>!key.startsWith('NEXT_PUBLIC_') && value.length>=12).map(([,value])=>Buffer.from(value));
  for(const file of expected) {
    const bytes=readFileSync(join(target,file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.checksums[file]);
    assert.ok(secrets.every(secret=>!bytes.includes(secret)),'private environment value in package');
  }
  const config=validateConfig(JSON.parse(readFileSync(join(target,'config.json'),'utf8')));
  assert.deepEqual(Object.keys(config).sort(),['formatVersion','appUrl','supabaseUrl','publishableKey'].sort());
  assert.equal(config.appUrl,'https://sacsi-3-0.vercel.app');
  assert.equal(config.supabaseUrl,'https://afadqifyaoixkvxywxqb.supabase.co');
  const profile=mkdtempSync(join(work,'package-check-'));
  const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'package-check',version:'1'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'}, {jsonrpc:'2.0',id:2,method:'tools/list'}];
  const output=execFileSync(join(target,'node.exe'),[join(target,'mcp-server.mjs')],{cwd:profile,env:{...process.env,LOCALAPPDATA:profile},
    input:messages.map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:15000});
  const results=output.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(results.length,2);assert.equal(results[0].result.serverInfo.version,VERSION);assert.equal(results[1].result.tools.length,4);
  console.log('PASS: complete checksums, public-only config, no private environment values, standalone MCP handshake from unrelated working directory; no production API called.');
} catch {console.error('Package verification failed; no credentials printed.');process.exitCode=1;}
