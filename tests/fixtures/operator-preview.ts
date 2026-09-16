import type { OperatorActionRequest } from "@/features/business-actions/operator-action-contract";
export const previewActor = "11111111-1111-4111-8111-111111111111";
export const previewBooking = "33333333-3333-4333-8333-333333333333";
export const previewSecret = "ab".repeat(32); // Synthetic test key only.
export function previewRequest(): OperatorActionRequest {
  return { actionName: "record_daily_payment", inputSource: "excel_screenshot", scope: "business_data", exceptionalBusinessCase: false,
    protocolVersion: "1.0", connectorVersion: "0.1.0", requestId: "77777777-7777-4777-8777-777777777777",
    originalInstruction: "截图记录：测试收款 10000 西法", input: { bookingId: previewBooking, amountXof: 10000, paymentDate: "2026-09-15", receiptNo: "TEST" } };
}
export function previewSnapshot() {
  return { booking: { id: previewBooking, unit_id: "unit", customer_id: "customer", booking_agent_id: "agent",
    status: "checked_in", check_out: "2026-09-20", checkout_mode: "fixed", total_amount_xof: 30000, final_amount_xof: 30000, prepaid_amount_xof: 10000 },
    unit: { id: "unit", building_id: "building", code: "TEST-503", unit_no: "503" },
    receivables: [{ id: "receivable", source_type: "daily_booking", source_id: previewBooking, customer_id: "customer", unit_id: "unit", building_id: "building",
      category: "daily_rental", currency: "XOF", amount_xof: 30000, paid_amount_xof: 10000, status: "partial" }],
    payments: [{ request_id: "old-request", amount: 10000, source_type: "daily_booking", source_id: previewBooking, currency: "XOF" }], cleaningTasks: [] };
}
