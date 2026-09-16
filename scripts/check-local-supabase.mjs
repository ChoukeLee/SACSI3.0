// Deliberately does not load dotenv/Next configuration or accept a remote URL.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const workdir = join(root, 'work', 'supabase-local');
const project = 'sacsi-isolated-test';
const dockerBin = 'C:\\Program Files\\Docker\\Docker\\resources\\bin';
const env = { ...process.env, PATH: `${dockerBin};${process.env.PATH ?? ''}` };
const options = { cwd: root, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 };
const docker = (...args) => execFileSync(join(dockerBin, 'docker.exe'), args, options);

async function main() {
  assert.match(readFileSync(join(workdir, 'supabase/config.toml'), 'utf8'), /^project_id = "sacsi-isolated-test"$/m);
  assert.equal(existsSync(join(workdir, 'supabase/.temp/project-ref')), false, 'Must not be linked to a cloud project');
  assert.equal(existsSync(join(workdir, '.env.local')), false, 'Must not load application credentials');

  const names = docker('ps', '--filter', `name=_${project}`, '--format', '{{.Names}}').trim().split(/\r?\n/).filter(Boolean);
  assert.ok(names.includes(`supabase_db_${project}`), 'Local database must be running');
  let bindings = 0;
  for (const name of names) {
    const [container] = JSON.parse(docker('inspect', name));
    for (const ports of Object.values(container.NetworkSettings.Ports ?? {})) {
      for (const port of ports ?? []) {
        assert.ok(['127.0.0.1', '::1'].includes(port.HostIp), `${name} has a non-loopback published port`);
        bindings++;
      }
    }
  }
  assert.ok(bindings >= 2, 'Database and API ports must be published');
  console.log(`PASS: ${names.length} containers; ${bindings} loopback-only port bindings`);

  // Capture status in memory: never print the returned keys or database password.
  const status = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'npx.cmd --yes supabase@2.117.0 status --workdir work/supabase-local --output json'], options));
  assert.equal(status.API_URL, 'http://127.0.0.1:54321');
  assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Local credentials unavailable');
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, clientOptions);
  const client = createClient(status.API_URL, status.ANON_KEY, clientOptions);
  const email = `local-smoke-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString('base64url');
  let userId;
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null, 'Synthetic user creation failed');
    userId = created.data.user.id;
    const login = await client.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null, 'Real Auth login failed');
    const verified = await client.auth.getUser(login.data.session.access_token);
    assert.equal(verified.error, null, 'Real Auth token verification failed');
    assert.equal(verified.data.user.id, userId);
    console.log('PASS: synthetic account created, password login and server token verification');
    const invalid = await client.auth.getUser('invalid-local-smoke-token');
    assert.ok(invalid.error, 'Invalid token must be rejected');
    console.log('PASS: invalid token rejected');
  } finally {
    if (userId) {
      const signedOut = await client.auth.signOut();
      const deleted = await admin.auth.admin.deleteUser(userId);
      assert.equal(deleted.error, null, 'Synthetic account cleanup failed');
      assert.equal(signedOut.error, null, 'Synthetic session sign-out failed');
      const removed = await admin.auth.admin.getUserById(userId);
      assert.equal(removed.data.user, null, 'Synthetic account must no longer exist');
      assert.equal(removed.error?.status, 404, 'Cleanup must be verified by Auth');
      console.log('PASS: synthetic session signed out and test account removed');
    }
  }
  console.log('Auth infrastructure only: business schema/RLS/page acceptance remains pending.');
}

main().catch(error => {
  // Subprocess exceptions may contain credentials in stdout; never dump them.
  console.error(error.code === 'ERR_ASSERTION' ? error.message : 'Local smoke check failed; inspect local service health (credentials suppressed).');
  process.exitCode = 1;
});
