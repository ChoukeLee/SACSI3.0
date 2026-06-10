-- Receipt Attachments & Storage Bucket
-- Links uploaded receipt images to payments, receivables, and units.
-- Duplicate detection is handled at the application layer (not DB constraints).

-- ── Attachments table ──────────────────────────────────────────

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  bucket text not null default 'receipts',
  file_type text not null default 'receipt_image',
  linked_type text not null,
  linked_id uuid not null,
  unit_id uuid references units(id),
  customer_id uuid references customers(id),
  uploaded_by uuid,
  uploaded_at timestamptz default now(),
  original_filename text,
  mime_type text,
  file_size integer,
  ocr_text text,
  ocr_provider text,
  paper_archive_status text not null default 'pending',
  paper_archive_location text,
  metadata jsonb default '{}'::jsonb
);

comment on table attachments is 'Links uploaded images to business entities (payments, receivables, etc.)';

-- ── RLS ────────────────────────────────────────────────────────

alter table attachments enable row level security;

-- Authenticated users can read all attachments
drop policy if exists "Authenticated users can read attachments" on attachments;
create policy "Authenticated users can read attachments"
  on attachments for select
  to authenticated
  using (true);

-- Authenticated users can insert attachments
drop policy if exists "Authenticated users can insert attachments" on attachments;
create policy "Authenticated users can insert attachments"
  on attachments for insert
  to authenticated
  with check (true);

-- Only the uploading user or admin can delete
drop policy if exists "Uploader or admin can delete attachments" on attachments;
create policy "Uploader or admin can delete attachments"
  on attachments for delete
  to authenticated
  using (uploaded_by = auth.uid());

-- ── Storage bucket ─────────────────────────────────────────────

-- Create the receipts bucket (private, for receipt images and PDFs).
-- This INSERT runs directly in the migration context (no manual step needed).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, '{image/jpeg,image/png,image/webp,application/pdf}')
on conflict (id) do nothing;

-- Storage RLS: authenticated users can read and write to receipts bucket
drop policy if exists "Authenticated users can read receipts" on storage.objects;
create policy "Authenticated users can read receipts"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'receipts');

drop policy if exists "Authenticated users can upload receipts" on storage.objects;
create policy "Authenticated users can upload receipts"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'receipts');
