import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
// @ts-expect-error Standalone Node module.
import {verifyPackage} from '../operator-connector/verify-package.mjs';
let directory:string;let manifest:{version:string;checksums:Record<string,string>};
const save=()=>writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest));
beforeEach(()=>{directory=mkdtempSync(join(tmpdir(),'sacsi-integrity-'));manifest={version:'0.4.0',checksums:{}};for(const file of ['core.mjs','runtime.mjs','cli.mjs','mcp-server.mjs','mcp-tools.mjs','session-store.mjs','node.exe','SessionProtection.exe','config.json']){writeFileSync(join(directory,file),'synthetic');manifest.checksums[file]=createHash('sha256').update('synthetic').digest('hex');}save();});
afterEach(()=>rmSync(directory,{recursive:true,force:true}));
it('accepts only the complete hash checked package',()=>{expect(verifyPackage(directory).version).toBe('0.4.0');});
it('rejects tampered executable before runtime starts',()=>{writeFileSync(join(directory,'core.mjs'),'tampered');expect(()=>verifyPackage(directory)).toThrow('package_checksum_failed');});
it('rejects traversal and unlisted executable files',()=>{manifest.checksums['../outside']=manifest.checksums['core.mjs'];save();expect(()=>verifyPackage(directory)).toThrow('package_manifest_invalid');delete manifest.checksums['../outside'];save();writeFileSync(join(directory,'extra.cmd'),'synthetic');expect(()=>verifyPackage(directory)).toThrow('package_unexpected_executable');});
it('rejects incomplete manifest',()=>{delete manifest.checksums['node.exe'];save();expect(()=>verifyPackage(directory)).toThrow('package_manifest_incomplete');});
