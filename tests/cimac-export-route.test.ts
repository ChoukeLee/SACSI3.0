import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  project: vi.fn(),
  from: vi.fn(),
  related: vi.fn(),
  selected: vi.fn(),
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getCurrentUser: mocks.user,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: mocks.from, rpc: mocks.rpc })),
}));

import { GET } from "@/app/api/finance/cimac-export/route";
import { CIMAC_PROJECT_ID } from "@/features/finance/cimac-export-model";

const buildingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const unitId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const paymentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const entryId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const entry = {
  id: entryId,
  building_id: buildingId,
  unit_id: unitId,
  payment_id: paymentId,
  entry_date: "2026-10-19",
  direction: "liability_in",
  category: "lease_deposit",
  amount_xof: 1000,
  amount_cny: 10,
};
const payment = {
  id: paymentId,
  unit_id: unitId,
  amount: 10,
  currency: "CNY",
  exchange_rate_to_xof: 100,
  source_type: "lease_deposit",
  source_id: entryId,
  receipt_no: "CIMAC-TEST-RECEIPT",
  external_receipt_no: null,
  reversal_of_payment_id: null,
  payment_date: "2026-10-19",
  payment_method: null,
};
const unit = { id: unitId, unit_no: "601", building_id: buildingId };
const building = { id: buildingId, project_id: CIMAC_PROJECT_ID, display_name: "Synthetic CIMAC" };
const result = (rows: unknown[] = [entry]) => ({ kind: "ledger", total: rows.length, rows });
const receivableId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const confirmedBy = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const receivable = {
  id: receivableId,
  building_id: buildingId,
  unit_id: unitId,
  source_type: "property_fee",
  source_id: entryId,
  category: "property_fee",
  due_date: "2026-10-19",
  amount_xof: 1000,
  paid_amount_xof: 400,
  status: "partial",
  management_status: "managed",
  service_period_start: "2027-04-01",
  service_period_end: "2028-03-31",
  service_period_source: "DO_NOT_EXPORT_PERIOD_SOURCE",
  service_period_confirmed_by: confirmedBy,
};
const receivableResult = (rows: unknown[] = [receivable]) => ({
  kind: "receivables",
  total: rows.length,
  rows,
});
const newViews = ["deposits", "refunds", "property-fee-payments", "property-fee-receivables"];
const syntheticId = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function cashFixture() {
  const payments = [
    {
      ...payment,
      id: syntheticId(1),
      receipt_no: "EXPORT-DEPOSIT-ORIGINAL",
      payment_method: "cash",
    },
    {
      ...payment,
      id: syntheticId(2),
      source_type: "lease_deposit_refund",
      receipt_no: "EXPORT-REFUND-ACTUAL",
      payment_method: "bank_transfer",
    },
    {
      ...payment,
      id: syntheticId(3),
      source_type: "lease_deposit_deduction",
      receipt_no: "EXPORT-DEDUCTION-OFFSET",
      payment_method: "offset",
    },
    {
      ...payment,
      id: syntheticId(4),
      source_type: "lease_rent",
      receipt_no: "EXPORT-RENT-ONLY",
      payment_method: "cash",
    },
    {
      ...payment,
      id: syntheticId(5),
      source_type: "property_fee",
      receipt_no: "EXPORT-PROPERTY-FEE-ONLY",
      payment_method: "cash",
    },
  ];
  const entries = [
    { ...entry, id: syntheticId(11), payment_id: payments[0].id },
    { ...entry, id: syntheticId(12), payment_id: payments[1].id, direction: "liability_out" },
    { ...entry, id: syntheticId(13), payment_id: payments[2].id, direction: "liability_out" },
    {
      ...entry,
      id: syntheticId(14),
      payment_id: payments[2].id,
      direction: "income",
      category: "other_income",
    },
    {
      ...entry,
      id: syntheticId(15),
      payment_id: payments[3].id,
      direction: "income",
      category: "lease_rent",
    },
    {
      ...entry,
      id: syntheticId(16),
      payment_id: payments[4].id,
      direction: "income",
      category: "property_fee",
    },
  ];
  mocks.rpc.mockResolvedValue({ data: result(entries), error: null });
  mocks.related.mockImplementation(async (table: string, keys: string[]) => ({
    data: ({ payments, units: [unit], buildings: [building] }[table] || []).filter((row) =>
      keys.includes(row.id),
    ),
    error: null,
  }));
  return { entries, payments };
}
const request = (query = "") =>
  new Request(`https://sacsi.example/api/finance/cimac-export${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.user.mockResolvedValue({ id: entryId, role: "admin" });
  mocks.project.mockResolvedValue({ data: { id: CIMAC_PROJECT_ID, code: "CIMAC" }, error: null });
  mocks.rpc.mockResolvedValue({ data: result(), error: null });
  mocks.related.mockImplementation(async (table: string, keys: string[]) => ({
    data: ({ payments: [payment], units: [unit], buildings: [building] }[table] || []).filter(
      (row) => keys.includes(row.id),
    ),
    error: null,
  }));
  mocks.from.mockImplementation((table: string) => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mocks.project,
      in: vi.fn(async (_key: string, keys: string[]) => mocks.related(table, keys)),
    };
    builder.select.mockImplementation((columns: string) => {
      mocks.selected(table, columns);
      return builder;
    });
    return builder;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CIMAC dedicated finance export", () => {
  it("reads explicit native settlement facts and exports unvalued CNY without an FX fallback", async () => {
    const nativeEntry = {
      ...entry,
      amount_xof: 0,
      amount_cny: null,
      currency: "CNY",
      amount_native: 2000,
    };
    const nativePayment = {
      ...payment,
      amount: 2000,
      native_settlement: true,
      exchange_rate_to_xof: null,
      payment_method: "bank_transfer",
    };
    mocks.rpc.mockResolvedValue({ data: result([nativeEntry]), error: null });
    mocks.related.mockImplementation(async (table: string, keys: string[]) => ({
      data: (
        { payments: [nativePayment], units: [unit], buildings: [building] }[table] || []
      ).filter((row) => keys.includes(row.id)),
      error: null,
    }));
    const response = await GET(request("?view=deposits"));
    expect(response.status).toBe(200);
    expect(mocks.selected.mock.calls.find(([table]) => table === "payments")?.[1]).toContain(
      "native_settlement",
    );
    const csv = await response.text();
    expect(csv).toContain("未折算；不计入XOF合计");
    expect(csv).toContain('"2000","CNY",""');
  });
  it("rejects anonymous and operations roles before any query", async () => {
    for (const user of [null, { role: "front_desk" }, { role: "rental_sales" }]) {
      mocks.user.mockResolvedValue(user);
      expect((await GET(request())).status).toBe(403);
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["admin", "boss", "finance"])("allows %s only within fixed CIMAC scope", async (role) => {
    mocks.user.mockResolvedValue({ role });
    const response = await GET(request("?view=payments&dateFrom=2026-10-01&dateTo=2026-10-19"));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("finance_read_rpc", {
      p_kind: "ledger",
      p_filters: { projectId: CIMAC_PROJECT_ID, dateFrom: "2026-10-01", dateTo: "2026-10-19" },
      p_page: 1,
      p_export: true,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain("cimac-payments-2026-10-19.csv");
    expect(await response.text()).toContain("CIMAC-TEST-RECEIPT");
  });

  it.each([
    "?projectId=other",
    "?view=ledger&view=payments",
    "?view=unknown",
    "?locale=en",
    "?dateFrom=2026-02-30",
    "?dateFrom=2026-11-01&dateTo=2026-10-19",
    "?dateFrom=",
    "?ignored=1",
  ])("rejects ambiguous input %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not fall back when CIMAC is invisible", async () => {
    mocks.project.mockResolvedValue({ data: null, error: null });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not expose private database errors", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private SQL and financial details" },
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private SQL");
    expect(console.error).toHaveBeenCalledWith("cimac-export-unavailable");
  });

  it.each([
    ["42501", "permission", 403],
    ["", "exportTooLarge", 413],
  ])("preserves read error status %s", async (code, message, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
    expect((await GET(request())).status).toBe(status);
  });

  it("rejects partial or duplicate RPC rows before supplementing", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), total: 2 }, error: null });
    expect((await GET(request())).status).toBe(503);
    expect(mocks.related).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: result([entry, entry]), error: null });
    expect((await GET(request())).status).toBe(503);
  });

  it.each([{ rows: [] }, { rows: [payment, payment] }])(
    "rejects incomplete or duplicate payment references",
    async ({ rows }) => {
      mocks.related.mockResolvedValue({ data: rows, error: null });
      expect((await GET(request())).status).toBe(503);
    },
  );

  it("never enlarges scope to a payment's other-project unit", async () => {
    mocks.related.mockImplementation(async (table: string) => ({
      data:
        table === "payments"
          ? [payment]
          : table === "units"
            ? [unit]
            : [{ ...building, project_id: entryId }],
      error: null,
    }));
    expect((await GET(request())).status).toBe(503);
  });

  it("retains ledger-only records without inferring currency or payments", async () => {
    mocks.rpc.mockResolvedValue({ data: result([{ ...entry, payment_id: null }]), error: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(entryId);
    expect(mocks.related.mock.calls.some(([table]) => table === "payments")).toBe(false);
  });

  it("includes no unrelated fields even if a backend row contains them", async () => {
    mocks.rpc.mockResolvedValue({
      data: result([{ ...entry, notes: "DO_NOT_EXPORT_NOTES", phone: "DO_NOT_EXPORT_PHONE" }]),
      error: null,
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("DO_NOT_EXPORT");
  });

  it("limits the actual UTF-8 response bytes, not just character count", async () => {
    mocks.related.mockImplementation(async (table: string) => ({
      data:
        table === "payments"
          ? [{ ...payment, external_receipt_no: "中".repeat(1_400_000) }]
          : table === "units"
            ? [unit]
            : [building],
      error: null,
    }));
    const response = await GET(request("?view=payments"));
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.text()).toBe("Export unavailable");
  });

  it("handles an authorized empty result without issuing broad reference reads", async () => {
    mocks.rpc.mockResolvedValue({ data: result([]), error: null });
    expect((await GET(request())).status).toBe(200);
    expect(mocks.related).not.toHaveBeenCalled();
  });

  it("batches more than 100 references and checks every returned id", async () => {
    const entries = Array.from({ length: 120 }, (_, i) => ({
      ...entry,
      id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
      payment_id: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, "0")}`,
    }));
    mocks.rpc.mockResolvedValue({ data: result(entries), error: null });
    mocks.related.mockImplementation(async (table: string, keys: string[]) => ({
      data:
        table === "payments"
          ? keys.map((id) => ({ ...payment, id }))
          : table === "units"
            ? [unit]
            : [building],
      error: null,
    }));
    expect((await GET(request("?view=payments"))).status).toBe(200);
    const chunks = mocks.related.mock.calls
      .filter(([table]) => table === "payments")
      .map(([, keys]) => keys.length);
    expect(chunks).toEqual([100, 20]);
  });
});

