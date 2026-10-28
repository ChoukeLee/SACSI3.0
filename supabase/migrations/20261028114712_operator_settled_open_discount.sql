begin;

-- An open stay is eligible only after checkout has finalized its actual dates.
-- This extension adjusts discounts only: it cannot change historical occupancy.
create function public.booking_open_checkout_discount_protocol_version() returns integer
language sql security invoker set search_path='' as $$ select 1; $$;
revoke all on function public.booking_open_checkout_discount_protocol_version() from public,anon,authenticated,service_role;
grant execute on function public.booking_open_checkout_discount_protocol_version() to authenticated;

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.preview_checkout_correction(jsonb)'::regprocedure);
  anchor:='b.checkout_mode is distinct from ''fixed''';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
  then raise exception 'checkoutCorrectionMigrationDrift'; end if;
  definition:=replace(definition,anchor,'(b.checkout_mode is distinct from ''fixed'' and b.checkout_mode is distinct from ''open'')');
  anchor:='  discount:=(q->>''discountAmountXof'')::numeric;';
  if strpos(definition,anchor)=0 then raise exception 'checkoutCorrectionMigrationDrift'; end if;
  definition:=replace(definition,anchor,$patch$
  if b.checkout_mode='open' then
    if public.booking_open_checkout_discount_protocol_version()<>1
      or b.check_out is distinct from b.actual_check_out or co is distinct from b.actual_check_out
    then raise exception 'operationAssistanceRequired'; end if;
    if b.total_amount_xof is distinct from (b.actual_check_out-b.check_in)*b.nightly_price_xof
    then raise exception 'operationFinanceMismatch'; end if;
  end if;
  discount:=(q->>'discountAmountXof')::numeric;$patch$);
  definition:=replace(definition,'-- Only shorten an already recorded fixed stay. No new occupancy is introduced.',
    '-- Fixed stays may be shortened; settled open stays allow discounts without changing actual dates.');
  execute definition;
end; $$;

commit;
