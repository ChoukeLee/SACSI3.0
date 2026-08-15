import { describe, expect, it } from "vitest";
import { parseManagementFinanceSnapshot } from "../src/features/management/finance-snapshot";

describe("management finance snapshot", () => {
  it("normalizes numeric database values and keeps building identity", () => {
    const snapshot = parseManagementFinanceSnapshot({
      month_start: "2026-07-01",
      month_end_exclusive: "2026-08-01",
      as_of: "2026-07-28",
      summary: {
        total_receivable: "650",
        total_paid: "650",
        outstanding: "0",
        overdue: "0",
        count: 2,
        collection_rate: "1",
      },
      items: [
        {
          id: "deposit",
          due_date: "2026-07-20",
          source_type: "lease_contract",
          category: "lease_deposit",
          title: "B1204 deposit",
          amount_xof: "260",
          paid_amount_xof: "260",
          outstanding_xof: "0",
          status: "paid",
          building_code: "SACSI3",
          building_name: "3#公寓",
          unit_no: "B1204",
          customer_name: "福气",
        },
        {
          id: "rent",
          due_date: "2026-07-20",
          source_type: "lease_contract",
          category: "lease_rent",
          amount_xof: "390",
          paid_amount_xof: "390",
          outstanding_xof: "0",
          status: "paid",
          building_code: "SACSI3",
          unit_no: "B1204",
        },
      ],
    });

    expect(snapshot.summary).toEqual({
      totalReceivable: 650,
      totalPaid: 650,
      monthCollected: 650,
      outstanding: 0,
      overdue: 0,
      upcoming: 0,
      count: 2,
      historicalPending: 0,
      historicalPendingCount: 0,
      collectionRate: 1,
    });
    expect(snapshot.items[0]).toMatchObject({
      unitNo: "B1204",
      buildingCode: "SACSI3",
      buildingName: "3#公寓",
      amountXof: 260,
      paidAmountXof: 260,
      outstandingXof: 0,
      status: "paid",
    });
  });

  it("fails closed to zero values and a pending status for malformed payload fields", () => {
    const snapshot = parseManagementFinanceSnapshot({
      summary: { total_receivable: "not-a-number" },
      items: [{ id: "x", status: "unknown", amount_xof: null }],
    });

    expect(snapshot.summary.totalReceivable).toBe(0);
    expect(snapshot.items[0]).toMatchObject({
      id: "x",
      amountXof: 0,
      status: "pending",
    });
  });
});
