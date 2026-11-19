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
import { cimacApartmentPlan } from "@/features/cimac/cimac-apartment-model";

/** Exercise the real 64-room catalog, including the higher-priced two-bedroom rows. */
function catalogReceipt(count: number) {
  const raw = combinedResult(false),
    input = combinedInput(false),
    v = raw.data.verification;
  const plans = cimacApartmentPlan().slice(0, count),
    roomTemplate = input.rooms[0];
  const unitTemplate = v.units[0],
    reservationTemplate = v.reservations[0],
    paymentTemplate = v.payments[0],
    ledgerTemplate = v.ledger[0];
  input.rooms = plans.map((p, i) => ({
    ...roomTemplate,
    unitId: paidId(1000 + i),
    monthlyRentXof: p.monthlyRentXof,
    depositAmountXof: p.monthlyRentXof * 2,
    rentAmountXof: p.monthlyRentXof * 3,
    propertyFeeAmountXof: p.monthlyPropertyFeeXof * 12,
  }));
  input.totalAmountXof = input.rooms.reduce(
    (s, r) => s + r.depositAmountXof + r.rentAmountXof + r.propertyFeeAmountXof!,
    0,
  );
  raw.data.request = input;
  v.receipt.total_amount_xof = input.totalAmountXof;
  v.units = input.rooms.map((r, i) => ({
    ...unitTemplate,
    id: r.unitId,
    code: `CIMAC-B17-${plans[i].unitNo}`,
    unit_no: plans[i].unitNo,
    floor_label: `${plans[i].floor}F`,
  }));
  v.profiles = input.rooms.map((r, i) => ({
    unit_id: r.unitId,
    building_id: paidBuilding,
    floor_number: plans[i].floor,
    room_suffix: plans[i].suffix,
    bedrooms: plans[i].bedrooms,
    facing: plans[i].facing,
    monthly_rent_xof: r.monthlyRentXof,
    monthly_property_fee_xof: plans[i].monthlyPropertyFeeXof,
    deposit_months: 2,
    rent_prepay_months: 6,
    property_prepay_months: 12,
  }));
  v.reservations = input.rooms.map((r, i) => ({
    ...reservationTemplate,
    id: paidId(2000 + i),
    unit_id: r.unitId,
    monthly_rent_xof: r.monthlyRentXof,
    deposit_amount_xof: r.depositAmountXof,
    rent_amount_xof: r.rentAmountXof,
    property_fee_amount_xof: r.propertyFeeAmountXof,
    deposit_payment_id: paidId(3000 + i * 3),
    rent_payment_id: paidId(3001 + i * 3),
    property_payment_id: paidId(3002 + i * 3),
  }));
  v.payments = input.rooms.flatMap((r, i) =>
    ["deposit", "rent", "property_fee"].map((kind, j) => ({
      ...paymentTemplate,
      id: paidId(3000 + i * 3 + j),
      unit_id: r.unitId,
      source_id: v.reservations[i].id,
      source_type: `cimac_apartment_${kind}`,
      amount:
        kind === "deposit"
          ? r.depositAmountXof
          : kind === "rent"
            ? r.rentAmountXof
            : r.propertyFeeAmountXof,
      request_id: i === 0 && j === 0 ? input.requestId : paidId(5000 + i * 3 + j),
      receipt_no: `WB-CIMAC-B17-L-${plans[i].unitNo}-${input.paymentDate.replaceAll("-", "")}-${kind === "deposit" ? "DEP" : kind === "rent" ? "RENT" : "PROP"}-01`,
    })),
  );
  v.ledger = v.payments.map((p: any, i: number) => ({
    ...ledgerTemplate,
    id: paidId(4000 + i),
    unit_id: p.unit_id,
    payment_id: p.id,
    amount_xof: p.amount,
    direction: i % 3 === 0 ? "liability_in" : "income",
    category: i % 3 === 0 ? "lease_deposit" : i % 3 === 1 ? "lease_rent" : "property_fee",
  }));
  raw.data.reservationIds = v.reservations.map((r: any) => r.id);
  raw.data.paymentIds = v.payments.map((p: any) => p.id);
  raw.data.ledgerIds = v.ledger.map((l: any) => l.id);
  v.unpaidReservationsBefore = [];
  v.unpaidReservations = [];
  return { raw, input, numbers: new Map(input.rooms.map((r, i) => [r.unitId, plans[i].unitNo])) };
}

const verify = (r: unknown, input = combinedInput()) =>
  verifyApartmentPaidResult(r, input, paidActor, paidProject, paidBuilding, paidNos());
describe("versioned apartment deposit/rent/annual-property receipts", () => {
  it.each([43, 64])(
    "verifies all %s rooms with exactly three payment/ledger rows per room",
    (count) => {
      const { raw, input, numbers } = catalogReceipt(count);
      expect(parseApartmentPaidRequest(input)).toEqual(input);
      expect(raw.data.verification.payments).toHaveLength(count * 3);
      expect(raw.data.verification.ledger).toHaveLength(count * 3);
      expect(
        verifyApartmentPaidResult(raw, input, paidActor, paidProject, paidBuilding, numbers),
      ).toMatchObject({ success: true, roomCount: count, totalAmountXof: input.totalAmountXof });
      const read = readApartmentPaidRows(
        {
          buildingId: paidBuilding,
          receipts: [raw.data.verification.receipt],
          reservations: raw.data.verification.reservations,
        },
        paidProject,
        paidBuilding,
        numbers,
      );
      expect(read.size).toBe(count);
    },
  );
  it.each(["payments", "ledger"])(
    "rejects an extra %s evidence row beyond the exact 64-room split count",
    (field) => {
      const { raw, input, numbers } = catalogReceipt(64),
        evidence = raw.data.verification[field];
      evidence.push({ ...evidence[0], id: paidId(9900) });
      expect(() =>
        verifyApartmentPaidResult(raw, input, paidActor, paidProject, paidBuilding, numbers),
      ).toThrowError(expect.objectContaining({ status: 503 }));
    },
  );
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
