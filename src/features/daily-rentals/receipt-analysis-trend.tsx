"use client";
import { useEffect, useRef, useState } from "react";
import type { ReceiptAnalysis } from "./receipt-analysis-types";
import { number, type Locale } from "./receipt-analysis-format";
import styles from "./receipt-analysis.module.css";

export function ReceiptTrendChart({
  data,
  locale,
  onMonth,
}: {
  data: ReceiptAnalysis;
  locale: Locale;
  onMonth: (month: string) => void;
}) {
  const fr = locale === "fr";
  const trend = data.trend;
  const hasHistory = trend.some((month) => month.count > 0 || month.excludedCount > 0);
  const chartHost = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(640);
  useEffect(() => {
    if (!hasHistory || !chartHost.current) return;
    const node = chartHost.current;
    const measure = () => {
      if (node.clientWidth > 0) setChartWidth(Math.max(240, Math.floor(node.clientWidth)));
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hasHistory]);
  if (!hasHistory)
    return (
      <div className={styles.empty}>
        {fr ? "Aucun historique pour ces filtres." : "当前筛选下暂无完整月趋势记录。"}
      </div>
    );
  const width = chartWidth,
    height = 220,
    left = width < 500 ? 44 : 64,
    right = width < 500 ? 4 : 14,
    top = 26,
    bottom = 38;
  const largest = Math.max(0, ...trend.map((month) => month.net));
  const smallest = Math.min(0, ...trend.map((month) => month.net));
  const max = largest === 0 && smallest === 0 ? 1 : largest * 1.16;
  const min = smallest * 1.16;
  const y = (value: number) => top + ((max - value) / (max - min)) * (height - top - bottom);
  const step = (width - left - right) / Math.max(trend.length, 1);
  const barWidth = step * 0.52;
  const ticks = [max, (max + min) / 2, min];
  return (
    <div className={styles.chartWrap} ref={chartHost}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${width} ${height}`}
        aria-label={
          fr
            ? "Encaissements nets par mois, en dizaines de milliers de XOF"
            : "最近十二个完整月净收款，单位万 XOF"
        }
      >
        <title>
          {fr ? "Sélectionnez un mois pour afficher ses écritures" : "选择月份查看对应收款流水"}
        </title>
        {ticks.map((tick, index) => (
          <g key={index}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
            <text x={left - 10} y={y(tick) + 4} textAnchor="end">
              {number(tick / 10000, locale)}
            </text>
          </g>
        ))}
        <line className={styles.zeroLine} x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
        {trend.map((month, index) => {
          const x = left + index * step + (step - barWidth) / 2;
          const selected = !data.periods.custom && month.month === data.filters.month;
          const noRecord = month.count === 0 && month.excludedCount === 0;
          const label = noRecord
            ? `${month.month} · ${fr ? "Aucune écriture, activité inconnue" : "无记录，不代表零经营"}`
            : `${month.month} · ${fr ? "net" : "净收款"} ${number(month.net, locale)} XOF${month.excludedCount ? ` · ${month.excludedCount} ${fr ? "exclus" : "笔未纳入"}` : ""}`;
          return (
            <g
              key={month.month}
              className={`${styles.bar} ${selected ? styles.barSelected : ""}`}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onMonth(month.month)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onMonth(month.month);
                }
              }}
            >
              <title>{label}</title>
              {!noRecord && (
                <rect
                  x={x}
                  y={Math.min(y(0), y(month.net))}
                  width={barWidth}
                  height={Math.max(2, Math.abs(y(month.net) - y(0)))}
                  rx={3}
                />
              )}
              <rect
                x={left + index * step}
                y={top}
                width={step}
                height={height - top}
                fill="transparent"
                style={{ fill: "transparent" }}
              />
              {(width >= 620 || index % 3 === 0 || index === trend.length - 1) && (
                <text x={x + barWidth / 2} y={height - 15} textAnchor="middle">
                  {month.month.slice(5)}
                  {fr ? "" : "月"}
                </text>
              )}
              {noRecord && (
                <text x={x + barWidth / 2} y={y(0) - 5} textAnchor="middle">
                  —
                </text>
              )}
              {!noRecord && (selected || index === trend.length - 1) && (
                <text
                  x={x + barWidth / 2}
                  y={
                    month.net >= 0
                      ? Math.max(16, y(month.net) - 8)
                      : Math.min(height - bottom + 15, y(month.net) + 15)
                  }
                  textAnchor="middle"
                >
                  {number(month.net / 10000, locale)}
                </text>
              )}
              {month.excludedCount > 0 && (
                <text x={x + barWidth / 2} y={height - 2} textAnchor="middle">
                  !
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
