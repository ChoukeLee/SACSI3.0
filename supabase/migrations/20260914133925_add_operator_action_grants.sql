begin;

-- External operators need business capabilities that can evolve independently
-- from the page-oriented role matrix. Keep the catalog and grants outside the
-- exposed Data API schemas; authenticated users only receive their own
-- effective capabilities through narrowly scoped functions below.

create table private.operator_action_catalog (
  action_name text primary key,
  domain text not null check (domain in ('daily_rental', 'lease', 'sale', 'unit')),
  risk_level text not null check (risk_level in ('L0', 'L1', 'L2', 'L3')),
  is_write boolean not null,
  description text not null,
  default_roles text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(default_roles) > 0)
);

create table private.operator_action_grants (
  user_id uuid not null references auth.users(id) on delete restrict,
  action_name text not null references private.operator_action_catalog(action_name) on delete restrict,
  granted_by uuid not null references auth.users(id) on delete restrict,
  grant_reason text not null check (length(trim(grant_reason)) between 2 and 500),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, action_name),
  check (revoked_at is null or revoked_at >= granted_at)
);

revoke all on table private.operator_action_catalog from public, anon, authenticated, service_role;
revoke all on table private.operator_action_grants from public, anon, authenticated, service_role;

insert into private.operator_action_catalog (
  action_name, domain, risk_level, is_write, description, default_roles
)
values
  ('query_daily_booking', 'daily_rental', 'L0', false, '查询日租订单、房态、收款和保洁', array['admin', 'boss', 'finance', 'front_desk', 'rental_sales']),
  ('create_daily_booking', 'daily_rental', 'L2', true, '新建日租订单', array['admin', 'rental_sales']),
  ('check_in_daily_booking', 'daily_rental', 'L2', true, '办理日租入住', array['admin', 'front_desk', 'rental_sales']),
  ('extend_daily_stay', 'daily_rental', 'L2', true, '修改退房日期或续住', array['admin', 'front_desk', 'rental_sales']),
  ('record_daily_payment', 'daily_rental', 'L2', true, '登记日租收款', array['admin', 'front_desk', 'rental_sales']),
  ('check_out_daily_booking', 'daily_rental', 'L2', true, '办理退房与结算', array['admin', 'front_desk', 'rental_sales']),
  ('complete_daily_cleaning', 'daily_rental', 'L1', true, '完成日租保洁', array['admin', 'front_desk', 'rental_sales']),
  ('mark_unit_maintenance', 'unit', 'L1', true, '标记房间维修', array['admin', 'front_desk']),
  ('cancel_no_show_booking', 'daily_rental', 'L3', true, '取消未到店订单', array['admin']),
  ('transfer_daily_booking', 'daily_rental', 'L3', true, '转移日租订单与关联财务', array['admin']),
  ('reverse_daily_payment', 'daily_rental', 'L3', true, '反冲错误日租收款', array['admin']),
  ('correct_daily_booking', 'daily_rental', 'L3', true, '纠正日租业务记录', array['admin']),
  ('apply_booking_credit', 'daily_rental', 'L3', true, '转移日租可用余额', array['admin']),
  ('query_lease_position', 'lease', 'L0', false, '查询长租合同与财务状态', array['admin', 'boss', 'finance', 'front_desk', 'rental_sales']),
  ('query_lease_due_detail', 'lease', 'L0', false, '查询长租应收与逾期', array['admin', 'boss', 'finance', 'front_desk', 'rental_sales']),
  ('record_lease_rent', 'lease', 'L2', true, '登记长租租金', array['admin', 'finance']),
  ('record_property_fee', 'lease', 'L2', true, '登记物业费', array['admin', 'finance']),
  ('record_combined_lease_payment', 'lease', 'L3', true, '拆分组合长租付款', array['admin', 'finance']),
  ('record_lease_deposit', 'lease', 'L2', true, '登记长租押金', array['admin', 'finance']),
  ('renew_lease', 'lease', 'L3', true, '续签长租合同', array['admin', 'rental_sales']),
  ('mark_non_renewal', 'lease', 'L2', true, '标记到期不续租', array['admin', 'rental_sales']),
  ('start_lease_move_out', 'lease', 'L2', true, '开始退租流程', array['admin', 'rental_sales']),
  ('settle_lease_deposit', 'lease', 'L3', true, '结算押金退款与扣款', array['admin', 'finance']),
  ('terminate_lease', 'lease', 'L3', true, '终止长租合同', array['admin']),
  ('correct_lease_payment', 'lease', 'L3', true, '纠正长租收款', array['admin']),
  ('query_sale_position', 'sale', 'L0', false, '查询销售合同与财务状态', array['admin', 'boss', 'finance', 'rental_sales']),
  ('query_sale_payment_detail', 'sale', 'L0', false, '查询销售付款计划', array['admin', 'boss', 'finance', 'rental_sales']),
  ('create_sale_draft', 'sale', 'L3', true, '创建总价可待补的销售草稿', array['admin', 'rental_sales']),
  ('record_sale_payment', 'sale', 'L2', true, '登记销售收款', array['admin', 'finance']),
  ('add_sale_installment', 'sale', 'L3', true, '调整销售付款节点', array['admin', 'rental_sales']),
  ('update_transfer_status', 'sale', 'L2', true, '更新交房或过户状态', array['admin', 'rental_sales']),
  ('correct_sale_payment', 'sale', 'L3', true, '纠正销售收款', array['admin']),
  ('terminate_sale_contract', 'sale', 'L3', true, '解除销售合同', array['admin'])
