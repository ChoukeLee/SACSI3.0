import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  from: vi.fn(),
  rows: {} as Record<string, Record<string, unknown>[]>,
  requests: [] as { table: string; filters: { key: string; value: unknown; op: string }[] }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock }));
import { fetchCustomerProfile } from "@/features/customers/customer-profile-service";
const customer = "customer-1",
  other = "customer-2",
  unit = "unit-1";
const booking = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  customer_id: customer,
  guest_customer_id: null,
  booking_agent_id: null,
  unit_id: unit,
  check_in: "2026-10-01",
  check_out: "2026-10-20",
  ...patch,
});
const financial = (
  id: string,
  source_id: string | null,
  source_type = "daily_booking",
  customer_id: string | null = customer,
) => ({
  id,
  source_id,
  source_type,
  customer_id,
  due_date: "2026-10-01",
  payment_date: "2026-10-01",
  amount_xof: 100,
  paid_amount_xof: 0,
  amount: 100,
  currency: "XOF",
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.requests = [];
  mock.rows = {
    customers: [{ id: customer, name: "Synthetic customer", is_blacklisted: false }],
    daily_bookings: [
      booking("guest", {
        customer_id: other,
        guest_customer_id: customer,
        booking_agent_id: other,
      }),
      booking("agent", { guest_customer_id: other, booking_agent_id: customer }),
      booking("legacy"),
      booking("mixed", { guest_customer_id: other, booking_agent_id: "contact-3" }),
      booking("both", { guest_customer_id: customer, booking_agent_id: customer }),
    ],
    lease_contracts: [],
    sale_contracts: [],
    receivables: [
      financial("r-guest", "guest"),
      financial("r-agent", "agent"),
      financial("r-legacy", "legacy"),
      financial("r-mixed", "mixed"),
      financial("r-both", "both"),
      financial("r-unlinked", null),
      financial("r-lease", "lease", "lease_contract"),
      financial("r-sale", "sale", "sale_contract"),
      financial("r-manual", null, "manual"),
    ],
    payments: [
      financial("p-guest", "guest", "daily_booking", other),
      financial("p-agent", "agent"),
      financial("p-legacy", "legacy"),
      financial("p-mixed", "mixed"),
      financial("p-both", "both"),
      financial("p-unlinked", null),
      financial("p-lease", "lease", "lease_contract"),
      financial("p-sale", "sale", "sale_contract"),
      financial("p-manual", null, "manual"),
    ],
    units: [{ id: unit, building_id: "building-1", unit_no: "101" }],
    audit_logs: [],
    attachments: [],
  };
  mock.from.mockImplementation((table: string) => {
    const filters: { key: string; value: unknown; op: string }[] = [];
    const result = () =>
      (mock.rows[table] ?? []).filter((row) =>
        filters.every((f) =>
          f.op === "in"
            ? (f.value as unknown[]).includes(row[f.key])
            : f.op === "is"
              ? row[f.key] === f.value
              : row[f.key] === f.value,
        ),
      );
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        filters.push({ key, value, op: "eq" });
        return chain;
      },
      is: (key: string, value: unknown) => {
        filters.push({ key, value, op: "is" });
        return chain;
      },
      in: (key: string, value: unknown[]) => {
        filters.push({ key, value, op: "in" });
        return chain;
      },
      order: () => chain,
      range: async (from: number, to: number) => {
        mock.requests.push({ table, filters: [...filters] });
        const rows = result();
        return { data: rows.slice(from, to + 1), count: rows.length, error: null };
      },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
    };
    return chain;
  });
});
describe("customer profile authenticated source assembly", () => {
  it("retains all explicit roles while showing mixed legacy associations in unresolved only", async () => {
    const data = await fetchCustomerProfile(customer);
    expect(data).not.toBeNull();
    expect(data!.dailyBookings.map((row) => row.id).sort()).toEqual(["both", "guest"]);
    expect(data!.agentBookings.map((row) => row.id).sort()).toEqual(["agent", "both"]);
    expect(data!.unresolvedBookings.map((row) => row.id).sort()).toEqual(["legacy", "mixed"]);
    const legacyQuery = mock.requests.find(
      (request) =>
        request.table === "daily_bookings" &&
        request.filters.some((filter) => filter.key === "customer_id"),
    );
    expect(legacyQuery?.filters).toEqual([{ key: "customer_id", value: customer, op: "eq" }]);
  });
  it("does not assign agent, unresolved or unlinked daily receivables and payments to the customer", async () => {
    const data = await fetchCustomerProfile(customer);
    expect(data!.receivables.map((row) => row.id).sort()).toEqual([
      "r-both",
      "r-guest",
      "r-lease",
      "r-manual",
      "r-sale",
    ]);
    expect(data!.payments.map((row) => row.id).sort()).toEqual([
      "p-both",
      "p-guest",
      "p-lease",
      "p-manual",
      "p-sale",
    ]);
    // The explicit guest receives its own order's payment even when legacy financial customer_id is the agent.
    expect(data!.payments.find((row) => row.id === "p-guest")?.customer_id).toBe(other);
  });
  it("keeps unknown relationship business IDs and financial facts available to original audit/attachment reads", async () => {
    await fetchCustomerProfile(customer);
    const audit = mock.requests.find((request) => request.table === "audit_logs");
    const ids = audit?.filters.find((filter) => filter.key === "entity_id")?.value as string[];
    expect(ids).toEqual(
      expect.arrayContaining(["legacy", "mixed", "r-legacy", "r-mixed", "p-legacy", "p-mixed"]),
    );
    expect(
      mock.from.mock.calls.every((call) =>
        [
          "customers",
          "daily_bookings",
          "lease_contracts",
          "sale_contracts",
          "receivables",
          "payments",
          "units",
          "audit_logs",
          "attachments",
        ].includes(call[0]),
      ),
    ).toBe(true);
  });
  it("does not reclassify unknown financial rows as guest data when no guest relationship is visible", async () => {
    mock.rows.daily_bookings = mock.rows.daily_bookings.filter(
      (row) => row.guest_customer_id !== customer,
    );
    const data = await fetchCustomerProfile(customer);
    expect(data!.dailyBookings).toEqual([]);
    expect(data!.receivables.every((row) => row.source_type !== "daily_booking")).toBe(true);
    expect(data!.payments.every((row) => row.source_type !== "daily_booking")).toBe(true);
    expect(data!.unresolvedBookings.map((row) => row.id).sort()).toEqual(["legacy", "mixed"]);
  });
});
