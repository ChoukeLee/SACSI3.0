import { expect, it } from 'vitest';
// @ts-expect-error Development-only JS module.
import { isolatedWebEnvironment } from '../scripts/lib/local-web-environment.mjs';
it('allows only explicit local configuration and system runtime variables',()=>{
  const env=isolatedWebEnvironment({PATH:'node',SUPABASE_SERVICE_ROLE_KEY:'secret',DEEPSEEK_API_KEY:'secret',
    SENTRY_AUTH_TOKEN:'secret',NODE_OPTIONS:'--require dangerous.js',VERCEL_GIT_COMMIT_SHA:'production'},
  {API_URL:'http://127.0.0.1:54321',ANON_KEY:'local-public',SERVICE_ROLE_KEY:'local-secret'},'ab'.repeat(32));
  expect(env.PATH).toBe('node');
  for(const key of ['SUPABASE_SERVICE_ROLE_KEY','SERVICE_ROLE_KEY','DEEPSEEK_API_KEY','SENTRY_AUTH_TOKEN','NODE_OPTIONS','VERCEL_GIT_COMMIT_SHA']) expect(env[key]).toBeUndefined();
  expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
});
it('rejects remote Supabase configuration',()=>{
  expect(()=>isolatedWebEnvironment({}, {API_URL:'https://production.supabase.co',ANON_KEY:'key'},'ab'.repeat(32))).toThrow();
});
