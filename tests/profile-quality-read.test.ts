import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));

import { fetchCustomerProfile } from "@/features/customers/customer-profile-service";
import { fetchUnitProfile } from "@/features/units/unit-profile-service";
import { fetchDatabaseQualityIssues } from "@/features/data-quality/database-quality-service";
import { loadQualityPage } from "@/features/data-quality/quality-page-data";
import { loadUnitPageData } from "@/features/units/unit-page-data";

type Row = Record<string, unknown>;
function database(
  tables: Record<string, Row[]>,
  failedTable?: string | { table: string; sourceOnly: true },
) {
  const pages: { table: string; from: number }[] = [];
  session.client = {
    async rpc(name: string, input: { p_source: string }) {
      if (name !== "database_quality_read_rpc") throw new Error("Unexpected test RPC");
      const sourceTables: Record<string, string> = {
        findings: "system_data_quality_findings",
        units: "units",
        customers: "customers",
        dailyBookings: "daily_bookings",
        leaseContracts: "lease_contracts",
        saleContracts: "sale_contracts",
        saleSchedules: "sale_payment_schedule",
        receivables: "receivables",
        payments: "payments",
        cleaningTasks: "cleaning_tasks",
        ledgerEntries: "ledger_entries",
        auditLogs: "audit_logs",
      };
      const table = sourceTables[input.p_source];
      const rows = tables[table] ?? [];
      return {
        data: { rows, total: rows.length },
        error:
          failedTable === table
            ? { code: "57014", message: "sensitive database details must never be logged" }
            : null,
      };
    },
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let sourceRead = false;
      const orders: { key: string; ascending: boolean }[] = [];
      const result = () => ({
        data: rows,
        error:
          table === failedTable ||
          (typeof failedTable === "object" && failedTable.table === table && sourceRead)
            ? { message: "read unavailable" }
            : null,
        count: rows.length,
      });
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          if (key === "source_type") sourceRead = true;
          if (key.includes(".")) return query;
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        neq(key: string, value: unknown) {
          rows = rows.filter((row) => row[key] !== value);
          return query;
        },
        is(key: string, value: unknown) {
          rows = rows.filter((row) => (row[key] ?? null) === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          if (key === "source_type") sourceRead = true;
          if (key.includes(".")) return query;
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        order(key: string, options?: { ascending?: boolean }) {
          orders.push({ key, ascending: options?.ascending !== false });
          return query;
        },
        async maybeSingle() {
          return { ...result(), data: rows[0] ?? null };
        },
        async single() {
          return { ...result(), data: rows[0] ?? null };
        },
        async range(from: number, to: number) {
          pages.push({ table, from });
          rows.sort((a, b) => {
            for (const order of orders) {
              const comparison = String(a[order.key] ?? "").localeCompare(
                String(b[order.key] ?? ""),
              );
              if (comparison) return order.ascending ? comparison : -comparison;
            }
            return 0;
          });
          // Simulate a Data API maximum smaller than the requested page size.
          return { ...result(), data: rows.slice(from, Math.min(to + 1, from + 73)) };
        },
      };
      return query;
    },
  };
  return pages;
}

afterEach(() => vi.restoreAllMocks());

