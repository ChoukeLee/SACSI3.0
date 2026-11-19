import type { ApartmentPaidRequest } from "@/features/cimac/cimac-apartment-paid-model";
import {
  paidActor,
  paidBuilding,
  paidId,
  paidInput,
  paidResult,
  paidStamp,
} from "./cimac-apartment-paid";

export function combinedInput(withHold = true): ApartmentPaidRequest {
  const input = paidInput();
  input.schemaVersion = 2;
  input.rooms = input.rooms.map((r, i) => ({
    ...r,
    expectedHoldId: withHold && i === 0 ? paidId(70) : null,
    expectedHoldUpdatedAt: withHold && i === 0 ? paidStamp : null,
    propertyFeeAmountXof: 360000,
    propertyPeriodStart: input.agreementStartDate,
    propertyPeriodEnd: "2027-12-31",
  }));
  input.totalAmountXof = input.rooms.reduce(
    (sum, r) => sum + r.depositAmountXof + r.rentAmountXof + r.propertyFeeAmountXof!,
    0,
  );
  return input;
}

/** Synthetic raw public rows; no production identity, asset or receipt reference. */
export function combinedResult(withHold = true): Record<string, any> {
  const result: Record<string, any> = paidResult(),
    input = combinedInput(withHold),
    v = result.data.verification;
  result.data.request = input;
  v.receipt.total_amount_xof = input.totalAmountXof;
  v.reservations = v.reservations.map((r: Record<string, any>, i: number) => ({
    ...r,
    deposit_payment_id: paidId(100 + i * 3),
    rent_payment_id: paidId(101 + i * 3),
    property_payment_id: paidId(102 + i * 3),
    property_fee_amount_xof: 360000,
    property_period_start: input.rooms[i].propertyPeriodStart,
    property_period_end: input.rooms[i].propertyPeriodEnd,
  }));
  v.payments = input.rooms.flatMap((r, i) =>
    ["deposit", "rent", "property_fee"].map((kind, j) => ({
      id: paidId(100 + i * 3 + j),
      customer_id: result.data.customerId,
      unit_id: r.unitId,
      source_id: v.reservations[i].id,
      source_type: `cimac_apartment_${kind}`,
      payment_date: input.paymentDate,
      amount:
        kind === "deposit"
          ? r.depositAmountXof
          : kind === "rent"
            ? r.rentAmountXof
            : r.propertyFeeAmountXof,
      currency: "XOF",
      native_settlement: false,
      exchange_rate_to_xof: 1,
      payment_method: input.paymentMethod,
      request_id: i === 0 && j === 0 ? input.requestId : paidId(300 + i * 3 + j),
      request_kind: "cimac_apartment_paid",
      external_receipt_no: input.externalReceiptNo,
      receipt_no: `WB-CIMAC-B17-L-${201 + i}-${input.paymentDate.replaceAll("-", "")}-${kind === "deposit" ? "DEP" : kind === "rent" ? "RENT" : "PROP"}-01`,
      recorded_by: paidActor,
    })),
  );
  v.ledger = v.payments.map((p: Record<string, any>, i: number) => ({
    id: paidId(200 + i),
    building_id: paidBuilding,
    unit_id: p.unit_id,
    payment_id: p.id,
    entry_date: p.payment_date,
    direction: i % 3 === 0 ? "liability_in" : "income",
    category: i % 3 === 0 ? "lease_deposit" : i % 3 === 1 ? "lease_rent" : "property_fee",
    amount_xof: p.amount,
    currency: "XOF",
    amount_native: null,
    amount_cny: null,
  }));
  v.profiles = v.profiles.map((p: Record<string, any>) => ({
    ...p,
    monthly_property_fee_xof: 30000,
  }));
  result.data.paymentIds = v.payments.map((p: Record<string, any>) => p.id);
  result.data.ledgerIds = v.ledger.map((p: Record<string, any>) => p.id);
  const active = {
    id: paidId(70),
    unit_id: input.rooms[0].unitId,
    building_id: paidBuilding,
    reserver_name: "Synthetic previous holder",
    status: "reserved",
    payment_status: "unpaid",
    created_by: paidId(80),
    updated_by: paidId(80),
    created_at: "2026-10-01T00:00:00Z",
    updated_at: paidStamp,
    cancelled_at: null,
    last_reason: "Synthetic original hold",
  };
  const history = {
    ...active,
    id: paidId(71),
    status: "cancelled",
    updated_at: "2026-10-02T00:00:00Z",
    cancelled_at: "2026-10-02T00:00:00Z",
    last_reason: "Synthetic earlier cancellation",
  };
  v.unpaidReservationsBefore = withHold ? [history, active] : [history];
  v.unpaidReservations = withHold
    ? [
        structuredClone(history),
        {
          ...active,
          status: "cancelled",
          updated_at: "2026-11-19T12:00:00.123457Z",
          cancelled_at: "2026-11-19T12:00:00.123456Z",
          updated_by: paidActor,
          last_reason: input.reason,
        },
      ]
    : [structuredClone(history)];
  return result;
}
