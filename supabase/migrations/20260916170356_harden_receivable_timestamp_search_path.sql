-- This trigger only assigns NEW.updated_at = now(); it needs no schema lookup.
-- Preserve its body, privileges and invoker security; no business data changes.
alter function public.update_receivables_updated_at() set search_path = '';
