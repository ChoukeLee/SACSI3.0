begin;

-- Preserve both sides of an internal settlement and voided duplicate receipts
-- as evidence without adding their original amounts to cash reports.
do $migration$
declare
  definition text;
  patch record;
  target regprocedure;
begin
  for target in select unnest(array[
    'public.finance_read_rpc(text,jsonb,integer,boolean)'::regprocedure,
    'public.reports_trend_rpc(uuid,date)'::regprocedure,
    'public.contract_workspace_read_rpc(text,jsonb,text,uuid)'::regprocedure,
    'public.management_operating_snapshot_rpc(uuid)'::regprocedure
  ])
  loop
    definition:=replace(pg_get_functiondef(target),chr(13)||chr(10),chr(10));
    for patch in select * from (values
      (
        'public.finance_read_rpc(text,jsonb,integer,boolean)'::regprocedure,
        1,
        $$and (p_filters->>'direction' is distinct from 'income'
      or s.doc->>'category' is distinct from 'sale_internal_offset')$$,
        $$and (p_filters->>'direction' is distinct from 'income'
      or coalesce(s.doc->>'category','') not in ('sale_internal_offset','lease_duplicate_void'))
    and (p_filters->>'direction' is distinct from 'expense'
      or s.doc->>'category' is distinct from 'lease_internal_offset')$$
      ),
      (
        'public.finance_read_rpc(text,jsonb,integer,boolean)'::regprocedure,
        2,
        $$filter(where doc->>'direction'='income'
        and doc->>'category' is distinct from 'sale_internal_offset')$$,
        $$filter(where doc->>'direction'='income'
        and coalesce(doc->>'category','') not in ('sale_internal_offset','lease_duplicate_void'))$$
      ),
      (
        'public.finance_read_rpc(text,jsonb,integer,boolean)'::regprocedure,
        2,
        $$filter(where doc->>'direction'='expense')$$,
        $$filter(where doc->>'direction'='expense'
        and doc->>'category' is distinct from 'lease_internal_offset')$$
      ),
      (
        'public.reports_trend_rpc(uuid,date)'::regprocedure,
        1,
        $$filter (where l.direction = 'income'
        and l.category is distinct from 'sale_internal_offset')$$,
        $$filter (where l.direction = 'income'
        and coalesce(l.category,'') not in ('sale_internal_offset','lease_duplicate_void'))$$
      ),
      (
        'public.reports_trend_rpc(uuid,date)'::regprocedure,
        1,
        $$filter (where l.direction = 'expense')$$,
        $$filter (where l.direction = 'expense'
        and l.category is distinct from 'lease_internal_offset')$$
      ),
      (
        'public.contract_workspace_read_rpc(text,jsonb,text,uuid)'::regprocedure,
        1,
        $$'lease_rent_refund','lease_other_income','lease_other_expense'] else array['sale'$$,
        $$'lease_rent_refund','lease_other_income','lease_other_expense','lease_duplicate_void'] else array['sale'$$
      ),
      (
        'public.management_operating_snapshot_rpc(uuid)'::regprocedure,
        1,
        $$or p.native_settlement or p.source_type in ('lease_deposit','lease_deposit_refund','lease_deposit_deduction','daily_credit','daily_payment_pending')$$,
        $$or p.native_settlement or p.source_type in ('lease_deposit','lease_deposit_refund','lease_deposit_deduction','daily_credit','daily_payment_pending','lease_duplicate_void')$$
      )
    ) edits(signature,expected_count,old_text,new_text) where edits.signature=target
    loop
      if cardinality(string_to_array(definition,patch.old_text)) is distinct from patch.expected_count+1 then
        raise exception 'Unexpected % definition for lease noncash reporting',target;
      end if;
      definition:=replace(definition,patch.old_text,patch.new_text);
    end loop;
    execute definition;
  end loop;
end;
$migration$;

notify pgrst,'reload schema';
commit;
