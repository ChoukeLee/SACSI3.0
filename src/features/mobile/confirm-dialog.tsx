"use client";

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
}: ConfirmDialogProps) {
  if (!open) return null;

  const t = dictionaries[locale].mobile.actions;

  return (
    <div className="fixed inset-0 z-overlay flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-panel animate-in slide-in-from-bottom-4 duration-fast">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground/60 hover:bg-muted"
          aria-label={t.cancel}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3 mb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accentRed-50">
            <AlertTriangle className="h-5 w-5 text-accentRed-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
            {description && (
              <p className="mt-1 text-xs text-foreground/60">{description}</p>
            )}
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {cancelLabel ?? t.cancel}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onConfirm}
            disabled={loading}
          >
            {confirmLabel ?? t.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
