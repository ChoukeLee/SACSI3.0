"use client";

import { useState, useMemo, useCallback } from "react";
import { Copy, Printer, Check } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { calculateBilling } from "./billing";

/* PERF: static billing mode labels — avoids function call per row */
const BILLING_MODE_ZH: Record<string, string> = { fixed: "固定离店", open: "开放式入住" };
const BILLING_MODE_FR: Record<string, string> = { fixed: "Départ fixe", open: "Séjour ouvert" };

interface OverviewViewProps {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  cleaningTasks: { id: string; unit_id: string; is_completed: boolean }[];
  locale: Locale;
}

export function OverviewView({ dailyUnits, bookings, customers, payments, cleaningTasks, locale }: OverviewViewProps) {
  const t = dictionaries[locale].dailyOccupancy;
  const tDR = dictionaries[locale].dailyRentals;
  const statusLabels = dictionaries[locale].statuses;
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [copied, setCopied] = useState(false);

  // Active bookings: checked_in or confirmed (showing occupancy)
  const activeBookings = useMemo(() =>
    bookings.filter(b => b.status === "checked_in" || b.status === "confirmed"),
    [bookings]
  );

  // Room-status map for the selected date
  const unitStatusMap = useMemo(() => {
    const map: Record<string, { booking: DailyBookingRow | null; status: string; unit: UnitRow }> = {};
    for (const unit of dailyUnits) {
      // Find active booking for this unit on selectedDate
      const booking = activeBookings.find(b => {
        if (b.unit_id !== unit.id) return false;
        const checkIn = b.check_in;
        const checkOut = b.checkout_mode === "open" ? (b.actual_check_out ?? "9999-12-31") : (b.check_out ?? checkIn);
        return selectedDate >= checkIn && selectedDate < checkOut;
      }) ?? null;

      let displayStatus = unit.status;
      if (booking) {
        displayStatus = "daily_occupied";
      } else if (unit.status === "cleaning_pending") {
        displayStatus = "cleaning_pending";
      } else if (unit.status === "maintenance" || unit.status === "locked") {
        displayStatus = unit.status;
      } else {
        displayStatus = "available";
      }

      map[unit.id] = { booking, status: displayStatus, unit };
    }
    return map;
  }, [dailyUnits, activeBookings, selectedDate]);

  // Room rows for the table
  const roomRows = useMemo(() => {
    return dailyUnits.map(unit => {
      const info = unitStatusMap[unit.id];
      const booking = info?.booking;
      const customer = booking ? customers.find(c => c.id === booking.customer_id) : null;
      const billing = booking ? calculateBilling(booking, selectedDate) : null;
      const unitPayments = booking ? payments.filter(p => p.source_id === booking.id) : [];
      const totalPaid = unitPayments.reduce((s, p) => s + Number(p.amount), 0);

      return {
        unit,
        booking,
        customer,
        billing,
        totalPaid,
        status: info?.status ?? unit.status,
      };
    });
  }, [dailyUnits, unitStatusMap, customers, payments, selectedDate]);

  // Summary
  const summary = useMemo(() => {
    const occupied = roomRows.filter(r => r.status === "daily_occupied").length;
    const checkoutsToday = roomRows.filter(r => r.booking?.checkout_mode === "fixed" && r.booking?.check_out === selectedDate).length;
    const cleaning = roomRows.filter(r => r.status === "cleaning_pending").length;
    const available = roomRows.filter(r => r.status === "available").length;
    const openEnded = roomRows.filter(r => r.booking?.checkout_mode === "open").length;
    const outstanding = roomRows.filter(r => (r.billing?.outstanding ?? 0) > 0).length;
    return { total: dailyUnits.length, occupied, checkoutsToday, cleaning, available, openEnded, outstanding };
  }, [roomRows, dailyUnits.length, selectedDate]);

  // ── Copy text ──
  const buildShareText = useCallback(() => {
    const dateFormatted = new Date(selectedDate).toLocaleDateString(
      locale === "fr" ? "fr-FR" : "zh-CN", { day: "2-digit", month: "2-digit", year: "numeric" }
    );
    let text = `11# ${locale === "zh" ? "日租房态" : "Occupation journalière"} ${dateFormatted}\n`;

    // Occupied rooms
    const occupied = roomRows.filter(r => r.booking);
    if (occupied.length > 0) {
      text += `\n${locale === "zh" ? "占用" : "Occupé"}: ${occupied.length}\n`;
      for (const r of occupied) {
        const abbr = r.customer?.name?.slice(0, 6) ?? "?";
        const b = r.billing;
        text += `${r.unit.unit_no} ${abbr}`;
        text += `, ${locale === "zh" ? "入住" : "Arrivée"} ${r.booking?.check_in}`;
        if (r.booking?.checkout_mode === "fixed" && r.booking?.check_out) {
          text += `, ${locale === "zh" ? "预计退房" : "Départ prévu"} ${r.booking.check_out}`;
        } else {
          text += `, ${locale === "zh" ? "未定离店" : "Départ ouvert"}`;
        }
        if (b) {
          text += `, ${locale === "zh" ? "已住" : "Nuits"} ${b.nights}`;
          text += `, ${locale === "zh" ? "已收" : "Payé"} ${b.paid.toLocaleString()}`;
          if (b.outstanding > 0) text += `, ${locale === "zh" ? "待补" : "Dû"} ${b.outstanding.toLocaleString()}`;
        }
        text += "\n";
      }
    }

    // Today's checkouts
    const checkingOut = roomRows.filter(r => r.booking?.checkout_mode === "fixed" && r.booking?.check_out === selectedDate);
    if (checkingOut.length > 0) {
      text += `\n${locale === "zh" ? "今日退房" : "Départ aujourd'hui"}: ${checkingOut.map(r => r.unit.unit_no).join(", ")}\n`;
    }

    // Cleaning
    const cleaning = roomRows.filter(r => r.status === "cleaning_pending");
    if (cleaning.length > 0) {
      text += `\n${locale === "zh" ? "待保洁" : "Ménage requis"}: ${cleaning.map(r => r.unit.unit_no).join(", ")}\n`;
    }

    // Available
    const av = roomRows.filter(r => r.status === "available");
    if (av.length > 0) {
      text += `\n${locale === "zh" ? "空闲" : "Disponible"}: ${av.map(r => r.unit.unit_no).join(", ")}\n`;
    }

    return text;
  }, [roomRows, selectedDate, locale]);

  const handleCopy = async () => {
    const text = buildShareText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div>
      {/* Date selector + actions */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-9 rounded-lg border border-black/10 bg-white px-3 text-sm font-medium text-brand-ink-900 transition-all duration-fast hover:border-brand-orange-300 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30"
          />
          <span className="text-xs text-brand-ink-300">
            {new Date(selectedDate).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long" })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-medium text-brand-ink-700 transition-all duration-fast hover:bg-brand-orange-50 hover:text-brand-orange-500"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? (locale === "zh" ? "已复制" : "Copié") : t.copy}
          </button>
          <button
            onClick={handlePrint}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-medium text-brand-ink-700 transition-all duration-fast hover:bg-brand-ink-50 no-print"
          >
            <Printer className="h-3.5 w-3.5" />
            {dictionaries[locale].settings?.print?.print ?? (locale === "zh" ? "打印" : "Imprimer")}
          </button>
        </div>
      </div>

      {/* ── Summary cards — PERF: stable config avoids inline array allocation per render */}
      <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
        <SummaryCard label={locale === "zh" ? "总房源" : "Total"} value={summary.total} bg="bg-brand-ink-50 text-brand-ink-700" />
        <SummaryCard label={locale === "zh" ? "占用" : "Occupé"} value={summary.occupied} bg="bg-brand-orange-50 text-brand-orange-700" />
        <SummaryCard label={locale === "zh" ? "未定离店" : "Ouvert"} value={summary.openEnded} bg="bg-amber-50 text-amber-700" />
        <SummaryCard label={locale === "zh" ? "今日退房" : "Départ"} value={summary.checkoutsToday} bg="bg-blue-50 text-blue-700" />
        <SummaryCard label={locale === "zh" ? "待保洁" : "Ménage"} value={summary.cleaning} bg="bg-sky-50 text-sky-700" />
        <SummaryCard label={locale === "zh" ? "空闲" : "Libre"} value={summary.available} bg="bg-emerald-50 text-emerald-700" />
      </div>

      {/* ── Room table ── */}
      <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-brand-ink-50">
                {t.headers.map((h: string) => (
                  <th key={h} className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-brand-ink-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {roomRows.map(row => {
                const b = row.billing;
                return (
                  <tr key={row.unit.id} className={cn(
                    "transition-colors duration-fast",
                    row.status === "daily_occupied" && "bg-orange-50/30",
                    row.status === "cleaning_pending" && "bg-sky-50/40",
                  )}>
                    <td className="px-3 py-2.5 font-mono text-sm font-semibold text-brand-ink-900">{row.unit.unit_no}</td>
                    <td className="px-3 py-2.5">
                      {row.booking ? (
                        <span className="text-sm font-medium text-brand-ink-700">{row.customer?.name?.slice(0, 8) ?? "?"}</span>
                      ) : (
                        <StatusBadge status={row.status as UnitStatus} locale={locale} />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-brand-ink-500">{row.booking?.check_in ?? "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-brand-ink-500">
                      {row.booking?.checkout_mode === "open"
                        ? <span className="font-medium text-amber-600">{locale === "zh" ? "未定" : "Ouvert"}</span>
                        : (row.booking?.check_out ?? "-")}
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs tabular-nums text-brand-ink-700">{b?.nights ?? "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-brand-ink-500">
                      {row.booking ? (locale === "zh" ? BILLING_MODE_ZH[row.booking.checkout_mode] : BILLING_MODE_FR[row.booking.checkout_mode]) : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums font-medium text-brand-ink-700">
                      {b ? b.paid.toLocaleString() : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-brand-ink-700">
                      {b ? b.finalAmount.toLocaleString() : "-"}
                    </td>
                    <td className={cn("px-3 py-2.5 text-xs tabular-nums font-semibold", b && b.outstanding > 0 ? "text-red-600" : "text-emerald-600")}>
                      {b ? (b.outstanding > 0 ? b.outstanding.toLocaleString() : "0") : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-brand-ink-400 max-w-[120px] truncate">{row.booking?.notes ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Share text preview ── */}
      <div className="mt-6 rounded-lg border border-dashed border-black/15 bg-brand-ink-50 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-brand-ink-300">{t.shareTitle}</h3>
          <button onClick={handleCopy} className="rounded-md px-2 py-1 text-xs font-medium text-brand-orange-500 hover:bg-brand-orange-50 transition-colors duration-fast">
            {copied ? "✓" : <Copy className="inline h-3 w-3" />} {t.copy}
          </button>
        </div>
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-brand-ink-700">{buildShareText()}</pre>
      </div>
    </div>
  );
}

/* PERF: extracted as module-level component to avoid inline array .map() allocation per render */
function SummaryCard({ label, value, bg }: { label: string; value: number; bg: string }) {
  return (
    <div className={cn("rounded-lg p-3 text-center transition-colors duration-fast", bg)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
