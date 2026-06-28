"use client";

import type { Locale } from "@/lib/i18n";
import type { OptimisticOperation } from "@/hooks/use-optimistic-operation";
import { cn } from "@/lib/utils";

interface OperationStatusBannerProps {
  operation: OptimisticOperation | null;
  locale: Locale;
  className?: string;
}

export function OperationStatusBanner({ operation, locale, className }: OperationStatusBannerProps) {
  if (!operation) return null;

  return (
    <div
      className={cn(
        "sticky top-14 z-30 flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold shadow-card",
        operation.state === "failed"
          ? "border-accentRed-200 bg-accentRed-50 text-accentRed-700"
          : operation.state === "done"
            ? "border-accentGreen-200 bg-accentGreen-50 text-accentGreen-700"
            : "border-primary/15 bg-primary/5 text-primary",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span>{operation.label}</span>
      <span className="font-medium">
        {operation.state === "syncing"
          ? (locale === "zh" ? "\u540e\u53f0\u540c\u6b65\u4e2d" : "Synchronisation")
          : operation.state === "done"
            ? (locale === "zh" ? "\u5df2\u786e\u8ba4" : "Confirme")
            : (locale === "zh" ? "\u5931\u8d25\uff0c\u5df2\u56de\u6eda" : "Echec, annule")}
      </span>
    </div>
  );
}
