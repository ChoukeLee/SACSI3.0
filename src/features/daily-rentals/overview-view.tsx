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
import type { DailyRoomDisplayStatus } from "./room-status";
import { buildDailyRoomStateMap } from "./room-status";

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

  const stateMap = useMemo(
    () => buildDailyRoomStateMap({ dailyUnits, dateStr: selectedDate, bookings, cleaningTasks }),
    [dailyUnits, selectedDate, bookings, cleaningTasks],
  );

  const roomRows = useMemo(() => {
    return dailyUnits.map(unit => {
      const state = stateMap.get(unit.id)!;
      const booking = state.booking;
      const customer = booking ? (customers.find(c => c.id === booking.customer_id) ?? null) : null;
      const billing = booking ? calculateBilling(booking, selectedDate) : null;
      const unitPayments = booking ? payments.filter(p => p.source_id === booking.id) : [];
      const totalPaid = unitPayments.reduce((s, p) => s + Number(p.amount), 0);

      return {
        unit,
        booking,
        customer,
        billing,
        totalPaid,
        status: state.status,
        isCheckoutDay: state.isCheckoutDay,
      };
    });
  }, [dailyUnits, stateMap, customers, payments, selectedDate]);

  const summary = useMemo(() => {
    const occupied = roomRows.filter(r => r.status === "occupied" || r.status === "checking_out_today").length;
    const checkoutsToday = roomRows.filter(r => r.isCheckoutDay).length;
    const cleaning = roomRows.filter(r => r.status === "cleaning").length;
    const available = roomRows.filter(r => r.status === "available").length;
    const openEnded = roomRows.filter(r => r.booking?.checkout_mode === "open").length;
    const outstanding = roomRows.filter(r => (r.billing?.outstanding ?? 0) > 0).length;
    return { total: dailyUnits.length, occupied, checkoutsToday, cleaning, available, openEnded, outstanding };
  }, [roomRows, dailyUnits.length, selectedDate]);

  const floorGroups = useMemo(() => {
    const groups = new Map<string, typeof roomRows>();
    for (const row of roomRows) {
      const floor = row.unit.floor_label || `${Math.floor(Number(row.unit.unit_no) / 100)}`;
      if (!groups.has(floor)) groups.set(floor, []);
      groups.get(floor)!.push(row);
    }
    return [...groups.entries()].sort(([a], [b]) => Number(a) - Number(b));
  }, [roomRows]);

  const buildShareText = useCallback(() => {
    const dateFormatted = new Date(selectedDate).toLocaleDateString(
      locale === "fr" ? "fr-FR" : "zh-CN", { day: "2-digit", month: "2-digit", year: "numeric" }
    );
    let text = `11# ${locale === "zh" ? "日租房态" : "Occupation journalière"} ${dateFormatted}\n`;

    const occupied = roomRows.filter(r => r.status === "occupied" || r.status === "checking_out_today" || r.status === "reserved");
    if (occupied.length > 0) {
      text += `\n${locale === "zh" ? "占用" : "Occupé"}: ${occupied.length}\n`;
      text += `${occupied.map(r => r.unit.unit_no).join(", ")}\n`;
    }

    const checkingOut = roomRows.filter(r => r.isCheckoutDay);
    if (checkingOut.length > 0) {
      text += `\n${locale === "zh" ? "今日退房" : "Départ aujourd'hui"}: ${checkingOut.map(r => r.unit.unit_no).join(", ")}\n`;
    }

    const cleaning = roomRows.filter(r => r.status === "cleaning");
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
    <div className="space-y-6">
      {/* Date selector + actions */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-natural sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 shadow-sm transition-all duration-fast hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30"
          />
          <span className="text-xs font-semibold text-slate-400">
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
      <Card variant="dashed" className="border-slate-200 bg-white">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-950">{t.shareTitle}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{locale === "zh" ? "今日群发内容优先展示，可直接复制。" : "Message du jour pret a copier."}</p>
          </div>
          <Button variant="primary" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {t.copy}
          </Button>
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700">{buildShareText()}</pre>
      </Card>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
        <SummaryCard label={locale === "zh" ? "总房源" : "Total"} value={summary.total} bg="bg-brand-warm-100 text-brand-ink-700" />
        <SummaryCard label={locale === "zh" ? "占用" : "Occupé"} value={summary.occupied} bg="bg-brand-orange-50 text-brand-orange-700" />
        <SummaryCard label={locale === "zh" ? "未定离店" : "Ouvert"} value={summary.openEnded} bg="bg-brand-amber-50 text-brand-amber-700" />
        <SummaryCard label={locale === "zh" ? "今日退房" : "Départ"} value={summary.checkoutsToday} bg="bg-brand-sky-50 text-brand-sky-700" />
        <SummaryCard label={locale === "zh" ? "待保洁" : "Ménage"} value={summary.cleaning} bg="bg-brand-sky-50 text-brand-sky-700" />
        <SummaryCard label={locale === "zh" ? "空闲" : "Libre"} value={summary.available} bg="bg-brand-green-50 text-brand-green-700" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-natural">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-950">{locale === "zh" ? "今日房态矩阵" : "Matrice du jour"}</h3>
          <span className="text-xs font-semibold text-slate-400">{selectedDate}</span>
        </div>
        <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {floorGroups.map(([floor, rows]) => (
            <div key={floor} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-bold text-slate-500">{floor}</p>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500">{rows.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {rows.map(row => (
                  <DailyRoomCard key={row.unit.id} row={row} locale={locale} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Room table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-natural">
        <div className="overflow-x-auto">
          <table className="data-table min-w-[900px] text-sm">
            <thead>
              <tr>
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
                    (row.status === "occupied" || row.status === "checking_out_today") && "bg-brand-orange-50/40",
                    row.status === "reserved" && "bg-brand-amber-50/40",
                    row.status === "cleaning" && "bg-brand-sky-50/40",
                    (row.status === "maintenance" || row.status === "locked") && "bg-brand-red-50/40",
                  )}>
                    <td className="px-3 py-2.5 font-mono text-sm font-semibold text-brand-ink-900">{row.unit.unit_no}</td>
                    <td className="px-3 py-2.5">
                      {row.booking ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-brand-ink-700" title={row.customer?.name ?? undefined}>{row.customer?.name?.slice(0, 8) ?? "?"}</span>
                          {row.booking.status !== "checked_in" && (
                            <StatusBadge status="reserved" locale={locale} />
                          )}
                        </div>
                      ) : (
                        <StatusBadge status={statusToUnitStatus(row.status)} locale={locale} />
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
                      {b ? formatXof(b.paid) : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-brand-ink-600">
                      {b ? formatXof(b.finalAmount) : "-"}
                    </td>
                    <td className={cn("px-3 py-2.5 text-xs tabular-nums font-semibold", b && b.outstanding > 0 ? "text-brand-red-600" : "text-brand-green-600")}>
                      {b ? (b.outstanding > 0 ? formatXof(b.outstanding) : "0") : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-brand-ink-300 max-w-[120px] truncate">{row.booking?.notes ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

function DailyRoomCard({
  row,
  locale,
}: {
  row: {
    unit: UnitRow;
    booking: DailyBookingRow | null;
    customer: CustomerRow | null;
    billing: ReturnType<typeof calculateBilling> | null;
    totalPaid: number;
    status: DailyRoomDisplayStatus;
    isCheckoutDay: boolean;
  };
  locale: Locale;
}) {
  const labelMap: Record<DailyRoomDisplayStatus, string> = locale === "zh"
    ? {
        available: "空闲",
        occupied: "占用",
        checking_out_today: "今日退房",
        reserved: "预订",
        cleaning: "待保洁",
        maintenance: "维修",
        locked: "锁定",
      }
    : {
        available: "Libre",
        occupied: "Occupe",
        checking_out_today: "Depart",
        reserved: "Reserve",
        cleaning: "Menage",
        maintenance: "Maintenance",
        locked: "Bloque",
      };

  const tone: Record<DailyRoomDisplayStatus, string> = {
    available: "border-emerald-200 bg-emerald-50 text-emerald-900",
    occupied: "border-orange-300 bg-orange-100 text-orange-950",
    checking_out_today: "border-amber-300 bg-amber-100 text-amber-950",
    reserved: "border-sky-300 bg-sky-100 text-sky-950",
    cleaning: "border-cyan-300 bg-cyan-100 text-cyan-950",
    maintenance: "border-rose-300 bg-rose-100 text-rose-950",
    locked: "border-slate-300 bg-slate-100 text-slate-900",
  };

  const hasBooking = Boolean(row.booking);
  const checkoutText = row.booking?.checkout_mode === "open"
    ? (locale === "zh" ? "未定离店" : "Ouvert")
    : row.booking?.check_out;
  const outstanding = row.billing?.outstanding ?? 0;

  return (
    <div className={cn(
      "min-h-[92px] rounded-2xl border p-3 shadow-sm ring-1 ring-inset ring-white/50",
      tone[row.status],
    )}>
      <div className="flex items-start justify-between gap-2">
        <span className="rounded-full bg-white/80 px-2 py-1 font-mono text-sm font-black leading-none shadow-sm">
          {row.unit.unit_no}
        </span>
        <span className="rounded-full bg-white/65 px-2 py-0.5 text-[10px] font-bold">
          {labelMap[row.status]}
        </span>
      </div>
      <div className="mt-3 min-h-[28px]">
        <p className="truncate text-xs font-bold">
          {row.customer?.name ?? (hasBooking ? "?" : (locale === "zh" ? "可安排入住" : "Disponible"))}
        </p>
        <p className="mt-1 truncate text-[10px] font-semibold opacity-70">
          {hasBooking ? `${row.booking?.check_in ?? "-"} -> ${checkoutText ?? "-"}` : row.unit.layout ?? row.unit.floor_label}
        </p>
      </div>
      {outstanding > 0 && (
        <p className="mt-2 truncate text-[10px] font-black text-rose-700">
          {locale === "zh" ? "待收 " : "Reste "}{formatXof(outstanding)}
        </p>
      )}
    </div>
  );
}

function statusToUnitStatus(s: DailyRoomDisplayStatus): UnitStatus {
  switch (s) {
    case "occupied":
    case "checking_out_today":
      return "daily_occupied";
    case "reserved":
      return "reserved";
    case "cleaning":
      return "cleaning_pending";
    case "maintenance":
      return "maintenance";
    case "locked":
      return "locked";
    default:
      return "available";
  }
}

function SummaryCard({ label, value, bg }: { label: string; value: number; bg: string }) {
  return (
    <div className={cn("rounded-lg p-3 text-center transition-colors duration-fast", bg)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
