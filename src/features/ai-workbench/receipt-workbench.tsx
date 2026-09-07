"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageUp, X } from "lucide-react";
import { ReceiptUpload } from "@/features/finance/receipt-upload";

const COPY = {
  zh: {
    button: "凭证入账",
    title: "AI 财务凭证入账",
    description: "提取凭证、核对合同并在人工确认后入账",
    close: "关闭财务凭证入账",
  },
  fr: {
    button: "Saisir un reçu",
    title: "Saisie financière assistée",
    description: "Extraire, rapprocher et confirmer avant l'enregistrement",
    close: "Fermer la saisie du reçu",
  },
} as const;

export function ReceiptWorkbench({ locale }: { locale: "zh" | "fr" }) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const t = COPY[locale];

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-muted"
      >
        <ImageUp className="h-3.5 w-3.5" />
        {t.button}
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center sm:p-6"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-label={t.close}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-workbench-title"
            aria-describedby="receipt-workbench-description"
            className="relative z-10 flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-panel sm:rounded-2xl"
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ImageUp className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="receipt-workbench-title" className="text-sm font-semibold">{t.title}</h2>
                <p id="receipt-workbench-description" className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t.close}
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <ReceiptUpload locale={locale} onClose={() => setOpen(false)} />
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
