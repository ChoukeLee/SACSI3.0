import { localCredentials, safeFailure } from './lib/local-supabase-runtime.mjs';
import { buildPackage } from './lib/operator-package.mjs';
try {
  const status=localCredentials();
  console.log(await buildPackage({formatVersion:1,localTest:true,appUrl:'http://127.0.0.1:3100',supabaseUrl:status.API_URL,publishableKey:status.ANON_KEY},'local acceptance only; not employee production package'));
} catch(error) { safeFailure(error); }
