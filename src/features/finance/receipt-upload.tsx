"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ImageUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatXof } from "@/lib/utils";

type PaymentMethod = "cash" | "check" | "bank_transfer" | "offset" | "other";
interface ReceiptDraft { building_code: string | null; room_no: string | null; receipt_no: string | null; receipt_date: string | null; amount_xof: number | null; period_end: string | null; business_hint: "rent" | "property_fee" | null; payer_name: string | null; notes: string | null; confidence: "high" | "medium" | "low"; warnings: string[] }
interface PreparedProposal { proposal: { id: string; version: number; action: string; expiresAt: string }; match: { building: string; roomNo: string; contractNo: string; currentPaidThrough: string | null }; plan: { kind: string; rentAmountXof: number; propertyAmountXof: number; confidence: string; warnings: string[] } }
interface Props { locale: "zh" | "fr"; onClose: () => void }

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.plan?.warnings?.join("；") || "请求失败，请稍后重试。");
  return data;
}

export function ReceiptUpload({ locale, onClose }: Props) {
  const zh = locale === "zh";
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [manualText, setManualText] = useState("");
  const [jobId, setJobId] = useState("");
  const [prepared, setPrepared] = useState<PreparedProposal | null>(null);
  const [busy, setBusy] = useState<"scan" | "prepare" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [done, setDone] = useState<{ references: string[] } | null>(null);
  const [form, setForm] = useState({ buildingCode: "", roomNo: "", amount: "", receiptDate: "", paidThroughDate: "", payerName: "", notes: "", paymentMethod: "" as PaymentMethod | "", businessHint: "" as "rent" | "property_fee" | "" });

  const setField = (key: keyof typeof form, value: string) => {
    if (prepared) return;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const scan = async () => {
    if (!file && !manualText.trim()) { setError(zh ? "请选择图片或粘贴收款文字。" : "Ajoutez une image ou collez le texte du reçu."); return; }
    setBusy("scan"); setError(null); setWarning(null); setPrepared(null);
    try {
      const body = new FormData();
      if (file) body.append("file", file);
      if (manualText.trim()) body.append("manual_text", manualText.trim());
      body.append("locale", locale);
      const result = await readJson(await fetch("/api/receipt/scan", { method: "POST", body }));
      const draft = result.draft as ReceiptDraft;
      setJobId(String(result.jobId));
      setForm((current) => ({ ...current, buildingCode: draft.building_code ?? "", roomNo: draft.room_no ?? "", amount: draft.amount_xof ? String(draft.amount_xof) : "", receiptDate: draft.receipt_date ?? "", paidThroughDate: draft.period_end ?? "", payerName: draft.payer_name ?? "", notes: draft.notes ?? "", businessHint: draft.business_hint ?? "" }));
      const messages = [...(draft.warnings ?? [])];
      if (result.ocrError) messages.push(String(result.ocrError));
      setWarning(messages.length ? messages.join("；") : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "识别失败。"); }
    finally { setBusy(null); }
  };

  const prepare = async () => {
    if (!jobId) return;
    setBusy("prepare"); setError(null); setWarning(null);
    try {
      const result = await readJson(await fetch("/api/receipt/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: jobId, building_code: form.buildingCode, room_no: form.roomNo, amount_xof: Number(form.amount), receipt_date: form.receiptDate, period_end: form.paidThroughDate || null, payer_name: form.payerName || null, payment_method: form.paymentMethod, business_hint: form.businessHint || null, notes: form.notes || null }) }));
      setPrepared(result as PreparedProposal);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "匹配失败。"); }
    finally { setBusy(null); }
  };

  const confirm = async () => {
    if (!prepared) return;
    setBusy("confirm"); setError(null);
    try {
      const result = await readJson(await fetch("/api/receipt/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposal_id: prepared.proposal.id, proposal_version: prepared.proposal.version }) }));
      setDone({ references: result.referenceNos ?? [] });
      setWarning(result.warning ?? null);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "入账失败。"); }
    finally { setBusy(null); }
  };

  if (done) return <div className="flex min-h-72 flex-col items-center justify-center text-center">
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check className="h-6 w-6" /></span>
    <h3 className="mt-4 text-base font-semibold">{zh ? "已入账并完成复核" : "Enregistré et vérifié"}</h3>
    {done.references.length > 0 && <p className="mt-2 max-w-md text-xs text-muted-foreground">{done.references.join(" · ")}</p>}
    {warning && <p className="mt-3 max-w-md text-sm text-amber-700">{warning}</p>}
    <Button className="mt-6 min-h-11 px-8" onClick={onClose}>{zh ? "完成" : "Terminer"}</Button>
  </div>;

  return <div className="space-y-5">
    <section aria-labelledby="receipt-source-title">
      <h3 id="receipt-source-title" className="text-sm font-semibold">1. {zh ? "提供凭证" : "Ajouter le justificatif"}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{zh ? "图片只负责提取候选内容，不会直接入账。" : "L’image ne crée jamais une écriture automatiquement."}</p>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={Boolean(prepared)} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setJobId(""); setPrepared(null); }} />
      <button type="button" disabled={Boolean(prepared)} onClick={() => fileRef.current?.click()} className="flex min-h-20 w-full items-center gap-3 rounded-lg border border-dashed px-4 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60">
        <ImageUp className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span><span className="block text-sm font-medium">{file?.name ?? (zh ? "选择收据图片" : "Choisir une image")}</span><span className="block text-xs text-muted-foreground">JPEG / PNG / WebP，最大 10 MB</span></span>
      </button>
      <textarea value={manualText} disabled={Boolean(prepared)} onChange={(event) => { setManualText(event.target.value); setJobId(""); setPrepared(null); }} rows={3} placeholder={zh ? "也可直接粘贴收款文字（没有视觉模型时建议使用）" : "Ou collez le texte du reçu"} className="mt-3 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60" />
      <Button className="mt-3 min-h-11 w-full sm:w-auto" onClick={scan} disabled={busy !== null || Boolean(prepared)}>{busy === "scan" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{zh ? "提取候选信息" : "Extraire les informations"}</Button>
    </section>

    {jobId && <section className="border-t pt-5" aria-labelledby="receipt-review-title">
      <h3 id="receipt-review-title" className="text-sm font-semibold">2. {zh ? "人工核对关键字段" : "Vérifier les champs"}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{zh ? "楼栋、房号、日期、金额和付款方式必须由你确认。" : "Confirmez l’immeuble, le logement, la date, le montant et le mode."}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={zh ? "楼栋编码 *" : "Code immeuble *"}><Input className="h-11" value={form.buildingCode} onChange={(e) => setField("buildingCode", e.target.value.toUpperCase())} placeholder="SACSI11" /></Field>
        <Field label={zh ? "房号 *" : "Logement *"}><Input className="h-11" value={form.roomNo} onChange={(e) => setField("roomNo", e.target.value)} /></Field>
        <Field label={zh ? "金额（XOF）*" : "Montant (XOF) *"}><Input className="h-11" type="number" min="1" value={form.amount} onChange={(e) => setField("amount", e.target.value)} /></Field>
        <Field label={zh ? "付款日期 *" : "Date *"}><Input className="h-11" type="date" value={form.receiptDate} onChange={(e) => setField("receiptDate", e.target.value)} /></Field>
        <Field label={zh ? "已缴至（含租金时必填）" : "Payé jusqu’au"}><Input className="h-11" type="date" value={form.paidThroughDate} onChange={(e) => setField("paidThroughDate", e.target.value)} /></Field>
        <Field label={zh ? "付款方式 *" : "Mode de paiement *"}><select className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={form.paymentMethod} onChange={(e) => setField("paymentMethod", e.target.value)}><option value="">{zh ? "请选择" : "Choisir"}</option><option value="cash">{zh ? "现金" : "Espèces"}</option><option value="bank_transfer">{zh ? "银行转账" : "Virement"}</option><option value="check">{zh ? "支票" : "Chèque"}</option><option value="offset">{zh ? "抵扣" : "Compensation"}</option><option value="other">{zh ? "其他" : "Autre"}</option></select></Field>
        <Field label={zh ? "付款人" : "Payeur"}><Input className="h-11" value={form.payerName} onChange={(e) => setField("payerName", e.target.value)} /></Field>
        <Field label={zh ? "业务提示（不作为证据）" : "Indication facultative"}><select className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={form.businessHint} onChange={(e) => setField("businessHint", e.target.value)}><option value="">{zh ? "不指定" : "Non précisé"}</option><option value="rent">{zh ? "租金" : "Loyer"}</option><option value="property_fee">{zh ? "物业费" : "Charges"}</option></select></Field>
        <Field label={zh ? "备注" : "Note"}><Input className="h-11" value={form.notes} onChange={(e) => setField("notes", e.target.value)} /></Field>
      </div>
      <Button className="mt-4 min-h-11 w-full sm:w-auto" onClick={prepare} disabled={busy !== null}>{busy === "prepare" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{zh ? "核对系统记录并生成草稿" : "Vérifier et préparer"}</Button>
    </section>}

    {prepared && <section className="rounded-xl border bg-muted/20 p-4" aria-labelledby="receipt-confirm-title">
      <div className="flex items-start justify-between gap-3"><div><h3 id="receipt-confirm-title" className="text-sm font-semibold">3. {zh ? "确认入账草稿" : "Confirmer le brouillon"}</h3><p className="mt-1 text-xs text-muted-foreground">{prepared.match.building} · {prepared.match.roomNo} · {prepared.match.contractNo}</p></div><span className="rounded-full border px-2 py-1 text-xs font-medium">{prepared.proposal.action === "record_combined_lease_payment" ? "L3" : "L2"}</span></div>
      <dl className="mt-4 grid gap-3 rounded-lg bg-background p-3 sm:grid-cols-3"><Summary label={zh ? "总额" : "Total"} value={formatXof(Number(form.amount))} /><Summary label={zh ? "分配租金" : "Loyer"} value={formatXof(prepared.plan.rentAmountXof)} /><Summary label={zh ? "分配物业费" : "Charges"} value={formatXof(prepared.plan.propertyAmountXof)} /></dl>
      <p className="mt-3 text-xs text-muted-foreground">{zh ? "确认后只执行上方不可变草稿；页面字段的后续变化不会改变本次执行内容。" : "La confirmation exécute uniquement ce brouillon immuable."}</p>
      <Button className="mt-4 min-h-11 w-full" onClick={confirm} disabled={busy !== null}>{busy === "confirm" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{zh ? "确认并入账" : "Confirmer et enregistrer"}</Button>
    </section>}

    {(error || warning) && <div role="alert" className={`flex gap-2 rounded-lg border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{error ?? warning}</p></div>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{value}</dd></div>; }
