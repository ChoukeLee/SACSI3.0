import { describe, it, expect } from "vitest";
import {
  parseApartmentPaidRequest,
  paidAnnualEnd,
  readApartmentPaidRows,
  verifyApartmentPaidResult,
} from "@/features/cimac/cimac-apartment-paid-model";
import {
  paidActor,
  paidBuilding,
  paidId,
  paidInput,
  paidNos,
  paidProject,
  paidResult,
} from "./fixtures/cimac-apartment-paid";
import { combinedInput, combinedResult } from "./fixtures/cimac-apartment-paid-v2";

const verify = (r: unknown, input = combinedInput()) =>
  verifyApartmentPaidResult(r, input, paidActor, paidProject, paidBuilding, paidNos());
describe("versioned apartment deposit/rent/annual-property receipts", () => {
  it("retains a single physical receipt with three exact classifications for each room", () => {
    const input = parseApartmentPaidRequest(combinedInput()),
      raw = combinedResult();
    expect(input.totalAmountXof).toBe(6330000);
    expect(raw.data.verification.payments).toHaveLength(9);
    expect(verify(raw, input)).toMatchObject({
      success: true,
      totalAmountXof: 6330000,
      roomCount: 3,
    });
    const v = raw.data.verification,
      paid = readApartmentPaidRows(
        { buildingId: paidBuilding, receipts: [v.receipt], reservations: v.reservations },
        paidProject,
        paidBuilding,
        paidNos(),
      );
    expect(paid.get(input.rooms[0].unitId)).toMatchObject({
      totalAmountXof: 2110000,
      propertyFeeAmountXof: 360000,
      propertyPeriodStart: "2027-01-01",
      propertyPeriodEnd: "2027-12-31",
    });
    expect(
      v.payments
        .filter((p: any) => p.source_type === "cimac_apartment_property_fee")
        .reduce((s: number, p: any) => s + p.amount, 0),
    ).toBe(1080000);
  });
  it("preserves the original previous holder while cancelling only the precise CAS hold", () => {
    const r = combinedResult();
    expect(r.data.verification.unpaidReservations[1].reserver_name).not.toBe(
      r.data.request.customerName,
    );
    expect(verify(r).success).toBe(true);
    expect(r.data.verification.unpaidReservationsBefore[1].status).toBe("reserved");
    expect(r.data.verification.unpaidReservations[1].status).toBe("cancelled");
  });
  it("requires an explicit unchanged history proof even when no current hold is present", () => {
    const r = combinedResult(false);
    expect(verify(r, combinedInput(false)).success).toBe(true);
    delete r.data.verification.unpaidReservationsBefore;
    expect(() => verify(r, combinedInput(false))).toThrow();
  });
  it("keeps legacy receipts at two classifications and exposes absent annual property as null, not paid zero", () => {
    const r = paidResult(),
      v = r.data.verification;
    expect(
      verifyApartmentPaidResult(r, paidInput(), paidActor, paidProject, paidBuilding, paidNos())
        .success,
    ).toBe(true);
    const read = () =>
      readApartmentPaidRows(
        { buildingId: paidBuilding, receipts: [v.receipt], reservations: v.reservations },
        paidProject,
        paidBuilding,
        paidNos(),
      );
    expect(read().get(paidInput().rooms[0].unitId)).toMatchObject({
      totalAmountXof: 1750000,
      propertyFeeAmountXof: null,
      propertyPeriodStart: null,
      propertyPeriodEnd: null,
    });
    for (const row of v.reservations as any[]) {
      row.property_fee_amount_xof = null;
      row.property_period_start = null;
      row.property_period_end = null;
      row.property_payment_id = null;
    }
    expect(read().get(paidInput().rooms[0].unitId)?.propertyFeeAmountXof).toBeNull();
  });
  it.each([
    (p: any) => {
      p.schemaVersion = 1;
    },
    (p: any) => {
      p.schemaVersion = "2";
    },
    (p: any) => {
      p.schemaVersion = null;
    },
    (p: any) => {
      p.schemaVersion = 3;
    },
    (p: any) => {
      delete p.rooms[0].propertyFeeAmountXof;
    },
    (p: any) => {
      p.rooms[0].propertyFeeAmountXof = 0;
    },
    (p: any) => {
      p.rooms[0].propertyFeeAmountXof = -1;
    },
    (p: any) => {
      p.rooms[0].propertyFeeAmountXof = "360000";
    },
    (p: any) => {
      p.rooms[0].propertyFeeAmountXof = 360000.01;
    },
    (p: any) => {
      delete p.rooms[0].propertyPeriodStart;
    },
    (p: any) => {
      p.rooms[0].propertyPeriodStart = "2027-04-01";
    },
    (p: any) => {
      p.rooms[0].propertyPeriodEnd = "2027-12-30";
    },
    (p: any) => {
      p.rooms[0].propertyPeriodEnd = "2028-01-01";
    },
    (p: any) => {
      p.rooms[0].expectedHoldId = null;
    },
    (p: any) => {
      p.rooms[0].expectedHoldUpdatedAt = null;
    },
    (p: any) => {
      p.rooms[1].expectedHoldId = p.rooms[0].expectedHoldId;
      p.rooms[1].expectedHoldUpdatedAt = p.rooms[0].expectedHoldUpdatedAt;
    },
    (p: any) => {
      p.rooms[0].expectedHoldId = [p.rooms[0].expectedHoldId];
    },
    (p: any) => {
      p.rooms[0].expectedHoldUpdatedAt = "invalid";
    },
    (p: any) => {
      p.totalAmountXof = 5250000;
    },
    (p: any) => {
      p.rooms[0].propertySource = "unapproved";
    },
  ])("rejects malformed v2 data or an incomplete receipt total %#", (change) => {
    const p = combinedInput();
    change(p);
    expect(() => parseApartmentPaidRequest(p)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
  it("does not silently upgrade a v1 request by adding money or cancelling a hold", () => {
    const p: any = paidInput();
    p.rooms[0].propertyFeeAmountXof = 360000;
    expect(() => parseApartmentPaidRequest(p)).toThrow();
    delete p.rooms[0].propertyFeeAmountXof;
    p.rooms[0].expectedHoldId = paidId(70);
    p.rooms[0].expectedHoldUpdatedAt = p.rooms[0].expectedUnitUpdatedAt;
    expect(() => parseApartmentPaidRequest(p)).toThrow();
  });
  it.each([
    (r: any) => {
      r.data.verification.reservations[0].property_fee_amount_xof = 359999;
    },
    (r: any) => {
      r.data.verification.reservations[0].property_period_start = "2027-04-01";
    },
    (r: any) => {
      r.data.verification.reservations[0].property_period_end = "2028-03-31";
    },
    (r: any) => {
      r.data.verification.reservations[0].property_payment_id =
        r.data.verification.reservations[0].deposit_payment_id;
    },
    (r: any) => {
      r.data.verification.profiles[0].monthly_property_fee_xof = 30001;
    },
    (r: any) => {
      r.data.verification.profiles[0].monthly_property_fee_xof = [30000];
    },
    (r: any) => {
      r.data.verification.payments[2].amount = 1;
    },
    (r: any) => {
      r.data.verification.payments[2].source_type = "property_fee";
    },
    (r: any) => {
      r.data.verification.payments[2].receipt_no =
        r.data.verification.payments[2].receipt_no.replace("PROP", "RENT");
    },
    (r: any) => {
      r.data.verification.ledger[2].direction = "liability_in";
    },
    (r: any) => {
      r.data.verification.ledger[2].category = "lease_rent";
    },
    (r: any) => {
      r.data.verification.ledger[2].amount_xof = 360001;
    },
    (r: any) => {
      r.data.verification.payments.pop();
    },
    (r: any) => {
      delete r.data.verification.unpaidReservationsBefore;
    },
    (r: any) => {
      r.data.verification.unpaidReservationsBefore[1].updated_at =
        "2026-11-01T00:00:00.123457+00:00";
    },
    (r: any) => {
      r.data.verification.unpaidReservations[1].reserver_name = "Changed original holder";
    },
    (r: any) => {
      r.data.verification.unpaidReservations[1].created_by = paidActor;
    },
    (r: any) => {
      r.data.verification.unpaidReservations[1].created_at = "2026-10-02T00:00:00Z";
    },
    (r: any) => {
      r.data.verification.unpaidReservations[1].updated_by = paidId(999);
    },
    (r: any) => {
      r.data.verification.unpaidReservations[1].status = "reserved";
      r.data.verification.unpaidReservations[1].cancelled_at = null;
    },
    (r: any) => {
      r.data.verification.unpaidReservations[1].last_reason = "Unrequested cancellation";
    },
    (r: any) => {
      r.data.verification.unpaidReservations[1].cancelled_at = "invalid";
    },
    (r: any) => {
      r.data.verification.unpaidReservations[1].updated_at = "2026-10-01T00:00:00Z";
    },
    (r: any) => {
      r.data.verification.unpaidReservations[0].last_reason = "Changed unrelated history";
    },
    (r: any) => {
      r.data.verification.unpaidReservationsBefore.pop();
    },
    (r: any) => {
      r.data.verification.unpaidReservations.pop();
    },
    (r: any) => {
      r.data.verification.unpaidReservations.push({
        ...r.data.verification.unpaidReservations[0],
        id: paidId(999),
      });
    },
  ])(
    "keeps post-write evidence unverified when a classification or hold fact is altered %#",
    (change) => {
      const r = combinedResult();
      change(r);
      expect(() => verify(r)).toThrowError(expect.objectContaining({ status: 503 }));
    },
  );
  it("compares CAS instants across timezone spellings without discarding microseconds", () => {
    const r = combinedResult(),
      p = combinedInput();
    p.rooms[0].expectedHoldUpdatedAt = "2026-11-01T01:00:00.123456+01:00";
    r.data.request = p;
    expect(verify(r, p).success).toBe(true);
  });
  it("keeps explicitly confirmed annual property independent of the contract total-end rule", () => {
    const p = combinedInput();
    p.agreementEndDate = "2027-03-31";
    expect(parseApartmentPaidRequest(p).agreementEndDate).toBe("2027-03-31");
    expect(paidAnnualEnd("2028-02-01")).toBe("2029-01-31");
  });
});
