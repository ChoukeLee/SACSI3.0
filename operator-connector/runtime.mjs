import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { OperatorClient, validateConfig } from './core.mjs';
import { sessionStore } from './session-store.mjs';
import { pendingStore } from './pending-store.mjs';
import { durableClient } from './pending-client.mjs';
import {verifyPackage} from './verify-package.mjs';
import {fileURLToPath} from 'node:url';
export function runtime() {
  verifyPackage(fileURLToPath(new URL('.',import.meta.url)));
  const config=validateConfig(JSON.parse(readFileSync(new URL('./config.json',import.meta.url),'utf8')));
  if(!process.env.LOCALAPPDATA) throw new Error('windows_profile_required');
  const directory=join(process.env.LOCALAPPDATA,'SACSI','operator',createHash('sha256').update(config.appUrl).digest('hex').slice(0,16));
  const store=sessionStore(directory);
  return {config,store,client:durableClient(new OperatorClient(config,store),store,pendingStore(directory,config.appUrl),config)};
}
