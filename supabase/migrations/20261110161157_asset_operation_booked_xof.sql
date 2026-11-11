begin;
set local lock_timeout = '3s';

alter table public.asset_operation_entries
  add column booked_amount_xof numeric,
  add constraint asset_operation_entries_booked_amount_xof_check check (
    booked_amount_xof is null
    or (
      currency <> 'XOF'
      and booked_amount_xof > 0
      and booked_amount_xof <= 90071992547409.91
      and booked_amount_xof = round(booked_amount_xof, 2)
    )
  );

comment on column public.asset_operation_entries.booked_amount_xof is
  'Explicit XOF booking value for the same original-currency cash movement. Never a second receipt.';

CREATE OR REPLACE FUNCTION public.asset_operations_read_rpc(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not coalesce(public.has_app_role('admin','boss','finance'),false) then
    raise exception 'assetOperationPermissionDenied' using errcode='42501'; end if;
  if p_project_id is null or not coalesce(public.can_access_project(p_project_id),false) then
    raise exception 'assetOperationAccessDenied' using errcode='42501'; end if;
  return jsonb_build_object('projectId',p_project_id,
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'projectId',a.project_id,'unitId',a.unit_id,
      'code',a.code,'name',a.name,'group',a.asset_group,'verification',a.verification,'sourceRefs',a.source_refs,
      'monthlyRentNative',a.monthly_rent_native,'rentCurrency',a.rent_currency,'costCoverageThrough',null,
      'updatedAt',a.updated_at) order by a.asset_group,a.code,a.id) from public.asset_operation_assets a where a.project_id=p_project_id),'[]'::jsonb),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'assetId',e.asset_id,'kind',e.kind,'category',e.category,
      'amountNative',e.amount_native,'currency',e.currency,'bookedAmountXof',e.booked_amount_xof,'cashDate',e.cash_date,'periodStart',e.period_start,'periodEnd',e.period_end,
      'verification',e.verification,'recognitionMethod',e.recognition_method,'sourceRef',e.source_ref,'description',e.description,
      'updatedAt',e.updated_at,'voidedAt',e.voided_at,'voidReason',e.void_reason) order by e.created_at,e.id)
      from public.asset_operation_entries e join public.asset_operation_assets a on a.id=e.asset_id where a.project_id=p_project_id),'[]'::jsonb),
    'canWrite',public.has_app_role('admin','finance'),'asOf',statement_timestamp());
end $function$;

commit;
