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

  it.each([
    ["retards bail 11#", "receivable_overdue", "lease", "SACSI11", null],
    ["reste dû bail 11#503", "receivable_outstanding", "lease", "SACSI11", "503"],
    ["échéances vente sous 15 jours", "receivable_due_soon", "sale", null, null],
    ["état journalier aujourd'hui", "daily_status", "daily", null, null],
    ["contrat et paiements du 11#503", "unit_snapshot", "all", "SACSI11", "503"],
  ])("parses French queries: %s", (query, kind, domain, buildingCode, unitNo) => {
    expect(parseWorkbenchIntent(query, today)).toMatchObject({
      kind,
      domain,
      buildingCode,
      unitNo,
      source: "rules",
    });
  });

  it("extracts the French due-soon window in days", () => {
    expect(parseWorkbenchIntent("échéances vente sous 30 jours", today).days).toBe(30);
  });

  it("maps a French cleaning question to a read-only daily state query", () => {
    expect(parseWorkbenchIntent("le ménage de 11#906 est-il terminé ?", today)).toMatchObject({
      kind: "daily_status",
      domain: "daily",
      source: "rules",
    });
  });

  it.each([
    ["11#今天退房名单", "daily_movements", "daily", "SACSI11", null],
    ["5#今日到店客人", "daily_movements", "daily", "SACSI5", null],
    ["départs du jour 11#", "daily_movements", "daily", "SACSI11", null],
  ])("parses today arrivals/departures lists (zh/fr): %s", (query, kind, domain, buildingCode, unitNo) => {
    expect(parseWorkbenchIntent(query, today)).toMatchObject({ kind, domain, buildingCode, unitNo });
  });

  it.each([
    ["长租30天内到期", 30],
    ["11#长租7天内到期名单", 7],
    ["baux expirant sous 30 jours", 30],
  ])("parses leases expiring within N days (zh/fr): %s", (query, days) => {
    expect(parseWorkbenchIntent(query, today)).toMatchObject({
      kind: "lease_expiring",
      domain: "lease",
      days,
    });
  });

  it("does not mistake availability questions for arrivals", () => {
    expect(parseWorkbenchIntent("今天5号楼有哪些房间可安排入住", today)).toMatchObject({
      kind: "daily_status",
      domain: "daily",
    });
  });
});
