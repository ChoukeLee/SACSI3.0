"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ImageUp, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ReceiptDraft {
  room_no: string | null;
  receipt_no: string | null;
  receipt_date: string | null;
  amount_xof: number | null;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  business_type: string | null;
  payer_name: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

interface ScanResult {
  success: boolean;
  imagePath?: string | null;
  ocrText: string;
  ocrProvider: string;
  ocrError?: string | null;
  draft: ReceiptDraft;
  status: string;
  error?: string;
}

interface ConfirmResult {
  success: boolean;
  paymentId?: string;
  attachmentId?: string | null;
  duplicateWarning?: string | null;
  duplicateOverridden?: boolean;
  requiresOverride?: boolean;
  matchedReceivableId?: string | null;
  unmatchedReceivable?: boolean;
  message?: string;
  error?: string;
}

interface Props {
  locale: "zh" | "fr";
  onClose: () => void;
}

export function ReceiptUpload({ locale, onClose }: Props) {
  const zh = locale === "zh";
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [overrideDuplicate, setOverrideDuplicate] = useState(false);

  // Editable draft fields
  const [editRoom, setEditRoom] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editReceiptNo, setEditReceiptNo] = useState("");
  const [editPeriodStart, setEditPeriodStart] = useState("");
  const [editPeriodEnd, setEditPeriodEnd] = useState("");
  const [editBusinessType, setEditBusinessType] = useState("");
  const [editPayer, setEditPayer] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [manualText, setManualText] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f) { setPreviewUrl(URL.createObjectURL(f)); setResult(null); setError(null); setConfirmed(false); }
  };

  const handleScan = async () => {
    if (!file && !manualText) { setError(zh ? "请选择收据图片或粘贴文字" : "Choisissez une image ou collez le texte"); return; }
    setLoading(true); setError(null);
    try {
      const formData = new FormData();
      if (file) formData.append("file", file);
      if (manualText) formData.append("manual_text", manualText);
      formData.append("locale", locale);
      const res = await fetch("/api/receipt/scan", { method: "POST", body: formData });
      const data = (await res.json()) as ScanResult;
      if (!res.ok) { setError(data.error ?? "Scan failed"); return; }
      setResult(data);
      setEditRoom(data.draft.room_no ?? "");
      setEditAmount(data.draft.amount_xof?.toString() ?? "");
      setEditDate(data.draft.receipt_date ?? "");
      setEditReceiptNo(data.draft.receipt_no ?? "");
      setEditPeriodStart(data.draft.period_start ?? "");
      setEditPeriodEnd(data.draft.period_end ?? "");
      setEditBusinessType(data.draft.business_type ?? "");
      setEditPayer(data.draft.payer_name ?? "");
      setEditNotes(data.draft.notes ?? "");
      setOverrideDuplicate(false);
    } catch { setError(zh ? "扫描失败，请重试" : "Échec du scan"); }
    finally { setLoading(false); }
  };

  const handleConfirm = async (forceOverride = false) => {
    if (!editRoom || !editDate || !editAmount) { setError(zh ? "房号、金额、日期为必填" : "Chambre, montant, date obligatoires"); return; }
    setConfirming(true); setError(null);
    try {
      const res = await fetch("/api/receipt/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_no: editRoom, receipt_no: editReceiptNo || null, receipt_date: editDate,
          amount_xof: parseInt(editAmount, 10) || 0, currency: "XOF",
          period_start: editPeriodStart || null, period_end: editPeriodEnd || null,
          business_type: editBusinessType || null, payer_name: editPayer || null,
          notes: editNotes || null, image_path: result?.imagePath ?? null,
          ocr_text: result?.ocrText ?? null, ocr_provider: result?.ocrProvider ?? "manual",
          overrideDuplicate: forceOverride,
        }),
      });
      const data = (await res.json()) as ConfirmResult;

      if (!data.success && data.requiresOverride) {
        setError(data.duplicateWarning ?? "检测到重复收据");
        setOverrideDuplicate(true);
        return;
      }

      if (!data.success || !res.ok) { setError(data.error ?? data.message ?? (zh ? "入账失败" : "Échec")); return; }

      setConfirmed(true);
      setConfirmResult(data);
      router.refresh();
    } catch { setError(zh ? "确认失败" : "Échec de la confirmation"); }
    finally { setConfirming(false); }
  };

  const labelClass = "text-xs font-medium text-muted-foreground";
  const inputClass = "w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px]";

  return (
    <div className="space-y-4">
      {!confirmed && (
        <>
          <input ref={fileRef} type="file" accept="image/*,.pdf" onChange={handleFileSelect} className="hidden" />
          <div onClick={() => fileRef.current?.click()} className={cn("cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors", file ? "border-primary/30 bg-accent/30" : "border-border hover:border-primary/20 hover:bg-muted/30")}>
            {previewUrl ? <img src={previewUrl} alt="receipt" className="mx-auto max-h-48 rounded-lg object-contain" /> : (
              <div className="space-y-2">
                <ImageUp className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="text-[13px] text-muted-foreground">{zh ? "点击上传收据图片" : "Cliquez pour télécharger"}</p>
                <p className="text-[11px] text-muted-foreground/60">{zh ? "支持 JPG、PNG、PDF" : "JPG, PNG, PDF"}</p>
              </div>
            )}
          </div>

          <button type="button" onClick={() => setShowManualInput(!showManualInput)} className="text-[11px] text-muted-foreground underline">
            {showManualInput ? (zh ? "收起" : "Masquer") : (zh ? "或手动粘贴收据文字" : "Ou collez le texte du reçu")}
          </button>
          {showManualInput && <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder={zh ? "粘贴收据上的文字……" : "Collez le texte du reçu…"} rows={4} className={inputClass} />}

          {!result && (
            <Button onClick={handleScan} disabled={loading} variant="default" className="w-full">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {loading ? (zh ? "识别中……" : "Analyse…") : (zh ? "识别收据" : "Analyser le reçu")}
            </Button>
          )}

          {error && !overrideDuplicate && <p className="text-[13px] text-red-600">{error}</p>}
        </>
      )}

      {/* Duplicate override prompt */}
      {overrideDuplicate && !confirmed && (
        <div className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <p className="text-sm font-semibold text-amber-800">{zh ? "检测到重复收据" : "Reçu en double détecté"}</p>
          <p className="text-xs text-amber-700">{error}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { setOverrideDuplicate(false); setError(null); }}>
              {zh ? "取消" : "Annuler"}
            </Button>
            <Button variant="default" size="sm" className="flex-1" onClick={() => handleConfirm(true)} disabled={confirming}>
              {confirming ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {zh ? "仍然确认入账" : "Confirmer quand même"}
            </Button>
          </div>
        </div>
      )}

      {/* Draft review */}
      {result && !confirmed && !overrideDuplicate && (
        <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-xs font-semibold text-muted-foreground">{zh ? "OCR 识别结果" : "Résultat OCR"} ({result.ocrProvider})</p>
          {result.ocrError && <p className="text-xs text-red-600">{result.ocrError}</p>}
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-2 text-xs text-muted-foreground">{result.ocrText}</pre>

          <div className="space-y-3">
            <p className="text-xs font-semibold">
              {zh ? "AI 解析草稿" : "Brouillon"} — <span className={cn("ml-1", result.draft.confidence === "high" ? "text-green-600" : result.draft.confidence === "medium" ? "text-amber-600" : "text-red-600")}>
                {result.draft.confidence === "high" ? "✓" : result.draft.confidence === "medium" ? "⚠" : "✗"}
              </span>
            </p>
            {result.draft.warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-600">⚠ {w}</p>)}

            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>{zh ? "房号 *" : "Chambre *"}</label><Input value={editRoom} onChange={(e) => setEditRoom(e.target.value)} className={cn(inputClass, !result.draft.room_no && "border-amber-400 bg-amber-50")} /></div>
              <div><label className={labelClass}>{zh ? "金额 (XOF) *" : "Montant *"}</label><Input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className={cn(inputClass, !result.draft.amount_xof && "border-amber-400 bg-amber-50")} /></div>
              <div><label className={labelClass}>{zh ? "收据日期 *" : "Date *"}</label><Input value={editDate} onChange={(e) => setEditDate(e.target.value)} className={cn(inputClass, !result.draft.receipt_date && "border-amber-400 bg-amber-50")} /></div>
              <div><label className={labelClass}>{zh ? "收据号" : "No reçu"}</label><Input value={editReceiptNo} onChange={(e) => setEditReceiptNo(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>{zh ? "周期开始" : "Début période"}</label><Input value={editPeriodStart} onChange={(e) => setEditPeriodStart(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>{zh ? "周期结束" : "Fin période"}</label><Input value={editPeriodEnd} onChange={(e) => setEditPeriodEnd(e.target.value)} className={inputClass} /></div>
              <div>
                <label className={labelClass}>{zh ? "业务类型" : "Type"}</label>
                <select value={editBusinessType} onChange={(e) => setEditBusinessType(e.target.value)} className={inputClass}>
                  <option value="">{zh ? "自动识别" : "Auto"}</option>
                  <option value="lease_rent">{zh ? "长租" : "Loyer"}</option>
                  <option value="managed_lease_rent">{zh ? "代租" : "Gestion"}</option>
                  <option value="daily_rental">{zh ? "日租" : "Journalier"}</option>
                  <option value="sale">{zh ? "出售" : "Vente"}</option>
                  <option value="other">{zh ? "其他" : "Autre"}</option>
                </select>
              </div>
              <div><label className={labelClass}>{zh ? "付款人" : "Payeur"}</label><Input value={editPayer} onChange={(e) => setEditPayer(e.target.value)} className={inputClass} /></div>
            </div>
            <div><label className={labelClass}>{zh ? "备注" : "Notes"}</label><Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className={inputClass} /></div>
          </div>

          <Button onClick={() => handleConfirm(false)} disabled={confirming} variant="default" className="w-full">
            {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {confirming ? "……" : (zh ? "确认入账" : "Confirmer l'écriture")}
          </Button>
        </div>
      )}

      {/* Confirmed */}
      {confirmed && (
        <div className={cn("space-y-3 rounded-xl border p-4 text-center", confirmResult?.unmatchedReceivable ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50")}>
          <Check className={cn("mx-auto h-8 w-8", confirmResult?.unmatchedReceivable ? "text-amber-600" : "text-green-600")} />
          <p className={cn("text-sm font-semibold", confirmResult?.unmatchedReceivable ? "text-amber-800" : "text-green-800")}>
            {confirmResult?.unmatchedReceivable ? (zh ? "收款已入账（未匹配应收款）" : "Paiement enregistré (créance non trouvée)") : (zh ? "收款已确认入账" : "Paiement enregistré")}
          </p>
          {confirmResult?.message && <p className="text-xs text-muted-foreground">{confirmResult.message}</p>}
          {confirmResult?.duplicateWarning && <p className="text-xs text-amber-700">⚠ {confirmResult.duplicateWarning}</p>}
          {confirmResult?.attachmentId && <p className="text-xs text-muted-foreground">{zh ? "附件已保存" : "Pièce jointe sauvegardée"}</p>}
          <Button variant="outline" size="sm" onClick={onClose}>{zh ? "关闭" : "Fermer"}</Button>
        </div>
      )}
    </div>
  );
}
