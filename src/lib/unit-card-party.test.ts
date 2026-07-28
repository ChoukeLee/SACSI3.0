import { describe, expect, it } from "vitest";
import { referencedLeaseContractNo, unitCardPartyFromNotes, unresolvedUnitCardParty } from "./unit-card-party";

describe("unit card party fallback", () => {
  it("shows a confirmed tenant from structured lease notes", () => {
    expect(unitCardPartyFromNotes({ notes: "当前租赁状态：华为长租；其他信息待确认。" }, "leased")).toBe("华为");
    expect(unitCardPartyFromNotes({ notes: "当前按建材城长租标记；租金待确认。" }, "leased")).toBe("建材城");
  });

  it("resolves a shared master lease number", () => {
    expect(referencedLeaseContractNo("11-12层办公室整租；主合同WB-LEASE-SACSI7-11-12F-20250901；财务统一统计。"))
      .toBe("WB-LEASE-SACSI7-11-12F-20250901");
  });

  it("shows the named occupant for an owner-occupied employee unit", () => {
    expect(unitCardPartyFromNotes({ notes: "自用员工宿舍；入住人：李军；登记日期：2026-07-22。" }, "ownerOccupied"))
      .toBe("李军");
    expect(unitCardPartyFromNotes({ notes: "内部使用；使用人：李振咏；" }, "ownerOccupied"))
      .toBe("李振咏");
  });

  it("uses a role-specific label when the party is genuinely unknown", () => {
    expect(unitCardPartyFromNotes({ notes: "买方、售价及日期待确认。" }, "sold")).toBeNull();
    expect(unresolvedUnitCardParty("sold", "zh")).toBe("买方待确认");
    expect(unresolvedUnitCardParty("leased", "zh")).toBe("租户待确认");
  });
});
