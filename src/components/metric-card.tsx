import { cn } from "@/lib/utils";

export function MetricCard({
  title, value, caption, accent = "accent",
}: {
  title: string; value: string; caption: string;
  accent?: "accent" | "green" | "ink" | "orange";
}) {
  const accentColor: Record<string, string> = {
    accent: "bg-brand-indigo",
    orange: "bg-brand-indigo",
    green: "bg-brand-green-500",
    ink: "bg-brand-neutral-950",
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-natural transition duration-150 hover:-translate-y-0.5 hover:shadow-lifted">
      <div className={cn("h-[3px]", accentColor[accent])} />
      <div className="px-5 py-4">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-brand-neutral-800">{title}</p>
        <p className="mt-1.5 text-2xl font-black tracking-tight text-brand-neutral-950 tabular-nums">{value}</p>
        <p className="mt-1.5 text-[13px] leading-5 text-brand-neutral-900">{caption}</p>
      </div>
    </div>
  );
}
