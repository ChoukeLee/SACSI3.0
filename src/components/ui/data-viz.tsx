"use client";

import * as React from "react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// ── HSL Color Palette (modern, gradient-friendly) ──

export type ChartTone = "blue" | "green" | "amber" | "red" | "neutral" | "sold" | "leased" | "teal";

const HSL: Record<ChartTone, { base: string; fill: string; glow: string }> = {
  blue:    { base: "hsl(210 90% 50%)", fill: "hsl(210 90% 50% / 0.12)", glow: "hsl(210 90% 55% / 0.25)" },
  green:   { base: "hsl(150 55% 40%)", fill: "hsl(150 55% 40% / 0.12)", glow: "hsl(150 55% 45% / 0.25)" },
  amber:   { base: "hsl(38 85% 45%)", fill: "hsl(38 85% 45% / 0.12)", glow: "hsl(38 85% 48% / 0.25)" },
  red:     { base: "hsl(0 72% 51%)", fill: "hsl(0 72% 51% / 0.10)", glow: "hsl(0 72% 55% / 0.25)" },
  neutral: { base: "hsl(220 8% 46%)", fill: "hsl(220 8% 46% / 0.10)", glow: "hsl(220 8% 50% / 0.20)" },
  sold:    { base: "hsl(32 45% 45%)", fill: "hsl(32 45% 45% / 0.12)", glow: "hsl(32 45% 50% / 0.25)" },
  leased:  { base: "hsl(200 40% 50%)", fill: "hsl(200 40% 50% / 0.12)", glow: "hsl(200 40% 55% / 0.25)" },
  teal:    { base: "hsl(172 55% 42%)", fill: "hsl(172 55% 42% / 0.12)", glow: "hsl(172 55% 48% / 0.25)" },
};

// ── DataVizCard ──

export function DataVizCard({
  title, description, metric, children, className,
}: {
  title: React.ReactNode; description?: React.ReactNode; metric?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "group rounded-2xl border border-border/60 bg-card p-5 shadow-sm transition-shadow duration-300 hover:shadow-md",
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {metric && (
          <div className="shrink-0 rounded-lg bg-muted/50 px-2.5 py-1 text-sm font-bold tabular-nums text-foreground">
            {metric}
          </div>
        )}
      </div>
      {children}
    </motion.section>
  );
}

// ── DonutChart ──

