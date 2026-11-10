begin;

-- Opt in verified SACSI7 monthly leases through the existing source marker.
-- Keep SACSI11, all other eligibility rules, and caller permissions unchanged.
do $migration$
declare
  definition text;
  old_scope text := $$b.code='SACSI11' and p.code='SACSI'$$;
  new_scope text := $$b.code in ('SACSI11','SACSI7') and p.code='SACSI'$$;
begin
  definition:=pg_get_functiondef(
    'private.sacsi11_monthly_rent_basis(public.lease_contracts,date)'::regprocedure
  );
  if cardinality(string_to_array(definition,old_scope)) is distinct from 2 then
    raise exception 'Unexpected verified monthly lease schedule scope';
  end if;
  execute replace(definition,old_scope,new_scope);
end;
$migration$;

commit;
