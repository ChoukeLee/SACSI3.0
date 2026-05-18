import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UnitStatus } from "@/types/domain";

/* MACOS-STYLE: soft tints, ring-inset, Apple-style subtle badges */
const colors: Record<UnitStatus, string> = {
  available: "bg-brand-green-50 text-brand-green ring-brand-green/20",
  reserved: "bg-brand-amber-50 text-brand-amber ring-brand-amber/20",
  daily_occupied: "bg-brand-blue-50 text-brand-blue ring-brand-blue/20",
  cleaning_pending: "bg-brand-sky-50 text-brand-sky ring-brand-sky/20",
  leased: "bg-brand-ink-100 text-brand-ink-600 ring-brand-ink-200/50",
  sold: "bg-brand-ink-200 text-brand-ink-500 ring-brand-ink-200/50",
  maintenance: "bg-brand-red-50 text-brand-red ring-brand-red/20",
  locked: "bg-brand-ink-200 text-brand-ink-400 ring-brand-ink-200/50",
};

export function StatusBadge({ status, locale = "zh" }: { status: UnitStatus; locale?: Locale }) {
  return (
    <span
      role="status"
      aria-label={dictionaries[locale].statuses[status]}
      className={cn("inline-flex items-center rounded-md px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", colors[status])}
    >
      {dictionaries[locale].statuses[status]}
    </span>
  );
}
