import type { ReceiptAnalysis, ReceiptLine } from "@/features/daily-rentals/receipt-analysis-types";

export function receiptLine(overrides: Partial<ReceiptLine> = {}): ReceiptLine {
  return {
    id: "example-payment-01",
    date: "2026-09-28",
    createdAt: "2026-09-28T15:30:00Z",
    bookingId: "example-booking-01",
    unitId: "example-unit-01",
    room: "11#903",
    buildingId: "example-building-11",
    buildingName: "11号楼",
    guestName: "Kouamé",
    bookingAgentName: "颖",
    receiptNo: "EX-09-001",
    paymentMethod: "bank_transfer",
    amount: 180000,
    currency: "XOF",
    amountXof: 180000,
    kind: "collection",
    exclusionReason: null,
    reversalOf: null,
    notes: "仅用于测试和设计示例，不是真实账务。",
    ...overrides,
  };
}

export function receiptAnalysis(overrides: Partial<ReceiptAnalysis> = {}): ReceiptAnalysis {
  const current = { from: "2026-09-01", to: "2026-09-30" };
  const previous = { from: "2026-08-01", to: "2026-08-31" };
  const year = { from: "2025-09-01", to: "2025-09-30" };
  return {
    rows: [
      receiptLine(),
      receiptLine({
        id: "example-payment-02",
        room: "11#1102",
        guestName: "Niamké",
        receiptNo: "EX-09-002",
        kind: "refund",
        amount: -180000,
        amountXof: -180000,
        paymentMethod: "cash",
      }),
    ],
    total: 123,
    summary: {
      gross: 6480000,
      refund: 180000,
      adjustment: -60000,
      net: 6240000,
      count: 122,
      excludedCount: 1,
    },
    previous: {
      gross: 5620000,
      refund: 120000,
      adjustment: 0,
      net: 5500000,
      count: 90,
      excludedCount: 0,
    },
    year: {
      gross: 5120000,
      refund: 120000,
      adjustment: 0,
      net: 5000000,
      count: 80,
      excludedCount: 0,
    },
    trend: Array.from({ length: 12 }, (_, index) => ({
      month: new Date(Date.UTC(2025, 9 + index, 1)).toISOString().slice(0, 7),
      gross: 4800000 + index * 150000,
      refund: 100000,
      adjustment: -10000,
      net: 4690000 + index * 150000,
      count: 90,
      excludedCount: index === 2 ? 1 : 0,
    })),
    coverage: { firstDate: "2025-01-01", lastDate: "2026-10-14" },
    buildings: [
      { id: "example-building-11", name: "11号楼", code: "SACSI11" },
      { id: "example-building-5", name: "5号楼", code: "SACSI5" },
    ],
    generatedAt: "2026-10-15T10:00:00Z",
    filters: {
      month: "2026-09",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      buildingId: "all",
      query: "",
      method: "all",
      kind: "all",
      page: 1,
    },
    periods: {
      current,
      previous,
      year,
      trend: { from: "2025-10-01", to: "2026-09-30" },
      partial: false,
      custom: false,
    },
    comparisons: {
      previous: { status: "available", amount: 740000, percent: 13.4545454545, period: previous },
      year: { status: "available", amount: 1240000, percent: 24.8, period: year },
    },
    pageSize: 50,
    ...overrides,
  };
}