on conflict (action_name) do update
set domain = excluded.domain,
    risk_level = excluded.risk_level,
    is_write = excluded.is_write,
    description = excluded.description,
    default_roles = excluded.default_roles,
    updated_at = now();

create or replace function private.current_operator_action_allowed(
  p_action_name text,
  p_risk_level text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.operator_action_catalog catalog
    where catalog.action_name = p_action_name
      and catalog.risk_level = p_risk_level
      and (
        public.current_user_role() = any(catalog.default_roles)
        or exists (
          select 1
          from private.operator_action_grants action_grant
          where action_grant.user_id = (select auth.uid())
            and action_grant.action_name = catalog.action_name
            and action_grant.revoked_at is null
        )
      )
  );
$$;

-- Keep the existing AI evidence state machine, but make its authorization
-- source role-or-explicit-grant instead of a role-only hardcoded VALUES list.
create or replace function private.is_ai_action_authorized(
  p_action_name text,
  p_risk_level text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and private.current_operator_action_allowed(p_action_name, p_risk_level);
$$;

create or replace function private.get_my_operator_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := public.current_user_role();
begin
  if v_actor_id is null then
    raise exception 'authenticationRequired' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'action_name', catalog.action_name,
        'domain', catalog.domain,
        'risk_level', catalog.risk_level,
        'is_write', catalog.is_write,
        'description', catalog.description,
        'authorized', (
          v_role = any(catalog.default_roles)
          or action_grant.user_id is not null
        ),
        'authorization_source', case
          when v_role = any(catalog.default_roles) then 'role'
          when action_grant.user_id is not null then 'explicit_grant'
          else 'none'
        end
      )
      order by catalog.domain, catalog.action_name
    )
    from private.operator_action_catalog catalog
    left join private.operator_action_grants action_grant
      on action_grant.user_id = v_actor_id
      and action_grant.action_name = catalog.action_name
      and action_grant.revoked_at is null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.can_execute_operator_action(
  p_action_name text,
  p_risk_level text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.current_operator_action_allowed($1, $2);
$$;

create or replace function public.get_my_operator_capabilities()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_my_operator_capabilities();
$$;

revoke all on function private.current_operator_action_allowed(text, text) from public, anon;
revoke all on function private.is_ai_action_authorized(text, text) from public, anon;
revoke all on function private.get_my_operator_capabilities() from public, anon;
grant execute on function private.current_operator_action_allowed(text, text) to authenticated;
grant execute on function private.is_ai_action_authorized(text, text) to authenticated;
grant execute on function private.get_my_operator_capabilities() to authenticated;

revoke all on function public.can_execute_operator_action(text, text) from public, anon;
revoke all on function public.get_my_operator_capabilities() from public, anon;
grant execute on function public.can_execute_operator_action(text, text) to authenticated;
grant execute on function public.get_my_operator_capabilities() to authenticated;

commit;
