import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// @ts-expect-error Development-only catalog compiler.
import { applicationSchemaSql } from '../scripts/lib/application-schema.mjs';
const raw=readFileSync('supabase/baselines/20260916.application-schema.json','utf8').replaceAll('\r\n','\n');
const snapshot=JSON.parse(raw);
it('pins the reviewed data-free application baseline',()=>{
  expect(createHash('sha256').update(raw).digest('hex')).toBe('6816fa8930d606dcd9c4ac66f5370967ad5a5da60b716165594768627c795dff');
  expect(snapshot.tables).toHaveLength(32);expect(snapshot.functions).toHaveLength(67);expect(snapshot.policies).toHaveLength(102);
  expect(snapshot.tables.filter((t: {schema:string})=>t.schema==='public').every((t: {rls:boolean})=>t.rls)).toBe(true);
});
it('preserves 64-bit sequence bounds without JS number rounding',()=>{
  const sql=applicationSchemaSql(snapshot);
  expect(sql).toContain('maxvalue 9223372036854775807');
  expect(sql).not.toContain('9223372036854776000');
  expect(sql).toContain('create table "public"."property_fee_rules"');
  expect(sql).toContain('revoke all on all functions in schema "private" from public, anon, authenticated, service_role;');
});
it('rejects unsupported structures instead of silently omitting them',()=>{
  const changed=structuredClone(snapshot);changed.tables[0].kind='p';
  expect(()=>applicationSchemaSql(changed)).toThrow('Partitioned tables');
});
it('keeps the full-baseline property fee policy migration scoped to roles and unit access',()=>{
  const sql=readFileSync('supabase/migrations/20260916173232_restrict_property_fee_rule_access.sql','utf8');
  expect(sql).toContain("public.has_app_role('admin','finance') and public.can_access_unit(unit_id)");
  expect(sql).toContain('drop policy "Authenticated can write property fee rules"');
  expect(sql).not.toMatch(/using\s*\(true\)|with check\s*\(true\)/i);
  expect(sql).not.toMatch(/insert into|delete from|update public/i);
});
