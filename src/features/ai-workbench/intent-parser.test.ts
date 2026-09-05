import { describe, expect, it } from "vitest";
import { parseWorkbenchIntent } from "./intent-parser";

const today = "2026-09-05";

describe("parseWorkbenchIntent", () => {
  it("parses a building-scoped lease overdue query", () => {
    expect(parseWorkbenchIntent("11#长租有哪些逾期", today)).toMatchObject({
      kind: "receivable_overdue",
      domain: "lease",
      buildingCode: "SACSI11",
      unitNo: null,
    });
  });

  it("parses a unit snapshot without mistaking the date for a unit", () => {
    expect(parseWorkbenchIntent("查看11#503的合同和收款", today)).toMatchObject({
      kind: "unit_snapshot",
      buildingCode: "SACSI11",
      unitNo: "503",
    });
  });

  it("parses a custom due-soon window", () => {
    expect(parseWorkbenchIntent("出售业务30天内应缴明细", today)).toMatchObject({
      kind: "receivable_due_soon",
      domain: "sale",
      days: 30,
    });
  });

  it("routes room-status language to daily status", () => {
    expect(parseWorkbenchIntent("今天5号楼有哪些房间可安排入住", today)).toMatchObject({
      kind: "daily_status",
      domain: "daily",
      buildingCode: "SACSI5",
    });
  });

  it("rejects unsupported open-ended analysis", () => {
    expect(parseWorkbenchIntent("预测下个月利润", today).kind).toBe("unsupported");
  });
});
