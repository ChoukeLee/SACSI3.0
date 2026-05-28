import { cn } from "@/lib/utils";

const tones = {
  indigo: "bg-brand-indigo-500",
  green: "bg-brand-green-500",
  amber: "bg-brand-amber-500",
  red: "bg-brand-red-500",
  cyan: "bg-brand-cyan-500",
  purple: "bg-brand-purple-500",
  neutral: "bg-brand-stone-500",
} as const;

export type MetricTone = keyof typeof tones;

interface MetricCardProps {
  title: string;
  value: string;
  caption?: string;
  tone?: MetricTone;
  className?: string;
}

export function MetricCard({ title, value, caption, tone = "indigo", className }: MetricCardProps) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-brand-warm-200 bg-white shadow-card transition duration-150 hover:-translate-y-0.5 hover:shadow-lifted", className)}>
      <div className={cn("h-[3px]", tones[tone])} />
      <div className="px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.04em] text-brand-ink-500">{title}</p>
        <p className="mt-1.5 text-[22px] font-bold tracking-tight text-brand-ink-800 tabular-nums">{value}</p>
        {caption && <p className="mt-1.5 text-[13px] text-brand-ink-400">{caption}</p>}
      </div>
    </div>
  );
}
