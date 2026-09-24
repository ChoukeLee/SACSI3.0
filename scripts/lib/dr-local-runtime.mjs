import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { unseal, digest } from "./dr-archive.mjs";
export const root = resolve(import.meta.dirname, "../..");
export const project = "sacsi-dr-20260923";
export const network = project;
export const db = `supabase_db_${project}`;
export const dockerBin = "C:/Program Files/Docker/Docker/resources/bin/docker.exe";
export function docker(args, input, binary = false) {
  return execFileSync(dockerBin, args, {
    input,
    encoding: binary ? undefined : "utf8",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 180000,
    maxBuffer: 128 * 1024 * 1024,
  });
}
export function backupInput(path) {
  const directory = resolve(path);
  assert.equal(dirname(directory), join(root, "outputs/disaster-recovery"));
  assert.match(basename(directory), /^backup-[A-Za-z0-9]+$/);
  const key = readFileSync(join(root, "work/disaster-recovery-keys", basename(directory) + ".key"));
  const manifest = JSON.parse(unseal(readFileSync(join(directory, "manifest.json.aes")), key));
  assert.equal(manifest.project, "afadqifyaoixkvxywxqb");
  assert.equal(manifest.complete, true);
  const dump = unseal(readFileSync(join(directory, "database.dump.aes")), key);
  assert.equal(digest(dump), manifest.dumpSha256);
  return { directory, key, manifest, dump };
}
export function assertIsolated() {
  const [net] = JSON.parse(docker(["network", "inspect", network]));
  assert.equal(net.Internal, true);
  const names = docker([
    "ps",
    "-a",
    "--filter",
    `label=com.supabase.cli.project=${project}`,
    "--format",
    "{{.Names}}",
  ])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.ok(names.includes(db));
  for (const name of names) {
    assert.ok(name.endsWith("_" + project));
    const [c] = JSON.parse(docker(["inspect", name]));
    assert.equal(c.Config.Labels["com.supabase.cli.project"], project);
    assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [network]);
    for (const bindings of Object.values(c.HostConfig.PortBindings ?? {}))
      for (const p of bindings ?? []) assert.ok(["127.0.0.1", "::1", ""].includes(p.HostIp));
    // Empty HostIp inherits network's explicit loopback default, verify live mapping too.
    for (const bindings of Object.values(c.NetworkSettings.Ports ?? {}))
      for (const p of bindings ?? []) assert.ok(["127.0.0.1", "::1"].includes(p.HostIp));
  }
  assert.equal(net.Options["com.docker.network.bridge.host_binding_ipv4"], "127.0.0.1");
  return names;
}
export function sql(query) {
  assertIsolated();
  return docker(
    [
      "exec",
      "-i",
      db,
      "psql",
      "-X",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    query,
  ).trim();
}
export const localClient = {
  async query(query, params) {
    assert.equal(params, undefined);
    const out = sql(`select coalesce(json_agg(dr_result),'[]'::json) from (${query}) dr_result;`);
    return { rows: JSON.parse(out) };
  },
};
