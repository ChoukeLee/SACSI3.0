import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260914084040_add_external_operator_daily_actions.sql"),
  "utf8",
);

describe("external operator daily actions migration", () => {
  it("authorizes the query and payment RPCs through operator capabilities", () => {
    expect(migration).toMatch(/private\.operator_query_daily_booking[\s\S]+current_operator_action_allowed\('query_daily_booking', 'L0'\)/i);
    expect(migration).toMatch(/daily_record_payment_rpc[\s\S]+current_operator_action_allowed\('record_daily_payment', 'L2'\)/i);
  });

  it("keeps payment atomic, idempotent and synchronized", () => {
    expect(migration).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_request_id::text, 0\)\)/i);
    expect(migration).toMatch(/where request_id = p_request_id/i);
    expect(migration).toMatch(/perform public\.daily_sync_booking_finance_tx\(p_booking_id\)/i);
    expect(migration).toMatch(/paymentExceedsOutstanding/i);
  });

  it("records bounded external evidence and exposes a narrow verification RPC", () => {
    expect(migration).toMatch(/'original_instruction', left\(coalesce\(p_actor->>'original_instruction', ''\), 4000\)/i);
    expect(migration).toMatch(/create or replace function private\.verify_operator_daily_payment/i);
    expect(migration).toMatch(/create or replace function public\.verify_operator_daily_payment[\s\S]+security invoker/i);
    expect(migration).toMatch(/actor_id = \(select auth\.uid\(\)\)/i);
    expect(migration).toMatch(/revoke all on function public\.verify_operator_daily_payment\(uuid, uuid\) from public, anon/i);
  });
});
