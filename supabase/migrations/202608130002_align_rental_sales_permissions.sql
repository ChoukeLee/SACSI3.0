-- Align the Ying account and the database RPC boundary with the application
-- rental-sales role. Rental-sales operators may maintain booking and contract
-- structure, while finance writes and destructive termination remain separate.

update public.user_profiles
set role = 'rental_sales'::public.user_role,
    display_name = 'Ying',
    updated_at = now()
where id = (
  select id from auth.users where lower(email) = 'ying@sacsi.com' limit 1
);

do $migration$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(
    'public.daily_create_booking_rpc(uuid,uuid,date,date,text,numeric,text,text,uuid,jsonb)'::regprocedure
  ) into v_definition;

  if position('dailyCreatePermissionDenied' in v_definition) = 0 then
    v_patched := replace(
      v_definition,
      E'begin\n  if p_request_id is null then',
      E'begin\n  if not public.has_app_role(''admin'', ''rental_sales'') then\n    raise exception ''dailyCreatePermissionDenied'' using errcode = ''42501'';\n  end if;\n  if p_request_id is null then'
    );
    if v_patched = v_definition then
      raise exception 'Unable to patch daily_create_booking_rpc permission guard';
    end if;
    execute v_patched;
  end if;

  select pg_get_functiondef(
    'public.create_sale_contract_rpc(uuid,uuid,text,date,numeric,text,integer,date,text,text,numeric,boolean,uuid)'::regprocedure
  ) into v_definition;

  v_patched := replace(
    v_definition,
    'public.has_app_role(''admin'')',
    'public.has_app_role(''admin'', ''rental_sales'')'
  );
  if v_patched = v_definition then
    raise exception 'Unable to patch create_sale_contract_rpc permission guard';
  end if;
  execute v_patched;
end
$migration$;

comment on function public.daily_create_booking_rpc(uuid, uuid, date, date, text, numeric, text, text, uuid, jsonb)
is 'Creates daily bookings atomically for admin and rental-sales operators.';

comment on function public.create_sale_contract_rpc(uuid, uuid, text, date, numeric, text, integer, date, text, text, numeric, boolean, uuid)
is 'Creates sale contracts atomically for admin and rental-sales operators.';
