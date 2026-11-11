import { beforeEach, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import type { FinanceActualCashSnapshot } from "@/features/finance/finance-actual-cash-model";
import type { UnifiedLeaseCollectionRow } from "@/features/leases/unified-lease-collections-model";

const mocks = vi.hoisted(() => ({ collections: vi.fn(), cash: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/finance/finance-actual-cash-server", () => ({
  getFinanceActualCash: mocks.cash,
}));
vi.mock("@/features/leases/unified-lease-collections-page", () => ({
  loadUnifiedLeaseCollections: mocks.collections,
}));

import { loadRentalHomeData, rentalHomeMonth } from "@/features/management/rental-first-data";

const projectId = "11111111-1111-4111-8111-111111111111";
const viewerId = "22222222-2222-4222-8222-222222222222";
const params = { projectId, viewerId, locale: "fr" as const, today: "2026-11-11" };
const rows: UnifiedLeaseCollectionRow[] = [
  {
    id: "apartment:lease-id",
    category: "apartment",
    name: "103",
    group: "11#公寓",
    tenant: "SERHAN",
    keywords: [],
    href: "/fr/leases?contract=lease-id",
    status: "overdue",
    statusLabel: "5 jours de retard",
    dueDate: "2026-11-06",
    paidThrough: "2026-11-05",
    amount: "65 万西法",
    amountLabel: "Solde en retard",
  },
];
const collections = {
  rows,
  unavailable: { apartments: false, operatingAssets: true },
};
const actual: FinanceActualCashSnapshot = {
  projectId,
  dateFrom: "2026-11-01",
  dateTo: "2026-11-11",
  rows: [],
  incomeXof: 900000,
  expenseXof: 2620000,
  rentIncomeXof: 650000,
  rentReceiptCount: 3,
  expenseReceiptCount: 2,
  depositInXof: 1300000,
  depositOutXof: 0,
  nativeTotals: [
    { currency: "XOF", incoming: 900000, outgoing: 2620000 },
    { currency: "CNY", incoming: 32515, outgoing: 30 },
    { currency: "USD", incoming: 15000, outgoing: 0 },
  ],
  unverifiedLedgerCount: 4,
  unknownBookedCount: 1,
  excludedNonCashCount: 2,
  duplicateOperatingCount: 1,
  costCoverageComplete: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.collections.mockResolvedValue(collections);
  mocks.cash.mockResolvedValue(actual);
});

it("passes the verified project, viewer, locale and independent cash period to each read", async () => {
  const result = await loadRentalHomeData(params);
  expect(mocks.collections).toHaveBeenCalledExactlyOnceWith({
    project: projectId,
    viewerId,
    locale: "fr",
  });
  expect(mocks.cash).toHaveBeenCalledExactlyOnceWith({
    projectId,
    dateFrom: "2026-11-01",
    dateTo: "2026-11-11",
  });
  expect(result.rows).toEqual(rows);
  expect(result.unavailable).toEqual(collections.unavailable);
  expect(result.month).toBe("2026-11");
});

it("maps rent-specific receipt counts and each original currency without including deposits in rent", async () => {
  const result = await loadRentalHomeData(params);
  expect(result.cash).toEqual({
    rentIncomeXof: 650000,
    expenseXof: 2620000,
    rentCount: 3,
    expenseCount: 2,
    unverifiedLedgerCount: 4,
    unknownBookedCount: 1,
    costCoverageComplete: false,
    originals: [
      { currency: "XOF", income: 900000, expense: 2620000 },
      { currency: "CNY", income: 32515, expense: 30 },
      { currency: "USD", income: 15000, expense: 0 },
    ],
  });
  expect(result.cash?.rentIncomeXof).not.toBe(actual.incomeXof + actual.depositInXof);
});

it("keeps successful cash facts when collection reads fail without making a complete empty rental view", async () => {
  mocks.collections.mockRejectedValue(new Error("private-query-host: collection timeout"));
  const result = await loadRentalHomeData(params);
  expect(mocks.cash).toHaveBeenCalledOnce();
  expect(result.cash?.rentIncomeXof).toBe(actual.rentIncomeXof);
  expect(result.cash?.originals).toHaveLength(3);
  expect(result.rows).toEqual([]);
  expect(result.unavailable).toEqual({ apartments: true, operatingAssets: true });
  expect(JSON.stringify(result)).not.toContain("private-query-host");
});

it("keeps available collections when the cash read fails and returns null instead of zero amounts", async () => {
  mocks.cash.mockRejectedValue(new Error("cash unavailable"));
  const result = await loadRentalHomeData(params);
  expect(mocks.collections).toHaveBeenCalledOnce();
  expect(result.rows).toEqual(rows);
  expect(result.unavailable).toEqual(collections.unavailable);
  expect(result.cash).toBeNull();
});

it("starts both independent reads before waiting for either result", async () => {
  let finishCollections!: (value: typeof collections) => void;
  let finishCash!: (value: FinanceActualCashSnapshot) => void;
  mocks.collections.mockReturnValue(
    new Promise<typeof collections>((resolve) => {
      finishCollections = resolve;
    }),
  );
  mocks.cash.mockReturnValue(
    new Promise<FinanceActualCashSnapshot>((resolve) => {
      finishCash = resolve;
    }),
  );
  const pending = loadRentalHomeData(params);
  expect(mocks.collections).toHaveBeenCalledOnce();
  expect(mocks.cash).toHaveBeenCalledOnce();
  finishCash(actual);
  finishCollections(collections);
  expect((await pending).cash?.rentCount).toBe(3);
});

it.each([
  undefined,
  null,
  "",
  "2026-1",
  "2026-00",
  "2026-13",
  "1999-12",
  "2101-01",
  "2026-12",
  "2028-02",
  "2026-11-01",
  ["2026-11"],
  202611,
])("falls back to the current month for invalid month input %j", (month) => {
  expect(rentalHomeMonth(month, params.today)).toBe("2026-11");
});

it.each([
  ["2024-02", "2024-02-29", params.today],
  ["2000-02", "2000-02-29", params.today],
  ["2100-02", "2100-02-28", "2100-03-11"],
  ["2026-04", "2026-04-30", params.today],
  ["2025-12", "2025-12-31", params.today],
])(
  "uses the calendar boundary for %s without changing rental due dates",
  async (month, end, asOf) => {
    const result = await loadRentalHomeData({ ...params, today: asOf, requestedMonth: month });
    expect(result.month).toBe(month);
    expect(mocks.cash).toHaveBeenCalledExactlyOnceWith({
      projectId,
      dateFrom: `${month}-01`,
      dateTo: end,
    });
    expect(result.rows[0].dueDate).toBe("2026-11-06");
  },
);

it("falls back from a future requested period and caps current-month cash at the as-of date", async () => {
  const result = await loadRentalHomeData({ ...params, requestedMonth: "2028-02" });
  expect(result.month).toBe("2026-11");
  expect(mocks.cash).toHaveBeenCalledExactlyOnceWith({
    projectId,
    dateFrom: "2026-11-01",
    dateTo: "2026-11-11",
  });
});

it.each(["collections", "cash"] as const)(
  "rethrows framework redirects from the %s read instead of treating them as missing financial data",
  async (source) => {
    let interruption: unknown;
    try {
      redirect("/login");
    } catch (error) {
      interruption = error;
    }
    mocks[source].mockRejectedValue(interruption);
    await expect(loadRentalHomeData(params)).rejects.toBe(interruption);
    expect(mocks.collections).toHaveBeenCalledOnce();
    expect(mocks.cash).toHaveBeenCalledOnce();
  },
);
