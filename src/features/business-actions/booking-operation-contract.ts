// Browser-safe operation vocabulary. This is presentation/protocol metadata,
// not authorization: the server and database must check actual permissions.
export const BOOKING_OPERATIONS = {
  create: { label: "新建预订", highRisk: false },
  check_in: { label: "办理入住（不收款）", highRisk: false },
  cancel: { label: "取消未入住预订", highRisk: true },
  change_stay: { label: "调整住期或房价", highRisk: true },
  correct_room: { label: "纠正录错房号", highRisk: true },
  transfer: { label: "转移未入住预订", highRisk: true },
  reverse: { label: "冲正错误收款", highRisk: true },
  refund: { label: "登记实际退款", highRisk: true },
  void_checkin: { label: "撤销误入住", highRisk: true },
} as const;

export type BookingOperation = keyof typeof BOOKING_OPERATIONS;
export const BOOKING_OPERATION_ACTIONS: Record<string, BookingOperation[]> = {
  create_daily_booking: ["create"],
  check_in_daily_booking: ["check_in"],
  cancel_no_show_booking: ["cancel"],
  transfer_daily_booking: ["transfer", "correct_room"],
  reverse_daily_payment: ["reverse"],
  refund_daily_payment: ["refund"],
  correct_daily_booking: ["change_stay", "void_checkin"],
};
export function isBookingOperation(value: unknown): value is BookingOperation {
  return typeof value === "string" && Object.hasOwn(BOOKING_OPERATIONS, value);
}
export function bookingOperationLabel(value: unknown): string {
  return isBookingOperation(value) ? BOOKING_OPERATIONS[value].label : "业务";
}
export function isHighRiskBookingOperation(value: unknown): boolean {
  return !isBookingOperation(value) || BOOKING_OPERATIONS[value].highRisk;
}
