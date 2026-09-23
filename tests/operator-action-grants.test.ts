import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_ACTIONS } from "@/features/business-actions/registry";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260914133925_add_operator_action_grants.sql"),
  "utf8",
);

describe("operator action grants migration", () => {
  it("keeps the capability catalog and grants out of exposed schemas", () => {
    expect(migration).toMatch(/create table private\.operator_action_catalog/i);
    expect(migration).toMatch(/create table private\.operator_action_grants/i);
    expect(migration).toMatch(/revoke all on table private\.operator_action_grants from public, anon, authenticated, service_role/i);
  });

  it("requires an authenticated identity and only reads the caller's active grant", () => {
    expect(migration).toMatch(/action_grant\.user_id = \(select auth\.uid\(\)\)/i);
    expect(migration).toMatch(/action_grant\.revoked_at is null/i);
    expect(migration).toMatch(/\(select auth\.uid\(\)\) is not null[\s\S]+current_operator_action_allowed/i);
  });

  it("preserves risk matching so a grant cannot downgrade a high-risk action", () => {
    expect(migration).toMatch(/catalog\.risk_level = p_risk_level/i);
  });

  it("publishes only narrow authenticated functions", () => {
    expect(migration).toMatch(/create or replace function public\.can_execute_operator_action[\s\S]+security invoker/i);
    expect(migration).toMatch(/create or replace function public\.get_my_operator_capabilities[\s\S]+security invoker/i);
    expect(migration).toMatch(/revoke all on function public\.get_my_operator_capabilities\(\) from public, anon/i);
    expect(migration).toMatch(/grant execute on function public\.get_my_operator_capabilities\(\) to authenticated/i);
  });

  it("keeps the database catalog synchronized with every registered action", () => {
    for (const action of BUSINESS_ACTIONS) {
      if (action.name === 'refund_daily_payment') {
        const incremental = readFileSync('supabase/migrations/20260923135331_operator_booking_operations.sql','utf8');
        expect(incremental).toContain("values('refund_daily_payment','daily_rental','L3',true,'登记实际日租退款',array['admin'])");
        continue;
      }
      expect(migration).toContain(`('${action.name}', '${action.domain}', '${action.risk}'`);
    }
  });
});

