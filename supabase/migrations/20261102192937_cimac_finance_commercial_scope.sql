begin;

-- B17 apartment numbers overlap existing shop numbers. Restrict documentary
-- unit-number resolution to commercial shops in BOTH preview and execution.
-- The full-project snapshot, locks, authorization and old migrations remain
-- unchanged. Preserve existing function ownership, ACL, mode and settings.
do $commercial_scope$
declare
  signature regprocedure; definition text; anchor text; replacement text;
  expected integer; occurrences integer;
begin
  foreach signature in array array[
    'private.cimac_finance_validate_scope(jsonb)'::regprocedure,
    'private.execute_cimac_finance(jsonb,jsonb,timestamp with time zone,text)'::regprocedure
  ] loop
    definition:=replace(pg_get_functiondef(signature),chr(13)||chr(10),chr(10));
    if signature='private.cimac_finance_validate_scope(jsonb)'::regprocedure then
      anchor:='where p.code=''CIMAC'' and u.unit_no=part->>''unitNo''';
      replacement:=anchor||' and u.kind=''storefront'' and u.asset_subtype=''commercial_shop''';
      occurrences:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
      if occurrences<>1 then raise exception 'cimacFinanceCommercialScopeDefinitionDrift'; end if;
      definition:=replace(definition,anchor,replacement);
      expected:=3;
    else
      expected:=2;
    end if;
    anchor:='where p.code=''CIMAC'' and us.unit_no=part->>''unitNo''';
    replacement:=anchor||' and us.kind=''storefront'' and us.asset_subtype=''commercial_shop''';
    occurrences:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
    if occurrences<>expected then raise exception 'cimacFinanceCommercialScopeDefinitionDrift'; end if;
    definition:=replace(definition,anchor,replacement);
    execute definition;
  end loop;
end; $commercial_scope$;

notify pgrst,'reload schema';
commit;
