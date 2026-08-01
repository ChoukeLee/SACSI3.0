-- Include historical non-daily receivables in the management finance snapshot.
-- The homepage finance cards are used as an as-of-now risk view, so unpaid
-- prior-month lease/sale receivables must not disappear when a new month starts.

create or replace function public.management_finance_snapshot(
  p_month date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select
      date_trunc('month', coalesce(p_month, current_date))::date as month_start,
      (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date as month_end
  ),
  scoped as (
    select
      r.id,
      r.due_date,
      r.source_type::text as source_type,
      r.category::text as category,
      r.title,
      greatest(coalesce(r.amount_xof, 0), 0)::numeric as amount,
      least(
        greatest(coalesce(r.paid_amount_xof, 0), 0),
        greatest(coalesce(r.amount_xof, 0), 0)
      )::numeric as paid,
      greatest(
        greatest(coalesce(r.amount_xof, 0), 0)
          - least(
              greatest(coalesce(r.paid_amount_xof, 0), 0),
              greatest(coalesce(r.amount_xof, 0), 0)
            ),
        0
      )::numeric as outstanding,
      coalesce(r.building_id, u.building_id) as building_id,
      b.code as building_code,
      coalesce(b.display_name, b.code) as building_name,
      r.unit_id,
      u.unit_no,
      r.customer_id,
      c.name as customer_name
    from public.receivables r
    cross join bounds x
    left join public.units u on u.id = r.unit_id
    left join public.buildings b on b.id = coalesce(r.building_id, u.building_id)
    left join public.customers c on c.id = r.customer_id
    where r.source_type::text <> 'daily_booking'
      and r.status::text <> 'cancelled'
      and r.due_date < x.month_end
  ),
  classified as (
    select
      s.*,
      case
        when s.outstanding <= 0 then 'paid'
        when s.due_date < current_date then 'overdue'
        when s.paid > 0 then 'partial'
        else 'pending'
      end as computed_status
    from scoped s
  ),
  summary as (
    select
      coalesce(sum(amount), 0)::numeric as total_receivable,
      coalesce(sum(paid), 0)::numeric as total_paid,
      coalesce(sum(outstanding), 0)::numeric as outstanding,
      coalesce(sum(outstanding) filter (where computed_status = 'overdue'), 0)::numeric as overdue,
      count(*)::integer as count
    from classified
  )
  select jsonb_build_object(
    'month_start', x.month_start,
    'month_end_exclusive', x.month_end,
    'as_of', current_date,
    'summary', jsonb_build_object(
      'total_receivable', s.total_receivable,
      'total_paid', s.total_paid,
      'outstanding', s.outstanding,
      'overdue', s.overdue,
      'count', s.count,
      'collection_rate',
        case when s.total_receivable > 0
          then s.total_paid / s.total_receivable
          else 0
        end
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'due_date', c.due_date,
          'source_type', c.source_type,
          'category', c.category,
          'title', c.title,
          'amount_xof', c.amount,
          'paid_amount_xof', c.paid,
          'outstanding_xof', c.outstanding,
          'status', c.computed_status,
          'building_id', c.building_id,
          'building_code', c.building_code,
          'building_name', c.building_name,
          'unit_id', c.unit_id,
          'unit_no', c.unit_no,
          'customer_id', c.customer_id,
          'customer_name', c.customer_name
        )
        order by c.due_date desc, c.building_code nulls last, c.unit_no nulls last, c.id
      )
      from classified c
    ), '[]'::jsonb)
  )
  from bounds x
  cross join summary s;
$$;

revoke all on function public.management_finance_snapshot(date) from public, anon;
grant execute on function public.management_finance_snapshot(date) to authenticated, service_role;

comment on function public.management_finance_snapshot(date) is
  'As-of snapshot for management finance cards and detail rows; includes historical non-daily receivables due before the selected month end.';
