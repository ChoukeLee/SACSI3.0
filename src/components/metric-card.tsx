import { cn } from "@/lib/utils";

export function MetricCard({
  title, value, caption, accent = "accent",
}: {
  title: string; value: string; caption: string;
  accent?: "accent" | "green" | "ink" | "orange";
}) {
  const barColor: Record<string, string> = {
    accent: "border-brand-orange",
    orange: "border-brand-orange",
    green: "border-brand-green-500",
    ink: "border-brand-ink-700",
  };
  return (
    <div className={cn("rounded-xl border border-brand-warm-300 bg-white px-5 py-4 shadow-natural border-l-[3px]", barColor[accent])}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-brand-ink-400">{title}</p>
      <p className="mt-1.5 text-[26px] font-semibold tracking-tight text-brand-ink-900">{value}</p>
      <p className="mt-1.5 text-[13px] text-brand-ink-400">{caption}</p>
    </div>
  );
}
