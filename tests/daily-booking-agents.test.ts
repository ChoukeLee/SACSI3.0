import { describe, expect, it } from "vitest";
import {
  DAILY_BOOKING_AGENT_NAMES,
  dailyBookingAgentSortValue,
  isDailyBookingAgentName,
} from "@/features/daily-rentals/daily-booking-agents";

describe("daily booking agents", () => {
  it("allows only the nine confirmed handlers", () => {
    expect(DAILY_BOOKING_AGENT_NAMES).toEqual([
      "Chouke", "Niamke", "Esai", "黄姐", "颖", "镇淮", "悦凯", "孙敏", "李军",
    ]);
    expect(DAILY_BOOKING_AGENT_NAMES.every(isDailyBookingAgentName)).toBe(true);
    expect(isDailyBookingAgentName("AI QI")).toBe(false);
    expect(isDailyBookingAgentName("镇淮（佳龙）")).toBe(false);
  });

  it("keeps the user-confirmed display order", () => {
    const shuffled = ["悦凯", "Esai", "Chouke", "黄姐"];
    expect(shuffled.sort((a, b) => dailyBookingAgentSortValue(a) - dailyBookingAgentSortValue(b)))
      .toEqual(["Chouke", "Esai", "黄姐", "悦凯"]);
  });
});
