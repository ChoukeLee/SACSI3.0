import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { buildPackage } from './lib/operator-package.mjs';
try {
  // No authentication or deployment. Build a candidate, not a release claim.
  const env=parseEnv(readFileSync(new URL('../.env.local',import.meta.url),'utf8'));
  if(env.NEXT_PUBLIC_SUPABASE_URL!=='https://afadqifyaoixkvxywxqb.supabase.co') throw new Error('production_project_mismatch');
  console.log(await buildPackage({formatVersion:1,appUrl:'https://sacsi-3-0.vercel.app',supabaseUrl:env.NEXT_PUBLIC_SUPABASE_URL,publishableKey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY},'production candidate; server rollout and employee acceptance required before use'));
} catch { console.error('Production candidate packaging failed; no credentials printed.');process.exitCode=1; }
