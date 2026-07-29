import { describe, expect, it } from "vitest";
import { computeAlerts } from "../src/features/management/management-alerts";

describe("management home workbench", () => {
  it("links overdue receivables back to the finance snapshot", () => {
    const alerts = computeAlerts({
      overdueCount: 3,
      overdueTotal: 7_564_000,
      todayCheckouts: 0,
      todayCheckins: 0,
      expiringLeases: 0,
      locale: "zh",
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      key: "overdue",
      label: "逾期欠款",
      count: 3,
      href: "/management#finance",
    });
  });

  it("keeps only actionable daily and lease reminders", () => {
    const alerts = computeAlerts({
      overdueCount: 0,
      overdueTotal: 0,
      todayCheckouts: 2,
      todayCheckins: 1,
      expiringLeases: 4,
      locale: "zh",
    });

    expect(alerts.map((item) => item.key)).toEqual(["checkouts", "checkins", "expiring"]);
  });
});
