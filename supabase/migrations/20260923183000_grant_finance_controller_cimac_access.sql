-- Configure finance@sacsi.com as the finance controller and grant CIMAC access.

begin;

update public.user_profiles profile
set role = 'finance',
    display_name = 'zhulin',
    updated_at = now()
from auth.users account
where profile.id = account.id
  and lower(account.email) = 'finance@sacsi.com';

insert into public.project_account_access (project_id, account_email)
select project.id, 'finance@sacsi.com'
from public.projects project
where project.code = 'CIMAC'
on conflict (project_id, account_email) do nothing;

insert into public.audit_logs (
  actor_email,
  actor_role,
  action,
  entity_type,
  entity_id,
  entity_label,
  before_data,
  after_data,
  metadata
)
select
  'system:migration',
  'admin',
  'account_permission_update',
  'user_profile',
  account.id,
  'finance@sacsi.com / zhulin',
  jsonb_build_object(
    'role', 'admin',
    'project_scope', 'sacsi_only'
  ),
  jsonb_build_object(
    'role', 'finance',
    'business_title', '财务总管',
    'project_scope', 'all',
    'cimac_access', true
  ),
  jsonb_build_object(
    'migration', '20260923183000_grant_finance_controller_cimac_access',
    'reason', '琳姐为财务总管，负责SACSI公寓及科建建材城财务'
  )
from auth.users account
where lower(account.email) = 'finance@sacsi.com';

commit;
