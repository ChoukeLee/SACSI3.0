import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UnitStatus } from "@/types/domain";

/* REFINED: Subtle tints, single ring, less saturated — premium minimal */
const colors: Record<UnitStatus, string> = {
  available: "bg-brand-green-50 text-brand-green ring-brand-green-100",
  reserved: "bg-brand-amber-50 text-brand-amber ring-brand-amber-100",
  daily_occupied: "bg-brand-accent-50 text-brand-accent ring-brand-accent-100",
  cleaning_pending: "bg-brand-sky-50 text-brand-sky ring-brand-sky-100",
  leased: "bg-brand-ink-50 text-brand-ink-600 ring-brand-ink-200",
  sold: "bg-brand-ink-100 text-brand-ink-500 ring-brand-ink-200",
  maintenance: "bg-brand-red-50 text-brand-red ring-brand-red-100",
  locked: "bg-brand-ink-100 text-brand-ink-400 ring-brand-ink-200",
};

export function StatusBadge({ status, locale = "zh" }: { status: UnitStatus; locale?: Locale }) {
  return (
    <span
      role="status"
      aria-label={dictionaries[locale].statuses[status]}
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        colors[status]
      )}
    >
      {dictionaries[locale].statuses[status]}
    </span>
  );
}
