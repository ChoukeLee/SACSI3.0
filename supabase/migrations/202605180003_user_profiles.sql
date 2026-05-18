create type public.user_role as enum ('admin', 'boss', 'finance', 'front_desk');

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'front_desk',
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- Users can read their own profile
create policy "Users can read own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

-- Only admin can insert/update/delete profiles
create policy "Admin can manage profiles"
  on public.user_profiles for all
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );
