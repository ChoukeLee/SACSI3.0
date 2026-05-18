"use client";

import { useMemo } from "react";
import { Phone, Check } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import type { DailyBookingRow, UnitRow, CustomerRow, PaymentRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { calculateBilling } from "@/features/daily-rentals/billing";
import { completeCleaning } from "@/features/daily-rentals/actions";

interface MobileDailyCardsProps {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  locale: Locale;
}

export function MobileDailyCards({ dailyUnits, bookings, customers, payments, cleaningTasks, locale }: MobileDailyCardsProps) {
  const t = dictionaries[locale].mobile;
  const dr = dictionaries[locale].dailyRentals;
  const todayStr = new Date().toISOString().slice(0, 10);

  const roomCards = useMemo(() => {
    return dailyUnits.map(unit => {
      const b = bookings.find(b =>
        b.unit_id === unit.id &&
        (b.status === "checked_in" || b.status === "confirmed") &&
        b.check_in <= todayStr &&
        (b.checkout_mode === "open" || (b.check_out && b.check_out > todayStr))
      );
      const cust = b ? customers.find(c => c.id === b.customer_id) : null;
      const billing = b ? calculateBilling(b, todayStr) : null;
      const ct = cleaningTasks.find(t => t.unit_id === unit.id && !t.is_completed);
      const unitPayments = b ? payments.filter(p => p.source_id === b.id) : [];
      const totalPaid = unitPayments.reduce((s, p) => s + Number(p.amount), 0);

      let displayStatus: string = unit.status;
      if (b && b.status === "checked_in") displayStatus = "daily_occupied";
      else if (b && b.status === "confirmed") displayStatus = "reserved";
      else if (ct) displayStatus = "cleaning_pending";

      return { unit, booking: b, customer: cust, billing, cleaningTask: ct, totalPaid, displayStatus };
    });
  }, [dailyUnits, bookings, customers, cleaningTasks, payments, todayStr]);

  const occupied = roomCards.filter(r => r.displayStatus === "daily_occupied");
  const reserved = roomCards.filter(r => r.displayStatus === "reserved");
  const cleaning = roomCards.filter(r => r.displayStatus === "cleaning_pending");
  const available = roomCards.filter(r => r.displayStatus === "available");

  const handleMarkCleaning = async (taskId: string) => {
    await completeCleaning(taskId);
  };

  const cardClass = "rounded-xl border border-black/10 bg-white p-4 shadow-card";

  if (roomCards.length === 0) {
    return <div className="py-16 text-center text-sm text-brand-ink-300">{dr.calendar.noRooms}</div>;
  }

  return (
    <div>
      {/* Occupied */}
      {occupied.length > 0 && (
        <div className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-brand-ink-400 mb-2">{t.occupied} · {occupied.length}</h2>
          <div className="space-y-2">
            {occupied.map((r, i) => (
              <div key={i} className={cardClass}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold text-brand-ink-900">{r.unit.unit_no}</span>
                    <StatusBadge status="daily_occupied" locale={locale} />
                  </div>
                  {r.customer && (
                    <div className="text-right">
                      <p className="text-sm font-semibold text-brand-ink-700">{r.customer.name.slice(0, 8)}</p>
                      {r.customer.phone && (
                        <a href={`tel:${r.customer.phone}`} className="inline-flex items-center gap-1 text-xs text-brand-orange-500 active:opacity-70">
                          <Phone className="h-3 w-3" />{r.customer.phone}
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {r.booking && r.billing && (
                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-brand-ink-50 p-2 text-center text-xs">
                    <div><p className="text-brand-ink-300">{dr.booking.nights}</p><p className="font-bold text-brand-ink-700">{r.billing.nights}</p></div>
                    <div><p className="text-brand-ink-300">{locale === "zh" ? "已收" : "Payé"}</p><p className="font-bold text-emerald-700">{formatXof(r.totalPaid)}</p></div>
                    <div><p className="text-brand-ink-300">{locale === "zh" ? "欠费" : "Dû"}</p><p className={cn("font-bold", r.billing.outstanding > 0 ? "text-red-600" : "text-emerald-600")}>{formatXof(r.billing.outstanding)}</p></div>
                  </div>
                )}

                {r.booking && (
                  <div className="mt-2 text-xs text-brand-ink-500">
                    {r.booking.check_in} → {r.booking.checkout_mode === "open"
                      ? <span className="text-amber-600 font-medium">{locale === "zh" ? "未定" : "?"}</span>
                      : r.booking.check_out}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reserved */}
      {reserved.length > 0 && (
        <div className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-brand-ink-400 mb-2">{locale === "zh" ? "预订中" : "Réservé"} · {reserved.length}</h2>
          <div className="flex flex-wrap gap-2">
            {reserved.map((r, i) => (
              <span key={i} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-mono font-semibold text-brand-ink-500 shadow-card">{r.unit.unit_no}</span>
            ))}
          </div>
        </div>
      )}

      {/* Cleaning */}
      {cleaning.length > 0 && (
        <div className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-brand-ink-400 mb-2">{t.cleaning} · {cleaning.length}</h2>
          <div className="space-y-2">
            {cleaning.map((r, i) => (
              <div key={i} className={cn(cardClass, "border-sky-200 bg-sky-50/50")}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-base font-bold text-brand-ink-900">{r.unit.unit_no}</span>
                  <StatusBadge status="cleaning_pending" locale={locale} />
                </div>
                {r.cleaningTask && (
                  <button
                    onClick={() => handleMarkCleaning(r.cleaningTask!.id)}
                    className="mt-2 w-full rounded-lg bg-sky-600 py-2 text-xs font-semibold text-white active:bg-sky-700 transition-colors duration-fast"
                  >
                    <Check className="inline h-3.5 w-3.5 mr-1" />{dr.cleaning.markComplete}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available */}
      {available.length > 0 && (
        <div className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-brand-ink-400 mb-2">{locale === "zh" ? "空闲" : "Disponible"} · {available.length}</h2>
          <div className="flex flex-wrap gap-2">
            {available.map((r, i) => (
              <span key={i} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-mono font-semibold text-brand-ink-500 shadow-card">{r.unit.unit_no}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