describe("complete authorized property profiles", () => {
  it("loads every guest history row and separates agent and unknown legacy relationships", async () => {
    const bookings = Array.from({ length: 1051 }, (_, index) => ({
      id: `booking-${index}`,
      guest_customer_id: "guest",
      customer_id: "agent",
      booking_agent_id: "agent",
      unit_id: "unit",
      check_in: "2026-01-01",
    }));
    const pages = database({
      customers: [{ id: "guest", name: "Guest" }],
      units: [{ id: "unit", unit_no: "101" }],
      daily_bookings: [
        ...bookings,
        {
          id: "agent-booking",
          guest_customer_id: "someone-else",
          customer_id: "guest",
          booking_agent_id: "guest",
          unit_id: "unit",
          check_in: "2026-02-01",
        },
        {
          id: "legacy",
          customer_id: "guest",
          guest_customer_id: null,
          booking_agent_id: null,
          unit_id: "unit",
          check_in: "2026-03-01",
        },
      ],
      payments: [
        {
          id: "p-guest",
          source_type: "daily_booking",
          source_id: "booking-0",
          customer_id: "agent",
          payment_date: "2026-04-01",
        },
        {
          id: "p-agent",
          source_type: "daily_booking",
          source_id: "agent-booking",
          customer_id: "guest",
          payment_date: "2026-04-01",
        },
      ],
      audit_logs: [
        {
          id: "audit-related",
          entity_id: "booking-0",
          entity_type: "daily_booking",
          created_at: "2026-04-01T00:00:00Z",
        },
        { id: "audit-unrelated", entity_id: "unrelated", created_at: "2026-04-01T00:00:00Z" },
      ],
      attachments: [
        {
          id: "proof",
          customer_id: null,
          linked_id: "p-guest",
          uploaded_at: "2026-04-01T00:00:00Z",
        },
      ],
    });
    const profile = await fetchCustomerProfile("guest");
    expect(profile?.dailyBookings).toHaveLength(1051);
    expect(profile?.agentBookings.map((row) => row.id)).toEqual(["agent-booking"]);
    expect(profile?.unresolvedBookings.map((row) => row.id)).toEqual(["legacy"]);
    expect(profile?.payments.map((row) => row.id)).toEqual(["p-guest"]);
    expect(profile?.auditLogs.map((row) => row.id)).toEqual(["audit-related"]);
    expect(profile?.attachments.map((row) => row.id)).toEqual(["proof"]);
    expect(pages.some((page) => page.table === "daily_bookings" && page.from >= 1000)).toBe(true);
  });

  it("does not turn a failed history or missing customer read into an empty profile", async () => {
    database({ customers: [{ id: "guest" }] }, "payments");
    await expect(fetchCustomerProfile("guest")).rejects.toThrow("customer payments");
    database({}, "customers");
    await expect(fetchCustomerProfile("guest")).rejects.toThrow("CustomerProfileUnavailable");
    database({});
    expect(await fetchCustomerProfile("missing")).toBeNull();
  });

  it("includes unit and related booking/payment audit events without unrelated events", async () => {
    database({
      units: [{ id: "unit", building_id: "building", unit_no: "101" }],
      buildings: [{ id: "building", display_name: "Building" }],
      unit_operational_position: [{ id: "unit", ownership: "unspecified" }],
      daily_bookings: [
        {
          id: "booking",
          unit_id: "unit",
          guest_customer_id: "guest",
          booking_agent_id: "agent",
          check_in: "2026-01-01",
        },
      ],
      customers: [{ id: "guest" }, { id: "agent" }],
      payments: [{ id: "payment", unit_id: "unit", payment_date: "2026-01-01" }],
      audit_logs: [
        { id: "a", entity_id: "booking", created_at: "2026-02-01" },
        { id: "b", entity_id: "payment", created_at: "2026-03-01" },
        { id: "c", entity_id: "other", created_at: "2026-04-01" },
      ],
    });
    const profile = await fetchUnitProfile("unit");
    expect(profile?.auditLogs.map((row) => row.id)).toEqual(["b", "a"]);
    expect(profile?.customers.map((row) => row.id)).toEqual(["agent", "guest"]);
  });

  it("loads every null-unit financial history by its exact source domain without overriding recorded units", async () => {
    const history = Array.from({ length: 1051 }, (_, index) => ({
      id: `legacy-${index}`,
      unit_id: null,
      source_type: "lease_rent",
      source_id: "same-uuid",
      payment_date: "2026-01-01",
    }));
    const direct = { id: "direct", unit_id: "unit", payment_date: "2026-04-01" };
    const pages = database({
      units: [{ id: "unit", building_id: "building", unit_no: "101" }],
      buildings: [{ id: "building", display_name: "Building" }],
      unit_operational_position: [{ id: "unit", ownership: "unspecified" }],
      daily_bookings: [{ id: "booking", unit_id: "unit", check_in: "2026-01-01" }],
      lease_contracts: [
        { id: "same-uuid", unit_id: "unit", start_date: "2026-01-01" },
        { id: "conflict", unit_id: "unit", start_date: "2026-01-01" },
        { id: "both", unit_id: "unit", start_date: "2026-01-01" },
        { id: "lease-fee", unit_id: "unit", start_date: "2026-01-01" },
      ],
      sale_contracts: [
        { id: "same-uuid", unit_id: "other-unit", signed_date: "2026-01-01" },
        { id: "conflict", unit_id: "other-unit", signed_date: "2026-01-01" },
        { id: "both", unit_id: "unit", signed_date: "2026-01-01" },
        { id: "sale-fee", unit_id: "unit", signed_date: "2026-01-01" },
      ],
      payments: [
        direct,
        direct,
        ...history,
        {
          id: "daily",
          unit_id: null,
          source_type: "daily_booking",
          source_id: "booking",
          payment_date: "2026-02-01",
        },
        {
          id: "sale",
          unit_id: null,
          source_type: "sale_other_income",
          source_id: "sale-fee",
          payment_date: "2026-02-01",
        },
        {
          id: "lease-fee",
          unit_id: null,
          source_type: "property_fee",
          source_id: "lease-fee",
          payment_date: "2026-02-01",
        },
        {
          id: "sale-fee",
          unit_id: null,
          source_type: "parking_fee",
          source_id: "sale-fee",
          payment_date: "2026-02-01",
        },
        {
          id: "both-fee",
          unit_id: null,
          source_type: "property_fee",
          source_id: "both",
          payment_date: "2026-02-01",
        },
        {
          id: "wrong-domain",
          unit_id: null,
          source_type: "sale",
          source_id: "same-uuid",
          payment_date: "2026-02-01",
        },
        {
          id: "ambiguous-fee",
          unit_id: null,
          source_type: "property_fee",
          source_id: "conflict",
          payment_date: "2026-02-01",
        },
        {
          id: "unrelated-manual",
          unit_id: null,
          source_type: "manual",
          source_id: "same-uuid",
          payment_date: "2026-02-01",
        },
        {
          id: "recorded-elsewhere",
          unit_id: "other-unit",
          source_type: "lease_rent",
          source_id: "same-uuid",
          payment_date: "2026-02-01",
        },
      ],
      receivables: [
        {
          id: "receivable",
          unit_id: null,
          building_id: "building",
          source_type: "lease_contract",
          source_id: "same-uuid",
          due_date: "2026-01-01",
        },
        {
          id: "wrong-domain",
          unit_id: null,
          building_id: "building",
          source_type: "sale_contract",
          source_id: "same-uuid",
          due_date: "2026-01-01",
        },
        {
          id: "wrong-building",
          unit_id: null,
          building_id: "other-building",
          source_type: "lease_contract",
          source_id: "same-uuid",
          due_date: "2026-01-01",
        },
        {
          id: "recorded-elsewhere",
          unit_id: "other-unit",
          building_id: "building",
          source_type: "lease_contract",
          source_id: "same-uuid",
          due_date: "2026-01-01",
        },
      ],
      audit_logs: [
        { id: "payment-audit", entity_id: "legacy-1050", created_at: "2026-03-01" },
        { id: "receivable-audit", entity_id: "receivable", created_at: "2026-02-01" },
        { id: "unrelated-audit", entity_id: "wrong-domain", created_at: "2026-02-01" },
      ],
    });
    const profile = await fetchUnitProfile("unit");
    expect(profile?.payments).toHaveLength(1057);
    expect(new Set(profile?.payments.map((row) => row.id)).size).toBe(1057);
    expect(profile?.payments.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        "direct",
        "legacy-1050",
        "daily",
        "sale",
        "lease-fee",
        "sale-fee",
        "both-fee",
      ]),
    );
    for (const id of ["wrong-domain", "ambiguous-fee", "unrelated-manual", "recorded-elsewhere"])
      expect(profile?.payments.map((row) => row.id)).not.toContain(id);
    expect(profile?.receivables.map((row) => row.id)).toEqual(["receivable"]);
    expect(profile?.auditLogs.map((row) => row.id)).toEqual(["payment-audit", "receivable-audit"]);
    expect(pages.some((page) => page.table === "payments" && page.from >= 1000)).toBe(true);
  });

  it("fails the whole asset profile when its source-linked history cannot be read", async () => {
    database(
      {
        units: [{ id: "unit", building_id: "building", unit_no: "101" }],
        buildings: [{ id: "building", display_name: "Building" }],
        unit_operational_position: [{ id: "unit", ownership: "unspecified" }],
        lease_contracts: [{ id: "lease", unit_id: "unit", start_date: "2026-01-01" }],
      },
      { table: "payments", sourceOnly: true },
    );
    await expect(fetchUnitProfile("unit")).rejects.toThrow("unit source payments");
  });
});

