import { describe, expect, it, vi } from "vitest";
import { extractAmountXof, extractCheckoutModeHint, extractCustomerNameHint, extractDateHints, extractRoomNumbers } from "../src/features/assistant-operations/utils";

describe("assistant operation parsing", () => {
  it("parses short date hints with the current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));

    expect(extractDateHints("创建1105、1106 6.28日预订")).toEqual(["2026-06-28"]);

    vi.useRealTimers();
  });

  it("does not treat room numbers or short dates as money", () => {
    expect(extractRoomNumbers("创建1105、1106 6.28日预订")).toEqual(["1105", "1106"]);
    expect(extractAmountXof("创建1105、1106 6.28日预订")).toBeUndefined();
  });

  it("extracts explicit XOF amounts after room numbers are ignored", () => {
    expect(extractAmountXof("1201 收了30000")).toBe(30000);
    expect(extractAmountXof("1201 房费3万")).toBe(30000);
  });

  it("keeps follow-up booking details separate", () => {
    expect(extractCustomerNameHint("客户镇淮 住一晚 按默认房价")).toBe("镇淮");
    expect(extractCheckoutModeHint("客户镇淮 住一晚 按默认房价")).toBe("fixed");
  });
});
