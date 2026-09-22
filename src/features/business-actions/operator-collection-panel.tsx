"use client";
import { useState } from "react";
import type { collectionPreview } from "./operator-batch";
import { collectionFeedback } from "./operator-batch";
export function OperatorCollectionPanel({ id, rows, totalXof, actor, requestId, expiresAt, status }: {
  id: string; rows: ReturnType<typeof collectionPreview>; totalXof: number; actor: string; requestId: string; expiresAt: string; status: string;
}) {
  const [state, setState] = useState(status);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const amount = (n: number) => `${n.toLocaleString("zh-CN")} XOF`;
  async function confirm() {
    if (!checked || !["pending", "unknown"].includes(state)) return;
    setState("sending"); setMessage("");
    try {
      const response = await fetch(`/api/operator/v1/collections/${id}`, { method: "POST", credentials: "same-origin" });
      const data = await response.json();
      if (response.ok && data.status === "completed" && data.verified) { setState("completed"); setMessage("整批已入账，分项金额及审计复查通过。"); return; }
      const unknown = response.status >= 500;
      setState(unknown ? "unknown" : "blocked");
      setMessage(unknown ? "结果暂时无法确认。请保留本单并按原单重试，不要重新创建收款。" : collectionFeedback(data.code));
    } catch { setState("unknown"); setMessage("网络中断，结果未知。恢复后按原单重试，不要换请求号。"); }
  }
  return <section className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
    <h1 className="text-xl font-semibold">核对整批收款与分账</h1>
    <p>共 {rows.length} 行 · 合计 {amount(totalXof)} · 登录账号：{actor}</p>
    <p className="text-sm text-muted-foreground">整批核对后一次入账。任何一项发生冲突，整批停止。请特别核对客户、账期、收款方式和租金已缴至日期。</p>
    {rows.map(row => <article key={row.lineId} className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{row.unitLabel} · {row.customer} · {row.contractNo || "日租订单"}</h2>
      <p className="whitespace-pre-wrap break-words text-sm">凭证第 {row.lineId} 行：{row.sourceText}</p>
      <p className="text-sm">收款 {amount(row.totalXof)} · {row.paymentDate} · {{ cash: "现金", check: "支票", bank_transfer: "银行转账", offset: "抵扣/转款", other: "其他" }[row.paymentMethod]} · 收据 {row.receiptNo || "未提供"}</p>
      {row.paidThroughDate && <p className="text-sm font-medium">租金已缴至将更新为：{row.paidThroughDate}（请核对完整覆盖期间）</p>}
      <ul className="space-y-2">{row.allocations.map(a => <li key={a.receivableId} className="rounded-lg bg-muted p-3 text-sm">
        <p>{a.category} · {a.title} · 应收日期 {a.dueDate}</p>
        <p>本次 {amount(a.amountXof)} · 未收 {amount(a.outstandingBeforeXof)} → {amount(a.outstandingAfterXof)}</p>
      </li>)}</ul>
    </article>)}
    <p className="break-all text-xs text-muted-foreground">请求号：{requestId} · 有效至（阿比让）：{new Date(expiresAt).toLocaleString("zh-CN", { timeZone: "Africa/Abidjan" })}</p>
    {state === "completed" ? <p role="status">{message || "此批次此前已完成，未在本页重新核查当前账务。请勿再次新建收款。"}</p> : state === "superseded" ? <p role="alert">此单已被重新准备的确认单替代，不能再执行。</p> : <>
      <label className="flex items-start gap-2"><input type="checkbox" checked={checked} disabled={["sending", "blocked"].includes(state)} onChange={e => setChecked(e.target.checked)} />我已逐行核对原始凭证、合同、应收分配和合计，确认整批收款。</label>
      <button className="min-h-11 rounded-lg bg-primary px-5 py-2 text-primary-foreground disabled:opacity-40" onClick={confirm} disabled={!checked || !["pending", "unknown"].includes(state)}>{state === "sending" ? "正在入账…" : state === "unknown" ? "按原确认单重试" : "确认整批入账"}</button>
      {message && <p role="alert">{message}</p>}
    </>}
  </section>;
}
