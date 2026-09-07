import { describe, expect, it } from "vitest";
import { parseReceiptRevisionInstruction } from "./receipt-revision-parser";

describe("receipt revision parser", () => {
  it("parses concise Chinese corrections with scaled amounts", () => {
    expect(parseReceiptRevisionInstruction("房号改成 503，金额改为 25 万，这笔是物业费")).toEqual({
      roomNo: "503",
      amountXof: 250_000,
      businessHint: "property_fee",
    });
  });

  it("parses dates and payment methods", () => {
    expect(parseReceiptRevisionInstruction("付款日期改为 2026-09-06，已缴至 2026-12-31，银行转账")).toEqual({
      receiptDate: "2026-09-06",
      paidThroughDate: "2026-12-31",
      paymentMethod: "bank_transfer",
    });
  });

  it("supports basic French corrections", () => {
    expect(parseReceiptRevisionInstruction("logement 905, montant 150000 XOF, charges, virement")).toEqual({
      roomNo: "905",
      amountXof: 150_000,
      businessHint: "property_fee",
      paymentMethod: "bank_transfer",
    });
  });

  it.each([
    ["金额不是25万，是26万", { amountXof: 260_000 }],
    ["实际金额为 185000 XOF", { amountXof: 185_000 }],
    ["付款人改为 Koffi，备注改为九月租金", { payerName: "Koffi", notes: "九月租金" }],
    ["date au 2026-09-07, chèque", { receiptDate: "2026-09-07", paymentMethod: "check" }],
    ["payé jusqu’au 2026-12-31, loyer", { paidThroughDate: "2026-12-31", businessHint: "rent" }],
    ["把楼栋改到11楼，房号为A-503", { buildingCode: "SACSI11", roomNo: "A-503" }],
    ["收款日期 2026-09-07，现金", { receiptDate: "2026-09-07", paymentMethod: "cash" }],
    ["immeuble 11, chambre A-503", { buildingCode: "SACSI11", roomNo: "A-503" }],
    ["montant à 225 000 XOF", { amountXof: 225_000 }],
    ["payeur: Awa Traoré; note: règlement septembre", { payerName: "Awa Traoré", notes: "règlement septembre" }],
    ["supprimer la note", { notes: null }],
  ])("covers a real bilingual revision expression: %s", (instruction, expected) => {
    expect(parseReceiptRevisionInstruction(instruction)).toEqual(expected);
  });

  it("rejects instructions without a supported field", () => {
    expect(() => parseReceiptRevisionInstruction("帮我改一下")).toThrow(/无法确定/);
  });
});
