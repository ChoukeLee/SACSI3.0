import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  requests: [] as Array<{
    table: string;
    columns: string;
    filters: Array<[string, string, unknown]>;
  }>,
  projectCode: "SACSI",
  reversed: false,
  withOperations: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));
vi.mock("@/features/asset-operations/asset-operations-server", () => ({
  fetchAssetOperations: async () => ({
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    assets: mocks.withOperations
      ? [
          {
            id: "oa-bound",
            projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            unitId: "operating-unit",
            sourceKey: "bound",
            code: "B02",
            name: "B02",
            group: "孵化园库房",
            verification: "verified",
            sourceRefs: ["财务凭证"],
            monthlyRentNative: null,
            rentCurrency: null,
            costCoverageThrough: null,
            updatedAt: "2026-11-02",
          },
          {
            id: "oa-independent",
            projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            unitId: null,
            sourceKey: "independent",
            code: "LAND",
            name: "独立土地",
            group: "土地",
            verification: "verified",
            sourceRefs: ["财务凭证"],
            monthlyRentNative: null,
            rentCurrency: null,
            costCoverageThrough: null,
            updatedAt: "2026-11-02",
          },
        ]
      : [],
    entries: mocks.withOperations
      ? [
          {
            id: "op-bound",
            assetId: "oa-bound",
            kind: "income",
            category: "rent",
            amountNative: 200,
            currency: "XOF",
            cashDate: "2026-11-02",
            periodStart: null,
            periodEnd: null,
            verification: "verified",
            recognitionMethod: "unallocated",
            sourceRef: "财务凭证",
            description: "绑定楼栋的经营收款",
          },
          {
            id: "op-independent",
            assetId: "oa-independent",
            kind: "income",
            category: "rent",
            amountNative: 300,
            currency: "XOF",
            cashDate: "2026-11-02",
            periodStart: null,
            periodEnd: null,
            verification: "verified",
            recognitionMethod: "unallocated",
            sourceRef: "财务凭证",
            description: "独立场地收款",
          },
        ]
      : [],
    canWrite: false,
  }),
}));
import { getFinanceActualCash } from "@/features/finance/finance-actual-cash-server";
const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const buildingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const payment = {
  id: "p1",
  amount: 100,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  payment_date: "2026-11-02",
  source_type: "lease_rent",
  unit_id: "u1",
  payment_method: "cash",
  reversal_of_payment_id: null,
};
beforeEach(() => {
  mocks.requests = [];
  mocks.projectCode = "SACSI";
  mocks.reversed = false;
  mocks.withOperations = false;
  mocks.from.mockImplementation((table: string) => {
    const request = { table, columns: "", filters: [] as Array<[string, string, unknown]> };
    mocks.requests.push(request);
    const chain = {
      select: (columns: string) => {
        request.columns = columns;
        return chain;
      },
      eq: (key: string, value: unknown) => {
        request.filters.push(["eq", key, value]);
        return chain;
      },
      gte: (key: string, value: unknown) => {
        request.filters.push(["gte", key, value]);
        return chain;
      },
      lte: (key: string, value: unknown) => {
        request.filters.push(["lte", key, value]);
        return chain;
      },
      is: (key: string, value: unknown) => {
        request.filters.push(["is", key, value]);
        return chain;
      },
      in: (key: string, value: unknown) => {
        request.filters.push(["in", key, value]);
        return chain;
      },
      order: () => chain,
      overrideTypes: () => chain,
      single: async () => ({
        data:
          table === "buildings"
            ? { id: buildingId, project_id: projectId }
            : { id: projectId, code: mocks.projectCode },
        error: null,
      }),
      range: () => {
        let data: unknown[] = [];
        if (
          table === "ledger_entries" &&
          request.columns.includes("payment:payments!inner") &&
          request.columns.includes("building:buildings!inner") &&
          !request.columns.includes("unit:units!inner")
        )
          data = [
            {
              id: "l1",
              payment_id: "p1",
              entry_date: "2026-10-30",
              direction: "income",
              category: "lease_rent",
              amount_xof: 100,
              unit_id: "u1",
              building_id: buildingId,
              payment,
              building: { id: buildingId, project_id: projectId, display_name: "11#" },
              unit: { id: "u1", unit_no: "103", building_id: buildingId },
            },
          ];
        if (table === "payments" && mocks.reversed)
          data = [{ id: "reversal", reversal_of_payment_id: "p1" }];
        if (table === "units") data = [{ id: "operating-unit", building_id: buildingId }];
        const response = Promise.resolve({ data, error: null });
        return Object.assign(response, { overrideTypes: () => response });
      },
    };
    return chain;
  });
});
describe("project-scoped actual receipt reads", () => {
  it("keeps explicitly building-linked operating cash while excluding independent sites from a building view", async () => {
    mocks.withOperations = true;
    const result = await getFinanceActualCash({
      projectId,
      buildingId,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
    });
    expect(result.rentIncomeXof).toBe(300);
    expect(result.rows.map((row) => row.operatingAssetId)).toContain("oa-bound");
    expect(result.rows.map((row) => row.operatingAssetId)).not.toContain("oa-independent");
  });
  it("filters related payments by actual date without filtering their ledger posting date", async () => {
    const result = await getFinanceActualCash({
      projectId,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
    });
    expect(result.rentIncomeXof).toBe(100);
    expect(result.rows[0].date).toBe("2026-11-02");
    const request = mocks.requests.find(
      (row) => row.table === "ledger_entries" && row.columns.includes("payment:payments!inner"),
    )!;
    expect(request.filters).toContainEqual(["eq", "building.project_id", projectId]);
    expect(request.filters).toContainEqual(["gte", "payment.payment_date", "2026-11-01"]);
    expect(request.filters).not.toContainEqual(["gte", "entry_date", "2026-11-01"]);
    expect(
      mocks.requests
        .filter((row) => row.table === "payments")
        .every((row) =>
          row.filters.some(
            (filter) => filter[0] === "in" && filter[1] === "reversal_of_payment_id",
          ),
        ),
    ).toBe(true);
  });
  it("reads cross-month reversal identities before counting the original receipt", async () => {
    mocks.reversed = true;
    const result = await getFinanceActualCash({
      projectId,
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
    });
    expect(result.rows).toHaveLength(0);
    expect(result.unverifiedLedgerCount).toBe(1);
  });
  it("rejects a different workspace before querying its financial records", async () => {
    mocks.projectCode = "CIMAC";
    await expect(
      getFinanceActualCash({ projectId, dateFrom: "2026-11-01", dateTo: "2026-11-30" }),
    ).rejects.toThrow("ActualCashScopeUnavailable");
    expect(mocks.requests.some((row) => row.table === "ledger_entries")).toBe(false);
  });
});
