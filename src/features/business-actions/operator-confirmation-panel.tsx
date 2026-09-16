"use client";
import { useState } from "react";
import type { buildPaymentPreview } from "./operator-payment-preview";
import { confirmationFeedback } from "./operator-confirmation-feedback";
type Preview = Extract<ReturnType<typeof buildPaymentPreview>, { success: true }>['preview'];
export function OperatorConfirmationPanel({ id, preview, actor, expiresAt, completed = false }: {
  id: string; preview: Preview; actor: string; expiresAt: string; completed?: boolean;
}) {
  const [state, setState] = useState<"ready" | "sending" | "completed" | "failed" | "blocked">(completed ? "completed" : "ready");
  const [message, setMessage] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [checked, setChecked] = useState(false);
  async function confirm() {
    if (!checked || state === "sending" || state === "completed" || state === "blocked") return;
    setState("sending"); setMessage("");
    try {
      const result = await fetch(`/api/operator/v1/confirmations/${id}`, { method: "POST", credentials: "same-origin" });
      const data = await result.json();
      if (result.ok && data.status === "completed") { setState("completed"); return; }
      const feedback = confirmationFeedback(data.code);
      setMessage(feedback.message); setLoginRequired(!!feedback.login);
      setState(feedback.retry ? "failed" : "blocked");
      return;
    } catch { setMessage("网络中断，结果未知。请保留此确认单；按原单重试不会创建新的请求号。"); }
    setState("failed");
  }
  return <section className="mx-auto max-w-2xl space-y-5 rounded-xl border bg-card p-6">
    <h1 className="text-xl font-semibold">核对截图收款</h1>
    <p className="text-sm text-muted-foreground">这是一次收款确认，不是日常审计复核。请核对后再入账。</p>
    <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
      {[["实际录入账号", actor], ["房间", preview.unitCode || preview.unitNo], ["本次收款", `${preview.amountXof.toLocaleString()} XOF`],
        ["收款日期", preview.paymentDate], ["收据号", preview.receiptNo || "未填写"], ["入账后未收", `${preview.outstandingAfterXof.toLocaleString()} XOF`],
        ["有效期至（阿比让）", new Date(expiresAt).toLocaleString("zh-CN", { timeZone: "Africa/Abidjan" })], ["请求编号", preview.requestId]].map(([label,value]) =>
        <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{value}</dd></div>)}
    </dl>
    <div className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">{preview.originalInstruction}</div>
    {state === "completed" ? <p role="status" className="font-medium">{completed ? "此确认单此前已执行，本页未重新复查当前账务。不要重复新建付款。" : "已入账并通过结果复查。不要重复新建付款。"}</p> : <>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={checked} disabled={state === "sending" || state === "blocked"} onChange={e => setChecked(e.target.checked)} />我已核对房间、金额、日期和收据，确认这笔收款。</label>
      <button type="button" onClick={confirm} disabled={!checked || state === "sending" || state === "blocked"} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-40">
        {state === "sending" ? "正在入账，请勿关闭…" : state === "failed" ? "按原确认单重试" : state === "blocked" ? "已停止入账" : "确认并入账"}
      </button>
    </>}
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    {loginRequired && <a className="inline-block text-sm underline" href={`/login?redirect=${encodeURIComponent(`/operator/confirmations/${id}`)}`}>重新登录并返回此单</a>}
  </section>;
}
