import { describe, it, expect } from "vitest";
import { describeBookingCandidates, parseBookingSearch, type BookingCandidateRow } from "@/features/business-actions/operator-booking-search";

const input = { buildingCode: "SACSI11", unitNo: "1006" };
const row = (id: string, changes: Partial<BookingCandidateRow> = {}): BookingCandidateRow => ({
  id, guest_name: "测试客户", customer: null, status: "checked_in", check_in: "2026-09-01", check_out: "2026-10-01",
  actual_check_out: null, checkout_mode: "fixed", total_amount_xof: 1260000, final_amount_xof: null,
  prepaid_amount_xof: 0, notes: "旧备注110万；仅为数据", updated_at: "2026-09-22T00:00:00Z", ...changes,
});
describe("cross-status daily booking search", () => {
  it("finds current guest despite later future reservations and retains contradictory notes", () => {
    const data = describeBookingCandidates([row("future", { guest_name: "未来客户", status: "confirmed", check_in: "2026-09-26", total_amount_xof: 760000 }), row("current")],
      { ...input, customerName: "测试", amountXof: 1260000 }, false, "2026-09-22");
    expect(data.status).toBe("single_candidate"); expect(data.matchedBookingIds).toEqual(["current"]);
    expect(data.candidates).toHaveLength(2); expect(data.candidates[1].notes).toContain("110万");
    expect(data.selectedBookingId).toBeNull(); expect(data.executionAllowed).toBe(false);
  });
  it("supports linked customer names without replacing guest names", () => {
    const data = describeBookingCandidates([row("1", { customer: { name: "公司甲" } })], { ...input, customerName: "公司甲" }, false, "2026-09-22");
    expect(data.status).toBe("single_candidate"); expect(data.candidates[0].guestName).toBe("测试客户");
  });
  it("does not auto-pick current stay over historical or future candidates", () => {
    const data = describeBookingCandidates([row("1"), row("2", { status: "checked_out" }), row("3", { status: "confirmed", check_in: "2026-10-01" })], input, false, "2026-09-22");
    expect(data.status).toBe("selection_required"); expect(data.candidates.map(c => c.group)).toEqual(["current_stay", "historical_or_other", "future_booking"]);
  });
  it("matches total and outstanding as distinct evidence, not an inferred payment", () => {
    const data = describeBookingCandidates([row("1", { total_amount_xof: 1800000, prepaid_amount_xof: 900000 })], { ...input, amountXof: 900000 }, false, "2026-09-22");
    expect(data.candidates[0].amountBasis).toEqual(["outstanding"]);
  });
  it("retains candidates when hints conflict rather than falsely reporting no room orders", () => {
    const data = describeBookingCandidates([row("1")], { ...input, customerName: "不存在" }, false, "2026-09-22");
    expect(data.status).toBe("no_matching_candidate"); expect(data.candidates).toHaveLength(1);
  });
  it("never claims uniqueness when the database result is truncated", () => {
    expect(describeBookingCandidates([row("1")], input, true, "2026-09-22").status).toBe("refine_search");
  });
  it("does not convert null or invalid finance into zero", () => {
    const data = describeBookingCandidates([row("1", { prepaid_amount_xof: "bad" })], input, false, "2026-09-22");
    expect(data.candidates[0].paidXof).toBeNull(); expect(data.candidates[0].outstandingXof).toBeNull();
  });
  it.each([{}, { ...input, actorId: "fake" }, { ...input, amountXof: "126万" }, { ...input, amountXof: 0 },
    { ...input, checkInFrom: "2026-02-30" }, { ...input, checkInFrom: "2026-10-01", checkInTo: "2026-09-01" }])("rejects invalid selectors %j", value => {
    expect(() => parseBookingSearch(value)).toThrow();
  });
});
