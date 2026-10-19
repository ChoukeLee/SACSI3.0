import { describe, expect, it } from "vitest";
import {
  customerProfileFinancialRows,
  unresolvedCustomerBookings,
} from "@/features/customers/customer-profile-identity";

const customer = "actual-customer";
const booking = (id: string, patch: Record<string, string | null | undefined> = {}) => ({
  id,
  customer_id: customer,
  guest_customer_id: null as string | null,
  booking_agent_id: undefined as string | undefined,
  ...patch,
});
describe("customer profile explicit daily identity", () => {
  it("retains legacy-only and mixed conflicting identities as unknown, not guest or agent", () => {
    const rows = [
      booking("legacy"),
      booking("mixed", { guest_customer_id: "other-guest", booking_agent_id: "other-contact" }),
      booking("guest", { guest_customer_id: customer }),
      booking("agent", { booking_agent_id: customer }),
      booking("both", { guest_customer_id: customer, booking_agent_id: customer }),
      booking("foreign", { customer_id: "someone-else" }),
    ];
    expect(unresolvedCustomerBookings(customer, rows).map((row) => row.id)).toEqual([
      "legacy",
      "mixed",
    ]);
  });
  it("does not infer financial ownership from the old financial customer_id or a missing source", () => {
    const guest = booking("guest", { guest_customer_id: customer }),
      both = booking("both", { guest_customer_id: customer, booking_agent_id: customer });
    const rows = [
      { id: "guest-payment", source_type: "daily_booking", source_id: "guest" },
      { id: "both-payment", source_type: "daily_booking", source_id: "both" },
      { id: "agent-payment", source_type: "daily_booking", source_id: "agent" },
      { id: "legacy-payment", source_type: "daily_booking", source_id: "legacy" },
      { id: "mixed-payment", source_type: "daily_booking", source_id: "mixed" },
      { id: "unlinked-daily", source_type: "daily_booking", source_id: null },
      { id: "lease-payment", source_type: "lease_contract", source_id: "lease" },
      { id: "sale-payment", source_type: "sale_contract", source_id: "sale" },
      { id: "manual", source_type: "manual", source_id: null },
    ];
    expect(
      customerProfileFinancialRows(customer, rows, [guest, both]).map((row) => row.id),
    ).toEqual(["guest-payment", "both-payment", "lease-payment", "sale-payment", "manual"]);
  });
  it("requires exact guest_customer_id even if passed an unrelated or legacy booking", () =>
    expect(
      customerProfileFinancialRows(
        customer,
        [{ source_type: "daily_booking", source_id: "legacy" }],
        [booking("legacy")],
      ),
    ).toEqual([]));
});
