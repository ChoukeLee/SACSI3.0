-- Keep generated internal lease references separate from source receipt numbers.
-- Patch only the receipt fields in the current functions; preserve later payment
-- allocations, period facts, authorization, locks, atomicity and audit patches.
-- No business rows, grants, triggers or confirmation requirements are changed.
begin;
do $migration$
declare
  definition text;
  before_text text;
  after_text text;
begin
  definition := pg_get_functiondef('private.confirm_operator_collection(uuid)'::regprocedure);
  before_text := $old$currency,exchange_rate_to_xof,receipt_no,payment_method,request_id$old$;
  after_text := $new$currency,exchange_rate_to_xof,receipt_no,external_receipt_no,payment_method,request_id$new$;
  if length(definition)-length(replace(definition,before_text,'')) <> length(before_text) then
    raise exception 'Unexpected confirm_operator_collection receipt columns; review before applying';
  end if;
  definition := replace(definition,before_text,after_text);
  before_text := $old$'XOF',1,nullif(btrim(row_data->>'receiptNo'),''),row_data->>'paymentMethod',child,'operator_collection'$old$;
  after_text := $new$'XOF',1,case when row_data->>'domain'='lease' then null else nullif(btrim(row_data->>'receiptNo'),'') end,case when row_data->>'domain'='lease' then nullif(btrim(row_data->>'receiptNo'),'') else null end,row_data->>'paymentMethod',child,'operator_collection'$new$;
  if length(definition)-length(replace(definition,before_text,'')) <> length(before_text) then
    raise exception 'Unexpected confirm_operator_collection receipt values; review before applying';
  end if;
  execute replace(definition,before_text,after_text);

  definition := pg_get_functiondef('private.verify_operator_collection(private.operator_collection_batches)'::regprocedure);
  before_text := $old$p.receipt_no is distinct from nullif(btrim(row_data->>'receiptNo'),'')$old$;
  after_text := $new$(case when row_data->>'domain'='lease' then p.external_receipt_no else p.receipt_no end) is distinct from nullif(btrim(row_data->>'receiptNo'),'')$new$;
  if length(definition)-length(replace(definition,before_text,'')) <> length(before_text) then
    raise exception 'Unexpected verify_operator_collection receipt predicate; review before applying';
  end if;
  execute replace(definition,before_text,after_text);
end;
$migration$;
commit;

