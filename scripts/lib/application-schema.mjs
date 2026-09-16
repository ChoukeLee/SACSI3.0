import assert from 'node:assert/strict';
const q = value => '"' + String(value).replaceAll('"','""') + '"';
const literal = value => "'" + String(value).replaceAll("'","''") + "'";
const name = item => `${q(item.schema)}.${q(item.name)}`;

/** Catalog snapshot only; no table rows, sequence values or account data. */
export function applicationSchemaSql(snapshot) {
  const sql = ["set local check_function_bodies = off;", "set local search_path = public, extensions;"];
  assert.ok(snapshot.tables.length > 0);
  for (const table of snapshot.tables) {
    assert.equal(table.kind, 'r', 'Partitioned tables require a reviewed exporter');
    assert.equal(table.owner, 'postgres', 'Unexpected table owner');
    for (const c of table.columns) assert.equal(c.generated, '', 'Generated columns require a reviewed exporter');
  }
  for (const type of snapshot.enums) sql.push(`create type ${name(type)} as enum (${type.labels.map(literal).join(',')});`);
  // Identity columns create their own sequences. All current sequences are identity-backed.
  assert.ok(snapshot.sequences.every(s => !s.ownedBy), 'Serial sequence support requires review');
  for (const table of snapshot.tables) {
    sql.push(`create table ${name(table)} (${table.columns.map(c => `${q(c.name)} ${c.type}${c.identity ? ` generated ${c.identity === 'a' ? 'always' : 'by default'} as identity` : ''}${c.notNull ? ' not null' : ''}`).join(',\n')});`);
  }
  for (const seq of snapshot.sequences) sql.push(`alter sequence ${name(seq)} as ${seq.type} increment by ${seq.increment} minvalue ${seq.min} maxvalue ${seq.max} start with ${seq.start} cache ${seq.cache} ${seq.cycle ? '' : 'no '}cycle;`);
  for (const fn of snapshot.functions) {
    assert.equal(fn.owner, 'postgres', 'Unexpected function owner');
    sql.push(fn.sql + ';');
  }
  for (const table of snapshot.tables) for (const c of table.columns) if (c.default !== null) sql.push(`alter table ${name(table)} alter column ${q(c.name)} set default ${c.default};`);
  for (const v of snapshot.views ?? []) sql.push(`create view ${name(v)}${v.options?.length ? ` with (${v.options.join(',')})` : ''} as ${v.definition}`);
  for (const c of snapshot.constraints) sql.push(`alter table ${c.table} add constraint ${q(c.name)} ${c.definition};`);
  for (const i of snapshot.indexes ?? []) sql.push(i + ';');
  for (const t of snapshot.triggers ?? []) sql.push(t + ';');
  for (const p of snapshot.policies) {
    sql.push(`create policy ${q(p.policyname)} on ${q(p.schemaname)}.${q(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(r => r === 'public' ? 'public' : q(r)).join(',')}${p.qual ? ` using (${p.qual})` : ''}${p.with_check ? ` with check (${p.with_check})` : ''};`);
  }
  for (const t of snapshot.tables) {
    if (t.rls) sql.push(`alter table ${name(t)} enable row level security;`);
    if (t.forceRls) sql.push(`alter table ${name(t)} force row level security;`);
  }
  // Remove implicit privileges before applying the actual exported ACLs.
  for (const schema of ['public','private']) {
    for (const object of ['tables','sequences','functions']) sql.push(`revoke all on all ${object} in schema ${q(schema)} from public, anon, authenticated, service_role;`);
    sql.push(`revoke all on schema ${q(schema)} from public, anon, authenticated, service_role;`);
  }
  for (const g of snapshot.grants) {
    assert.ok(['table','sequence','function','schema'].includes(g.kind));
    assert.ok(['postgres','authenticated','service_role','anon','PUBLIC','pg_database_owner'].includes(g.grantee));
    sql.push(`grant ${g.privilege} on ${g.kind} ${g.object} to ${g.grantee === 'PUBLIC' ? 'public' : q(g.grantee)}${g.grantable ? ' with grant option' : ''};`);
  }
  return sql.join('\n');
}
