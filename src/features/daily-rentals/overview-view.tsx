"use client";

import { useState, useMemo, useCallback } from "react";
import { Copy, Printer, Check } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import { calculateBilling } from "./billing";
import type { DailyRoomDisplayStatus } from "./room-status";
import { buildDailyRoomStateMap } from "./room-status";

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
  const selectedDate = new Date().toISOString().slice(0, 10);
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

  const shareRows = useMemo(() => {
    const occupied = roomRows.filter(r => r.status === "occupied" || r.status === "checking_out_today" || r.status === "reserved");
    const checkingOut = roomRows.filter(r => r.isCheckoutDay);
    const cleaning = roomRows.filter(r => r.status === "cleaning");
    const available = roomRows.filter(r => r.status === "available");

    return [
      { key: "occupied", label: locale === "zh" ? "å ç”¨" : "Occupe", count: occupied.length, units: occupied.map(r => r.unit.unit_no), tone: "bg-brand-orange-50 text-brand-orange-800 ring-brand-orange-200" },
      { key: "checkout", label: locale === "zh" ? "é€€æˆ¿" : "Depart", count: checkingOut.length, units: checkingOut.map(r => r.unit.unit_no), tone: "bg-brand-sky-50 text-brand-sky-800 ring-brand-sky-200" },
      { key: "cleaning", label: locale === "zh" ? "å¾…ä¿æ´" : "Menage", count: cleaning.length, units: cleaning.map(r => r.unit.unit_no), tone: "bg-cyan-50 text-cyan-800 ring-cyan-200" },
      { key: "available", label: locale === "zh" ? "å¯å®‰æŽ’å…¥ä½" : "Disponible", count: available.length, units: available.map(r => r.unit.unit_no), tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
    ].filter(row => row.count > 0);
  }, [roomRows, locale]);

  const buildShareText = useCallback(() => {
    let text = `11# ${locale === "zh" ? "æ—¥ç§Ÿæˆ¿æ€" : "Occupation journaliere"}\n`;
    for (const row of shareRows) {
      text += `\n${row.label}: ${row.count}\n`;
      text += `${row.units.join(", ")}\n`;
    }
    return text;
  }, [shareRows, locale]);

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
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-natural">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <h3 className="text-[15px] font-bold leading-5 text-slate-950">{locale === "zh" ? "ä»Šæ—¥å¯å‘ç¾¤å†…å®¹" : t.shareTitle}</h3>
              <p className="mt-1 text-[13px] font-medium leading-5 text-slate-500">{locale === "zh" ? "æˆ¿æ€æ‘˜è¦å·²æŒ‰ç¾¤å‘æ ¼å¼æ•´ç†" : "Message du jour pret a copier."}</p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-semibold leading-5 text-slate-700">
              <span>{new Date(selectedDate).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN")}</span>
              <span className="text-slate-400">/</span>
              <span>{new Date(selectedDate).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long" })}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? (locale === "zh" ? "å·²å¤åˆ¶" : "Copie") : t.copy}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()} className="no-print">
              <Printer className="h-3.5 w-3.5" />
              {dictionaries[locale].settings?.print?.print ?? (locale === "zh" ? "æ‰“å°" : "Imprimer")}
            </Button>
          </div>
        </div>
        <div className="space-y-2 bg-slate-50/60 px-5 py-4">
          <div className="text-[13px] font-semibold leading-5 text-slate-800">11# {locale === "zh" ? "æ—¥ç§Ÿæˆ¿æ€" : "Occupation journaliere"}</div>
          <div className="grid gap-2 md:grid-cols-2">
            {shareRows.map(row => (
              <div key={row.key} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-bold leading-4 ring-1 ring-inset", row.tone)}>{row.label}</span>
                  <span className="text-[13px] font-bold leading-5 text-slate-900">{row.count}</span>
                </div>
                <p className="text-[13px] font-medium leading-6 text-slate-700">{row.units.join(", ")}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
        <SummaryCard label={locale === "zh" ? "æ€»æˆ¿æº" : "Total"} value={summary.total} bg="bg-slate-100 text-slate-800" />
        <SummaryCard label={locale === "zh" ? "å ç”¨" : "Occupe"} value={summary.occupied} bg="bg-brand-orange-50 text-brand-orange-700" />
        <SummaryCard label={locale === "zh" ? "æœªå®šç¦»åº—" : "Ouvert"} value={summary.openEnded} bg="bg-brand-amber-50 text-brand-amber-700" />
        <SummaryCard label={locale === "zh" ? "ä»Šæ—¥é€€æˆ¿" : "Depart"} value={summary.checkoutsToday} bg="bg-brand-sky-50 text-brand-sky-700" />
        <SummaryCard label={locale === "zh" ? "å¾…ä¿æ´" : "Menage"} value={summary.cleaning} bg="bg-brand-sky-50 text-brand-sky-700" />
        <SummaryCard label={locale === "zh" ? "ç©ºé—²" : "Libre"} value={summary.available} bg="bg-brand-green-50 text-brand-green-700" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-natural">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-950">{locale === "zh" ? "ä»Šæ—¥æˆ¿æ€çŸ©é˜µ" : "Matrice du jour"}</h3>
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
        available: "ç©ºé—²",
        occupied: "å ç”¨",
        checking_out_today: "ä»Šæ—¥é€€æˆ¿",
        reserved: "é¢„è®¢",
        cleaning: "å¾…ä¿æ´",
        maintenance: "ç»´ä¿®",
        locked: "é”å®š",
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
    available: "border-brand-sky-100 bg-brand-sky-50 text-slate-900",
    occupied: "border-blue-300 bg-blue-500 text-white",
    checking_out_today: "border-blue-400 bg-blue-600 text-white",
    reserved: "border-brand-amber-100 bg-brand-amber-50 text-slate-900",
    cleaning: "border-cyan-200 bg-cyan-100 text-cyan-950",
    maintenance: "border-rose-300 bg-rose-500 text-white",
    locked: "border-slate-300 bg-slate-500 text-white",
  };

  const hasBooking = Boolean(row.booking);
  const checkoutText = row.booking?.checkout_mode === "open"
    ? (locale === "zh" ? "æœªå®šç¦»åº—" : "Ouvert")
    : row.booking?.check_out;
  const outstanding = row.billing?.outstanding ?? 0;
  const guestText = row.customer?.name ?? (hasBooking ? "?" : (locale === "zh" ? "å¯å®‰æŽ’å…¥ä½" : "Disponible"));
  const dateText = hasBooking
    ? `${row.booking?.check_in ?? "-"} -> ${checkoutText ?? "-"}`
    : (row.unit.layout ?? row.unit.floor_label);

  return (
    <div className={cn(
      "group relative flex min-h-[84px] flex-col justify-between overflow-hidden rounded-xl border p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
      tone[row.status],
    )}>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_55%)]" />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span className="rounded-full bg-white/90 px-2.5 py-0.5 font-mono text-xs font-black leading-5 text-slate-950 shadow-sm">
          {row.unit.unit_no}
        </span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black leading-4 text-slate-950 shadow-sm">
          {labelMap[row.status]}
        </span>
      </div>
      <div className="relative z-10 min-w-0">
        <p className="truncate text-xs font-black">{guestText}</p>
        <p className="mt-0.5 truncate text-[10px] font-semibold opacity-75">{dateText}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          {outstanding > 0 ? (
            <span className="truncate text-[10px] font-black text-rose-600">
              {locale === "zh" ? "å¾…æ”¶ " : "Reste "}{formatXof(outstanding)}
            </span>
          ) : (
            <span className="truncate text-[10px] font-bold opacity-65">{locale === "zh" ? "æˆ¿é—´æ¡£æ¡ˆ" : "Dossier"}</span>
          )}
          <span className="flex shrink-0 items-center gap-1">
            <span className="h-5 w-5 rounded-full bg-white/85 shadow-sm" />
            <span className="h-5 w-5 rounded-full bg-white/70 shadow-sm" />
          </span>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, bg }: { label: string; value: number; bg: string }) {
  return (
    <div className={cn("rounded-lg p-3 text-center transition-colors duration-fast", bg)}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-0.5 text-xl font-black tabular-nums">{value}</p>
    </div>
  );
}
