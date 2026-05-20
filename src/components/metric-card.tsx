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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-natural transition duration-150 hover:-translate-y-0.5 hover:shadow-lifted">
      <div className={cn("h-[3px]", accentColor[accent])} />
      <div className="px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
        <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-950 tabular-nums">{value}</p>
        <p className="mt-1.5 text-[13px] leading-5 text-slate-500">{caption}</p>
      </div>
    </div>
  );
}
