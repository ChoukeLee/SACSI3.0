import { expect, it } from "vitest";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit-labels";
import { auditBusinessSummary, auditSearchText } from "@/features/settings/audit-business-summary";
import { auditFixture } from "./fixtures/audit-display";

it("labels pending evidence and actual customer collection as different audited facts", () => {
  expect(auditActionLabel("save", "zh")).toBe("保存资料");
  expect(auditActionLabel("collect", "zh")).toContain("实际收款");
  expect(auditEntityLabel("cimac_fee_terms", "zh")).toContain("待核");
  expect(auditEntityLabel("cimac_meter_reading", "zh")).toContain("抄表");
  expect(auditEntityLabel("cimac_customer_collection", "zh")).toContain("客户总账收款");
  for (const entity of ["cimac_fee_terms", "cimac_meter_reading", "cimac_customer_collection"])
    expect(auditEntityLabel(entity, "fr")).not.toContain("_");
});

it("keeps original receipt reference, actual refund and noncash correction distinct in audit summaries", () => {
  const refund = auditFixture({
    action: "refund",
    entity_type: "cimac_customer_refund",
    metadata: {
      original_payment_id: "ORIGINAL-001",
      reason: "实际退款原因",
      amount: 300,
      currency: "XOF",
      payment_date: "2026-10-22",
    },
  });
  expect(auditBusinessSummary(refund, "zh").summary).toBe("登记客户实际退款 300 XOF");
  expect(
    auditBusinessSummary(
      { ...refund, action: "reversal", entity_type: "cimac_customer_reversal" },
      "zh",
    ).summary,
  ).toBe("冲正客户错误收款（非现金退款） 300 XOF");
  expect(auditBusinessSummary({ ...refund, metadata: {} }, "zh").paymentAmount).toBe("—");
  expect(auditSearchText(refund, "zh")).toContain("original-001");
  expect(auditSearchText(refund, "zh")).toContain("实际退款原因");
});

it("distinguishes customer refunds from non-cash receipt reversals in both languages", () => {
  expect(auditActionLabel("refund", "zh")).toBe("登记实际退款");
  expect(auditActionLabel("reversal", "zh")).toContain("非退款");
  expect(auditActionLabel("refund", "fr")).toContain("remboursement réel");
  expect(auditActionLabel("reversal", "fr")).toContain("sans remboursement");
  for (const entity of ["cimac_customer_refund", "cimac_customer_reversal"])
    for (const locale of ["zh", "fr"] as const) {
      expect(auditEntityLabel(entity, locale)).not.toContain("_");
      expect(auditEntityLabel(entity, locale)).not.toBe("其他对象");
    }
});
