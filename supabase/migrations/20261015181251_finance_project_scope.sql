begin;
-- Apply project scope to detail, totals and export together. No data changes.
do $migration$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.finance_read_rpc(text,jsonb,integer,boolean)'::regprocedure);
  anchor := 'if nullif(p_filters->>''dateFrom'','''')::date>';
  if strpos(definition,anchor)=0 then raise exception 'financeProjectFilterMigrationDrift'; end if;
  definition := replace(definition,anchor,
    'if nullif(p_filters->>''projectId'','''') is not null and not coalesce(public.can_access_project((p_filters->>''projectId'')::uuid),false) then raise exception ''financePermissionDenied'' using errcode=''42501''; end if; '||anchor);
  anchor := 'where (nullif(p_filters->>''dateFrom'','''') is null';
  if strpos(definition,anchor)=0 then raise exception 'financeProjectFilterMigrationDrift'; end if;
  definition := replace(definition,anchor,
    'where (nullif(p_filters->>''projectId'','''') is null or b.project_id=(p_filters->>''projectId'')::uuid) and (nullif(p_filters->>''dateFrom'','''') is null');
  execute definition;
  definition := pg_get_functiondef('public.finance_read_rpc(text,jsonb,integer,boolean)'::regprocedure);
  anchor := 'and (nullif(p_filters->>''status'','''') is null';
  if strpos(definition,anchor)=0 then raise exception 'financeOutstandingFilterMigrationDrift'; end if;
  definition := replace(definition,anchor,
    'and (p_kind<>''receivables'' or coalesce(p_filters->>''outstandingOnly'',''false'')<>''true'' or (s.doc->>''status''<>''cancelled'' and (s.doc->>''amount_xof'')::numeric>(s.doc->>''paid_amount_xof'')::numeric)) '||anchor);
  execute definition;
end; $migration$;
notify pgrst,'reload schema';
commit;
