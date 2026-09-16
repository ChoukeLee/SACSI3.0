import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const workdir = join(root, 'work/supabase-local');
export const project = 'sacsi-isolated-test';
const bin = 'C:\\Program Files\\Docker\\Docker\\resources\\bin';
const options = { cwd: root, env: { ...process.env, PATH: `${bin};${process.env.PATH ?? ''}` },
  encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 4 * 1024 * 1024 };
export function docker(args, input) {
  return execFileSync(join(bin, 'docker.exe'), args, { ...options, input });
}
export function assertLocalEnvironment() {
  assert.match(readFileSync(join(workdir, 'supabase/config.toml'), 'utf8'), /^project_id = "sacsi-isolated-test"$/m);
  assert.equal(existsSync(join(workdir, 'supabase/.temp/project-ref')), false, 'Cloud link forbidden');
  assert.equal(existsSync(join(workdir, '.env.local')), false, 'App credentials forbidden');
  const names = docker(['ps', '--filter', `name=_${project}$`, '--format', '{{.Names}}']).trim().split(/\r?\n/).filter(Boolean);
  for (const service of ['db', 'kong', 'auth', 'rest']) assert.ok(names.includes(`supabase_${service}_${project}`), `${service} not running`);
  let ports = 0;
  for (const name of names) {
    const [c] = JSON.parse(docker(['inspect', name]));
    assert.equal(c.Config.Labels['com.supabase.cli.project'], project);
    for (const bindings of Object.values(c.NetworkSettings.Ports ?? {})) for (const p of bindings ?? []) {
      assert.ok(['127.0.0.1', '::1'].includes(p.HostIp), 'Non-loopback binding forbidden'); ports++;
    }
  }
  assert.ok(ports >= 2);
}
export function localSql(sql) {
  assertLocalEnvironment();
  return docker(['exec', '-i', `supabase_db_${project}`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], sql).trim();
}
export function localCredentials() {
  assertLocalEnvironment();
  const status = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'npx.cmd --yes supabase@2.117.0 status --workdir work/supabase-local --output json'], options));
  assert.equal(status.API_URL, 'http://127.0.0.1:54321');
  assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY);
  return status;
}
export function safeFailure(error) {
  // Child process errors can include status credentials; do not serialize them.
  console.error(error.code === 'ERR_ASSERTION' ? error.message : `Local validation failed (${error.code ?? error.name ?? 'error'}); credentials suppressed.`);
  process.exitCode = 1;
}