describe("quality read completeness", () => {
  it("reads the complete findings past 1000 in one snapshot without count/page rescans", async () => {
    const pages = database({
      system_data_quality_findings: Array.from({ length: 1051 }, (_, index) => ({
        issue_key: `finding-${index}`,
        severity: "medium",
        category: "unit",
        entity_type: "unit",
        entity_id: "unit",
        detected_at: "2026-01-01",
      })),
    });
    const issues = await fetchDatabaseQualityIssues("zh");
    expect(issues).toHaveLength(1051);
    expect(new Set(issues.map((issue) => issue.id)).size).toBe(1051);
    expect(pages).toEqual([]);
  });

  it("marks the entire scan unknown when any source fails, never healthy with zero issues", async () => {
    database({}, "system_data_quality_findings");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(fetchDatabaseQualityIssues("zh")).rejects.toThrow("database quality findings");
    expect(await loadQualityPage("zh", "admin")).toEqual({ status: "unavailable" });
    expect(console.error).toHaveBeenCalledWith("QualitySourceUnavailable", {
      source: "findings",
      code: "57014",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive database");
  });

  it("rejects truncated or malformed finding payloads instead of declaring a complete scan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const data of [
      null,
      { rows: [], total: 1 },
      { rows: [{}], total: 1 },
      {
        rows: [
          { issue_key: "unsupported", entity_type: "unit", severity: "critical", category: "unit" },
        ],
        total: 1,
      },
    ]) {
      session.client = { rpc: async () => ({ data, error: null }) };
      await expect(fetchDatabaseQualityIssues("zh")).rejects.toThrow("database quality findings");
    }
  });

  it("completes findings alone then bounds the complete raw-source reads to two concurrent requests", async () => {
    let active = 0,
      peak = 0,
      findingsComplete = false;
    const calls: string[] = [];
    session.client = {
      rpc: async (_name: string, input: { p_source: string }) => {
        calls.push(input.p_source);
        if (input.p_source !== "findings") expect(findingsComplete).toBe(true);
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => {
          setTimeout(resolve, 1);
        });
        active--;
        if (input.p_source === "findings") findingsComplete = true;
        return { data: { rows: [], total: 0 }, error: null };
      },
    };
    expect((await loadQualityPage("zh", "admin")).status).toBe("complete");
    expect(calls[0]).toBe("findings");
    expect(calls).toHaveLength(12);
    expect(new Set(calls).size).toBe(12);
    expect(peak).toBe(2);
  });

  it("marks any timed-out, malformed or truncated raw source as an unavailable whole scan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bad of [
      { data: null, error: { code: "57014", message: "private payment details" } },
      { data: { rows: [{}], total: 1 }, error: null },
      { data: { rows: [], total: 1 }, error: null },
    ]) {
      session.client = {
        rpc: async (_name: string, input: { p_source: string }) =>
          input.p_source === "payments" ? bad : { data: { rows: [], total: 0 }, error: null },
      };
      expect(await loadQualityPage("zh", "admin")).toEqual({ status: "unavailable" });
    }
    expect(console.error).toHaveBeenCalledWith("QualitySourceUnavailable", {
      source: "payments",
      code: "57014",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private payment");
  });
});

