// Business records stay inside the local clone. Print only unit labels and match counts.
import assert from "node:assert/strict";
import { project, sql } from "./lib/dr-local-runtime.mjs";
try {
  assert.equal(project, "sacsi-dr-20261006");
  const output = sql(`BEGIN READ ONLY;
    WITH candidates AS (
      SELECT s.id schedule_id,r.id receivable_id,
        count(*) over(partition by s.id) schedule_matches,
        count(*) over(partition by r.id) receivable_matches
      FROM public.sale_payment_schedule s JOIN public.sale_contracts c ON c.id=s.sale_contract_id
      JOIN public.receivables r ON r.source_type='sale_contract' AND r.source_id=c.id
        AND r.unit_id=c.unit_id
        AND case when c.payment_plan_type='lump_sum' then r.category='sale_lump_sum'
          when c.payment_plan_type in ('fixed_installment','flexible_installment') then r.category='sale_installment'
          else r.category in ('sale_lump_sum','sale_installment') end
        AND r.due_date=s.due_date AND r.amount_xof=s.amount_xof AND r.status<>'cancelled' AND s.status<>'cancelled'
    ) SELECT coalesce(jsonb_agg(to_jsonb(report)),'[]') FROM (
      SELECT u.code unit_code,s.installment_no,s.status schedule_status,
        (SELECT count(*) FROM public.receivables r WHERE r.source_type='sale_contract' AND r.source_id=c.id AND r.due_date=s.due_date AND r.amount_xof=s.amount_xof AND r.status<>'cancelled') exact_date_amount_candidates,
        (SELECT count(*) FROM public.receivables r WHERE r.source_type='sale_contract' AND r.source_id=c.id AND r.status<>'cancelled') contract_receivable_count
      FROM public.sale_payment_schedule s JOIN public.sale_contracts c ON c.id=s.sale_contract_id JOIN public.units u ON u.id=c.unit_id
      WHERE c.status='active' AND s.status not in ('paid','cancelled') AND NOT EXISTS (
        SELECT 1 FROM candidates x WHERE x.schedule_id=s.id AND x.schedule_matches=1 AND x.receivable_matches=1
      ) ORDER BY u.code,s.installment_no
    ) report;
    ROLLBACK;`);
  console.log(output);
} catch {
  console.error("Safe read-only unpaid sale review failed");
  process.exitCode = 1;
}
