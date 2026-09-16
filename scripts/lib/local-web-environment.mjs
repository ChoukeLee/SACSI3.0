export function isolatedWebEnvironment(host, status, secret) {
  if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !/^[a-f0-9]{64}$/.test(secret)) {
    throw new Error('Invalid local web configuration');
  }
  const env = {};
  // Do not inherit production secrets, telemetry, NODE_OPTIONS or Vercel identity.
  for (const name of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']) {
    if (host[name]) env[name] = host[name];
  }
  return { ...env, NODE_ENV:'development', NEXT_TELEMETRY_DISABLED:'1',
    NEXT_PUBLIC_SUPABASE_URL:status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,
    NEXT_PUBLIC_APP_VERSION:'isolated-local-acceptance', SACSI_OPERATOR_CONFIRMATIONS_ENABLED:'true',
    SACSI_OPERATOR_PREVIEW_SECRET:secret, SACSI_OPERATOR_PUBLIC_ORIGIN:'http://127.0.0.1:3100' };
}
