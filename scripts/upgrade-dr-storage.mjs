// Local drill compatibility fix: production object versioning needs newer Storage.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { assertIsolated, docker, dockerBin, project, network } from "./lib/dr-local-runtime.mjs";
try {
  assertIsolated();
  const name = `supabase_storage_${project}`;
  const [c] = JSON.parse(docker(["inspect", name]));
  assert.equal(c.Config.Labels["com.supabase.cli.project"], project);
  assert.equal(c.Mounts.length, 1);
  assert.equal(c.Mounts[0].Type, "volume");
  assert.equal(c.Mounts[0].Name, name);
  assert.equal(c.Mounts[0].Destination, "/mnt");
  const env = { ...process.env },
    keys = [];
  for (const entry of c.Config.Env) {
    const i = entry.indexOf("=");
    const key = entry.slice(0, i);
    if (["VERSION", "NODE_VERSION", "YARN_VERSION", "PATH"].includes(key)) continue;
    env[key] = entry.slice(i + 1);
    keys.push(key);
  }
  docker(["stop", name]);
  docker(["rm", name]);
  execFileSync(
    dockerBin,
    [
      "run",
      "-d",
      "--name",
      name,
      "--network",
      network,
      "--label",
      `com.supabase.cli.project=${project}`,
      "--mount",
      `type=volume,source=${name},target=/mnt`,
      ...keys.flatMap((k) => ["--env", k]),
      "public.ecr.aws/supabase/storage-api@sha256:5fea789899d4dd16bdfdf255b3e60d55f64aabbf6976ba88cb8ed3e2f318f39a",
    ],
    { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 30000 },
  );
  assertIsolated();
  console.log("Drill Storage upgraded to pinned v1.79.16 digest; existing drill volume preserved.");
} catch {
  console.error("Safe local Storage upgrade failed");
  process.exitCode = 1;
}
