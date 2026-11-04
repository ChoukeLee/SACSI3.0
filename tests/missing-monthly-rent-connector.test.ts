import { expect, it, vi } from "vitest";
import {
  parseMissingMonthlyRent,
  verifyMissingMonthlyRent,
  MissingMonthlyRentClient,
  // @ts-expect-error The separately distributed connector is an ESM runtime module.
} from "../operator-connector/missing-monthly-rent.mjs";
const request = {
  requestId: "2e41b048-565e-4b35-b251-bf65ddd03052",
  contractId: "aea14a16-3be0-4081-b4a6-d22951d0e99c",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  amountXof: 700000,
  paymentDate: "2026-10-02",
  paymentMethod: "cash",
  reason: "Explicit user instruction: October rent already paid in cash.",
  inputSource: "natural_language",
};
const actor = "79d31688-fb04-48f7-840f-89a88f955f3d",
  bill = "11111111-1111-4111-8111-111111111111",
  payment = "22222222-2222-4222-8222-222222222222";
const { requestId, contractId, ...input } = request;
const preparedInput = { ...input, expectedToken: "a".repeat(32) };
function result() {
  return {
    status: "completed",
    requestId,
    actorId: actor,
    contractId,
    receivableId: bill,
    ...input,
    paidThroughDate: "2026-07-31",
    input: { ...preparedInput },
    collection: { paymentIds: [payment], referenceNos: ["SYNTHETIC"] },
    currentContract: {
      id: contractId,
      unit_id: "unit",
      customer_id: "customer",
      paid_through_date: "2026-07-31",
    },
    currentReceivable: {
      id: bill,
      unit_id: "unit",
      customer_id: "customer",
      source_id: contractId,
      source_type: "lease_contract",
      category: "lease_rent",
      currency: "XOF",
      status: "paid",
      amount_xof: 700000,
      paid_amount_xof: 700000,
      service_period_start: input.periodStart,
      service_period_end: input.periodEnd,
      service_period_confirmed_by: actor,
      service_period_source: input.reason,
    },
    currentPayments: [
      {
        id: payment,
        source_id: contractId,
        unit_id: "unit",
        customer_id: "customer",
        source_type: "lease_rent",
        amount: 700000,
        currency: "XOF",
        exchange_rate_to_xof: 1,
        payment_date: input.paymentDate,
        payment_method: "cash",
        recorded_by: actor,
        reversal_of_payment_id: null,
        external_receipt_no: null,
      },
    ],
  };
}
it("accepts exact calendar-month facts without changing source provenance", () => {
  expect(parseMissingMonthlyRent(request)).toEqual(request);
  expect(parseMissingMonthlyRent({ ...request, inputSource: "excel_screenshot" }).inputSource).toBe(
    "excel_screenshot",
  );
  for (const patch of [
    { amountXof: 0 },
    { amountXof: NaN },
    { amountXof: 1.1 },
    { periodEnd: "2026-10-32" },
    { periodStart: "2026-10-02" },
    { currency: "USD" },
    { reason: "" },
    { inputSource: "guessed" },
    { actualCollector: "guessed" },
  ])
    expect(() => parseMissingMonthlyRent({ ...request, ...patch })).toThrow();
});
it("verifies read-back facts and tolerates JSON object key ordering", () => {
  const s = result();
  s.input = Object.fromEntries(Object.entries(s.input).reverse()) as typeof preparedInput;
  expect(verifyMissingMonthlyRent(s, request, preparedInput, actor)).toMatchObject({
    status: "completed",
    verified: true,
    amountXof: 700000,
    paidThroughDate: "2026-07-31",
  });
});
it("rejects altered actor, money, date, method, period, coverage or payment link", () => {
  const variants = [
    () => {
      const s = result();
      s.actorId = "other";
      return s;
    },
    () => {
      const s = result();
      s.currentPayments[0].amount = 1;
      return s;
    },
    () => {
      const s = result();
      s.currentPayments[0].payment_date = "2026-11-04";
      return s;
    },
    () => {
      const s = result();
      s.currentPayments[0].payment_method = "check";
      return s;
    },
    () => {
      const s = result();
      s.currentReceivable.service_period_end = "2026-09-30";
      return s;
    },
    () => {
      const s = result();
      s.currentContract.paid_through_date = "2026-10-31";
      return s;
    },
    () => {
      const s = result();
      s.collection.paymentIds = ["different"];
      return s;
    },
    () => {
      const s = result();
      s.input.paymentMethod = "check";
      return s;
    },
  ];
  for (const change of variants)
    expect(() => verifyMissingMonthlyRent(change(), request, preparedInput, actor)).toThrow();
});
function operator() {
  return {
    capabilities: vi.fn(async () => ({ identity: { userId: actor, role: "admin" } })),
    token: vi.fn(async () => "test-token"),
    config: { supabaseUrl: "https://test.invalid", publishableKey: "test-public" },
  };
}
it("does not submit when the independent server protocol is missing or changed", async () => {
  const transport = vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: "not_found", requestId }),
  }));
  const client = new MissingMonthlyRentClient(operator(), transport);
  await expect(client.prepare(request)).rejects.toThrow("missing_rent_protocol_not_available");
  expect(transport).toHaveBeenCalledTimes(2);
  expect(
    transport.mock.calls.every((c: unknown[]) => !String(c[0]).includes("/collect_missing")),
  ).toBe(true);
});
it("never automatically replays a prior completed request", async () => {
  const transport = vi.fn(async () => ({ ok: true, json: async () => result() }));
  const client = new MissingMonthlyRentClient(operator(), transport);
  expect(await client.execute({ request, actorId: actor, input: preparedInput })).toMatchObject({
    status: "completed_previously",
    verified: true,
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
it("marks transport failures as unknown and sends only once", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "not_found", requestId }) })
    .mockRejectedValueOnce(new Error("synthetic network interruption"));
  const client = new MissingMonthlyRentClient(operator(), transport);
  await expect(client.execute({ request, actorId: actor, input: preparedInput })).rejects.toThrow(
    "outcome_unknown_keep_original_request_id",
  );
  expect(transport).toHaveBeenCalledTimes(2);
});
