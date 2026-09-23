// Synthetic local files only. Accept a freshly built package, never installed sessions.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyPackage} from '../operator-connector/verify-package.mjs';
import {pendingStore} from '../operator-connector/pending-store.mjs';
const target=resolve(process.argv[2]??'');
try{
  assert.equal(verifyPackage(target).version,'0.4.0');
  const {protect,sessionStore}=await import(pathToFileURL(join(target,'session-store.mjs')));
  const work=resolve('work');mkdirSync(work,{recursive:true});const profile=mkdtempSync(join(work,'recovery-check-'));
  const site='https://synthetic.invalid',actor='synthetic-actor',requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const oldSession=sessionStore(profile);oldSession.save({userId:actor,appUrl:site,accessToken:'synthetic-not-valid'});
  const journal=pendingStore(profile,site,protect);
  journal.put(actor,{requestId,kind:'note',state:'needs_details',sourceText:'Synthetic receipt'.repeat(16000)});
  assert.equal(pendingStore(profile,site,protect).get(actor,requestId).sourceText.length,272000);
  for(const file of readdirSync(join(profile,'pending-v1')))assert.ok(!readFileSync(join(profile,'pending-v1',file)).includes(Buffer.from('Synthetic receipt')));
  assert.deepEqual(journal.list('other'),[]);
  const lock=join(profile,'operation.lock');
  writeFileSync(lock,`sacsi-lock-v1\n${process.pid}\n`);
  assert.throws(()=>oldSession.recoverLock());
  // Produce a known exited process, not a guessed/nonexistent PID.
  const deadPid=execFileSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8',windowsHide:true}).trim();
  writeFileSync(lock,`sacsi-lock-v1\n${deadPid}\n`);assert.equal(oldSession.recoverLock().status,'lock_recovered');
  await oldSession.lock(async()=>assert.equal(journal.get(actor,requestId).state,'needs_details'));
  oldSession.remove();assert.equal(oldSession.load(),null);assert.equal(journal.list(actor).length,1);
  // Upgrade/reopen uses the same format. Unknown newer format fails without reset.
  const file=join(profile,'pending-v1',readdirSync(join(profile,'pending-v1'))[0]);const ciphertext=readFileSync(file);
  writeFileSync(file,protect(JSON.stringify({formatVersion:99}),'protect'));assert.throws(()=>journal.list(actor),/pending_format_upgrade_required/);writeFileSync(file,ciphertext);
  console.log('PASS: real Windows DPAPI 272KB payload, ciphertext only, actor separation, restart/upgrade data preservation, logout retention, future format refusal, live-lock refusal and exited-process lock recovery. Synthetic profile: '+profile);
}catch(e){console.error('Recovery acceptance failed: '+(e.code==='ERR_ASSERTION'?e.message:'safe failure; no data printed'));process.exitCode=1;}
