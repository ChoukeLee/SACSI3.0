"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  locale: Locale;
  loading?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  locale,
  loading = false,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || !portalTarget) return null;

  const t = dictionaries[locale].mobile.actions;

  return createPortal(
    <div
      data-mobile-modal="true"
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={loading ? undefined : onClose} />
      <div
        className="relative flex max-h-[calc(100dvh-var(--safe-top)-0.5rem)] w-full max-w-sm flex-col overflow-hidden rounded-t-xl bg-card shadow-panel animate-in slide-in-from-bottom-4 duration-fast sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-confirm-title"
      >
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          aria-label={t.cancel}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-4 pt-5">
          <div className="mb-4 flex items-start gap-3 pr-8">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accentRed-50">
              <AlertTriangle className="h-5 w-5 text-accentRed-600" />
            </div>
            <div>
              <h3 id="mobile-confirm-title" className="text-base font-semibold leading-6 text-foreground">{title}</h3>
              {description && (
                <p className="mt-1 text-sm leading-5 text-foreground/60">{description}</p>
              )}
            </div>
          </div>

          {children}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-border bg-card px-5 pb-[calc(1rem+var(--safe-bottom))] pt-3 sm:flex sm:justify-end sm:pb-4">
          <Button variant="outline" onClick={onClose} disabled={loading} className="min-h-11 sm:min-h-9">
            {cancelLabel ?? t.cancel}
          </Button>
          <Button
            variant="default"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className="min-h-11 sm:min-h-9"
          >
            {confirmLabel ?? t.confirm}
          </Button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
