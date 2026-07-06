"use client";

import type { Locale } from "@/lib/i18n";
import type { OptimisticOperation } from "@/hooks/use-optimistic-operation";

interface OperationStatusBannerProps {
  operation: OptimisticOperation | null;
  locale: Locale;
  className?: string;
}

export function OperationStatusBanner({ operation, locale }: OperationStatusBannerProps) {
  if (!operation) return null;

  const stateLabel = operation.state === "syncing"
    ? (locale === "zh" ? "\u540e\u53f0\u540c\u6b65\u4e2d" : "Synchronisation")
    : operation.state === "done"
      ? (locale === "zh" ? "\u5df2\u786e\u8ba4" : "Confirme")
      : (locale === "zh" ? "\u5931\u8d25\uff0c\u5df2\u56de\u6eda" : "Echec, annule");

  return (
    <span
      className="sr-only"
      role="status"
      aria-live="polite"
    >
      {operation.label} {stateLabel}
    </span>
  );
}
