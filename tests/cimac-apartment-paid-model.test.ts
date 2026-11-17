import { describe, it, expect } from "vitest";
import {
  parseApartmentPaidRequest,
  paidEqual,
  paidQuarterEnd,
  readApartmentPaidRows,
  verifyApartmentPaidResult,
} from "@/features/cimac/cimac-apartment-paid-model";
import {
  paidActor,
  paidBuilding,
  paidInput,
  paidNos,
  paidProject,
  paidResult,
} from "./fixtures/cimac-apartment-paid";
const verify = (raw: unknown) =>
  verifyApartmentPaidResult(raw, paidInput(), paidActor, paidProject, paidBuilding, paidNos());
describe("independent paid B17 apartment receipt", () => {
  it("keeps a single physical receipt distinct from six deposit/rent splits and future agreement", () => {
    const input = parseApartmentPaidRequest(paidInput()),
      raw = paidResult();
    expect(input.totalAmountXof).toBe(5250000);
    expect(verify(raw)).toMatchObject({ success: true, roomCount: 3, totalAmountXof: 5250000 });
    expect(
      raw.data.verification.units.every(
        (u) => u.occupancy_verified === false && u.status === "available",
      ),
    ).toBe(true);
    expect(raw.data.verification.payments.reduce((n, p) => n + p.amount, 0)).toBe(
      input.totalAmountXof,
    );
    const paid = readApartmentPaidRows(
      {
        buildingId: paidBuilding,
        receipts: [raw.data.verification.receipt],
        reservations: raw.data.verification.reservations,
      },
      paidProject,
      paidBuilding,
      paidNos(),
    );
    expect(paid.get(input.rooms[0].unitId)).toMatchObject({
      paidPeriodEnd: "2027-03-31",
      agreementEndDate: "2028-12-31",
      totalAmountXof: 1750000,
    });
  });
  it.each([
    (r: any) => {
      r.sql = "update";
    },
    (r: any) => {
      r.customerName = "";
    },
    (r: any) => {
      r.customerName = ["A"];
    },
    (r: any) => {
      r.totalAmountXof = "5250000";
    },
    (r: any) => {
      r.totalAmountXof = 5249999;
    },
    (r: any) => {
      r.totalAmountXof += 0.1;
    },
    (r: any) => {
      r.paymentMethod = ["cash"];
    },
    (r: any) => {
      r.paymentMethod = "";
    },
    (r: any) => {
      r.currency = "CNY";
    },
    (r: any) => {
      r.rooms = null;
    },
    (r: any) => {
      r.rooms.push(r.rooms[0]);
    },
    (r: any) => {
      r.rooms[0].expectedHoldId = r.requestId;
    },
    (r: any) => {
      delete r.rooms[0].expectedHoldUpdatedAt;
    },
    (r: any) => {
      r.rooms[0].monthlyRentXof = 35;
    },
    (r: any) => {
      r.rooms[0].depositMonths = 1;
    },
    (r: any) => {
      r.rooms[0].rentAmountXof = 1;
    },
    (r: any) => {
      r.rooms[0].occupancy_verified = true;
    },
    (r: any) => {
      r.agreementStartDate = "2027-01-02";
    },
    (r: any) => {
      r.paidPeriodEnd = "2027-03-30";
    },
    (r: any) => {
      r.agreementEndDate = "2028-12-30";
    },
    (r: any) => {
      r.agreementEndDate = "2027-02-28";
    },
    (r: any) => {
      r.paymentDate = "2027-01-02";
    },
    (r: any) => {
      r.paymentDate = "2026-02-30";
    },
    (r: any) => {
      r.externalReceiptNo = "";
    },
    (r: any) => {
      r.sourceRef = " ";
    },
    (r: any) => {
      r.reason = "";
    },
  ])("rejects malformed or unauthorised request facts %#", (change) => {
    const r = paidInput();
    change(r);
    expect(() => parseApartmentPaidRequest(r)).toThrow();
  });
  it.each([
    (r: any) => {
      r.data.actorId = r.data.customerId;
    },
    (r: any) => {
      r.data.request.totalAmountXof = 1;
    },
    (r: any) => {
      r.data.requestId = r.data.customerId;
    },
    (r: any) => {
      r.data.verification.receipt.total_amount_xof = 1;
    },
    (r: any) => {
      r.data.verification.reservations[0].paid_period_end = "2027-04-30";
    },
    (r: any) => {
      r.data.verification.reservations.pop();
    },
    (r: any) => {
      r.data.verification.payments[0].amount = 700001;
    },
    (r: any) => {
      r.data.verification.payments[0].source_type = "lease_deposit";
    },
    (r: any) => {
      r.data.verification.payments[0].native_settlement = true;
    },
    (r: any) => {
      r.data.verification.payments[0].customer_id = r.data.actorId;
    },
    (r: any) => {
      r.data.verification.payments[0].receipt_no = "EXTERNAL";
    },
    (r: any) => {
      r.data.verification.ledger[0].direction = "income";
    },
    (r: any) => {
      r.data.verification.ledger[0].amount_native = 700000;
    },
    (r: any) => {
      r.data.verification.ledger[0].amount_xof = 1;
    },
    (r: any) => {
      r.data.verification.ledger[0].payment_id = r.data.paymentIds[1];
    },
    (r: any) => {
      r.data.verification.units[0].kind = "storefront";
    },
    (r: any) => {
      r.data.verification.units[0].building_id = r.data.projectId;
    },
    (r: any) => {
      r.data.verification.unpaidReservations = [
        { unit_id: r.data.request.rooms[0].unitId, status: "reserved" },
      ];
    },
    (r: any) => {
      r.data.verification.leases = [{ unit_id: r.data.request.rooms[0].unitId, status: "active" }];
    },
    (r: any) => {
      r.data.verification.dailyBookings = [
        { unit_id: r.data.request.rooms[0].unitId, status: "confirmed" },
      ];
    },
  ])("rejects a tampered raw financial or apartment proof %#", (change) => {
    const r = paidResult();
    change(r);
    expect(() => verify(r)).toThrow();
  });
  it("does not turn missing or duplicated paid read rows into empty availability", () => {
    const r = paidResult().data.verification;
    expect(() => readApartmentPaidRows(null, paidProject, paidBuilding, paidNos())).toThrow();
    expect(() =>
      readApartmentPaidRows(
        { buildingId: paidBuilding, receipts: [r.receipt], reservations: r.reservations.slice(1) },
        paidProject,
        paidBuilding,
        paidNos(),
      ),
    ).toThrow();
    expect(() =>
      readApartmentPaidRows(
        {
          buildingId: paidBuilding,
          receipts: [r.receipt],
          reservations: [...r.reservations, r.reservations[0]],
        },
        paidProject,
        paidBuilding,
        paidNos(),
      ),
    ).toThrow();
  });
  it("compares canonical requests independent of object key order", () => {
    const r = paidInput();
    expect(paidEqual(r, Object.fromEntries(Object.entries(r).reverse()))).toBe(true);
    expect(paidQuarterEnd("2027-11-01")).toBe("2028-01-31");
  });
  it("classifies malformed post-write date evidence as unknown, never as a safe pre-write rejection", () => {
    const raw = paidResult();
    raw.data.verification.reservations[0].agreement_start_date = "2027-01-02";
    raw.data.verification.reservations[0].paid_period_start = "2027-01-02";
    expect(() => verify(raw)).toThrowError(expect.objectContaining({ status: 503 }));
  });
});
