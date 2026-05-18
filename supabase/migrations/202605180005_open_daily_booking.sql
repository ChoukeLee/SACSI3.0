-- Support open-ended (no fixed check-out) daily bookings
-- and manual discount handling.

-- 1. Drop the old check constraint that requires check_out > check_in
alter table public.daily_bookings drop constraint if exists daily_bookings_check;

-- 2. Make check_out nullable for open-ended bookings
alter table public.daily_bookings alter column check_out drop not null;

-- 3. Add new columns
alter table public.daily_bookings
  add column if not exists checkout_mode text not null default 'fixed'
    check (checkout_mode in ('fixed', 'open')),
  add column if not exists actual_check_out date,
  add column if not exists billing_status text not null default 'prepaid'
    check (billing_status in ('prepaid', 'partially_paid', 'need_top_up', 'settled')),
  add column if not exists manual_discount_amount_xof numeric(14, 2) not null default 0,
  add column if not exists manual_discount_reason text,
  add column if not exists final_amount_xof numeric(14, 2);

-- 4. New check: if fixed mode, check_out is required and > check_in.
--    if open mode, check_out can be null.
alter table public.daily_bookings add constraint daily_bookings_checkout_check check (
  (checkout_mode = 'fixed' and check_out is not null and check_out > check_in)
  or (checkout_mode = 'open')
);

-- 5. Update RLS for new columns (authenticated users can read/write)
-- (already covered by existing policies on daily_bookings)
