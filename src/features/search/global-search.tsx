"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageUp, X } from "lucide-react";
import { ReceiptUpload } from "@/features/finance/receipt-upload";

export function GlobalSearch({ locale }: { locale: "zh" | "fr" }) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const zh = locale === "zh";

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    setTimeout(() => closeButtonRef.current?.focus(), 50);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="hidden h-8 w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/55 px-2.5 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:bg-card hover:text-foreground sm:flex"
        >
          <ImageUp className="h-3.5 w-3.5" />
          <span className="hidden truncate lg:inline">{zh ? "收据扫描" : "Scan reçu"}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center justify-center rounded-lg border border-border bg-muted/50 p-1.5 text-muted-foreground hover:bg-muted sm:hidden"
          aria-label={zh ? "收据扫描" : "Scanner un reçu"}
        >
          <ImageUp className="h-4 w-4" />
        </button>
      </>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[8vh] sm:pt-[10vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[1px]" />
      <div
        className="relative mx-2 flex h-[85vh] max-h-[640px] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-panel sm:mx-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <ImageUp className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium tracking-tight">{zh ? "收据扫描入账" : "Scan de reçu"}</p>
            <p className="text-xs text-muted-foreground">
              {zh ? "上传收据，识别后确认入账" : "Télécharger, analyser, puis confirmer"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={zh ? "关闭" : "Fermer"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-4">
          <ReceiptUpload locale={locale} onClose={() => setOpen(false)} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
