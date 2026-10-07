import assert from "node:assert/strict";
import { project, sql } from "./lib/dr-local-runtime.mjs";
try {
  assert.equal(project, "sacsi-dr-20261006");
  const output = sql(`BEGIN READ ONLY;
    SELECT coalesce(jsonb_agg(to_jsonb(report)),'[]') FROM (
      SELECT case when c.payment_plan_type in ('lump_sum','installment','flexible_installment','flexible') then c.payment_plan_type else 'legacy_unstructured' end plan_type,c.status contract_status,s.status schedule_status,
        count(*) schedules,
        count(*) filter(where exists(select 1 from public.receivables r where r.source_type='sale_contract' and r.source_id=c.id and r.due_date=s.due_date and r.amount_xof=s.amount_xof and r.status<>'cancelled')) matching_date_amount,
        count(*) filter(where exists(select 1 from public.receivables r where r.source_type='sale_contract' and r.source_id=c.id and r.unit_id=c.unit_id and (case when c.payment_plan_type='lump_sum' then r.category='sale_lump_sum' when c.payment_plan_type in ('fixed_installment','flexible_installment') then r.category='sale_installment' else r.category in ('sale_lump_sum','sale_installment') end) and r.due_date=s.due_date and r.amount_xof=s.amount_xof and r.status<>'cancelled')) matching_category_date_amount
      FROM public.sale_payment_schedule s JOIN public.sale_contracts c ON c.id=s.sale_contract_id WHERE s.status<>'cancelled'
      GROUP BY 1,c.status,s.status ORDER BY 1,c.status,s.status
    ) report;
    SELECT coalesce(jsonb_agg(to_jsonb(report)),'[]') FROM (
      SELECT category,source_type,count(*) rows FROM public.receivables WHERE source_type in ('sale','sale_contract') GROUP BY category,source_type ORDER BY category,source_type
    ) report;
    ROLLBACK;`);
  console.log(output);
} catch {
  console.error("Safe local sale link inspection failed");
  process.exitCode = 1;
}
