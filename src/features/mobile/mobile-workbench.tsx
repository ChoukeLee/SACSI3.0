"use client";

import { useMemo } from "react";
import { Phone, AlertTriangle, CheckCircle, Clock, BedDouble, DoorOpen } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import { calculateBilling } from "@/features/daily-rentals/billing";

interface MobileWorkbenchProps {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  notifications: { id: string; title: string; body: string; read_at: string | null; created_at: string }[];
  locale: Locale;
}

/* UX-REFACTOR: Mobile workbench — lightweight field ops dashboard, replaces complex desktop tables */
export function MobileWorkbench({ dailyUnits, bookings, customers, payments, cleaningTasks, notifications, locale }: MobileWorkbenchProps) {
  const t = dictionaries[locale].mobile;
  const statusLabels = dictionaries[locale].statuses;
  const todayStr = new Date().toISOString().slice(0, 10);

  const todayData = useMemo(() => {
    const occupied: { unitNo: string; customer: string; checkIn: string; checkOut: string | null; mode: string; outstanding: number; nights: number }[] = [];
    const checkingOut: { unitNo: string; customer: string }[] = [];
    const cleaning: { unitNo: string; taskId: string }[] = [];
    const needTopUp: { unitNo: string; customer: string; outstanding: number }[] = [];

    for (const unit of dailyUnits) {
      const b = bookings.find(b => b.unit_id === unit.id && b.status === "checked_in" &&
        b.check_in <= todayStr &&
        (b.checkout_mode === "open" || (b.check_out && b.check_out >= todayStr)));
      if (b) {
        const billing = calculateBilling(b, todayStr);
        const cust = customers.find(c => c.id === b.customer_id);
        occupied.push({
          unitNo: unit.unit_no, customer: cust?.name?.slice(0, 6) ?? "?", checkIn: b.check_in,
          checkOut: b.checkout_mode === "open" ? null : (b.check_out ?? null),
          mode: b.checkout_mode, outstanding: billing.outstanding, nights: billing.nights,
        });
        if (b.checkout_mode === "fixed" && b.check_out === todayStr) {
          checkingOut.push({ unitNo: unit.unit_no, customer: cust?.name?.slice(0, 6) ?? "?" });
        }
        if (billing.outstanding > 0) {
          needTopUp.push({ unitNo: unit.unit_no, customer: cust?.name?.slice(0, 6) ?? "?", outstanding: billing.outstanding });
        }
      }
      const ct = cleaningTasks.find(t => t.unit_id === unit.id && !t.is_completed);
      if (ct) cleaning.push({ unitNo: unit.unit_no, taskId: ct.id });
    }
    return { occupied, checkingOut, cleaning, needTopUp };
  }, [dailyUnits, bookings, customers, cleaningTasks, payments, todayStr]);

  const urgentNotifs = notifications.filter(n => !n.read_at).slice(0, 3);

  const cardClass = "rounded-xl border border-brand-warm-400 bg-white p-4 shadow-card";
  const statBadge = (n: number) => n > 0 ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-orange text-xs font-bold text-white" : "";

  return (
    <div className="space-y-4">
      {/* Today summary header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-brand-ink-900">{t.today}</h1>
        <span className="text-xs text-brand-ink-300">{new Date().toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long", month: "short", day: "numeric" })}</span>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className={cn(cardClass, "text-center")}>
          <BedDouble className="mx-auto h-5 w-5 text-brand-orange" />
          <p className="mt-1 text-2xl font-bold text-brand-ink-900">{todayData.occupied.length}</p>
          <p className="text-[10px] text-brand-ink-500">{t.occupied}</p>
        </div>
        <div className={cn(cardClass, "text-center")}>
          <DoorOpen className="mx-auto h-5 w-5 text-brand-sky-500" />
          <p className="mt-1 text-2xl font-bold text-brand-ink-900">{todayData.checkingOut.length}</p>
          <p className="text-[10px] text-brand-ink-500">{t.checkingOut}</p>
        </div>
        <div className={cn(cardClass, "text-center")}>
          <CheckCircle className="mx-auto h-5 w-5 text-brand-sky-500" />
          <p className="mt-1 text-2xl font-bold text-brand-ink-900">{todayData.cleaning.length}</p>
          <p className="text-[10px] text-brand-ink-500">{t.cleaning}</p>
        </div>
      </div>

      {/* Occupied rooms */}
      {todayData.occupied.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-sm font-bold text-brand-ink-900 mb-3">{t.occupied} ({todayData.occupied.length})</h2>
          <div className="space-y-2">
            {todayData.occupied.map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-brand-warm-50 px-3 py-2.5">
                <div>
                  <span className="font-mono text-sm font-bold text-brand-ink-900">{r.unitNo}</span>
                  <span className="ml-2 text-xs text-brand-ink-500">{r.customer}</span>
                </div>
                <div className="text-right text-xs text-brand-ink-500">
                  <div>{r.nights}{locale === "zh" ? "晚" : "n"}</div>
                  {r.outstanding > 0 && <div className="font-bold text-brand-red-600">{formatXof(r.outstanding)}</div>}
                  {r.mode === "open" && <div className="text-brand-amber-600">{locale === "zh" ? "未定" : "?"}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Need top-up */}
      {todayData.needTopUp.length > 0 && (
        <div className={cn(cardClass, "border-brand-amber-200 bg-brand-amber-50/50")}>
          <h2 className="text-sm font-semibold text-brand-ink-700 mb-3 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-brand-accent" />{t.needTopUp} ({todayData.needTopUp.length})</h2>
          {todayData.needTopUp.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="font-semibold">{r.unitNo} {r.customer}</span>
              <span className="font-bold text-brand-red-600">{formatXof(r.outstanding)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Cleaning pending */}
      {todayData.cleaning.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-sm font-bold text-brand-ink-900 mb-2">{t.cleaning} ({todayData.cleaning.length})</h2>
          <div className="flex flex-wrap gap-2">
            {todayData.cleaning.map((c, i) => (
              <span key={i} className="rounded-full bg-brand-sky-100 px-3 py-1 text-xs font-medium text-brand-sky-700">{c.unitNo}</span>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {todayData.occupied.length === 0 && todayData.cleaning.length === 0 && (
        <div className="py-12 text-center text-sm text-brand-ink-300">
          <BedDouble className="mx-auto h-10 w-10 mb-3 opacity-30" />
          <p>{t.allClear}</p>
        </div>
      )}

      {/* Urgent notifications */}
      {urgentNotifs.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-sm font-bold text-brand-ink-900 mb-2">{t.reminders}</h2>
          {urgentNotifs.map((n, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-brand-warm-50 px-3 py-2 mb-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-brand-orange mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-brand-ink-700">{n.title}</p>
                <p className="text-[10px] text-brand-ink-500">{n.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
