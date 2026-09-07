import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeReceiptRevisionModelOutput } from "./receipt-revision-model";

const base = {
  buildingCode: null,
  roomNo: null,
  amountXof: null,
  receiptDate: null,
  paidThroughDate: null,
  payerName: null,
  notes: null,
  paymentMethod: null,
  businessHint: null,
  clearFields: [],
  confidence: 0.91,
};

describe("receipt revision structured model output", () => {
  it("accepts only normalized closed fields", () => {
    expect(normalizeReceiptRevisionModelOutput({ ...base, buildingCode: "sacsi 11", roomNo: "a-503", amountXof: 250000, paymentMethod: "bank_transfer" }, "deepseek")).toEqual({
      patch: { buildingCode: "SACSI11", roomNo: "A-503", amountXof: 250000, paymentMethod: "bank_transfer" },
      confidence: 0.91,
      provider: "deepseek",
    });
  });

  it("supports explicit clearing without treating null as a change", () => {
    expect(normalizeReceiptRevisionModelOutput({ ...base, clearFields: ["notes"] }, "openai")).toMatchObject({ patch: { notes: null } });
  });

  it("rejects invalid enums, dates and empty patches", () => {
    expect(normalizeReceiptRevisionModelOutput({ ...base, paymentMethod: "crypto" }, "deepseek")).toBeNull();
    expect(normalizeReceiptRevisionModelOutput({ ...base, receiptDate: "2026-02-31" }, "deepseek")).toBeNull();
    expect(normalizeReceiptRevisionModelOutput({ ...base, notes: "ok", unexpected: "ignored?" }, "deepseek")).toBeNull();
    expect(normalizeReceiptRevisionModelOutput(base, "deepseek")).toBeNull();
  });
});
