"use client";

import { useState } from "react";
import { FileText, ImageUp, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { currencyDisplayLabel, financialBusinessLabel, statusDisplayLabel } from "@/lib/display-labels";

interface AttachmentMeta {
  id: string;
  storage_path: string;
  file_type?: string;
  ocr_text?: string | null;
  ocr_provider?: string | null;
  metadata?: Record<string, unknown> | null;
  paper_archive_status?: string;
  paper_archive_location?: string | null;
  uploaded_at?: string;
}
interface Props { attachment: AttachmentMeta; locale: "zh" | "fr"; }

export function ReceiptThumb({ attachment, locale }: Props) {
  const zh = locale === "zh";
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    setOpen(true);
    if (url) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/attachments/${attachment.id}/signed-url`);
      const data = await res.json();
      setUrl(data.signedUrl ?? null);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const meta = (attachment.metadata ?? {}) as Record<string, unknown>;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ImageUp className="h-3.5 w-3.5" />
        {zh ? "查看收据" : "Voir reçu"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="relative mx-2 max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-card shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <p className="text-sm font-medium">{zh ? "收据凭证" : "Reçu"}</p>
              <button onClick={() => setOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              {loading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
              {url && <img src={url} alt="receipt" className="w-full rounded-xl border border-border" />}
              {!url && !loading && <p className="text-center text-sm text-muted-foreground">{zh ? "无法加载图片" : "Image non disponible"}</p>}

              <div className="space-y-1 text-[12px] text-muted-foreground">
                {meta.receipt_no != null && <p>{zh ? "收据号" : "No"}: {String(meta.receipt_no)}</p>}
                {meta.receipt_date != null && <p>{zh ? "日期" : "Date"}: {String(meta.receipt_date)}</p>}
                {meta.amount_xof != null && <p>{zh ? "金额" : "Montant"}: {Number(meta.amount_xof).toLocaleString()} {currencyDisplayLabel("XOF", locale)}</p>}
                {meta.business_type != null && <p>{zh ? "类型" : "Type"}: {financialBusinessLabel(String(meta.business_type), locale)}</p>}
              </div>

              {attachment.ocr_text && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-muted-foreground">{zh ? "OCR 原文" : "Texte OCR"}</summary>
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/20 p-2">{attachment.ocr_text}</pre>
                </details>
              )}

              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span>{zh ? "纸质归档" : "Archive"}: <span className={cn("font-semibold", attachment.paper_archive_status === "archived" ? "text-green-600" : attachment.paper_archive_status === "missing" ? "text-red-600" : "text-amber-600")}>{statusDisplayLabel(attachment.paper_archive_status ?? "pending", locale)}</span></span>
                {attachment.paper_archive_location && <span>{attachment.paper_archive_location}</span>}
                {attachment.uploaded_at && <span className="ml-auto">{new Date(attachment.uploaded_at).toLocaleDateString()}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
