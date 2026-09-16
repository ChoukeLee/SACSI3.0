import { createHash } from 'node:crypto';

// This is a conservative inventory, NOT a SQL parser or an execution allow-list.
// Matches inside functions/comments are intentional: no file becomes safe to run
// merely because an automated scanner thinks its writes are deferred.
export function inspectMigrationFiles(files) {
  const versions = new Map();
  const entries = files.map(({ name, sql }) => {
    const match = /^(\d+)_(.+)\.sql$/.exec(name);
    const version = match?.[1] ?? null;
    if (version) versions.set(version, [...(versions.get(version) ?? []), name]);
    const risks = [];
    if (!version) risks.push('invalid_filename');
    if (/\b(insert\s+into|update\s+(?:public\.|auth\.|storage\.)|delete\s+from|merge\s+into|copy\s+)\b/i.test(sql)) risks.push('data_write_text');
    if (/\bdo\s+(?:\$|')/i.test(sql)) risks.push('procedural_block');
    if (/\bexecute\b/i.test(sql)) risks.push('execute_text');
    if (/\b(seed|import|backfill|consolidate|reconcile|promote|configure|reconfigure|fix|correct|delete|remove|rename|normalize|finalize)\b/i.test(name.replaceAll('_', ' '))) risks.push('business_or_repair_filename');
    if (/\b(?:https?:\/\/|dblink|http_post|net\.http|foreign\s+server)/i.test(sql)) risks.push('external_reference_text');
    return { name, version, sha256: createHash('sha256').update(sql).digest('hex'), risks,
      review: 'required', executionAuthorized: false };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const duplicateVersions = [...versions].filter(([, names]) => names.length > 1)
    .map(([version, names]) => ({ version, names: names.sort() }));
  return { formatVersion: 1, purpose: 'read-only inventory; never an execution allow-list',
    files: entries.length, duplicateVersions, entries };
}
