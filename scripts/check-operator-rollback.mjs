import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyPackage} from '../operator-connector/verify-package.mjs';
try{
  const current=resolve(process.argv[2]),previous=resolve(process.argv[3]);verifyPackage(current);verifyPackage(previous);
  mkdirSync(resolve('work'),{recursive:true});const profile=mkdtempSync(resolve('work/rollback-check-'));
  const oldModule=await import(pathToFileURL(join(previous,'session-store.mjs'))),nextModule=await import(pathToFileURL(join(current,'session-store.mjs'))),{pendingStore}=await import(pathToFileURL(join(current,'pending-store.mjs')));
  const old=oldModule.sessionStore(profile),next=nextModule.sessionStore(profile);
  const session={userId:'synthetic',accessToken:'synthetic-not-valid',refreshToken:'synthetic-not-valid',expiresAt:Date.now()+3600000,appUrl:'https://synthetic.invalid',supabaseUrl:'https://db.invalid'};
  old.save(session);assert.deepEqual(next.load(),session);
  const journal=pendingStore(profile,session.appUrl,nextModule.protect),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  journal.put(session.userId,{requestId:id,kind:'note',sourceText:'Synthetic rollback receipt',state:'needs_details'});
  await old.lock(async()=>assert.deepEqual(old.load(),session));old.remove();assert.equal(next.load(),null);
  assert.equal(journal.get(session.userId,id).sourceText,'Synthetic rollback receipt');
  next.save(session);assert.deepEqual(old.load(),session);next.remove();
  for(const directory of [previous,current]){
    const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'rollback-test',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'}].map(x=>JSON.stringify(x)).join('\n')+'\n';
    const output=execFileSync(join(directory,'node.exe'),[join(directory,'mcp-server.mjs')],{input,encoding:'utf8',windowsHide:true,env:{...process.env,LOCALAPPDATA:profile},timeout:15000});
    const messages=output.trim().split('\n').map(x=>JSON.parse(x));
    assert.equal(messages[0].result.serverInfo.version,JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')).version);
    assert.ok(messages[1].result.tools.length>=7);
  }
  console.log('PASS: previous/current standalone MCP startup, upgrade and rollback session compatibility, old logout preserves new encrypted pending records, next version reopens pending data; no production API called.');
}catch(e){console.error(e.code==='ERR_ASSERTION'?e.message:'Rollback rehearsal failed; credentials suppressed.');process.exitCode=1;}
