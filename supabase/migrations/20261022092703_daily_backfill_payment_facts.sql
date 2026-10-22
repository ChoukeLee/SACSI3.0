begin;

-- Patch only the historical posting branch. Keep existing authentication,
-- project authorization, actor/payload-bound replay, locks and transaction.
-- Fail closed on implementation drift; never rewrite any historical records.
do $migration$
declare definition text; branch text; start_at integer; end_at integer; item record;
begin
  definition := pg_get_functiondef('private.finance_operation(text,jsonb,uuid)'::regprocedure);
  start_at := strpos(definition, '  elsif p_operation=''daily_backfill'' then');
  end_at := strpos(definition, E'  else\n    select * into strict b from public.daily_bookings where id=b.id for update;');
  if start_at=0 or end_at<=start_at then raise exception 'daily_backfill_branch_drift'; end if;
  branch := substring(definition from start_at for end_at-start_at);
  for item in select * from (values
    ($old$if paid>total then raise exception 'paymentExceedsOutstanding'; end if;$old$,
     $new$if paid>total then raise exception 'paymentExceedsOutstanding'; end if;
    if paid>0 then
      if jsonb_typeof(p_input->'paymentDate') is distinct from 'string'
        or coalesce(p_input->>'paymentDate','') !~ '^\d{4}-\d{2}-\d{2}$'
        or coalesce(p_input->>'paymentMethod','') not in ('cash','check','bank_transfer','other')
      then raise exception 'backfillPaymentFactsRequired'; end if;
      dt := (p_input->>'paymentDate')::date;
      if not isfinite(dt) or dt>current_date or dt::text<>p_input->>'paymentDate'
      then raise exception 'backfillPaymentDateInvalid'; end if;
    end if;$new$),
    ($old$billing_status,status,notes)$old$,
     $new$billing_status,status,actual_check_out,notes)$new$),
    ($old$end,'checked_out',
      '[历史补录] '$old$,
     $new$end,'checked_out',end_date,
      '[历史补录] '$new$),
    ($old$payment_date,amount,currency,exchange_rate_to_xof,request_id,request_kind)
      values(b.customer_id,unit,'daily_booking',b.id,end_date,paid,'XOF',1,p_request_id,'daily_backfill')$old$,
     $new$payment_date,amount,currency,exchange_rate_to_xof,request_id,request_kind,payment_method)
      values(b.customer_id,unit,'daily_booking',b.id,dt,paid,'XOF',1,p_request_id,'daily_backfill',p_input->>'paymentMethod')$new$),
    ($old$values(building,unit,payment,end_date,'income','daily_rental',paid,'日租历史补录 房间'||u.unit_no);$old$,
     $new$values(building,unit,payment,dt,'income','daily_rental',paid,'日租历史补录 房间'||u.unit_no);
      insert into public.payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id)
      select payment,r.id,paid,actor,p_request_id from public.receivables r
        where r.source_type='daily_booking' and r.source_id=b.id;$new$)
  ) changes(old_text,new_text)
  loop
    if strpos(branch,item.old_text)=0 then raise exception 'daily_backfill_posting_drift'; end if;
    branch := replace(branch,item.old_text,item.new_text);
  end loop;
  execute substring(definition from 1 for start_at-1) || branch || substring(definition from end_at);
end $migration$;

commit;
