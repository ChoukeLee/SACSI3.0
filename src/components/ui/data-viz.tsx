import * as React from "react";
import { cn } from "@/lib/utils";

type ChartTone = "blue" | "green" | "amber" | "red" | "neutral" | "sold" | "leased";

const toneStroke: Record<ChartTone, string> = {
  blue: "#0ea5d7",
  green: "#26a269",
  amber: "#d88406",
  red: "#dc2626",
  neutral: "#181919",
  sold: "#B88A48",
  leased: "#5E9BC5",
};

export function DataVizCard({
  title,
  description,
  metric,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  metric?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4 text-card-foreground shadow-card transition-shadow duration-200", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium leading-tight tracking-tight text-foreground">{title}</h2>
          {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {metric && <div className="shrink-0 text-right text-xl font-semibold leading-none tabular-nums text-foreground">{metric}</div>}
      </div>
      {children}
    </section>
  );
}

export function DonutChart({
  items,
  size = 132,
  stroke = 14,
  centerLabel,
  centerValue,
}: {
  items: { label: string; value: number; tone?: ChartTone; color?: string }[];
  size?: number;
  stroke?: number;
  centerLabel?: React.ReactNode;
  centerValue?: React.ReactNode;
}) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#ecebe8" strokeWidth={stroke} />
          {items.map((item) => {
            const value = total > 0 ? Math.max(0, item.value) / total : 0;
            const dash = value * circumference;
            const segment = (
              <circle
                key={item.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={item.color ?? toneStroke[item.tone ?? "neutral"]}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap={dash > 2 ? "round" : "butt"}
              />
            );
            offset += dash;
            return segment;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerValue && <span className="text-lg font-semibold leading-none tabular-nums">{centerValue}</span>}
          {centerLabel && <span className="mt-1 text-[11px] font-medium text-muted-foreground">{centerLabel}</span>}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color ?? toneStroke[item.tone ?? "neutral"] }} />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="font-semibold tabular-nums text-foreground">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MiniLineChart({
  values,
  tone = "blue",
  height = 112,
  label,
}: {
  values: number[];
  tone?: ChartTone;
  height?: number;
  label?: React.ReactNode;
}) {
  const width = 320;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 18) - 9;
    return `${x},${y}`;
  });
  const fillPath = points.length > 0 ? `M ${points.join(" L ")} L ${width},${height} L 0,${height} Z` : "";

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full overflow-visible">
        <path d={fillPath} fill={toneStroke[tone]} opacity="0.08" />
        <polyline points={points.join(" ")} fill="none" stroke={toneStroke[tone]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {values.map((value, index) => {
          const [x, y] = points[index]?.split(",").map(Number) ?? [0, 0];
          if (index !== values.length - 1 && index !== 0) return null;
          return <circle key={`${index}-${value}`} cx={x} cy={y} r="4" fill="#fff" stroke={toneStroke[tone]} strokeWidth="2" />;
        })}
      </svg>
      {label && <div className="mt-1 text-xs text-muted-foreground">{label}</div>}
    </div>
  );
}

export function RadarChart({
  axes,
  size = 180,
}: {
  axes: { label: string; value: number; tone?: ChartTone }[];
  size?: number;
}) {
  const center = size / 2;
  const radius = size * 0.36;
  const toPoint = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index / axes.length) * Math.PI * 2;
    const r = radius * Math.max(0, Math.min(1, value));
    return [center + Math.cos(angle) * r, center + Math.sin(angle) * r] as const;
  };
  const polygon = axes.map((axis, index) => toPoint(index, axis.value).join(",")).join(" ");
  const grid = [0.33, 0.66, 1].map((level) => axes.map((_, index) => toPoint(index, level).join(",")).join(" "));

  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-44 w-44 shrink-0">
        {grid.map((points, index) => (
          <polygon key={index} points={points} fill="none" stroke="#e5e3e0" strokeWidth="1" />
        ))}
        {axes.map((_, index) => {
          const [x, y] = toPoint(index, 1);
          return <line key={index} x1={center} y1={center} x2={x} y2={y} stroke="#e5e3e0" strokeWidth="1" />;
        })}
        <polygon points={polygon} fill="#0ea5d7" opacity="0.12" stroke="#0ea5d7" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <div className="min-w-0 flex-1 space-y-2">
        {axes.map((axis) => (
          <div key={axis.label} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{axis.label}</span>
              <span className="font-semibold tabular-nums">{Math.round(axis.value * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, axis.value)) * 100}%`, backgroundColor: toneStroke[axis.tone ?? "blue"] }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarListChart({
  items,
  maxValue,
}: {
  items: { label: string; value: number; tone?: ChartTone; color?: string }[];
  maxValue?: number;
}) {
  const max = Math.max(maxValue ?? 0, ...items.map((item) => item.value), 1);

  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const pct = Math.max(0, Math.min(100, (item.value / max) * 100));
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">{item.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: item.color ?? toneStroke[item.tone ?? "blue"],
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
