import { validBusinessDate } from "./operator-booking-search";

export interface DailyChangeRequest {
  bookingId: string;
  operation: "extend_and_collect" | "checkout_and_collect";
  originalInstruction: string;
  effectiveCheckOut?: string;
  amountXof?: number;
  paymentDate?: string;
  paymentMethod?: "cash" | "check" | "bank_transfer" | "offset" | "other";
}

export function parseDailyChangeRequest(value: unknown): DailyChangeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_plan");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !["bookingId", "operation", "originalInstruction", "effectiveCheckOut", "amountXof", "paymentDate", "paymentMethod"].includes(key))
    || typeof v.bookingId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.bookingId)
    || !["extend_and_collect", "checkout_and_collect"].includes(String(v.operation))
    || typeof v.originalInstruction !== "string" || !v.originalInstruction.trim() || v.originalInstruction.length > 4000) throw new Error("invalid_plan");
  for (const key of ["effectiveCheckOut", "paymentDate"]) if (v[key] !== undefined && !validBusinessDate(v[key])) throw new Error("invalid_plan_date");
  if (v.amountXof !== undefined && (!Number.isSafeInteger(v.amountXof) || Number(v.amountXof) <= 0 || Number(v.amountXof) > 999999999999)) throw new Error("invalid_plan_amount");
  if (v.paymentMethod !== undefined && !["cash", "check", "bank_transfer", "offset", "other"].includes(String(v.paymentMethod))) throw new Error("invalid_plan_method");
  return v as unknown as DailyChangeRequest;
}

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function money(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(\.0+)?$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && Math.abs(number) <= 999999999999 ? number : null;
}
const nights = (start: string, end: string) => Math.max(1, (Date.parse(end) - Date.parse(start)) / 86400000);

/** A proposal only. No draft, signature, execution token or write RPC is created. */
export function buildDailyChangePlan(request: DailyChangeRequest, snapshot: unknown, today: string) {
  const base = { executionAllowed: false as const, confirmationAvailable: false as const, originalInstruction: request.originalInstruction };
  const stop = (code: string, question: string) => ({ ...base, status: "assistance_required" as const, code, question });
  if (!object(snapshot) || !object(snapshot.booking) || !object(snapshot.unit)
    || !Array.isArray(snapshot.receivables) || !snapshot.receivables.every(object)
    || !Array.isArray(snapshot.payments) || !snapshot.payments.every(object)) return stop("invalid_snapshot", "当前订单信息不完整，请重新查询。");
  const b = snapshot.booking, u = snapshot.unit;
  if (b.id !== request.bookingId || b.unit_id !== u.id || b.status !== "checked_in") return stop("not_current_stay", "本次只支持已入住订单，请核对目标入住记录。");
  if (b.checkout_mode !== "fixed" || !validBusinessDate(b.check_in) || !validBusinessDate(b.check_out) || b.check_out <= b.check_in) return stop("open_or_invalid_stay", "开放住期需单独核算，不能按固定住期自动改账。");
  const rate = money(b.nightly_price_xof), total = money(b.final_amount_xof ?? b.total_amount_xof), paid = money(b.prepaid_amount_xof);
  if (rate === null || rate <= 0 || total === null || total < 0 || paid === null || paid < 0 || paid > total) return stop("invalid_finance", "订单金额异常，需要核对账务。");
  if (money(b.manual_discount_amount_xof ?? 0) !== 0 || total !== nights(b.check_in, b.check_out) * rate) return stop("special_pricing", "订单含额外优惠或特殊计价，请先确认变更日期后优惠如何适用。");
  const receivables = snapshot.receivables.filter(r => r.status !== "cancelled");
  const r = receivables[0];
  if (receivables.length !== 1 || r.source_id !== b.id || r.source_type !== "daily_booking" || r.unit_id !== u.id
    || r.customer_id !== b.customer_id || r.building_id !== u.building_id || r.category !== "daily_rental" || r.currency !== "XOF"
    || ["historical_pending", "excluded"].includes(String(r.management_status))
    || money(r.amount_xof) !== total || money(r.paid_amount_xof) !== paid) return stop("inconsistent_receivable", "订单与应收不一致，需要先核对，不能用新收款掩盖差异。");
  let paymentTotal = 0;
  for (const payment of snapshot.payments) {
    const value = money(payment.amount);
    if (value === null || payment.currency !== "XOF" || payment.source_type !== "daily_booking" || payment.source_id !== b.id) return stop("inconsistent_payments", "既有付款币种或归属需要人工核对。");
    paymentTotal += value;
  }
  if (!Number.isSafeInteger(paymentTotal) || paymentTotal !== paid) return stop("inconsistent_payments", "付款明细与已收金额不一致，请先对账。");
  const missing = [request.effectiveCheckOut === undefined ? "effectiveCheckOut" : null, request.amountXof === undefined ? "amountXof" : null,
    request.paymentDate === undefined ? "paymentDate" : null, request.paymentMethod === undefined ? "paymentMethod" : null].filter(Boolean);
  if (missing.length) return { ...base, status: "clarification_required" as const, missing,
    question: "请补充实际/新退房日期、本次实收金额（XOF）、收款日期和方式；不会默认现金、今天或自动补足欠款。" };
  const date = request.effectiveCheckOut!, amount = request.amountXof!;
  if (request.paymentDate! > today || b.check_in > today) return stop("future_actual_event", "实际入住和收款不能按未来日期登记。");
  if (request.operation === "extend_and_collect" ? date <= b.check_out || date <= today : date < b.check_in || date > today) {
    return stop("invalid_effective_date", "请核对日期：续住须延后原退房日，实际退房日不能早于入住或晚于今天。");
  }
  const totalAfter = nights(b.check_in, date) * rate;
  const paidAfter = paid + amount;
  if (!Number.isSafeInteger(totalAfter) || totalAfter > 999999999999 || paidAfter > totalAfter) return stop("overpayment_or_refund", "调整后已收超过应收，需要核对收款或退款，不会自动冲销。");
  return { ...base, status: "proposal_only" as const, bookingId: b.id, unitCode: u.code, operation: request.operation,
    pricingBasis: { nightlyRateXof: rate, nightsBefore: nights(b.check_in, b.check_out), nightsAfter: nights(b.check_in, date), currency: "XOF" },
    changes: {
      checkOut: { before: b.check_out, after: request.operation === "extend_and_collect" ? date : b.check_out },
      actualCheckOut: { before: b.actual_check_out ?? null, after: request.operation === "checkout_and_collect" ? date : b.actual_check_out ?? null },
      bookingStatus: { before: b.status, after: request.operation === "checkout_and_collect" ? "checked_out" : "checked_in" },
      totalXof: { before: total, after: totalAfter }, paidXof: { before: paid, after: paidAfter },
      outstandingXof: { before: total - paid, after: totalAfter - paidAfter },
    },
    payment: { amountXof: amount, date: request.paymentDate, method: request.paymentMethod },
    cleaningRequired: request.operation === "checkout_and_collect", historicalDebtIncluded: false,
    notice: "仅为完整影响方案，尚未创建确认单或执行任何修改。写入前仍须检查房间冲突、当前权限和实时账务，并通过整笔原子事务确认；禁止拆成几个独立写操作。",
  };
}
