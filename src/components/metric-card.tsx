import { cn } from "@/lib/utils";

/* REFINED: minimal accent strip, generous padding, refined typography */
export function MetricCard({
  title, value, caption, accent = "accent",
}: {
  title: string; value: string; caption: string;
  accent?: "accent" | "green" | "ink" | "orange";
}) {
  const barColor: Record<string, string> = {
    accent: "border-brand-accent", orange: "border-brand-accent",
    green: "border-brand-green",
    ink: "border-brand-ink-700",
  };
  return (
    <div className={cn("rounded-lg border border-brand-ink-100 bg-white px-5 py-4 shadow-soft border-l-[3px]", barColor[accent])}>
      <p className="text-[11px] font-medium uppercase tracking-widen text-brand-ink-400">{title}</p>
      <p className="mt-2 text-[28px] font-semibold tracking-tighten text-brand-ink-900">{value}</p>
      <p className="mt-1.5 text-[13px] text-brand-ink-400">{caption}</p>
    </div>
  );
}
