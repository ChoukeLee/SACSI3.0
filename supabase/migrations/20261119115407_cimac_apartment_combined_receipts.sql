begin;

-- Schema v2 adds an explicitly paid annual property component and atomically
-- replaces exact prior unpaid holds. Existing v1 receipts and permissions remain.
alter table public.cimac_apartment_paid_reservations
  add column property_fee_amount_xof numeric(14,2),
  add column property_period_start date,
  add column property_period_end date,
  add column property_payment_id uuid unique references public.payments(id),
  add constraint cimac_apartment_paid_property_shape check(
    (property_fee_amount_xof is null and property_period_start is null and property_period_end is null and property_payment_id is null)
    or (property_fee_amount_xof is not null and property_fee_amount_xof>0 and property_fee_amount_xof=trunc(property_fee_amount_xof)
      and property_period_start is not null and property_period_end is not null and property_payment_id is not null
      and property_period_start=agreement_start_date
      and property_period_end=(property_period_start+interval '12 months'-interval '1 day')::date
      and property_payment_id<>deposit_payment_id and property_payment_id<>rent_payment_id));

do $migration$
declare d text; old_text text; new_text text;
begin
  d:=replace(pg_get_functiondef('private.lease_payment_business_code(text)'::regprocedure),E'\r\n',E'\n');
  old_text:=$old0$when 'property_fee' then 'PROP'$old0$;
  new_text:=$new0$when 'property_fee' then 'PROP' when 'cimac_apartment_property_fee' then 'PROP'$new0$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedReferenceAnchor0Drift'; end if;
  d:=replace(d,old_text,new_text);
  execute d;
end; $migration$;

do $migration$
declare d text; old_text text; new_text text;
begin
  d:=replace(pg_get_functiondef('private.guard_cimac_paid_money()'::regprocedure),E'\r\n',E'\n');
  old_text:=$old0$('cimac_apartment_rent','cimac_apartment_deposit')$old0$;
  new_text:=$new0$('cimac_apartment_rent','cimac_apartment_deposit','cimac_apartment_property_fee')$new0$;
  if (length(d)-length(replace(d,old_text,'')))<>2*length(old_text) then raise exception 'CimacApartmentCombinedGuardAnchor0Drift'; end if;
  d:=replace(d,old_text,new_text);
  execute d;
end; $migration$;

