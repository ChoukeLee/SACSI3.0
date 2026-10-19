import { expect, it } from "vitest";
import { parseLeaseRentPeriodInput } from "@/features/leases/lease-rent-period-model";
const input = {
  expectedToken: "a".repeat(32),
  paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  receivableId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  paidThroughDate: "2026-06-30",
  reason: "Explicit user confirmation",
};
it("accepts only explicit period/identity fields and a real calendar date", () => {
  expect(parseLeaseRentPeriodInput(input)).toEqual(input);
  for (const patch of [
    { paidThroughDate: "2026-06-31" },
    { reason: "" },
    { amountXof: 1 },
    { paymentId: "" },
    { expectedToken: "invalid" },
  ]) {
    expect(() => parseLeaseRentPeriodInput({ ...input, ...patch })).toThrow(
      "invalidLeasePeriodCorrection",
    );
  }
});
