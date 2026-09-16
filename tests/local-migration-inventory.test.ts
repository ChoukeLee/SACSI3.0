import { describe, expect, it } from 'vitest';
// @ts-expect-error Development-only JavaScript inventory module.
import { inspectMigrationFiles } from '../scripts/lib/local-migration-inventory.mjs';

describe('local migration inventory safety', () => {
  it('finds version collisions even when descriptions differ', () => {
    const report = inspectMigrationFiles([
      { name: '202608010001_a.sql', sql: 'select 1;' },
      { name: '202608010001_b.sql', sql: 'select 2;' },
    ]);
    expect(report.duplicateVersions).toEqual([{ version: '202608010001', names: ['202608010001_a.sql', '202608010001_b.sql'] }]);
  });
  it('never grants execution approval to schema-only text', () => {
    const entry = inspectMigrationFiles([{ name: '202601010001_schema.sql', sql: 'create table x (id int);' }]).entries[0];
    expect(entry.risks).toEqual([]);
    expect(entry.executionAuthorized).toBe(false);
    expect(entry.review).toBe('required');
  });
  it('flags mixed data/procedure files without silently stripping statements', () => {
    const sql = "create table x (id int); DO $$ BEGIN INSERT INTO x VALUES (1); END $$;";
    const entry = inspectMigrationFiles([{ name: '202601010001_schema.sql', sql }]).entries[0];
    expect(entry.risks).toContain('data_write_text');
    expect(entry.risks).toContain('procedural_block');
  });
  it('conservatively flags deferred function writes too', () => {
    const entry = inspectMigrationFiles([{ name: '202601010001_rpc.sql', sql: 'create function f() returns void as $$ delete from public.x; $$ language sql;' }]).entries[0];
    expect(entry.risks).toContain('data_write_text');
    expect(entry.executionAuthorized).toBe(false);
  });
  it('rejects malformed migration names', () => {
    expect(inspectMigrationFiles([{ name: 'seed.sql', sql: '' }]).entries[0].risks).toContain('invalid_filename');
  });
  it('fingerprints the exact SQL content and never exposes it in the report', () => {
    const a = inspectMigrationFiles([{ name: '202601010001_a.sql', sql: 'select 1;' }]);
    const b = inspectMigrationFiles([{ name: '202601010001_a.sql', sql: 'select 2;' }]);
    expect(a.entries[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a.entries[0].sha256).not.toBe(b.entries[0].sha256);
    expect(JSON.stringify(a)).not.toContain('select 1;');
  });
});
