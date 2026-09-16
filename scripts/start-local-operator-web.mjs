import { cpSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { localCredentials, root, safeFailure } from './lib/local-supabase-runtime.mjs';
import { isolatedWebEnvironment } from './lib/local-web-environment.mjs';

try {
  const env = isolatedWebEnvironment(process.env, localCredentials(), randomBytes(32).toString('hex'));
  const build = process.argv.includes('--build');
  if (build) env.NODE_ENV='production';
  mkdirSync(join(root,'work'),{recursive:true});
  const stage = mkdtempSync(join(root,'work','operator-web-'));
  // Explicit source allow-list. No .env, .git, credentials, logs or prior build.
  for (const name of ['src','public','package.json','package-lock.json','tsconfig.json','next-env.d.ts',
    'next.config.mjs','postcss.config.mjs','tailwind.config.ts','instrumentation-client.ts','sentry.edge.config.ts','sentry.server.config.ts']) {
    cpSync(join(root,name),join(stage,name),{recursive:true});
  }
  console.log(build ? 'Building isolated source snapshot (no production environment files).' : 'Starting isolated source snapshot on http://127.0.0.1:3100 (no production environment files).');
  const child = spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),...(build ? ['build',stage] : ['dev',stage,'--hostname','127.0.0.1','--port','3100'])],
    {cwd:stage,env,stdio:'inherit',windowsHide:true});
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
  child.on('error',safeFailure);
  child.on('exit',code=>{ process.exitCode=code ?? 1; });
} catch (error) { safeFailure(error); }
