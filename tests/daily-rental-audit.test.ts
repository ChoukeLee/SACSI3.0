import { describe, expect, it } from "vitest";
import { scanDailyRentalIssues, type AuditSnapshot } from "@/features/daily-rentals/daily-rental-audit";

const bookingId = "booking-historical-1101";
const receivableId = "43346c5a-test";

function snapshot(paid: number): AuditSnapshot {
  return {
    dailyBookings: [],
    units: [{ id: "unit-1101", unit_no: "1101", status: "available" }],
    payments: [
      { id: "rent-1", source_type: "daily_booking", source_id: bookingId, amount: 400_000 },
      { id: "rent-2", source_type: "daily_booking", source_id: bookingId, amount: 360_000 },
    ],
    receivables: [{
      id: receivableId, source_type: "daily_booking", source_id: bookingId,
      unit_id: "unit-1101", amount_xof: 760_000, paid_amount_xof: paid,
    }],
    cleaningTasks: [], ledgerEntries: [], auditLogs: [],
  };
}

function paidIssues(data: AuditSnapshot) {
  return scanDailyRentalIssues(data).filter((issue) => issue.id.startsWith("dr_fin_rec_paid_"));
}

describe("daily receivable paid reconciliation", () => {
  it.each([759_999, 760_001, 759_998])("reports a mismatch at %i without changing the snapshot", (paid) => {
    const data = snapshot(paid);
    const before = structuredClone(data);
    expect(paidIssues(data)).toEqual([expect.objectContaining({
      id: "dr_fin_rec_paid_43346c5a", entityId: receivableId,
      fixable: true, repairEntityId: bookingId, relatedEntities: [bookingId],
    })]);
    expect(data).toEqual(before);
  });

  it("does not report an exactly settled receivable", () => {
    expect(paidIssues(snapshot(760_000))).toEqual([]);
  });

  it("includes reversals in the net amount", () => {
    const data = snapshot(760_000);
    data.payments.push(
      { id: "mistake", source_type: "daily_booking", source_id: bookingId, amount: 28 },
      { id: "reversal", source_type: "daily_booking", source_id: bookingId, amount: -28 },
    );
    expect(paidIssues(data)).toEqual([]);
  });

  it("excludes another business source even if its source id matches", () => {
    const data = snapshot(760_000);
    data.payments.push({ source_type: "lease_contract", source_id: bookingId, amount: 1 });
    expect(paidIssues(data)).toEqual([]);
  });

  it("does not flag another business receivable", () => {
    const data = snapshot(759_999);
    data.receivables[0].source_type = "lease_contract";
    expect(paidIssues(data)).toEqual([]);
  });
});
