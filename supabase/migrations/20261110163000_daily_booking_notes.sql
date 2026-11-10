begin;

create function public.update_daily_booking_notes_rpc(
  p_booking_id uuid,
  p_unit_id uuid,
  p_expected_notes text,
  p_notes text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  historical_prefix constant text := '[历史补录]';
  prior_notes text;
  next_notes text;
  saved_notes text;
begin
  if actor is null or not coalesce(public.has_app_role('admin','front_desk','rental_sales'), false)
    or not coalesce(public.can_access_unit(p_unit_id), false)
  then raise exception 'dailyBookingNotesDenied' using errcode = '42501'; end if;

  next_notes := nullif(regexp_replace(p_notes, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if char_length(next_notes) > 4000 or starts_with(next_notes, historical_prefix) then
    raise exception 'dailyBookingNotesInvalid' using errcode = '22023';
  end if;

  select b.notes into prior_notes
  from public.daily_bookings b
  where b.id = p_booking_id and b.unit_id = p_unit_id
  for update;
  if not found then
    raise exception 'dailyBookingNotesUnavailable' using errcode = '42501';
  end if;
  if prior_notes is distinct from p_expected_notes then
    return jsonb_build_object('status', 'conflict', 'notes', prior_notes);
  end if;

  if starts_with(prior_notes, historical_prefix) then
    next_notes := historical_prefix || coalesce(' ' || next_notes, '');
  end if;
  if prior_notes is not distinct from next_notes then
    return jsonb_build_object('status', 'saved', 'notes', prior_notes);
  end if;

  -- Notes do not advance the version shared by booking and finance operations.
  update public.daily_bookings b set notes = next_notes
  where b.id = p_booking_id and b.unit_id = p_unit_id
  returning b.notes into strict saved_notes;

  insert into public.audit_logs (actor_id,action,entity_type,entity_id,before_data,after_data,metadata)
  values (actor,'update_daily_booking_notes','daily_booking',p_booking_id,
    jsonb_build_object('notes', prior_notes),jsonb_build_object('notes', saved_notes),
    jsonb_build_object('channel', 'sacsi_web', 'unit_id', p_unit_id));

  return jsonb_build_object('status', 'saved', 'notes', saved_notes);
end;
$$;
revoke all on function public.update_daily_booking_notes_rpc(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.update_daily_booking_notes_rpc(uuid,uuid,text,text) to authenticated;

-- A fresh checkout revision preview remains valid after an independent notes
-- edit. Keep the prepared revision's complete live snapshot comparison intact.
do $migration$
declare
  definition text := pg_get_functiondef('private.preview_checkout_revision_payment(jsonb)'::regprocedure);
  anchor constant text := 'if to_jsonb(b) is distinct from source_audit.after_data';
  replacement constant text := 'if (to_jsonb(b) - ''notes'') is distinct from (source_audit.after_data - ''notes'')';
begin
  if strpos(definition, anchor) = 0
    or strpos(substr(definition, strpos(definition, anchor) + length(anchor)), anchor) > 0
  then raise exception 'dailyBookingNotesRevisionMigrationDrift'; end if;
  execute replace(definition, anchor, replacement);
end;
$migration$;

commit;
