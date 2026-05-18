import { cn } from "@/lib/utils";

const accentClasses = {
  orange: "border-l-brand-orange-500",
  green: "border-l-brand-green-500",
  ink: "border-l-brand-ink-500",
};

const accentBg = {
  orange: "bg-brand-orange-50",
  green: "bg-brand-green-50",
  ink: "bg-brand-ink-50",
};

export function MetricCard({
  title,
  value,
  caption,
  accent = "orange",
}: {
  title: string;
  value: string;
  caption: string;
  accent?: keyof typeof accentClasses;
}) {
  return (
    <div
      className={cn(
        "group rounded-lg border border-black/10 border-l-[3px] bg-white p-4 shadow-card transition-shadow duration-normal hover:shadow-panel",
        accentClasses[accent]
      )}
    >
      <p className="text-xs font-medium tracking-wide text-brand-ink-500 uppercase">
        {title}
      </p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-brand-ink-900">
        {value}
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", accentBg[accent])} />
        <p className="text-xs leading-relaxed text-brand-ink-500">{caption}</p>
      </div>
    </div>
  );
}
