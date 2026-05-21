"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { X, Check, UserX, Printer, DollarSign, Percent } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { CustomerSummary } from "./calendar";
import { printDailyReceipt } from "@/features/print";
import { calculateBilling } from "./billing";
import {
  createBooking, confirmBooking, checkIn, checkOut, completeCleaning, extendStay, cancelBooking,
  recordSupplementaryPayment, applyDiscount,
} from "./actions";

interface BookingPanelProps {
  booking: DailyBookingRow | null; unitId: string | null; defaultDate?: string;
  units: UnitRow[]; customers: CustomerSummary[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean; completed_at?: string | null }[];
  payments: { id: string; source_id: string; amount: number; payment_date: string }[];
  locale: Locale; onClose: () => void; onChanged: () => void;
  onBookingCreated?: (booking: DailyBookingRow) => void;
}

export function BookingPanel({ booking, unitId, defaultDate, units, customers, cleaningTasks, payments, locale, onClose, onChanged, onBookingCreated }: BookingPanelProps) {
  const t = dictionaries[locale].dailyRentals;
  const router = useRouter();
  const isNew = !booking;

  // router.refresh() (soft RSC re-fetch) can fail to propagate new bookings
  // to the calendar grid. Hard navigation to current path guarantees fresh data.
  const refresh = () => {
    router.replace(window.location.pathname + window.location.search + (window.location.search ? '&' : '?') + '_t=' + Date.now());
    onChanged();
  };

  const [newCustomerId, setNewCustomerId] = useState("");
  const [newCheckIn, setNewCheckIn] = useState(defaultDate ?? "");
  const [newCheckOut, setNewCheckOut] = useState("");
  const [newNightlyPrice, setNewNightlyPrice] = useState("40000");
  const [newCheckoutMode, setNewCheckoutMode] = useState<"fixed" | "open">("fixed");
  const [newNotes, setNewNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [suppAmount, setSuppAmount] = useState("");
  const [finalAmount, setFinalAmount] = useState("");
  const [actualCheckOut, setActualCheckOut] = useState(new Date().toISOString().slice(0, 10));
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [extendDays, setExtendDays] = useState("1");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (defaultDate) { setNewCheckIn(defaultDate); const nextDay = new Date(defaultDate); nextDay.setDate(nextDay.getDate() + 1); setNewCheckOut(nextDay.toISOString().slice(0, 10)); }
  }, [defaultDate]);

  useEffect(() => {
    if (booking) { setFinalAmount(String(booking.final_amount_xof ?? booking.total_amount_xof)); }
  }, [booking]);

  const selectedUnit = unitId ? units.find((u) => u.id === unitId) : null;
  const bookingPayments = useMemo(() => payments.filter(p => p.source_id === booking?.id), [payments, booking]);
  const totalPaid = bookingPayments.reduce((s, p) => s + Number(p.amount), 0);

  const newNights = useMemo(() => {
    if (!newCheckIn || !newCheckOut) return 0;
    return Math.max(0, Math.ceil((new Date(newCheckOut).getTime() - new Date(newCheckIn).getTime()) / (1000 * 60 * 60 * 24)));
  }, [newCheckIn, newCheckOut]);

  const newTotal = newNights * (parseInt(newNightlyPrice, 10) || 0);
  const bookingCustomer = booking ? customers.find((c) => c.id === booking.customer_id) : null;
  const relatedCleaningTask = booking ? cleaningTasks.find((t) => t.daily_booking_id === booking.id) : null;
  const billing = booking ? calculateBilling(booking) : null;

  const toN = (s: string) => parseInt(s, 10) || 0;

  const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 transition-all duration-fast hover:border-brand-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30";
  const labelClass = "block text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 mb-1";

  const handleCreate = async () => {
    if (!newCustomerId) { setError(t.booking.noCustomer); return; }
    if (newCheckoutMode === "fixed" && newNights <= 0) { setError("Invalid date range."); return; }
    setSaving(true); setError("");
    const result = await createBooking({
      unitId: unitId!, customerId: newCustomerId, checkIn: newCheckIn,
      checkOut: newCheckoutMode === "fixed" ? newCheckOut : undefined,
      checkoutMode: newCheckoutMode, nightlyPriceXof: toN(newNightlyPrice) || 40000,
      notes: newNotes || undefined,
    });
    setSaving(false);
    if (result.success) {
      if (result.data) onBookingCreated?.(result.data);
      refresh(); onClose();
    }
    else setError(result.error ?? "Failed");
  };

  const handleCheckIn = async () => {
    const prepay = toN(prepaidAmount);
    if (booking?.checkout_mode !== "open" && prepay <= 0) { setActionError(t.booking.prepaidWarning); return; }
    setSaving(true); const result = await checkIn(booking!.id, prepay);
    setSaving(false); if (!result.success) setActionError(result.error ?? "Failed"); else { refresh(); onClose(); }
  };

  const handleCheckOut = async () => {
    setSaving(true);
    const disc = toN(discountAmount);
    const fin = toN(finalAmount);
    const result = await checkOut(booking!.id, {
      finalAmount: fin || undefined,
      actualCheckOut: booking?.checkout_mode === "open" ? actualCheckOut : undefined,
      discountAmount: disc || undefined,
      discountReason: discountReason || undefined,
    });
    setSaving(false); if (!result.success) setActionError(result.error ?? "Failed"); else { refresh(); onClose(); }
  };

  const handleSuppPayment = async () => {
    const amt = toN(suppAmount);
    if (amt <= 0) return;
    setSaving(true); const result = await recordSupplementaryPayment({ bookingId: booking!.id, amount: amt });
    setSaving(false); if (result.success) { refresh(); setSuppAmount(""); } else setActionError(result.error ?? "Failed");
  };

  const handleDiscount = async () => {
    const amt = toN(discountAmount);
    if (amt <= 0) return;
    setSaving(true); const result = await applyDiscount({ bookingId: booking!.id, amount: amt, reason: discountReason || "手动优惠" });
    setSaving(false); if (result.success) { refresh(); setDiscountAmount(""); setDiscountReason(""); } else setActionError(result.error ?? "Failed");
  };

  const handleExtend = async () => {
    const days = toN(extendDays) || 1;
    const extraAmount = Math.round(Number(booking!.nightly_price_xof) * days);
    setSaving(true);
    const result = await extendStay(booking!.id, booking!.check_out ?? "", days, extraAmount);
    setSaving(false); if (!result.success) setActionError(result.error ?? "Failed"); else { refresh(); onClose(); }
  };

  return (
    <>
      <div className="fixed inset-0 z-overlay bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-panel w-full max-w-full overflow-auto border-l border-slate-200 bg-white shadow-panel lg:max-w-md" role="dialog" aria-label={isNew ? t.booking.newBooking : t.booking.title}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <h3 className="text-sm font-black text-slate-950">{isNew ? t.booking.newBooking : t.booking.title}</h3>
            {selectedUnit && <p className="text-sm text-slate-600">{selectedUnit.unit_no} ({selectedUnit.floor_label})</p>}
          </div>
          <Button variant="icon" size="icon" onClick={onClose} aria-label={locale === "zh" ? "关闭" : "Fermer"}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {/* New Booking */}
          {isNew && (<>
            <div>
              <label className={labelClass}>{t.booking.customer}</label>
              <select value={newCustomerId} onChange={e => setNewCustomerId(e.target.value)} className={inputClass}>
                <option value="">{t.booking.noCustomer}</option>
                {customers.filter(c => !c.is_blacklisted).map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t.checkoutModeLabel}</label>
              <div className="flex gap-2">
                <button onClick={() => setNewCheckoutMode("fixed")} className={cn("flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all duration-fast", newCheckoutMode === "fixed" ? "border-brand-orange bg-brand-orange-50 text-brand-orange-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{t.fixedCheckout}</button>
                <button onClick={() => setNewCheckoutMode("open")} className={cn("flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all duration-fast", newCheckoutMode === "open" ? "border-brand-orange bg-brand-orange-50 text-brand-orange-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{t.openCheckout}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>{t.booking.checkInDate}</label><input type="date" value={newCheckIn} onChange={e => setNewCheckIn(e.target.value)} className={inputClass} /></div>
              {newCheckoutMode === "fixed" && <div><label className={labelClass}>{t.booking.checkOutDate}</label><input type="date" value={newCheckOut} onChange={e => setNewCheckOut(e.target.value)} className={inputClass} /></div>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>{t.booking.nightlyPrice}</label><input type="number" value={newNightlyPrice} onChange={e => setNewNightlyPrice(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>{t.booking.totalAmount}</label><p className="mt-2 text-base font-black text-slate-950">{newCheckoutMode === "fixed" ? `${newNights} ${t.booking.nights} = ${formatXof(newTotal)}` : `${t.booking.nights}×${newNightlyPrice.toLocaleString()} ${locale === "zh" ? "起" : "min"}`}</p></div>
            </div>
            <div><label className={labelClass}>{t.booking.notes}</label><textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2} className={inputClass} /></div>
            {error && <p className="text-sm text-brand-red-600" role="alert">{error}</p>}
            <Button onClick={handleCreate} disabled={saving} className="w-full" variant="primary">
              {saving ? "..." : t.booking.newBooking}
            </Button>
          </>)}

          {/* Booking Detail */}
          {booking && (<>
            <div className="flex items-start justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 bg-brand-amber-50 text-brand-amber-700 ring-brand-amber-200">{t.bookingStatus[booking.status as keyof typeof t.bookingStatus] ?? booking.status}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", booking.checkout_mode === "open" ? "bg-brand-amber-100 text-brand-amber-700" : "bg-slate-100 text-slate-600")}>{booking.checkout_mode === "open" ? t.openEndedBadge : t.fixedBadge}</span>
              </div>
              <Button variant="icon" size="icon" onClick={() => printDailyReceipt({ booking, unit: selectedUnit ?? null, customer: null }, locale)} aria-label={dictionaries[locale].settings.print.print}>
                <Printer className="h-4 w-4" />
              </Button>
            </div>

            <div className="text-right text-sm"><p className="font-semibold text-slate-950">{bookingCustomer?.name ?? booking.customer_id.slice(0, 8)}</p>{bookingCustomer?.phone && <p className="text-xs text-slate-400">{bookingCustomer.phone}</p>}</div>

            <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
              <div><p className="text-[10px] text-slate-400">{t.booking.checkInDate}</p><p className="font-semibold text-slate-950">{booking.check_in}</p></div>
              <div><p className="text-[10px] text-slate-400">{booking.checkout_mode === "open" ? t.actualCheckOutDate : t.booking.checkOutDate}</p><p className="font-semibold text-slate-950">{booking.checkout_mode === "open" ? (booking.actual_check_out ?? "—") : booking.check_out}</p></div>
            </div>

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-600">{t.booking.nightlyPrice}</span><span>{formatXof(Number(booking.nightly_price_xof))}</span></div>
              {billing && (
                <>
                  <div className="flex justify-between"><span className="text-slate-600">{t.booking.nights}</span><span>{billing.nights}{locale === "zh" ? "晚" : " nuits"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">{t.billing.grossAmount}</span><span>{formatXof(billing.grossAmount)}</span></div>
                  {billing.discount > 0 && <div className="flex justify-between text-brand-green-600"><span>{t.billing.discount}</span><span>-{formatXof(billing.discount)}</span></div>}
                  <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>{t.billing.finalAmount}</span><span>{formatXof(billing.finalAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">{t.billing.paid}</span><span>{formatXof(totalPaid)}</span></div>
                  {billing.outstanding > 0 && <div className="flex justify-between text-brand-red-600 font-semibold"><span>{t.billing.outstanding}</span><span>{formatXof(billing.outstanding)}</span></div>}
                </>
              )}
            </div>

            {billing?.eligibleForMonthlyDiscount && billing.outstanding > 0 && (
              <div className="rounded-lg border border-brand-amber-200 bg-brand-amber-50 p-3 text-xs text-brand-amber-700">
                <Percent className="inline h-3.5 w-3.5 mr-1" />
                {t.monthlyDiscountHint.replace("{nights}", String(billing.nights)).replace("{gross}", formatXof(billing.grossAmount))}
              </div>
            )}

            {booking.notes && <p className="text-xs text-slate-500">{locale === "zh" ? "备注" : "Note"}: {booking.notes}</p>}

            {/* Cleaning task */}
            {relatedCleaningTask && (
              <div className="rounded-lg border border-brand-sky-200 bg-brand-sky-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-brand-sky-700">{t.cleaning.title}: {relatedCleaningTask.is_completed ? t.cleaning.completed : t.cleaning.pending}</span>
                  {!relatedCleaningTask.is_completed && (
                    <Button variant="primary" size="sm" onClick={() => { setSaving(true); completeCleaning(relatedCleaningTask.id).then(() => { setSaving(false); refresh(); onClose(); }); }} disabled={saving}>
                      <Check className="h-3 w-3" />{t.cleaning.markComplete}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Actions by status */}
            <div className="space-y-2">
              {booking.status === "pending_review" && (
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => { setSaving(true); confirmBooking(booking.id).then(r => { setSaving(false); if (r.success) { refresh(); onClose(); } else setActionError(r.error ?? "Failed"); }); }} disabled={saving} className="flex-1">{t.booking.confirmBooking}</Button>
                  <Button variant="danger-secondary" onClick={() => { setSaving(true); cancelBooking(booking.id).then(r => { setSaving(false); if (r.success) { refresh(); onClose(); } else setActionError(r.error ?? "Failed"); }); }} disabled={saving} className="flex-1"><UserX className="h-4 w-4" />{t.booking.cancelBooking}</Button>
                </div>
              )}

              {booking.status === "confirmed" && (
                <div className="space-y-2">
                  <div><label className={labelClass}>{t.booking.prepaidAmount} *</label><input type="number" value={prepaidAmount} onChange={e => setPrepaidAmount(e.target.value)} className={inputClass} /><p className="mt-0.5 text-xs text-slate-400">{t.booking.prepaidWarning}</p></div>
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={handleCheckIn} disabled={saving} className="flex-1">{t.booking.checkIn}</Button>
                    <Button variant="danger-secondary" onClick={() => { setSaving(true); cancelBooking(booking.id).then(r => { setSaving(false); if (r.success) { refresh(); onClose(); } else setActionError(r.error ?? "Failed"); }); }} disabled={saving} className="flex-1">{t.booking.cancelBooking}</Button>
                  </div>
                </div>
              )}

              {booking.status === "checked_in" && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className={labelClass}>{t.supplementaryPayment}</label>
                    <div className="flex items-center gap-2">
                      <input type="number" value={suppAmount} onChange={e => setSuppAmount(e.target.value)} className={inputClass} placeholder={t.booking.totalAmount} />
                      <Button variant="primary" size="sm" onClick={handleSuppPayment} disabled={saving || (parseInt(suppAmount,10)||0) <= 0} className="shrink-0"><DollarSign className="h-3 w-3" />{locale === "zh" ? "收款" : "Payer"}</Button>
                    </div>
                    {bookingPayments.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                        {bookingPayments.map(p => <li key={p.id} className="flex justify-between">{p.payment_date} <span className="font-semibold">{formatXof(Number(p.amount))}</span></li>)}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-lg border border-dashed border-brand-neutral-500 p-3">
                    <label className={labelClass}>{t.discount}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} className={inputClass} placeholder={t.discountAmount} />
                      <input type="text" value={discountReason} onChange={e => setDiscountReason(e.target.value)} className={inputClass} placeholder={t.discountReason} />
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleDiscount} disabled={saving || (parseInt(discountAmount,10)||0) <= 0} className="mt-2 w-full"><Percent className="h-3 w-3" />{t.applyDiscount}</Button>
                  </div>

                  {booking.checkout_mode === "fixed" && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <label className={labelClass}>{t.booking.extendStay}</label>
                      <div className="flex items-center gap-2">
                        <input type="number" min={1} value={extendDays} onChange={e => setExtendDays(e.target.value)} className="w-16 rounded-lg border border-slate-200 px-2 py-2 text-sm transition-all duration-fast hover:border-brand-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30" />
                        <span className="text-xs text-slate-600">{t.booking.nights} +{formatXof(Number(booking.nightly_price_xof) * (parseInt(extendDays,10)||1))}</span>
                        <Button variant="secondary" size="sm" onClick={handleExtend} disabled={saving}>{t.booking.extendStay}</Button>
                      </div>
                    </div>
                  )}

                  <div>
                    {booking.checkout_mode === "open" && (
                      <div className="mb-2">
                        <label className={labelClass}>{t.actualCheckOutDate}</label>
                        <input type="date" value={actualCheckOut} onChange={e => setActualCheckOut(e.target.value)} className={inputClass} />
                      </div>
                    )}
                    <label className={labelClass}>{t.booking.calculatedTotal}</label>
                    <input type="number" value={finalAmount} onChange={e => setFinalAmount(e.target.value)} className={inputClass} />
                  </div>
                  <Button variant="primary" onClick={handleCheckOut} disabled={saving} className="w-full"><Check className="h-4 w-4" />{t.booking.confirmCheckOut} — {formatXof(parseInt(finalAmount,10)||0)}</Button>
                </div>
              )}

              {booking.status === "checked_out" && (
                <div className="rounded-lg bg-slate-50 p-3 text-center text-sm text-slate-600">{t.bookingStatus.checked_out}{relatedCleaningTask && !relatedCleaningTask.is_completed && <p className="mt-1 text-xs text-brand-sky-600">{t.cleaning.pending}</p>}</div>
              )}
            </div>
            {actionError && <p className="text-sm text-brand-red-600" role="alert">{actionError}</p>}
          </>)}
        </div>
      </div>
    </>
  );
}
