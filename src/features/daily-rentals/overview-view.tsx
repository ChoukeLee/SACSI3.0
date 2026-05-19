"use client";

import { useState, useMemo, useCallback } from "react";
import { Copy, Printer, Check } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { calculateBilling } from "./billing";

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
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [copied, setCopied] = useState(false);

  const activeBookings = useMemo(() =>
    bookings.filter(b => b.status === "checked_in" || b.status === "confirmed" || b.status === "pending_review"),
    [bookings]
  );

  const unitStatusMap = useMemo(() => {
    const map: Record<string, { booking: DailyBookingRow | null; status: string; unit: UnitRow }> = {};
    for (const unit of dailyUnits) {
      const booking = activeBookings.find(b => {
        if (b.unit_id !== unit.id) return false;
        const checkIn = b.check_in;
        // fixed checkout: departure date is still an occupied night
        // open-ended: actual_check_out means they've already left, so use <
        if (b.checkout_mode === "fixed") {
          const fixedEnd = b.check_out ?? checkIn;
          return selectedDate >= checkIn && selectedDate <= fixedEnd;
        }
        const openEnd = b.actual_check_out ?? "9999-12-31";
        return selectedDate >= checkIn && selectedDate < openEnd;
      }) ?? null;

      let displayStatus = unit.status;
      if (booking?.status === "checked_in") {
        displayStatus = "daily_occupied";
      } else if (booking?.status === "confirmed" || booking?.status === "pending_review") {
        displayStatus = "reserved";
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

  const summary = useMemo(() => {
    const occupied = roomRows.filter(r => r.status === "daily_occupied").length;
    const checkoutsToday = roomRows.filter(r => r.booking?.checkout_mode === "fixed" && r.booking?.check_out === selectedDate).length;
    const cleaning = roomRows.filter(r => r.status === "cleaning_pending").length;
    const available = roomRows.filter(r => r.status === "available").length;
    const openEnded = roomRows.filter(r => r.booking?.checkout_mode === "open").length;
    const outstanding = roomRows.filter(r => (r.billing?.outstanding ?? 0) > 0).length;
    return { total: dailyUnits.length, occupied, checkoutsToday, cleaning, available, openEnded, outstanding };
  }, [roomRows, dailyUnits.length, selectedDate]);

  const buildShareText = useCallback(() => {
    const dateFormatted = new Date(selectedDate).toLocaleDateString(
      locale === "fr" ? "fr-FR" : "zh-CN", { day: "2-digit", month: "2-digit", year: "numeric" }
    );
    let text = `11# ${locale === "zh" ? "日租房态" : "Occupation journalière"} ${dateFormatted}\n`;

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

    const checkingOut = roomRows.filter(r => r.booking?.checkout_mode === "fixed" && r.booking?.check_out === selectedDate);
    if (checkingOut.length > 0) {
      text += `\n${locale === "zh" ? "今日退房" : "Départ aujourd'hui"}: ${checkingOut.map(r => r.unit.unit_no).join(", ")}\n`;
    }

    const cleaning = roomRows.filter(r => r.status === "cleaning_pending");
    if (cleaning.length > 0) {
      text += `\n${locale === "zh" ? "待保洁" : "Ménage requis"}: ${cleaning.map(r => r.unit.unit_no).join(", ")}\n`;
    }

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

  return (
    <div>
      {/* Date selector + actions */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-9 rounded-lg border border-brand-warm-400 bg-white px-3 text-sm font-medium text-brand-ink-900 transition-all duration-fast hover:border-brand-warm-500 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30"
          />
          <span className="text-xs text-brand-ink-300">
            {new Date(selectedDate).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long" })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? (locale === "zh" ? "已复制" : "Copié") : t.copy}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.print()}
            className="no-print"
          >
            <Printer className="h-3.5 w-3.5" />
            {dictionaries[locale].settings?.print?.print ?? (locale === "zh" ? "打印" : "Imprimer")}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
        <SummaryCard label={locale === "zh" ? "总房源" : "Total"} value={summary.total} bg="bg-brand-warm-100 text-brand-ink-700" />
        <SummaryCard label={locale === "zh" ? "占用" : "Occupé"} value={summary.occupied} bg="bg-brand-orange-50 text-brand-orange-700" />
        <SummaryCard label={locale === "zh" ? "未定离店" : "Ouvert"} value={summary.openEnded} bg="bg-brand-amber-50 text-brand-amber-700" />
        <SummaryCard label={locale === "zh" ? "今日退房" : "Départ"} value={summary.checkoutsToday} bg="bg-brand-sky-50 text-brand-sky-700" />
        <SummaryCard label={locale === "zh" ? "待保洁" : "Ménage"} value={summary.cleaning} bg="bg-brand-sky-50 text-brand-sky-700" />
        <SummaryCard label={locale === "zh" ? "空闲" : "Libre"} value={summary.available} bg="bg-brand-green-50 text-brand-green-700" />
      </div>

      {/* Room table */}
      <div className="overflow-hidden rounded-xl border border-brand-warm-400 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-brand-warm-400 bg-brand-warm-50">
                {t.headers.map((h: string) => (
                  <th key={h} className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-brand-ink-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-warm-400">
              {roomRows.map(row => {
                const b = row.billing;
                return (
                  <tr key={row.unit.id} className={cn(
                    "transition-colors duration-fast",
                    row.status === "daily_occupied" && "bg-brand-orange-50/40",
                    row.status === "reserved" && "bg-brand-amber-50/40",
                    row.status === "cleaning_pending" && "bg-brand-sky-50/40",
                  )}>
                    <td className="px-3 py-2.5 font-mono text-sm font-semibold text-brand-ink-900">{row.unit.unit_no}</td>
                    <td className="px-3 py-2.5">
                      {row.booking ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-brand-ink-700">{row.customer?.name?.slice(0, 8) ?? "?"}</span>
                          {row.booking.status !== "checked_in" && (
                            <StatusBadge status="reserved" locale={locale} />
                          )}
                        </div>
                      ) : (
                        <StatusBadge status={row.status as UnitStatus} locale={locale} />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-brand-ink-500">{row.booking?.check_in ?? "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-brand-ink-500">
                      {row.booking?.checkout_mode === "open"
                        ? <span className="font-medium text-brand-amber-700">{locale === "zh" ? "未定" : "Ouvert"}</span>
                        : (row.booking?.check_out ?? "-")}
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs tabular-nums text-brand-ink-600">{b?.nights ?? "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-brand-ink-500">
                      {row.booking ? (locale === "zh" ? BILLING_MODE_ZH[row.booking.checkout_mode] : BILLING_MODE_FR[row.booking.checkout_mode]) : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums font-medium text-brand-ink-600">
                      {b ? b.paid.toLocaleString() : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-brand-ink-600">
                      {b ? b.finalAmount.toLocaleString() : "-"}
                    </td>
                    <td className={cn("px-3 py-2.5 text-xs tabular-nums font-semibold", b && b.outstanding > 0 ? "text-brand-red-600" : "text-brand-green-600")}>
                      {b ? (b.outstanding > 0 ? b.outstanding.toLocaleString() : "0") : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-brand-ink-300 max-w-[120px] truncate">{row.booking?.notes ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Share text preview */}
      <Card variant="dashed" className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-brand-ink-300">{t.shareTitle}</h3>
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3 w-3" />} {t.copy}
          </Button>
        </div>
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-brand-ink-600">{buildShareText()}</pre>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, bg }: { label: string; value: number; bg: string }) {
  return (
    <div className={cn("rounded-lg p-3 text-center transition-colors duration-fast", bg)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
