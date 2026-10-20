import { expect, it } from "vitest";
import { auditActionLabel } from "@/lib/audit-labels";

it.each([
  ["operator_collection_item", "截图分账收款"],
  ["operator_booking_create", "新建日租预订"],
  ["operator_booking_check_in", "办理入住（不收款）"],
  ["operator_booking_cancel", "取消未入住预订"],
  ["operator_booking_change_stay", "调整住期或房价"],
  ["operator_booking_transfer", "转移未入住预订"],
  ["operator_booking_correct_room", "纠正录错房号"],
  ["operator_booking_reverse", "冲正错误收款（非退款）"],
  ["operator_booking_refund", "登记实际退款"],
  ["operator_booking_void_checkin", "撤销误入住"],
])("names the recorded %s operation without conflating business effects", (action, zh) => {
  expect(auditActionLabel(action, "zh")).toBe(zh);
  expect(auditActionLabel(action, "fr")).toBeTruthy();
  expect(auditActionLabel(action, "fr")).not.toContain("operator booking");
});
it("keeps actual refunds and corrections distinct in French", () => {
  expect(auditActionLabel("operator_booking_reverse", "fr")).toContain("sans remboursement");
  expect(auditActionLabel("operator_booking_refund", "fr")).toContain("remboursement réel");
  expect(auditActionLabel("operator_booking_correct_room", "fr")).toContain("erreur");
});
it("does not guess a business meaning for an unknown historical action", () => {
  expect(auditActionLabel("legacy_action_unknown", "zh")).toBe("其他操作");
});
