import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { applicationSchemaSql } from "./application-schema.mjs";

const base = new URL("../../supabase/", import.meta.url);
export function applicationRebuildPlan(read = (path) => readFileSync(new URL(path, base), "utf8")) {
  const manifest = JSON.parse(read("baselines/rebuild-manifest.json"));
  assert.equal(manifest.formatVersion, 1);
  const verified = (folder, item) => {
    assert.match(item.file, /^[a-zA-Z0-9_.-]+$/);
    const sql = read(`${folder}/${item.file}`).replaceAll("\r\n", "\n");
    assert.equal(
      createHash("sha256").update(sql).digest("hex"),
      item.sha256,
      `Rebuild source changed: ${item.file}`,
    );
    return sql;
  };
  const snapshot = JSON.parse(verified("baselines", manifest.baseline));
  const catalog = verified("migrations", manifest.catalog);
  const start = catalog.indexOf("insert into private.operator_action_catalog (");
  const end = catalog.indexOf(
    "create or replace function private.current_operator_action_allowed(",
  );
  assert.ok(start >= 0 && end > start);
  const steps = [
    { name: manifest.baseline.file, sql: `begin;\n${applicationSchemaSql(snapshot)}\ncommit;` },
    { name: "static_operator_action_catalog", sql: catalog.slice(start, end) },
    ...manifest.overlays.map((item) => ({ name: item.file, sql: verified("migrations", item) })),
  ];
  assert.equal(new Set(steps.map((step) => step.name)).size, steps.length);
  return { manifest, steps };
}