do $migration$
declare d text; old_text text; new_text text;
begin
  d:=replace(pg_get_functiondef('private.cimac_paid_request(jsonb)'::regprocedure),E'\r\n',E'\n');
  old_text:=$old0$'externalReceiptNo','reason','rooms'];$old0$;
  new_text:=$new0$'externalReceiptNo','reason','rooms','schemaVersion'];$new0$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedRequestAnchor0Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old1$room jsonb; ids uuid[]:='{}'; id uuid; total numeric:=0; starts date; ends date; paid_end date; day date;$old1$;
  new_text:=$new1$room jsonb; ids uuid[]:='{}'; id uuid; total numeric:=0; starts date; ends date; paid_end date; day date; is_v2 boolean:=coalesce(p->'schemaVersion'='2'::jsonb,false);$new1$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedRequestAnchor1Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old2$perform private.cimac_finance_keys(p,keys,$old2$;
  new_text:=$new2$if p?'schemaVersion' and p->'schemaVersion' is distinct from '2'::jsonb then raise exception 'CimacApartmentPaidInvalid'; end if;
  perform private.cimac_finance_keys(p,keys,$new2$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedRequestAnchor2Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old3$perform private.cimac_finance_keys(room,keys,array['unitId','expectedUnitUpdatedAt','monthlyRentXof','depositMonths','rentPrepayMonths','depositAmountXof','rentAmountXof']);$old3$;
  new_text:=$new3$if is_v2 then keys:=keys||array['propertyFeeAmountXof','propertyPeriodStart','propertyPeriodEnd']; end if;
    perform private.cimac_finance_keys(room,keys,array['unitId','expectedUnitUpdatedAt','monthlyRentXof','depositMonths','rentPrepayMonths','depositAmountXof','rentAmountXof']||case when is_v2 then array['propertyFeeAmountXof','propertyPeriodStart','propertyPeriodEnd'] else '{}'::text[] end);$new3$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedRequestAnchor3Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old4$if not(room?'expectedHoldId') or not(room?'expectedHoldUpdatedAt') or room->'expectedHoldId' is distinct from 'null'::jsonb or room->'expectedHoldUpdatedAt' is distinct from 'null'::jsonb
      or room->'depositMonths' is distinct from '2'::jsonb or room->'rentPrepayMonths' is distinct from '3'::jsonb then raise exception 'CimacApartmentPaidInvalid'; end if;$old4$;
  new_text:=$new4$if not(room?'expectedHoldId') or not(room?'expectedHoldUpdatedAt')
      or room->'depositMonths' is distinct from '2'::jsonb or room->'rentPrepayMonths' is distinct from '3'::jsonb then raise exception 'CimacApartmentPaidInvalid'; end if;
    if room->'expectedHoldId'='null'::jsonb and room->'expectedHoldUpdatedAt'='null'::jsonb then null;
    elsif is_v2 then
      perform private.cimac_finance_uuid(room,'expectedHoldId');
      perform private.cimac_finance_text(room,'expectedHoldUpdatedAt',40);
      if room->>'expectedHoldUpdatedAt' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        or not isfinite((room->>'expectedHoldUpdatedAt')::timestamptz) then raise exception 'CimacApartmentPaidInvalid'; end if;
    else raise exception 'CimacApartmentPaidInvalid'; end if;
    if is_v2 then
      if private.cimac_finance_date(room,'propertyPeriodStart')<>starts
        or private.cimac_finance_date(room,'propertyPeriodEnd')<>(starts+interval '12 months'-interval '1 day')::date then raise exception 'CimacApartmentPaidInvalid'; end if;
      total:=total+private.cimac_paid_money(room,'propertyFeeAmountXof');
    end if;$new4$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedRequestAnchor4Drift'; end if;
  d:=replace(d,old_text,new_text);
  execute d;
end; $migration$;

do $migration$
declare d text; old_text text; new_text text;
begin
  d:=replace(pg_get_functiondef('private.cimac_paid_result(uuid)'::regprocedure),E'\r\n',E'\n');
  old_text:=$old0$jsonb_array_length(ps)<>2*jsonb_array_length(j.request_data->'rooms')$old0$;
  new_text:=$new0$jsonb_array_length(ps)<>(case when j.request_data->'schemaVersion'='2'::jsonb then 3 else 2 end)*jsonb_array_length(j.request_data->'rooms')$new0$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedResultAnchor0Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old1$return jsonb_build_object('success',true,'idempotent',true,'data',data||jsonb_build_object('verification',verification));$old1$;
  new_text:=$new1$if j.request_data->'schemaVersion'='2'::jsonb then
    verification:=verification||jsonb_build_object('unpaidReservationsBefore',j.before_data->'unpaidReservations');
  end if;
  return jsonb_build_object('success',true,'idempotent',true,'data',data||jsonb_build_object('verification',verification));$new1$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedResultAnchor1Drift'; end if;
  d:=replace(d,old_text,new_text);
  execute d;
end; $migration$;

do $migration$
declare d text; old_text text; new_text text;
begin
  d:=replace(pg_get_functiondef('private.cimac_apartment_paid_execute(jsonb)'::regprocedure),E'\r\n',E'\n');
  old_text:=$old0$room jsonb; u public.units%rowtype; profile public.cimac_apartment_profiles%rowtype; before_rows jsonb:='[]'; old_holds jsonb;$old0$;
  new_text:=$new0$room jsonb; u public.units%rowtype; profile public.cimac_apartment_profiles%rowtype; before_rows jsonb:='[]'; old_holds jsonb;
  after_holds jsonb; current_hold public.cimac_apartment_reservations%rowtype; is_v2 boolean:=coalesce(p_request->'schemaVersion'='2'::jsonb,false);
  old_request text; old_operation text; old_unit text; cancelled_count integer;$new0$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedExecuteAnchor0Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old1$if exists(select 1 from public.cimac_apartment_reservations where unit_id=u.id and status='reserved')
      or exists(select 1 from public.cimac_apartment_paid_reservations where unit_id=u.id)$old1$;
  new_text:=$new1$select * into current_hold from public.cimac_apartment_reservations where unit_id=u.id and status='reserved' for update;
    if is_v2 then
      if current_hold.id is distinct from (room->>'expectedHoldId')::uuid
        or current_hold.updated_at is distinct from (room->>'expectedHoldUpdatedAt')::timestamptz then raise exception 'CimacApartmentPaidHoldChanged' using errcode='40001'; end if;
      if (room->>'propertyFeeAmountXof')::numeric is distinct from profile.monthly_property_fee_xof*12 then raise exception 'CimacApartmentPaidAmountMismatch'; end if;
      -- Unpaid hold cancellation retains the original admin-only permission.
      if current_hold.id is not null then perform private.cimac_apartment_building_scope(); end if;
    elsif current_hold.id is not null then raise exception 'CimacApartmentPaidBusinessConflict'; end if;
    if exists(select 1 from public.cimac_apartment_paid_reservations where unit_id=u.id)$new1$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedExecuteAnchor1Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old2$insert into private.cimac_apartment_paid_requests values(request,auth.uid(),p_request,'executing',jsonb_build_object('units',before_rows,'unpaidReservations',old_holds),null,clock_timestamp());$old2$;
  new_text:=$new2$insert into private.cimac_apartment_paid_requests values(request,auth.uid(),p_request,'executing',jsonb_build_object('units',before_rows,'unpaidReservations',old_holds),null,clock_timestamp());
  after_holds:=old_holds;
  if is_v2 then
    old_request:=current_setting('app.cimac_apartment_reservation_request',true);
    old_operation:=current_setting('app.cimac_apartment_reservation_operation',true);
    old_unit:=current_setting('app.cimac_apartment_reservation_unit',true);
    perform set_config('app.cimac_apartment_reservation_request',request::text,true);
    perform set_config('app.cimac_apartment_reservation_operation','cancel',true);
    for room in select value from jsonb_array_elements(p_request->'rooms') loop
      if room->>'expectedHoldId' is not null then
        perform set_config('app.cimac_apartment_reservation_unit',room->>'unitId',true);
        update public.cimac_apartment_reservations set status='cancelled',cancelled_at=clock_timestamp(),updated_by=auth.uid(),last_reason=p_request->>'reason'
          where id=(room->>'expectedHoldId')::uuid and unit_id=(room->>'unitId')::uuid and status='reserved' and updated_at=(room->>'expectedHoldUpdatedAt')::timestamptz;
        get diagnostics cancelled_count=row_count;
        if cancelled_count<>1 then raise exception 'CimacApartmentPaidHoldChanged' using errcode='40001'; end if;
      end if;
    end loop;
    perform set_config('app.cimac_apartment_reservation_request',coalesce(old_request,''),true);
    perform set_config('app.cimac_apartment_reservation_operation',coalesce(old_operation,''),true);
    perform set_config('app.cimac_apartment_reservation_unit',coalesce(old_unit,''),true);
    select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') into after_holds from public.cimac_apartment_reservations r
      where unit_id in(select (value->>'unitId')::uuid from jsonb_array_elements(p_request->'rooms'));
  end if;$new2$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedExecuteAnchor2Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old3$foreach kind in array array['deposit','rent'] loop$old3$;
  new_text:=$new3$foreach kind in array (case when is_v2 then array['deposit','rent','property_fee'] else array['deposit','rent'] end) loop$new3$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedExecuteAnchor3Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old4$source:=case when kind='deposit' then 'cimac_apartment_deposit' else 'cimac_apartment_rent' end;
      category:=case when kind='deposit' then 'lease_deposit' else 'lease_rent' end;$old4$;
  new_text:=$new4$source:=case kind when 'deposit' then 'cimac_apartment_deposit' when 'rent' then 'cimac_apartment_rent' else 'cimac_apartment_property_fee' end;
      category:=case kind when 'deposit' then 'lease_deposit' when 'rent' then 'lease_rent' else 'property_fee' end;$new4$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedExecuteAnchor4Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old5$amount:=(room->>case when kind='deposit' then 'depositAmountXof' else 'rentAmountXof' end)::numeric;$old5$;
  new_text:=$new5$amount:=(room->>case kind when 'deposit' then 'depositAmountXof' when 'rent' then 'rentAmountXof' else 'propertyFeeAmountXof' end)::numeric;$new5$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedExecuteAnchor5Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old6$rent_amount_xof,deposit_payment_id,rent_payment_id,recorded_by)$old6$;
  new_text:=$new6$rent_amount_xof,deposit_payment_id,rent_payment_id,recorded_by,property_fee_amount_xof,property_period_start,property_period_end,property_payment_id)$new6$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedExecuteAnchor6Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old7$private.cimac_child_uuid(request,'room:'||idx||':rent:payment'),auth.uid());$old7$;
  new_text:=$new7$private.cimac_child_uuid(request,'room:'||idx||':rent:payment'),auth.uid(),
        case when is_v2 then (room->>'propertyFeeAmountXof')::numeric else null end,
        case when is_v2 then (room->>'propertyPeriodStart')::date else null end,
        case when is_v2 then (room->>'propertyPeriodEnd')::date else null end,
        case when is_v2 then private.cimac_child_uuid(request,'room:'||idx||':property_fee:payment') else null end);$new7$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedExecuteAnchor7Drift'; end if;
  d:=replace(d,old_text,new_text);
  old_text:=$old8$) is distinct from old_holds then raise exception 'CimacApartmentPaidVerificationFailed'; end if;$old8$;
  new_text:=$new8$) is distinct from after_holds then raise exception 'CimacApartmentPaidVerificationFailed'; end if;$new8$;
  if (length(d)-length(replace(d,old_text,'')))<>1*length(old_text) then raise exception 'CimacApartmentCombinedExecuteAnchor8Drift'; end if;
  d:=replace(d,old_text,new_text);
  execute d;
end; $migration$;

notify pgrst,'reload schema';
commit;
