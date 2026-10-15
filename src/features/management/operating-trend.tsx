"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { OperatingSnapshot } from "./operating-snapshot";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import styles from "./operating.module.css";

export function OperatingTrend({
  snapshot,
  locale,
}: {
  snapshot: OperatingSnapshot;
  locale: Locale;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth) setWidth(Math.max(260, element.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const zh = locale === "zh";
  const number = new Intl.NumberFormat(zh ? "zh-CN" : "fr-FR", { maximumFractionDigits: 1 });
  const exact = new Intl.NumberFormat(zh ? "zh-CN" : "fr-FR", { maximumFractionDigits: 2 });
  const left = width < 480 ? 46 : 62,
    right = 10,
    top = 20,
    bottom = 35,
    height = 236;
  const max = Math.max(1, ...snapshot.trend.map((row) => row.net)) * 1.12;
  const min = Math.min(0, ...snapshot.trend.map((row) => row.net)) * 1.12;
  const y = (value: number) => top + ((max - value) / (max - min)) * (height - top - bottom);
  const step = (width - left - right) / 12;
  const href = (month: string) => {
    const [year, m] = month.split("-").map(Number);
    return routeFor(
      locale,
      `/finance?${new URLSearchParams({ projectId: snapshot.projectId, dateFrom: `${month}-01`, dateTo: new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10) })}`,
    );
  };
  return (
    <div ref={host}>
      <div className={styles.chartUnit}>
        {zh ? "万 XOF · 已录净收款" : "10 000 XOF · encaissements nets enregistrés"}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.chart}
        role="img"
        aria-label={
          zh
            ? "按收款日期统计的十二个月净收款；无记录不代表零经营"
            : "Encaissements nets par date de paiement; absence de données ne signifie pas activité nulle"
        }
      >
        <title>
          {zh
            ? "最近十二个月净收款，本月为截至今日的未完结月份"
            : "Douze mois, mois en cours arrêté à ce jour"}
        </title>
        {[max, (max + min) / 2, min].map((tick, index) => (
          <g key={index}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
            <text x={left - 8} y={y(tick) + 4} textAnchor="end">
              {number.format(tick / 10000)}
            </text>
          </g>
        ))}
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
        {snapshot.trend.map((row, index) => (
          <g key={row.month}>
            <title>{`${row.month} · ${row.count ? `${exact.format(row.net)} XOF` : zh ? "无可纳入记录" : "Aucune écriture incluse"}${row.excluded ? ` · ${row.excluded} ${zh ? "笔未纳入" : "exclues"}` : ""}`}</title>
            {row.count > 0 && row.net !== 0 && (
              <rect
                x={left + step * (index + 0.22)}
                y={Math.min(y(0), y(row.net))}
                width={step * 0.56}
                height={Math.abs(y(row.net) - y(0))}
                rx={3}
                className={index === 11 ? styles.currentBar : styles.bar}
              />
            )}
            {row.count === 0 && (
              <text x={left + step * (index + 0.5)} y={y(0) - 6} textAnchor="middle">
                —
              </text>
            )}
            {(width > 500 || index % 3 === 0 || index === 11) && (
              <text x={left + step * (index + 0.5)} y={height - 13} textAnchor="middle">
                {row.month.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <details className={styles.chartDetails}>
        <summary>
          {zh ? "查看每月金额与明细入口" : "Montants et accès aux écritures mensuelles"}
        </summary>
        <div className={styles.months}>
          {snapshot.trend.map((row) => (
            <Link key={row.month} href={href(row.month)}>
              <span>{row.month}</span>
              <strong>
                {row.count ? `${exact.format(row.net)} XOF` : zh ? "无记录" : "Sans écriture"}
              </strong>
            </Link>
          ))}
        </div>
      </details>
      <p className={styles.note}>
        {zh
          ? "按真实收款日期，押金、费用、非现金抵扣另列；无法分类的记录不纳入。无记录不代表零经营，本月尚未结束。"
          : "Dates de paiement réelles; dépôts, charges et compensations séparés. Écritures non classées exclues. Mois en cours partiel."}
      </p>
    </div>
  );
}
