import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localSql, root, safeFailure } from './lib/local-supabase-runtime.mjs';
try {
  const baseline=JSON.parse(readFileSync(join(root,'supabase/baselines/20260916.application-schema.json'),'utf8'));
  const actual=JSON.parse(localSql(readFileSync(join(root,'scripts/sql/export-application-schema.sql'),'utf8')));
  const equal=(a,b,message)=>assert.deepEqual(JSON.parse(JSON.stringify(a).replaceAll('\\r\\n','\\n')),JSON.parse(JSON.stringify(b).replaceAll('\\r\\n','\\n')),message);
  const key=t=>`${t.schema}.${t.name}`;
  const changed=new Set(['private.current_operator_action_allowed','private.verify_operator_daily_payment','public.daily_record_payment_rpc','public.update_receivables_updated_at']);
  for(const table of baseline.tables){
    const current=actual.tables.find(t=>key(t)===key(table)); assert.ok(current,`Missing ${key(table)}`);
    const {acl:ignore,...expected}=table; const {acl:alsoIgnore,...received}=current;
    equal(received,expected,`Table drift: ${key(table)}`);
  }
  equal(actual.enums,baseline.enums,'Enum drift');
  equal(actual.sequences,baseline.sequences,'Sequence definition drift');
  equal(actual.views,baseline.views,'View drift');
  equal(actual.policies.filter(p=>p.tablename!=='property_fee_rules'),baseline.policies.filter(p=>p.tablename!=='property_fee_rules'),'Policy drift');
  assert.equal(actual.policies.filter(p=>p.tablename==='property_fee_rules').length,4,'Property fee policy overlay missing');
  assert.ok(actual.policies.filter(p=>p.tablename==='property_fee_rules').every(p=>(p.qual ?? p.with_check).includes('can_access_unit')));
  equal(actual.triggers,baseline.triggers,'Trigger drift');
  for(const c of baseline.constraints) equal(actual.constraints.find(x=>x.table===c.table && x.name===c.name),c,`Constraint drift ${c.name}`);
  for(const index of baseline.indexes) assert.ok(actual.indexes.includes(index),'Index drift');
  for(const fn of baseline.functions){
    const current=actual.functions.find(f=>f.identity===fn.identity); assert.ok(current,`Missing ${fn.identity}`);
    if(!changed.has(key(fn))) equal(current.sql,fn.sql,`Function drift ${fn.identity}`);
  }
  // The local hardening only narrows grants; all other baseline ACLs must match exactly.
  const baselineObjects=new Set(baseline.grants.map(g=>g.kind+'|'+g.object));
  const normalized=items=>items.map(g=>JSON.stringify(g)).sort();
  equal(normalized(actual.grants.filter(g=>baselineObjects.has(g.kind+'|'+g.object))),normalized(baseline.grants),'Existing object privilege drift');
  const report={status:'passed',scope:'public/private application schema, with four explicitly changed baseline functions, property fee policy hardening and new local operator objects',
    baselineTables:baseline.tables.length,localTables:actual.tables.length,baselineFunctions:baseline.functions.length,localFunctions:actual.functions.length,
    policies:actual.policies.length,changedFunctions:[...changed],productionRowsCopied:0,verifiedAt:new Date().toISOString()};
  writeFileSync(join(root,'work/full-schema-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} catch(error) { safeFailure(error); }
