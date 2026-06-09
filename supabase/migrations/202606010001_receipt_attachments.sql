-- Receipt Attachments & Storage Bucket
-- Links uploaded receipt images to payments, receivables, and units.
-- Does NOT create database uniqueness constraints on receipt_no.
-- Duplicate detection is handled at the application layer.

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

-- Create the receipts storage bucket if not exists (Supabase migration cannot create
-- buckets directly — run this in the Supabase dashboard SQL editor or via CLI):
--
--   INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   VALUES ('receipts', 'receipts', false, 10485760, '{image/jpeg,image/png,image/webp,application/pdf}')
--   ON CONFLICT (id) DO NOTHING;