describe("asset catalogue database facts", () => {
  it("keeps current and future tenant identities distinct while retaining future business reservations", async () => {
    database({
      units: [
        {
          id: "office",
          unit_no: "4F前楼",
          code: "SACSI5-4F-FRONT",
          building_id: "building",
          building: {
            id: "building",
            code: "SACSI5",
            display_name: "5",
            project_id: "project",
            project: { code: "SACSI", display_name: "SACSI" },
          },
          lease_contracts: [
            {
              status: "active",
              start_date: "2099-11-15",
              customer: { name: "Future tenant" },
              expected_end_date: "2103-02-14",
              expected_end_confirmed: true,
            },
            {
              status: "active",
              start_date: "2000-01-01",
              customer: { name: "Current tenant" },
              expected_end_date: null,
              expected_end_confirmed: false,
            },
          ],
          sale_contracts: [],
          daily_bookings: [],
        },
      ],
      unit_operational_position: [
        { id: "office", lease_occupied: true, lease_pending: true, lease_start_date: "2099-11-15" },
      ],
    });
    const catalogue = await loadUnitPageData();
    expect(catalogue.unitPartySummaries.office).toMatchObject({
      leaseCustomerName: "Current tenant",
      leaseEndConfirmed: false,
      pendingLeaseCustomerName: "Future tenant",
      pendingLeaseEndDate: "2103-02-14",
    });
    expect(catalogue.managedLeaseUnitIds).toContain("office");
  });
  it("does not fabricate missing storefront flags or remove the recorded disabled daily flag", async () => {
    const building = {
      id: "building",
      code: "SACSI11",
      display_name: "11",
      project_id: "project",
      project: { code: "SACSI", display_name: "SACSI" },
    };
    database({
      units: [
        {
          id: "503",
          unit_no: "503",
          code: "SACSI-503",
          building_id: "building",
          building,
          unit_business_flags: [
            {
              unit_id: "503",
              business_type: "daily_rental",
              is_enabled: false,
              default_price_xof: 40000,
            },
          ],
          lease_contracts: [],
          sale_contracts: [],
          daily_bookings: [],
        },
        {
          id: "storefront",
          unit_no: "门面房",
          code: "SACSI7-STOREFRONT",
          building_id: "building",
          building,
          unit_business_flags: [],
          lease_contracts: [],
          sale_contracts: [],
          daily_bookings: [
            {
              status: "checked_in",
              check_in: "2026-01-01",
              guest_name: null,
              guest_customer: null,
              legacy_customer: { name: "Legacy booking agent" },
            },
          ],
        },
      ],
      unit_operational_position: [
        { id: "503", ownership: "sold", lease_occupied: true },
        { id: "storefront", ownership: "unspecified" },
      ],
    });
    const catalogue = await loadUnitPageData();
    expect(catalogue.businessFlagsMap["503"]).toEqual([
      {
        unit_id: "503",
        business_type: "daily_rental",
        is_enabled: false,
        default_price_xof: 40000,
      },
    ]);
    expect(catalogue.businessFlagsMap.storefront).toEqual([]);
    expect(catalogue.positionsMap["503"]).toMatchObject({
      ownership: "sold",
      lease_occupied: true,
    });
    expect(catalogue.unitPartySummaries.storefront.dailyCustomerName).toBeUndefined();
    expect(catalogue.unitPartySummaries.storefront.dailyStatus).toBe("checked_in");
  });
  it("fails closed when the operational dimensions could not be read", async () => {
    database({}, "unit_operational_position");
    await expect(loadUnitPageData()).rejects.toThrow("unit operational dimensions");
  });
});
