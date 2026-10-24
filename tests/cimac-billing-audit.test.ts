import { expect, it } from "vitest";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit-labels";

it("labels pending evidence and actual customer collection as different audited facts", () => {
  expect(auditActionLabel("save", "zh")).toBe("保存资料");
  expect(auditActionLabel("collect", "zh")).toContain("实际收款");
  expect(auditEntityLabel("cimac_fee_terms", "zh")).toContain("待核");
  expect(auditEntityLabel("cimac_meter_reading", "zh")).toContain("抄表");
  expect(auditEntityLabel("cimac_customer_collection", "zh")).toContain("客户总账收款");
  for (const entity of ["cimac_fee_terms", "cimac_meter_reading", "cimac_customer_collection"])
    expect(auditEntityLabel(entity, "fr")).not.toContain("_");
});
