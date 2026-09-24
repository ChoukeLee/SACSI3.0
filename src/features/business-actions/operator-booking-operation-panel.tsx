"use client";
import { useState } from "react";
import { bookingOperationLabel, isHighRiskBookingOperation } from "./booking-operation-contract";
const fields: Record<string, string> = {
  unitCode: "原房间",
  targetUnitCode: "目标房间",
  bookingAgent: "业务经办人",
  guestName: "入住客人",
  checkInBefore: "原入住日期",
  checkInAfter: "新入住日期",
  checkOutBefore: "原退房日期",
  checkOutAfter: "新退房日期",
  priceBefore: "原日价（XOF）",
  priceAfter: "新日价（XOF）",
  totalBefore: "原应收（XOF）",
  totalAfter: "新应收（XOF）",
  paidBefore: "原净收款（XOF）",
  paidAfter: "新净收款（XOF）",
  amountXof: "本次退款或冲正金额（XOF）",
  paymentDate: "实际退款日期",
  paymentMethod: "实际退款方式",
  paymentCount: "关联收款条数",
  receivableCount: "关联应收条数",
  ledgerCount: "关联账本条数",
  reason: "变更原因",
};
export function BookingOperationPanel({
  id,
  plan,
  requestId,
  actor,
  originalInstruction,
  expiresAt,
  status,
}: {
  id: string;
  plan: Record<string, unknown>;
  requestId: string;
  actor: string;
  originalInstruction: string;
  expiresAt: string;
  status: string;
}) {
  const [state, setState] = useState(status),
    [checked, setChecked] = useState(false),
    [highRiskChecked, setHighRiskChecked] = useState(false),
    [message, setMessage] = useState("");
  const highRisk = isHighRiskBookingOperation(plan.operation);
  async function confirm() {
    if (!checked || (highRisk && !highRiskChecked) || !["pending", "unknown"].includes(state))
      return;
    setState("sending");
    try {
      const r = await fetch(`/api/operator/v1/booking-operations/confirmations/${id}`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await r.json();
      if (r.ok && data.status === "completed" && data.verified === true) {
        setState("completed");
        setMessage("业务已完成并通过本次执行核验。");
        return;
      }
      if (r.ok && data.status === "completed_previously") {
        setState("completed");
        setMessage("原单此前已完成，没有重复执行；未重新复核后续全部账务。");
        return;
      }
      setState(r.status >= 500 ? "unknown" : "blocked");
      setMessage(data.message || "结果未核实，请保留原请求号查询或联系 Chucke。");
    } catch {
      setState("unknown");
      setMessage("网络中断，结果未知。请按原单重试，勿换号重录。");
    }
  }
  return (
    <section className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">{bookingOperationLabel(plan.operation)} · 本人确认</h1>
      <p>实际操作账号：{actor}</p>
      <p className="whitespace-pre-wrap break-words rounded-lg border p-3">{originalInstruction}</p>
      <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
        {Object.entries(fields)
          .filter(([key]) => plan[key] !== null && plan[key] !== undefined)
          .map(([key, label]) => (
            <div key={key}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="break-words">{String(plan[key])}</dd>
            </div>
          ))}
      </dl>
      <p>{String(plan.notice || "")}</p>
      <p className="break-all text-xs">
        请求号：{requestId} · 有效至 {expiresAt}（UTC）
      </p>
      {state === "completed" ? (
        <p role="status">{message || "此单此前已完成，请勿重复执行。"}</p>
      ) : state === "superseded" ? (
        <p role="alert">此单已被替换。</p>
      ) : (
        <>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            我已核对房间、客人、经办人、日期与金额。
          </label>
          {highRisk && (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={highRiskChecked}
                onChange={(e) => setHighRiskChecked(e.target.checked)}
              />
              {plan.operation === "refund"
                ? "我确认款项已经实际退给客户，日期、方式和金额正确。"
                : "我确认变更原因及影响；冲正不是实际退钱。不确定时先联系 Chucke。"}
            </label>
          )}
          <button
            className="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-40"
            onClick={confirm}
            disabled={
              !checked || (highRisk && !highRiskChecked) || !["pending", "unknown"].includes(state)
            }
          >
            {state === "sending"
              ? "正在处理…"
              : state === "unknown"
                ? "按原单重试"
                : "确认执行业务"}
          </button>
          {message && <p role="alert">{message}</p>}
        </>
      )}
    </section>
  );
}
