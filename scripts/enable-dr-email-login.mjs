// Recreate only this drill's stateless Auth container; never touch DB volumes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { assertIsolated, docker, dockerBin, project, network } from "./lib/dr-local-runtime.mjs";
try {
  assertIsolated();
  const name = `supabase_auth_${project}`;
  const [container] = JSON.parse(docker(["inspect", name]));
  assert.equal(container.Config.Labels["com.supabase.cli.project"], project);
  assert.equal(container.Mounts.length, 0);
  const env = { ...process.env };
  const keys = [];
  for (const entry of container.Config.Env) {
    const i = entry.indexOf("=");
    const key = entry.slice(0, i);
    env[key] = entry.slice(i + 1);
    keys.push(key);
  }
  env.GOTRUE_EXTERNAL_EMAIL_ENABLED = "true";
  env.GOTRUE_DISABLE_SIGNUP = "true";
  for (const key of ["GOTRUE_EXTERNAL_EMAIL_ENABLED", "GOTRUE_DISABLE_SIGNUP"])
    if (!keys.includes(key)) keys.push(key);
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
      ...keys.flatMap((key) => ["--env", key]),
      container.Config.Image,
      ...(container.Config.Cmd ?? []),
    ],
    { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 30000 },
  );
  assertIsolated();
  console.log(
    "Drill Auth email login enabled; registration remains disabled; no DB/volume removed.",
  );
} catch {
  console.error("Safe local Auth configuration failed");
  process.exitCode = 1;
}
