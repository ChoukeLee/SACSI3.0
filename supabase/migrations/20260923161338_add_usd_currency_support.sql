-- Preserve USD as the original payment currency while the ledger remains in XOF.
alter type public.currency_code add value if not exists 'USD';
