import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error Development-only JS bootstrap module.
import { buildLocalPaymentSchema, reviewedSlice } from '../scripts/lib/local-payment-schema.mjs';

describe('reviewed local payment bootstrap', () => {
  it('builds a stable, reviewed slice without historical business data', () => {
    const result = buildLocalPaymentSchema();
    expect(result.sourceFiles).toHaveLength(17);
    expect(result.previousChecksum).toBe('aa32730f25717bcd4e7aba59cf270ed12e293b87bc7b9a16aa9938af0c59785a');
    expect(result.upgradeSql).toContain("alter function public.update_receivables_updated_at() set search_path = '';");
    expect(result.checksum).toBe(buildLocalPaymentSchema().checksum);
    expect(result.sql).toContain('create table public.daily_bookings');
    expect(result.sql).toContain('create function public.confirm_operator_payment');
    expect(result.sql).not.toContain('insert into public.system_settings');
    expect(result.sql).not.toContain("set role = 'admin'::public.user_role");
    expect(result.sql).not.toContain('set booking_agent_id = customer_id\nwhere');
    expect(result.sql).not.toMatch(/^begin;|^commit;/m);
  });
  it('rejects source drift before any SQL execution', () => {
    expect(() => buildLocalPaymentSchema(() => '-- changed')).toThrow('Source changed');
  });
  it('accepts CRLF without weakening content verification', () => {
    const crlf = buildLocalPaymentSchema((name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r?\n/g,'\r\n'));
    expect(crlf.checksum).toBe(buildLocalPaymentSchema().checksum);
  });
  it('rejects missing or ambiguous anchors', () => {
    expect(() => reviewedSlice('begin finish','missing','finish')).toThrow();
    expect(() => reviewedSlice('start start finish','start','finish')).toThrow();
    expect(() => reviewedSlice('start finish finish','start','finish')).toThrow();
  });
  it('returns only the exact reviewed source region', () => {
    expect(reviewedSlice('seed; START schema; END seed;','START','END')).toBe('START schema; ');
  });
});