export function DonutChart({
  items, size = 160, stroke = 16, centerValue, centerLabel, animate = true,
}: {
  items: { label: string; value: number; tone?: ChartTone; color?: string }[];
  size?: number; stroke?: number; centerValue?: React.ReactNode; centerLabel?: React.ReactNode;
  animate?: boolean;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* Background ring */}
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(220 14% 92%)" strokeWidth={stroke} />
          {items.map((item, i) => {
            const value = total > 0 ? Math.max(0, item.value) / total : 0;
            const dash = value * circumference;
            const color = item.color ?? HSL[item.tone ?? "blue"].base;
            const seg = (
              <motion.circle
                key={item.label}
                cx={size / 2} cy={size / 2} r={radius}
                fill="none" stroke={color}
                strokeWidth={hoveredIdx === i ? stroke + 4 : stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                style={{ cursor: "pointer", transition: "stroke-width 0.2s" }}
                initial={animate ? { strokeDasharray: `0 ${circumference}` } : undefined}
                animate={{ strokeDasharray: `${dash} ${circumference - dash}` }}
                transition={{ duration: 1, delay: i * 0.08, ease: "easeOut" }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            );
            offset += dash;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={hoveredIdx !== null ? items[hoveredIdx].label : "total"}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
            >
              {hoveredIdx !== null ? (
                <>
                  <span className="text-lg font-bold tabular-nums">{items[hoveredIdx].value}</span>
                  <span className="mt-0.5 block text-[10px] font-medium text-muted-foreground truncate max-w-[100px]">
                    {items[hoveredIdx].label}
                  </span>
                </>
              ) : (
                <>
                  {centerValue && <span className="text-lg font-bold tabular-nums">{centerValue}</span>}
                  {centerLabel && <span className="mt-0.5 block text-[10px] font-medium text-muted-foreground">{centerLabel}</span>}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      {/* Legend */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {items.map((item, i) => {
          const color = item.color ?? HSL[item.tone ?? "blue"].base;
          return (
            <div
              key={item.label}
              className={cn("flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs transition-colors cursor-pointer", hoveredIdx === i && "bg-muted/60")}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="truncate">{item.label}</span>
              </span>
              <span className="font-semibold tabular-nums text-foreground">{item.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BarListChart ──

export function BarListChart({
  items, maxValue, animate = true,
}: {
  items: { label: string; value: number; tone?: ChartTone; color?: string }[];
  maxValue?: number; animate?: boolean;
}) {
  const max = Math.max(maxValue ?? 0, ...items.map((i) => i.value), 1);

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const pct = (item.value / max) * 100;
        const c = HSL[item.tone ?? "blue"];
        const color = item.color ?? c.base;
        return (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-medium text-muted-foreground">{item.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">{item.value}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted/60">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: color }}
                initial={animate ? { width: 0 } : undefined}
                animate={{ width: `${Math.max(pct, 2)}%` }}
                transition={{ duration: 0.6, delay: i * 0.08, ease: "easeOut" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── MiniLineChart ──

export function MiniLineChart({
  values, tone = "blue", height = 120, label,
}: {
  values: number[]; tone?: ChartTone; height?: number; label?: React.ReactNode;
}) {
  const width = 320;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const c = HSL[tone];

  const points = values.map((v, i) => {
    const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 24) - 12;
    return `${x},${y}`;
  });
  const linePath = points.length > 0 ? `M ${points.join(" L ")}` : "";
  const fillPath = linePath ? `${linePath} L ${width},${height} L 0,${height} Z` : "";

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`lineGrad-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.base} stopOpacity="0.25" />
            <stop offset="100%" stopColor={c.base} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Gradient fill */}
        <path d={fillPath} fill={`url(#lineGrad-${tone})`} />
        {/* Line */}
        <motion.path
          d={linePath}
          fill="none"
          stroke={c.base}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
        {/* Glow under line */}
        <path d={linePath} fill="none" stroke={c.base} strokeWidth="6" strokeLinecap="round" opacity="0.12" />
        {/* Endpoint */}
        {values.length > 0 && (
          <circle
            cx={parseFloat(points[points.length - 1]?.split(",")[0] ?? "0")}
            cy={parseFloat(points[points.length - 1]?.split(",")[1] ?? "0")}
            r="5" fill="#fff" stroke={c.base} strokeWidth="2.5"
          />
        )}
      </svg>
      {label && <div className="mt-1 text-xs text-muted-foreground">{label}</div>}
    </div>
  );
}

// ── RadarChart (improved) ──

export function RadarChart({ axes, size = 180 }: { axes: { label: string; value: number; tone?: ChartTone }[]; size?: number }) {
  const center = size / 2;
  const radius = size * 0.36;
  const toPoint = (i: number, v: number) => {
    const angle = -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
    return [center + Math.cos(angle) * radius * Math.max(0, Math.min(1, v)), center + Math.sin(angle) * radius * Math.max(0, Math.min(1, v))];
  };
  const polygon = axes.map((a, i) => toPoint(i, a.value).join(",")).join(" ");
  const grid = [0.33, 0.66, 1].map(l => axes.map((_, i) => toPoint(i, l).join(",")).join(" "));

  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-44 w-44 shrink-0">
        {grid.map((pts, i) => <polygon key={i} points={pts} fill="none" stroke="hsl(220 14% 90%)" strokeWidth="1" />)}
        {axes.map((_, i) => { const [x, y] = toPoint(i, 1); return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="hsl(220 14% 92%)" strokeWidth="1" />; })}
        <motion.polygon
          points={polygon} fill={HSL.blue.fill} stroke={HSL.blue.base}
          strokeWidth="2.5" strokeLinejoin="round"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
        />
      </svg>
      <div className="min-w-0 flex-1 space-y-2">
        {axes.map((a) => (
          <div key={a.label} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{a.label}</span>
              <span className="font-semibold tabular-nums">{Math.round(a.value * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: HSL[a.tone ?? "blue"].base }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(0, Math.min(100, a.value * 100))}%` }}
                transition={{ duration: 0.5, delay: 0.1 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── GroupedBarChart ──

export function GroupedBarChart({
  groups,
  height = 200,
  animate = true,
}: {
  groups: { label: string; series: { label: string; value: number; tone?: ChartTone; color?: string }[] }[];
  height?: number;
  animate?: boolean;
}) {
  const seriesMeta = Array.from(new Set(groups.flatMap((g) => g.series.map((s) => s.label)))).map((label) => {
    const sample = groups.flatMap((g) => g.series).find((s) => s.label === label);
    return { label, tone: sample?.tone ?? "blue" as ChartTone, color: sample?.color };
  });
  const max = Math.max(1, ...groups.flatMap((g) => g.series.map((s) => s.value)));

  const chartW = 720;
  const chartH = height;
  const padX = 44;
  const padTop = 12;
  const padBottom = 28;
  const innerW = chartW - padX * 2;
  const innerH = chartH - padTop - padBottom;
  const groupGap = 28;
  const barGap = 3;
  const groupW = groups.length > 0 ? (innerW - groupGap * (groups.length - 1)) / groups.length : innerW;
  const barW = Math.max(2, (groupW - barGap * (seriesMeta.length - 1)) / Math.max(1, seriesMeta.length));

  return (
    <div>
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full">
        {[0, 0.5, 1].map((f) => {
          const y = padTop + innerH * (1 - f);
          return <line key={f} x1={padX} y1={y} x2={chartW - padX} y2={y} stroke="hsl(220 14% 90%)" strokeWidth="1" />;
        })}
        {groups.map((g, gi) => {
          const groupX = padX + gi * (groupW + groupGap);
          return g.series.map((s, si) => {
            const h = (Math.max(0, s.value) / max) * innerH;
            const x = groupX + si * (barW + barGap);
            const y = padTop + innerH - h;
            const color = s.color ?? HSL[s.tone ?? "blue"].base;
            return (
              <motion.rect
                key={gi + "-" + si}
                x={x} y={animate ? padTop + innerH : y}
                width={barW} height={animate ? 0 : Math.max(h, 1)} rx="2"
                fill={color}
                initial={animate ? { y: padTop + innerH, height: 0 } : undefined}
                animate={{ y, height: Math.max(h, 1) }}
                transition={{ duration: 0.5, delay: gi * 0.05 }}
              />
            );
          });
        })}
        {groups.map((g, gi) => {
          const groupX = padX + gi * (groupW + groupGap);
          return (
            <text key={gi} x={groupX + groupW / 2} y={chartH - 8} textAnchor="middle" fontSize="10" fill="hsl(220 8% 46%)">
              {g.label}
            </text>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3">
        {seriesMeta.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color ?? HSL[s.tone].base }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── MultiLineChart ──

export function MultiLineChart({
  series,
  xLabels,
  height = 200,
}: {
  series: { label: string; values: number[]; tone?: ChartTone; color?: string }[];
  xLabels: string[];
  height?: number;
}) {
  const chartW = 720;
  const chartH = height;
  const padX = 44;
  const padTop = 14;
  const padBottom = 28;
  const innerW = chartW - padX * 2;
  const innerH = chartH - padTop - padBottom;

  const allVals = series.flatMap((s) => s.values);
  const max = Math.max(1, ...allVals);
  const min = Math.min(0, ...allVals);
  const range = Math.max(1, max - min);

  const toPoint = (value: number, idx: number) => {
    const x = xLabels.length <= 1 ? padX : padX + (idx / (xLabels.length - 1)) * innerW;
    const y = padTop + innerH - ((value - min) / range) * innerH;
    return { x, y };
  };

  return (
    <div>
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full">
        {[0, 0.5, 1].map((f) => {
          const y = padTop + innerH * (1 - f);
          return <line key={f} x1={padX} y1={y} x2={chartW - padX} y2={y} stroke="hsl(220 14% 90%)" strokeWidth="1" />;
        })}
        {series.map((s, si) => {
          const color = s.color ?? HSL[s.tone ?? "blue"].base;
          const pts = s.values.map((v, i) => toPoint(v, i));
          const path = pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
          return (
            <motion.path
              key={si}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.2, ease: "easeOut" }}
            />
          );
        })}
        {xLabels.map((lbl, i) => {
          const p = toPoint(0, i);
          return (
            <text key={i} x={p.x} y={chartH - 8} textAnchor="middle" fontSize="10" fill="hsl(220 8% 46%)">
              {lbl}
            </text>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color ?? HSL[s.tone ?? "blue"].base }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── CalendarHeatmap ──

export function CalendarHeatmap({
  rows,
  columns,
  cells,
  legend,
}: {
  rows: { id: string; label: string }[];
  columns: { id: string; label: string }[];
  cells: Record<string, Record<string, ChartTone>>;
  legend: { label: string; tone: ChartTone }[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="overflow-x-auto"
    >
      <div className="min-w-max">
        <div className="flex">
          <div className="w-16 shrink-0" />
          {columns.map((c) => (
            <div key={c.id} className="w-8 shrink-0 pb-1 text-center text-[10px] leading-tight text-muted-foreground">
              {c.label}
            </div>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.id} className="flex items-center">
            <div className="w-16 shrink-0 truncate pr-1 text-right text-[10px] text-muted-foreground">{r.label}</div>
            {columns.map((c) => {
              const tone = cells[r.id]?.[c.id];
              return (
                <div key={c.id} className="p-0.5">
                  <div
                    className="h-6 w-6 rounded-sm"
                    style={{ backgroundColor: tone ? HSL[tone].base : "hsl(220 14% 94%)" }}
                    title={tone ? `${r.label} · ${c.label}` : undefined}
                  />
                </div>
              );
            })}
          </div>
        ))}
        {legend.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: HSL[l.tone].base }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
