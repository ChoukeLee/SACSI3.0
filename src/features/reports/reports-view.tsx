"use client";

import { useState, useMemo } from "react";
import { Mail } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import type { LedgerEntryRow, DailyBookingRow, UnitRow, LeaseContractRow, SaleContractRow, SalePaymentScheduleRow } from "@/types/database";

interface ReportsViewProps {
  entries: LedgerEntryRow[];
  bookings: DailyBookingRow[];
  units: UnitRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  saleSchedules: SalePaymentScheduleRow[];
  locale: Locale;
}

function toWanXof(amount: number): string {
  return (amount / 10000).toFixed(2);
}

export function ReportsView({
  entries,
  bookings,
  units,
  leaseContracts,
  saleContracts,
  saleSchedules,
  locale,
}: ReportsViewProps) {
  const t = dictionaries[locale].reports;
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);

  // ── 1. Monthly Summary ──
  const monthlySummary = useMemo(() => {
    const months: Record<string, { income: number; expense: number }> = {};
    for (let m = 1; m <= 12; m++) {
      months[`${year}-${String(m).padStart(2, "0")}`] = { income: 0, expense: 0 };
    }
    for (const e of entries) {
      const key = e.entry_date.slice(0, 7);
      if (!months[key]) continue;
      const amt = Number(e.amount_xof);
      if (e.direction === "income") months[key].income += amt;
      else if (e.direction === "expense") months[key].expense += amt;
    }
    const maxVal = Math.max(1, ...Object.values(months).flatMap(v => [v.income, v.expense]));
    return { months, maxVal };
  }, [entries, year]);

  // ── 2. Daily Rental Occupancy ──
  const occupancy = useMemo(() => {
    const dailyUnits = units.filter(u =>
      u.status === "daily_occupied" || u.status === "available" || u.status === "reserved" || u.status === "cleaning_pending"
    );
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);
    const totalDays = new Date(year, month, 0).getDate();

    const roomStats = dailyUnits.map(unit => {
      const unitBookings = bookings.filter(b => {
        const bCheckOut = b.check_out ?? b.actual_check_out ?? "9999-12-31";
        return b.unit_id === unit.id &&
          b.check_in < monthEnd &&
          bCheckOut > monthStart &&
          b.status !== "cancelled";
      });
      let nightsBooked = 0;
      for (const b of unitBookings) {
        const bCheckOut = b.check_out ?? b.actual_check_out ?? "9999-12-31";
        const start = new Date(Math.max(new Date(b.check_in).getTime(), new Date(monthStart).getTime()));
        const end = new Date(Math.min(new Date(bCheckOut).getTime(), new Date(monthEnd).getTime()));
        const nights = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
        nightsBooked += nights;
      }
      return { unitNo: unit.unit_no, nightsBooked, nightsAvailable: totalDays, rate: totalDays > 0 ? Math.round((nightsBooked / totalDays) * 100) : 0 };
    }).filter(r => r.nightsBooked > 0)
    .sort((a, b) => b.rate - a.rate);

    const totalBooked = roomStats.reduce((s, r) => s + r.nightsBooked, 0);
    const totalAvailable = dailyUnits.length * totalDays;
    const overallRate = totalAvailable > 0 ? Math.round((totalBooked / totalAvailable) * 100) : 0;

    return { roomStats, totalBooked, totalAvailable, overallRate, totalDays };
  }, [bookings, units, year, month]);

  // ── 3. Long Lease Vacancy ──
  const vacancy = useMemo(() => {
    const leasableUnits = units.filter(u => u.kind === "apartment");
    const leasedCount = leaseContracts.filter(c => c.status === "active").length;
    const vacantCount = leasableUnits.length - leasedCount;
    const rate = leasableUnits.length > 0 ? Math.round((vacantCount / leasableUnits.length) * 100) : 0;
    return { total: leasableUnits.length, leased: leasedCount, vacant: Math.max(0, vacantCount), rate };
  }, [units, leaseContracts]);

  // ── 4. Sale Payment Progress ──
  const saleProgress = useMemo(() => {
    return saleContracts
      .filter(c => c.status === "active")
      .map(c => {
        const schedules = saleSchedules.filter(s => s.sale_contract_id === c.id);
        const totalSchedule = schedules.reduce((s, i) => s + Number(i.amount_xof), 0);
        const paidSchedule = schedules.filter(s => s.status === "paid").reduce((s, i) => s + Number(i.amount_xof), 0);
        const progress = totalSchedule > 0 ? Math.round((paidSchedule / totalSchedule) * 100) : 0;
        return { contractNo: c.contract_no, totalAmount: Number(c.total_amount_xof), paidAmount: paidSchedule, progress, remaining: Math.max(0, Number(c.total_amount_xof) - paidSchedule) };
      })
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }, [saleContracts, saleSchedules]);

  const barClass = "rounded-sm bg-brand-orange transition-all";
  const expBarClass = "rounded-sm bg-brand-red-400 transition-all";

  return (
    <div className="space-y-8">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-ink-300">{t.dateRange}</span>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded border border-brand-warm-400 px-3 py-1.5 text-sm">
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded border border-brand-warm-400 px-3 py-1.5 text-sm">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button disabled className="ml-auto inline-flex items-center gap-1.5 rounded border border-brand-warm-400 px-3 py-1.5 text-xs font-medium text-brand-ink-300">
          <Mail className="h-3.5 w-3.5" />{t.emailSchedule}
        </button>
      </div>

      {/* 1. Monthly Summary */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <h3 className="text-base font-bold text-brand-ink-900">{t.monthlySummary.title} ({year})</h3>
        <p className="text-xs text-brand-ink-300 mb-3">{t.unit}</p>
        {Object.values(monthlySummary.months).every(v => v.income === 0 && v.expense === 0) ? (
          <p className="py-8 text-center text-sm text-brand-ink-300">{t.empty}</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(monthlySummary.months).map(([key, val]) => {
              const incomeW = Math.round((val.income / monthlySummary.maxVal) * 100);
              const expenseW = Math.round((val.expense / monthlySummary.maxVal) * 100);
              return (
                <div key={key} className="flex items-center gap-3 text-xs">
                  <span className="w-16 shrink-0 text-brand-ink-400">{key.slice(5)}月</span>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="w-8 text-right text-brand-green-600">{toWanXof(val.income)}</span>
                      <div className="h-3 flex-1 rounded-sm bg-brand-warm-100">
                        <div className={cn(barClass, "h-3")} style={{ width: `${Math.max(1, incomeW)}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-8 text-right text-brand-red-500">{toWanXof(val.expense)}</span>
                      <div className="h-3 flex-1 rounded-sm bg-brand-warm-100">
                        <div className={cn(expBarClass, "h-3")} style={{ width: `${Math.max(1, expenseW)}%` }} />
                      </div>
                    </div>
                  </div>
                  <span className={cn("w-16 text-right font-semibold", val.income - val.expense >= 0 ? "text-brand-green-700" : "text-brand-red-700")}>
                    {toWanXof(val.income - val.expense)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Occupancy Rate */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <h3 className="text-base font-bold text-brand-ink-900">{t.occupancy.title} ({month}月 {year})</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div className="rounded bg-brand-green-50 p-3 text-center">
            <p className="text-xs text-brand-green-600">{t.occupancy.rate}</p>
            <p className="text-3xl font-bold text-brand-green-700">{occupancy.overallRate}%</p>
          </div>
          <div className="rounded bg-brand-sky-50 p-3 text-center">
            <p className="text-xs text-brand-sky-600">{t.occupancy.nightsBooked}</p>
            <p className="text-3xl font-bold text-brand-sky-700">{occupancy.totalBooked}</p>
          </div>
          <div className="rounded bg-brand-warm-50 p-3 text-center">
            <p className="text-xs text-brand-ink-500">{t.occupancy.totalDays} / {t.occupancy.nightsAvailable}</p>
            <p className="text-3xl font-bold text-brand-ink-600">{occupancy.totalDays}天 / {occupancy.totalAvailable}</p>
          </div>
        </div>
        {occupancy.roomStats.length === 0 ? (
          <p className="py-8 text-center text-sm text-brand-ink-300">{t.empty}</p>
        ) : (
          <div className="mt-4 space-y-1.5">
            {occupancy.roomStats.slice(0, 10).map(r => (
              <div key={r.unitNo} className="flex items-center gap-3 text-xs">
                <span className="w-12 font-semibold text-brand-ink-900">{r.unitNo}</span>
                <div className="h-4 flex-1 rounded-sm bg-brand-warm-100">
                  <div className="h-4 rounded-sm bg-brand-green-400" style={{ width: `${Math.max(2, r.rate)}%` }} />
                </div>
                <span className="w-10 text-right font-medium text-brand-ink-500">{r.rate}%</span>
                <span className="w-16 text-right text-brand-ink-300">{r.nightsBooked}/{r.nightsAvailable}晚</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. Vacancy Rate */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <h3 className="text-base font-bold text-brand-ink-900">{t.vacancy.title}</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-4">
          <div className="rounded bg-brand-warm-50 p-3 text-center">
            <p className="text-xs text-brand-ink-500">{t.vacancy.totalUnits}</p>
            <p className="text-2xl font-bold text-brand-ink-600">{vacancy.total}</p>
          </div>
          <div className="rounded bg-brand-sky-50 p-3 text-center">
            <p className="text-xs text-brand-sky-600">{t.vacancy.leasedUnits}</p>
            <p className="text-2xl font-bold text-brand-sky-700">{vacancy.leased}</p>
          </div>
          <div className="rounded bg-brand-amber-50 p-3 text-center">
            <p className="text-xs text-brand-amber-600">{t.vacancy.vacantUnits}</p>
            <p className="text-2xl font-bold text-brand-amber-700">{vacancy.vacant}</p>
          </div>
          <div className="rounded bg-brand-red-50 p-3 text-center">
            <p className="text-xs text-brand-red-600">{t.vacancy.rate}</p>
            <p className="text-2xl font-bold text-brand-red-700">{vacancy.rate}%</p>
          </div>
        </div>
        {/* Vacancy bar */}
        <div className="mt-4 h-4 overflow-hidden rounded-full bg-brand-warm-100">
          <div className="h-full rounded-full bg-brand-sky-400" style={{ width: `${Math.max(2, 100 - vacancy.rate)}%` }} />
        </div>
        <p className="mt-1 text-xs text-brand-ink-300 text-right">{100 - vacancy.rate}% 已租 / {vacancy.rate}% 空置</p>
      </section>

      {/* 4. Sale Payment Progress */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <h3 className="text-base font-bold text-brand-ink-900">{t.saleProgress.title}</h3>
        {saleProgress.length === 0 ? (
          <p className="py-8 text-center text-sm text-brand-ink-300">{t.empty}</p>
        ) : (
          <div className="mt-3 space-y-3">
            {saleProgress.map(c => (
              <div key={c.contractNo} className="flex items-center gap-3 text-xs">
                <span className="w-24 shrink-0 font-semibold text-brand-ink-900">{c.contractNo}</span>
                <div className="flex-1">
                  <div className="flex justify-between text-brand-ink-400 mb-0.5">
                    <span>{formatXof(c.paidAmount)} / {formatXof(c.totalAmount)}</span>
                    <span className="font-semibold">{c.progress}%</span>
                  </div>
                  <div className="h-3 rounded-sm bg-brand-warm-100">
                    <div className="h-3 rounded-sm bg-brand-orange" style={{ width: `${Math.max(2, c.progress)}%` }} />
                  </div>
                </div>
                <span className="w-24 text-right text-brand-ink-300">{t.saleProgress.remaining}: {formatXof(c.remaining)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
