import { cn } from "@/lib/utils";

export function MetricCard({
  title, value, caption, accent = "accent",
}: {
  title: string; value: string; caption: string;
  accent?: "accent" | "green" | "ink" | "orange";
}) {
  const accentColor: Record<string, string> = {
    accent: "bg-brand-orange",
    orange: "bg-brand-orange",
    green: "bg-brand-green-500",
    ink: "bg-brand-ink-700",
  };
  return (
    <div className="rounded-xl border border-brand-warm-300 bg-white shadow-natural overflow-hidden">
      <div className={cn("h-[3px]", accentColor[accent])} />
      <div className="px-5 py-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-brand-ink-400">{title}</p>
        <p className="mt-1.5 text-[26px] font-semibold tracking-tight text-brand-ink-900 tabular-nums">{value}</p>
        <p className="mt-1.5 text-[13px] text-brand-ink-400">{caption}</p>
      </div>
    </div>
  );
}
