begin;

-- Internal sale offsets remain in the ledger and settlement history.
-- Exclude them from cash income without changing the stored direction or other categories.
do $migration$
declare
  definition text;
  patch record;
  old_trend text := $$filter (where l.direction = 'income')$$;
  new_trend text := $$filter (where l.direction = 'income'
        and l.category is distinct from 'sale_internal_offset')$$;
begin
  definition := replace(
    pg_get_functiondef('public.finance_read_rpc(text,jsonb,integer,boolean)'::regprocedure),
    chr(13)||chr(10), chr(10)
  );

  for patch in
    select * from (values
      (
        $$and (nullif(p_filters->>'direction','') is null or s.doc->>'direction'=p_filters->>'direction')$$,
        $$and (nullif(p_filters->>'direction','') is null or s.doc->>'direction'=p_filters->>'direction')
    and (p_filters->>'direction' is distinct from 'income'
      or s.doc->>'category' is distinct from 'sale_internal_offset')$$
      ),
      (
        $$sum((doc->>'amount_native')::numeric) filter(where doc->>'direction'='income')$$,
        $$sum((doc->>'amount_native')::numeric) filter(where doc->>'direction'='income'
        and doc->>'category' is distinct from 'sale_internal_offset')$$
      ),
      (
        $$sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='income')$$,
        $$sum((doc->>'amount_xof')::numeric) filter(where doc->>'direction'='income'
        and doc->>'category' is distinct from 'sale_internal_offset')$$
      )
    ) as edits(old_text, new_text)
  loop
    if cardinality(string_to_array(definition, patch.old_text)) is distinct from 2 then
      raise exception 'Unexpected finance_read_rpc definition for sale internal offset reporting';
    end if;
    definition := replace(definition, patch.old_text, patch.new_text);
  end loop;
  execute definition;

  definition := replace(
    pg_get_functiondef('public.reports_trend_rpc(uuid,date)'::regprocedure),
    chr(13)||chr(10), chr(10)
  );
  if cardinality(string_to_array(definition, old_trend)) is distinct from 2 then
    raise exception 'Unexpected reports_trend_rpc definition for sale internal offset reporting';
  end if;
  execute replace(definition, old_trend, new_trend);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
