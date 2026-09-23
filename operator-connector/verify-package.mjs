import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function verifyPackage(directory){
  let manifest;try{manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));}catch{throw new Error('package_manifest_unreadable');}
  if(!/^\d+\.\d+\.\d+$/.test(manifest.version)||!manifest.checksums||typeof manifest.checksums!=='object')throw new Error('package_manifest_invalid');
  const critical=['core.mjs','runtime.mjs','cli.mjs','mcp-server.mjs','mcp-tools.mjs','session-store.mjs','node.exe','SessionProtection.exe','config.json'];
  if(critical.some(file=>!manifest.checksums[file]))throw new Error('package_manifest_incomplete');
  for(const [file,hash] of Object.entries(manifest.checksums)){
    if(!/^[a-zA-Z0-9_.-]+$/.test(file)||file==='.'||file==='..'||!/^([a-f0-9]{64})$/.test(hash))throw new Error('package_manifest_invalid');
    try{if(lstatSync(join(directory,file)).isSymbolicLink()||createHash('sha256').update(readFileSync(join(directory,file))).digest('hex')!==hash)throw new Error();}catch{throw new Error('package_checksum_failed');}
  }
  // setup output is harmless; unmanifested executable code is not.
  for(const file of readdirSync(directory))if(/\.(?:exe|mjs|dll|cmd|ps1)$/i.test(file)&&!manifest.checksums[file])throw new Error('package_unexpected_executable');
  return {version:manifest.version,files:Object.keys(manifest.checksums).length,notice:'哈希用于完整性比对，不是可信发布签名。'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(verifyPackage(fileURLToPath(new URL('.',import.meta.url)))));}catch(e){console.error(e.message);process.exitCode=1;}}
