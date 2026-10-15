import type { OperatingSnapshot } from "@/features/management/operating-snapshot";
export function operatingSnapshotFixture(): OperatingSnapshot {
  return {
    projectId: "11111111-1111-4111-8111-111111111111",
    asOf: "2026-10-15",
    monthStart: "2026-10-01",
    generatedAt: "2026-10-15T17:00:00Z",
    netCollected: 5000,
    excludedCount: 0,
    dueOutstanding: 1000,
    overdue: 800,
    upcoming: 200,
    historicalPending: 0,
    attentionCount: 3,
    assetCount: 20,
    assetAttention: 1,
    leaseCount: 8,
    renewalCount: 1,
    saleCount: 2,
    saleAttention: 1,
    dailyInHouse: 3,
    dailyNet: 500,
    businessNet: { lease: 3000, sale: 1000, asset: 500 },
    trend: Array.from({ length: 12 }, (_, index) => ({
      month: new Date(Date.UTC(2025, 10 + index, 1)).toISOString().slice(0, 7),
      net: index === 11 ? 5000 : 0,
      count: index === 11 ? 5 : 0,
      excluded: 0,
    })),
    dueItems: [
      {
        id: "due",
        date: "2026-10-01",
        title: "503 已核租金应收",
        unit: "503",
        building: "11#公寓",
        balance: 1000,
        sourceType: "lease_contract",
      },
    ],
    renewals: [{ id: "lease", unit: "503", date: "2026-11-01" }],
  };
}
