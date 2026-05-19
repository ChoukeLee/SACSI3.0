import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UnitStatus } from "@/types/domain";

const colors: Record<UnitStatus, string> = {
  available: "bg-brand-green-50 text-brand-green-700 ring-brand-green-200/50",
  reserved: "bg-brand-amber-50 text-brand-amber-700 ring-brand-amber-200/50",
  daily_occupied: "bg-brand-orange-50 text-brand-orange-700 ring-brand-orange-200/50",
  cleaning_pending: "bg-brand-sky-50 text-brand-sky-700 ring-brand-sky-200/50",
  leased: "bg-brand-warm-200 text-brand-ink-600 ring-brand-warm-400/50",
  sold: "bg-brand-warm-200 text-brand-ink-500 ring-brand-warm-400/50",
  maintenance: "bg-brand-red-50 text-brand-red-700 ring-brand-red-200/50",
  locked: "bg-brand-warm-200 text-brand-ink-400 ring-brand-warm-400/50",
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