describe("CIMAC specialized finance exports", () => {
  it.each(newViews)("rejects unauthorized users before reading %s", async (view) => {
    for (const user of [null, { role: "front_desk" }, { role: "rental_sales" }]) {
      mocks.user.mockResolvedValue(user);
      expect((await GET(request(`?view=${view}`))).status).toBe(403);
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(newViews)("does not fall back to another project for %s", async (view) => {
    mocks.project.mockResolvedValue({ data: null, error: null });
    expect((await GET(request(`?view=${view}`))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["admin", "boss", "finance"])(
    "uses the complete authorized ledger for cash views as %s",
    async (role) => {
      mocks.user.mockResolvedValue({ role });
      cashFixture();
      for (const view of newViews.slice(0, 3)) {
        mocks.rpc.mockClear();
        const response = await GET(request(`?view=${view}&dateFrom=2026-10-01&dateTo=2026-10-19`));
        expect(response.status).toBe(200);
        expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("finance_read_rpc", {
          p_kind: "ledger",
          p_filters: { projectId: CIMAC_PROJECT_ID, dateFrom: "2026-10-01", dateTo: "2026-10-19" },
          p_page: 1,
          p_export: true,
        });
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("content-disposition")).toContain(
          `cimac-${view}-2026-10-19.csv`,
        );
      }
      const columns = mocks.selected.mock.calls.find(([table]) => table === "payments")?.[1];
      expect(String(columns).split(",")).toContain("payment_method");
    },
  );

  it.each(newViews)("rejects user-controlled scope and ambiguous dates for %s", async (view) => {
    for (const suffix of [
      "&projectId=other",
      "&category=lease_rent",
      "&management=managed",
      "&status=paid",
      "&view=payments",
      "&dateFrom=2026-10-01T00%3A00%3A00Z",
      "&dateTo=2026-02-30",
      "&dateFrom=2026-10-20&dateTo=2026-10-19",
    ]) {
      expect((await GET(request(`?view=${view}${suffix}`))).status).toBe(400);
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("exports original deposits, actual refunds and offsets without mixing rent or property fees", async () => {
    cashFixture();
    const response = await GET(request("?view=deposits"));
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const receipt of [
      "EXPORT-DEPOSIT-ORIGINAL",
      "EXPORT-REFUND-ACTUAL",
      "EXPORT-DEDUCTION-OFFSET",
    ])
      expect(text).toContain(receipt);
    expect(text).not.toContain("EXPORT-RENT-ONLY");
    expect(text).not.toContain("EXPORT-PROPERTY-FEE-ONLY");
    expect(text.match(/EXPORT-DEDUCTION-OFFSET/g)).toHaveLength(1);
  });

  it("exports actual refunds only, never deductions or offset income", async () => {
    cashFixture();
    const response = await GET(request("?view=refunds"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("EXPORT-REFUND-ACTUAL");
    for (const receipt of [
      "EXPORT-DEPOSIT-ORIGINAL",
      "EXPORT-DEDUCTION-OFFSET",
      "EXPORT-RENT-ONLY",
      "EXPORT-PROPERTY-FEE-ONLY",
    ])
      expect(text).not.toContain(receipt);
    expect(text.split("\r\n")).toHaveLength(2);
  });

  it("exports property-fee payments without treating rent as property fees", async () => {
    cashFixture();
    const response = await GET(request("?view=property-fee-payments"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("EXPORT-PROPERTY-FEE-ONLY");
    for (const receipt of [
      "EXPORT-DEPOSIT-ORIGINAL",
      "EXPORT-REFUND-ACTUAL",
      "EXPORT-DEDUCTION-OFFSET",
      "EXPORT-RENT-ONLY",
    ])
      expect(text).not.toContain(receipt);
    expect(text.split("\r\n")).toHaveLength(2);
  });

  it("keeps an empty property-fee payment report empty instead of substituting rent", async () => {
    expect((await GET(request("?view=property-fee-payments"))).status).toBe(200);
    const response = await GET(request("?view=property-fee-payments"));
    const text = await response.text();
    expect(text.split("\r\n")).toHaveLength(1);
    expect(text).not.toContain("CIMAC-TEST-RECEIPT");
  });

  it.each(["deposits", "refunds", "property-fee-payments"])(
    "requires the payment_method key but permits a confirmed null value for %s",
    async (view) => {
      const fixture = cashFixture();
      mocks.related.mockImplementation(async (table: string, keys: string[]) => ({
        data: (
          {
            payments: fixture.payments.map((row) =>
              row.source_type === "lease_deposit_deduction"
                ? row
                : { ...row, payment_method: null },
            ),
            units: [unit],
            buildings: [building],
          }[table] || []
        ).filter((row) => keys.includes(row.id)),
        error: null,
      }));
      expect((await GET(request(`?view=${view}`))).status).toBe(200);
      mocks.related.mockImplementation(async (table: string, keys: string[]) => ({
        data: (
          {
            payments: fixture.payments.map((row) => {
              const { payment_method: ignored, ...withoutMethod } = row;
              void ignored;
              return withoutMethod;
            }),
            units: [unit],
            buildings: [building],
          }[table] || []
        ).filter((row) => keys.includes(row.id)),
        error: null,
      }));
      expect((await GET(request(`?view=${view}`))).status).toBe(503);
    },
  );

  it("validates the full authorized bundle before filtering a cash report", async () => {
    const fixture = cashFixture();
    mocks.related.mockImplementation(async (table: string, keys: string[]) => ({
      data: (
        {
          payments: fixture.payments.map((row) =>
            row.source_type === "lease_rent" ? { ...row, currency: null } : row,
          ),
          units: [unit],
          buildings: [building],
        }[table] || []
      ).filter((row) => keys.includes(row.id)),
      error: null,
    }));
    expect((await GET(request("?view=deposits"))).status).toBe(503);
  });
});

describe("CIMAC property-fee receivable export", () => {
  beforeEach(() => {
    mocks.rpc.mockResolvedValue({ data: receivableResult(), error: null });
  });

  it.each(["admin", "boss", "finance"])(
    "reads only complete fixed-scope property-fee receivables as %s",
    async (role) => {
      mocks.user.mockResolvedValue({ role });
      const response = await GET(
        request("?view=property-fee-receivables&dateFrom=2026-10-01&dateTo=2026-10-19"),
      );
      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("finance_read_rpc", {
        p_kind: "receivables",
        p_filters: {
          projectId: CIMAC_PROJECT_ID,
          category: "property_fee",
          management: "all",
          dateFrom: "2026-10-01",
          dateTo: "2026-10-19",
        },
        p_page: 1,
        p_export: true,
      });
      expect(mocks.related.mock.calls).toEqual([
        ["units", [unitId]],
        ["buildings", [buildingId]],
      ]);
      expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain("payments");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.text()).toContain(receivableId);
    },
  );

  it("includes every management status rather than silently hiding historical or excluded rows", async () => {
    const rows = ["managed", "historical_pending", "excluded"].map((management_status, index) => ({
      ...receivable,
      id: syntheticId(30 + index),
      management_status,
    }));
    mocks.rpc.mockResolvedValue({ data: receivableResult(rows), error: null });
    const response = await GET(request("?view=property-fee-receivables"));
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const row of rows) expect(text).toContain(row.id);
  });

  it.each([
    { ...receivableResult(), total: 2 },
    receivableResult([receivable, receivable]),
    { ...receivableResult(), kind: "ledger" },
    { ...receivableResult(), total: -1 },
    { ...receivableResult(), total: "1" },
    receivableResult([{ ...receivable, category: "lease_rent" }]),
  ])(
    "rejects incomplete, duplicate or wrong-category RPC results before related reads",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect((await GET(request("?view=property-fee-receivables"))).status).toBe(503);
      expect(mocks.related).not.toHaveBeenCalled();
    },
  );

  it.each([
    "id",
    "building_id",
    "unit_id",
    "source_type",
    "source_id",
    "category",
    "due_date",
    "amount_xof",
    "paid_amount_xof",
    "status",
    "management_status",
    "service_period_start",
    "service_period_end",
    "service_period_source",
    "service_period_confirmed_by",
  ])(
    "rejects an omitted receivable field %s instead of treating it as zero or confirmed",
    async (field) => {
      const row: Record<string, unknown> = { ...receivable };
      delete row[field];
      mocks.rpc.mockResolvedValue({ data: receivableResult([row]), error: null });
      expect((await GET(request("?view=property-fee-receivables"))).status).toBe(503);
    },
  );

  it("never supplements a receivable with another project's building", async () => {
    mocks.related.mockImplementation(async (table: string) => ({
      data: table === "units" ? [unit] : [{ ...building, project_id: entryId }],
      error: null,
    }));
    expect((await GET(request("?view=property-fee-receivables"))).status).toBe(503);
  });

  it.each([{ rows: [] }, { rows: [unit, unit] }, { rows: [{ ...unit, id: entryId }] }])(
    "rejects missing, duplicate or unexpected unit supplements",
    async ({ rows }) => {
      mocks.related.mockResolvedValue({ data: rows, error: null });
      expect((await GET(request("?view=property-fee-receivables"))).status).toBe(503);
      expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain("payments");
    },
  );

  it("permits a null unit only when the receivable's building is verified within CIMAC", async () => {
    mocks.rpc.mockResolvedValue({
      data: receivableResult([{ ...receivable, unit_id: null }]),
      error: null,
    });
    const response = await GET(request("?view=property-fee-receivables"));
    expect(response.status).toBe(200);
    expect(mocks.related.mock.calls).toEqual([["buildings", [buildingId]]]);
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain("units");
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain("payments");
    expect(await response.text()).toContain(receivableId);
  });

  it("rejects a receivable without either unit or building scope", async () => {
    mocks.rpc.mockResolvedValue({
      data: receivableResult([{ ...receivable, unit_id: null, building_id: null }]),
      error: null,
    });
    expect((await GET(request("?view=property-fee-receivables"))).status).toBe(503);
  });

  it.each(["2026-09-30", "2026-10-20"])(
    "rejects out-of-range due_date %s even if the service period overlaps the filter",
    async (due_date) => {
      mocks.rpc.mockResolvedValue({
        data: receivableResult([
          {
            ...receivable,
            due_date,
            service_period_start: "2026-10-01",
            service_period_end: "2026-10-19",
          },
        ]),
        error: null,
      });
      expect(
        (await GET(request("?view=property-fee-receivables&dateFrom=2026-10-01&dateTo=2026-10-19")))
          .status,
      ).toBe(503);
    },
  );

  it("does not derive an unconfirmed service period from due_date", async () => {
    mocks.rpc.mockResolvedValue({
      data: receivableResult([
        {
          ...receivable,
          due_date: "2026-10-17",
          service_period_start: null,
          service_period_end: null,
          service_period_source: null,
          service_period_confirmed_by: null,
        },
      ]),
      error: null,
    });
    const response = await GET(request("?view=property-fee-receivables"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.match(/2026-10-17/g)).toHaveLength(1);
    expect(text).toContain("待核");
    const [headers, row] = text
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .map((line) =>
        [...line.matchAll(/"((?:""|[^"])*)"(?:,|$)/g)].map((cell) => cell[1].replaceAll('""', '"')),
      );
    expect(row[headers.indexOf("明确账期开始")]).toBe("");
    expect(row[headers.indexOf("明确账期结束")]).toBe("");
    expect(row[headers.indexOf("到期日")]).toBe("2026-10-17");
    expect(headers.some((cell) => cell.includes("2027-04-01"))).toBe(true);
    expect(text).not.toContain("2028-03-31");
  });

  it.each([
    "service_period_start",
    "service_period_end",
    "service_period_source",
    "service_period_confirmed_by",
  ])(
    "keeps a nullable service period field %s pending without inventing confirmation",
    async (field) => {
      mocks.rpc.mockResolvedValue({
        data: receivableResult([{ ...receivable, [field]: null }]),
        error: null,
      });
      const response = await GET(request("?view=property-fee-receivables"));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("待核");
    },
  );

  it.each([
    { ...receivable, due_date: "2026-02-30" },
    { ...receivable, service_period_start: "2027-02-30" },
    { ...receivable, service_period_start: "2028-04-01" },
    { ...receivable, amount_xof: null },
    { ...receivable, paid_amount_xof: null },
  ])("rejects invalid dates, reversed periods and missing amounts", async (row) => {
    mocks.rpc.mockResolvedValue({ data: receivableResult([row]), error: null });
    expect((await GET(request("?view=property-fee-receivables"))).status).toBe(503);
  });

  it("never exports customer titles, notes, service-period evidence or confirming user IDs", async () => {
    mocks.rpc.mockResolvedValue({
      data: receivableResult([
        {
          ...receivable,
          title: "DO_NOT_EXPORT_CUSTOMER_TITLE",
          notes: "DO_NOT_EXPORT_PRIVATE_NOTES",
          phone: "DO_NOT_EXPORT_PHONE",
        },
      ]),
      error: null,
    });
    const response = await GET(request("?view=property-fee-receivables"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("DO_NOT_EXPORT");
    expect(text).not.toContain(confirmedBy);
  });

  it("exports an authorized empty result as headers only, without fabricated arrears", async () => {
    mocks.rpc.mockResolvedValue({ data: receivableResult([]), error: null });
    const response = await GET(request("?view=property-fee-receivables"));
    expect(response.status).toBe(200);
    expect((await response.text()).split("\r\n")).toHaveLength(1);
    expect(mocks.related).not.toHaveBeenCalled();
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["projects"]);
  });

  it("keeps the UTF-8 byte limit for receivables and returns no partial CSV", async () => {
    mocks.related.mockImplementation(async (table: string) => ({
      data: table === "units" ? [unit] : [{ ...building, display_name: "中".repeat(1_400_000) }],
      error: null,
    }));
    const response = await GET(request("?view=property-fee-receivables"));
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.text()).toBe("Export unavailable");
  });
});
