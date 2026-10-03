begin;

-- Ownership (units.status = sold) and daily operating capability are independent.
-- This helper is only used by the existing authorized SECURITY DEFINER entrypoints.
create or replace function private.daily_rental_enabled(p_unit_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.unit_business_flags
    where unit_id=p_unit_id and business_type='daily_rental' and is_enabled);
$$;
revoke all on function private.daily_rental_enabled(uuid) from public, anon, authenticated;

-- Patch only the known business guards, retaining each deployed function's
-- authorization, idempotency, locks, audit and finance logic. Fail on schema drift.
do $migration$
declare item record; definition text;
begin
  for item in select * from (values
    ('public.daily_create_booking_rpc(uuid,uuid,date,date,text,numeric,text,text,uuid,jsonb)',
     'if v_unit.status = ''sold'' then',
     'if v_unit.status = ''sold'' and not private.daily_rental_enabled(p_unit_id) then'),
    ('public.daily_create_booking_core_rpc(uuid,uuid,date,date,text,numeric,text,text,uuid,jsonb)',
     'if v_unit.status = ''sold'' then',
     'if v_unit.status = ''sold'' and not private.daily_rental_enabled(p_unit_id) then'),
    ('public.daily_create_booking_rpc(uuid,uuid,date,date,text,numeric,text,text,uuid,jsonb)',
     'and s.status = ''active''',
     'and s.status = ''active'' and not private.daily_rental_enabled(p_unit_id)'),
    ('public.daily_create_booking_core_rpc(uuid,uuid,date,date,text,numeric,text,text,uuid,jsonb)',
     'and s.status = ''active''',
     'and s.status = ''active'' and not private.daily_rental_enabled(p_unit_id)'),
    ('public.daily_check_in_booking_rpc(uuid,numeric,uuid,jsonb)',
     'if v_unit.status in (''maintenance'', ''locked'', ''sold'', ''leased'') then',
     'if v_unit.status in (''maintenance'', ''locked'', ''leased'') or not private.daily_rental_enabled(v_unit.id) or exists(select 1 from public.lease_contracts where unit_id=v_unit.id and status=''active'') then'),
    ('public.daily_check_in_booking_rpc(uuid,numeric,uuid,jsonb)',
     'set status = ''daily_occupied'', updated_at = now()',
     'set status = case when status = ''sold'' then ''sold''::public.unit_status else ''daily_occupied''::public.unit_status end, updated_at = now()'),
    ('public.daily_check_out_booking_rpc(uuid,date,numeric,numeric,text,public.unit_status,jsonb)',
     'set status = ''cleaning_pending'', updated_at = now()',
     'set status = case when status = ''sold'' then ''sold''::public.unit_status else ''cleaning_pending''::public.unit_status end, updated_at = now()'),
    ('public.daily_resolve_unit_status(uuid,uuid)',
     'if v_current in (''maintenance'', ''locked'') then',
     'if v_current in (''maintenance'', ''locked'', ''sold'') then'),
    ('private.preview_daily_workflow(jsonb)',
     'if u.status in (''maintenance'',''locked'',''leased'',''sold'')',
     'if u.status in (''maintenance'',''locked'',''leased'') or (u.status=''sold'' and not private.daily_rental_enabled(u.id))'),
    ('private.preview_booking_operation(jsonb)',
     'if target.status in (''locked'',''maintenance'',''sold'',''leased'')',
     'if target.status in (''locked'',''maintenance'',''leased'')'),
    ('private.preview_booking_operation(jsonb)',
     'or exists(select 1 from public.sale_contracts where unit_id=target.id and status=''active'')',
     'or (not private.daily_rental_enabled(target.id) and exists(select 1 from public.sale_contracts where unit_id=target.id and status=''active''))')
  ) as changes(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(item.signature::regprocedure);
    if strpos(definition,item.old_text)=0 then
      raise exception 'Sold daily rental migration precondition failed: %', item.signature;
    end if;
    execute replace(definition,item.old_text,item.new_text);
  end loop;
end;
$migration$;

commit;
