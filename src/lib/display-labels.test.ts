import { describe, expect, it } from "vitest";
import { currencyDisplayLabel, financialBusinessLabel, knownFinancialBusinessCodes, statusDisplayLabel } from "./display-labels";

describe("display labels", () => {
  it("covers every currently supported financial code without exposing identifiers", () => {
    for (const code of knownFinancialBusinessCodes) {
      expect(financialBusinessLabel(code, "zh")).not.toMatch(/_/);
      expect(financialBusinessLabel(code, "fr")).not.toMatch(/_/);
    }
  });

  it("uses safe localized fallbacks for unknown database values", () => {
    expect(financialBusinessLabel("future_business_code", "zh")).toBe("其他业务");
    expect(statusDisplayLabel("future_status", "zh")).toBe("未知状态");
  });

  it("shows the local currency consistently as FCFA", () => {
    expect(currencyDisplayLabel("XOF", "zh")).toBe("FCFA");
    expect(currencyDisplayLabel("CNY", "zh")).toBe("人民币（CNY）");
  });
});

