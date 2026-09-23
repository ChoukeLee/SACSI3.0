// Generates versioned handoff files only. Never changes installed files or Codex settings.
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPackage} from '../operator-connector/verify-package.mjs';
import {validateConfig} from '../operator-connector/core.mjs';
import {mcpConfig} from '../operator-connector/setup.mjs';
try{
  if(process.argv.length!==4)throw new Error('provide_new_and_previous_package');
  const next=resolve(process.argv[2]),previous=resolve(process.argv[3]);
  const version=verifyPackage(next),old=verifyPackage(previous);
  const config=validateConfig(JSON.parse(readFileSync(join(next,'config.json'),'utf8'))),oldConfig=validateConfig(JSON.parse(readFileSync(join(previous,'config.json'),'utf8')));
  if(config.appUrl!==oldConfig.appUrl||config.supabaseUrl!==oldConfig.supabaseUrl||config.localTest!==oldConfig.localTest)throw new Error('release_site_mismatch');
  if(version.version===old.version)throw new Error('distinct_release_versions_required');
  mkdirSync(resolve('work'),{recursive:true});const output=mkdtempSync(resolve('work/operator-release-'));
  const hash=directory=>createHash('sha256').update(readFileSync(join(directory,'manifest.json'))).digest('hex');
  // Disabled until the administrator finishes server rollout and reconciliation.
  writeFileSync(join(output,'upgrade-config.toml'),mcpConfig(next,config.localTest===true).replace('enabled = true','enabled = false'));
  writeFileSync(join(output,'rollback-config.toml'),mcpConfig(previous,config.localTest===true).replace('enabled = true','enabled = false'));
  writeFileSync(join(output,'release.json'),JSON.stringify({formatVersion:1,status:'candidate_not_deployed',next:{path:next,...version,manifestSha256:hash(next)},previous:{path:previous,...old,manifestSha256:hash(previous)},site:config.appUrl,pendingFormat:1,automaticReplay:false,automaticInstallation:false},null,2));
  console.log('Prepared disabled upgrade/rollback configuration and integrity metadata: '+output);
}catch(e){console.error(/^[a-z_]+$/.test(e.message)?e.message:'release_preparation_failed');process.exitCode=1;}
