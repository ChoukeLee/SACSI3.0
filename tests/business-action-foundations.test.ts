import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_ACTIONS,
  canRoleUseBusinessAction,
  getBusinessActionDefinition,
} from "../src/features/business-actions/registry";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260905082337_ai_business_action_foundations.sql"),
  "utf8",
);

describe("business action foundations", () => {
  it("registers unique actions and requires confirmation for every write", () => {
    const names = BUSINESS_ACTIONS.map((action) => action.name);
    expect(new Set(names).size).toBe(names.length);
    expect(BUSINESS_ACTIONS.filter((action) => action.write).every((action) => ["L1", "L2", "L3"].includes(action.risk))).toBe(true);
  });

  it("keeps boss read-only and reserves correction actions for admin", () => {
    expect(canRoleUseBusinessAction("boss", "query_lease_position")).toBe(true);
    expect(canRoleUseBusinessAction("boss", "record_lease_rent")).toBe(false);
    expect(canRoleUseBusinessAction("finance", "record_sale_payment")).toBe(true);
    expect(canRoleUseBusinessAction("finance", "correct_sale_payment")).toBe(false);
    expect(getBusinessActionDefinition("correct_daily_booking")?.risk).toBe("L3");
  });

  it("separates daily handler and guest identities with indexed foreign keys", () => {
    expect(migration).toMatch(/booking_agent_id uuid references public\.customers/i);
    expect(migration).toMatch(/guest_customer_id uuid references public\.customers/i);
    expect(migration).toMatch(/idx_daily_bookings_booking_agent/i);
    expect(migration).toMatch(/idx_daily_bookings_guest_customer/i);
  });

  it("does not silently default lease payments to cash", () => {
    expect(migration).toMatch(/p_payment_method text default null/i);
    expect(migration).toMatch(/paymentMethodRequired/i);
    expect(migration).toMatch(/payment_method, p_request_id/i);
  });

  it("updates paid-through without changing the formal contract end date", () => {
    const rentSection = migration.slice(migration.indexOf("if p_business_type = 'rent_income'"));
    expect(rentSection).toMatch(/set paid_through_date = p_paid_through_date/i);
    expect(rentSection).not.toMatch(/set expected_end_date/i);
  });

  it("can represent an unconfirmed sale total", () => {
    expect(migration).toMatch(/total_amount_xof drop not null/i);
    expect(migration).toMatch(/total_amount_confirmed boolean not null default true/i);
  });
});
