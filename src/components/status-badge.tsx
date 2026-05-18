import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UnitStatus } from "@/types/domain";

// Semantic color tokens: each status has bg/text/border via Tailwind classes
const colors: Record<UnitStatus, string> = {
  available: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  reserved: "bg-amber-50 text-amber-700 ring-amber-200",
  daily_occupied: "bg-orange-50 text-orange-700 ring-orange-200",
  cleaning_pending: "bg-sky-50 text-sky-700 ring-sky-200",
  leased: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  sold: "bg-slate-100 text-slate-600 ring-slate-300",
  maintenance: "bg-red-50 text-red-700 ring-red-200",
  locked: "bg-zinc-100 text-zinc-600 ring-zinc-300",
};

export function StatusBadge({ status, locale = "zh" }: { status: UnitStatus; locale?: Locale }) {
  return (
    <span
      role="status"
      aria-label={dictionaries[locale].statuses[status]}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 transition-colors duration-fast",
        colors[status]
      )}
    >
      {dictionaries[locale].statuses[status]}
    </span>
  );
}
