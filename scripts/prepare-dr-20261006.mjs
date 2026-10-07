// Clone only local runtime configuration into new, empty volumes. Preserve the old drill.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { docker, dockerBin } from "./lib/dr-local-runtime.mjs";

const source = "sacsi-dr-20260923";
const target = "sacsi-dr-20261006";
const services = ["db", "inbucket", "auth", "storage", "rest", "kong"];
const replace = (value) =>
  value
    .replaceAll(source, target)
    .replaceAll("55321", "56321")
    .replaceAll("55322", "56322")
    .replaceAll("55324", "56324");
try {
  const occupied = docker(["ps", "-a", "--format", "{{.Names}}"]);
  assert.ok(
    !occupied.split(/\r?\n/).some((name) => name.endsWith("_" + target)),
    "Target containers already exist; no overwrite",
  );
  const volumes = docker(["volume", "ls", "--format", "{{.Name}}"]);
  assert.ok(
    !volumes.split(/\r?\n/).some((name) => name.endsWith("_" + target)),
    "Target volumes already exist; no overwrite",
  );
  const configs = services.map((service) => {
    const [c] = JSON.parse(docker(["inspect", `supabase_${service}_${source}`]));
    assert.equal(c.Config.Labels["com.supabase.cli.project"], source);
    assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [source]);
    assert.ok(c.Mounts.every((m) => m.Type === "volume" && m.Name.endsWith("_" + source)));
    assert.ok(
      !JSON.stringify([c.Config.Env, c.Config.Cmd]).includes("afadqifyaoixkvxywxqb"),
      "Production endpoint in local config",
    );
    return { service, c };
  });
  docker([
    "network",
    "create",
    "--internal",
    "--opt",
    "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
    target,
  ]);
  for (const { service, c } of configs) {
    const env = { ...process.env };
    const envKeys = c.Config.Env.map((entry) => {
      const i = entry.indexOf("=");
      const key = entry.slice(0, i);
      env[key] = replace(entry.slice(i + 1));
      return key;
    });
    const args = [
      "create",
      "--name",
      `supabase_${service}_${target}`,
      "--network",
      target,
      "--label",
      `com.supabase.cli.project=${target}`,
    ];
    for (const m of c.Mounts)
      args.push("--mount", `type=volume,source=${replace(m.Name)},target=${m.Destination}`);
    for (const [port, bindings] of Object.entries(c.HostConfig.PortBindings ?? {})) {
      for (const binding of bindings ?? [])
        args.push("--publish", `127.0.0.1:${replace(binding.HostPort)}:${port}`);
    }
    if (c.Config.User) args.push("--user", c.Config.User);
    if (c.Config.WorkingDir) args.push("--workdir", c.Config.WorkingDir);
    if (c.Config.Entrypoint) {
      assert.equal(c.Config.Entrypoint.length, 1);
      args.push("--entrypoint", c.Config.Entrypoint[0]);
    }
    args.push(
      ...envKeys.flatMap((key) => ["--env", key]),
      c.Config.Image,
      ...(c.Config.Cmd ?? []).map(replace),
    );
    execFileSync(dockerBin, args, {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    if (service === "kong") {
      const config = c.Config.Env.find((entry) => entry.startsWith("KONG_DECLARATIVE_CONFIG="))
        .split("=")
        .slice(1)
        .join("=");
      assert.ok(config.startsWith("/home/kong/"));
      // The old container is stopped; docker cp reads files without starting services.
      const archive = docker(
        ["cp", `supabase_${service}_${source}:${config}`, "-"],
        undefined,
        true,
      );
      const converted = Buffer.from(replace(archive.toString("latin1")), "latin1");
      assert.equal(converted.length, archive.length);
      // This fixed-width replacement touches file payload, not TAR names/size fields.
      assert.ok(!archive.subarray(0, 512).includes(Buffer.from(source)));
      docker(["cp", "-", `supabase_${service}_${target}:/home/kong/`], converted);
      for (const certName of ["localhost.crt", "localhost.key"]) {
        const cert = docker(
          ["cp", `supabase_kong_${source}:/home/kong/${certName}`, "-"],
          undefined,
          true,
        );
        docker(["cp", "-", `supabase_kong_${target}:/home/kong/`], cert);
      }
    }
  }
  docker(["start", `supabase_db_${target}`, `supabase_inbucket_${target}`]);
  console.log(JSON.stringify({ prepared: target, volumes: "fresh", oldDrillPreserved: true }));
} catch {
  console.error("Safe fresh drill preparation failed; existing database volumes were not changed.");
  process.exitCode = 1;
}
