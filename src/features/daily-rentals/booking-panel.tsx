"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { X, Check, UserX, Printer, DollarSign, Percent, Trash2, MoreHorizontal } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { CustomerSummary } from "./calendar";
import { printDailyReceipt } from "@/features/print";
import { calculateBilling } from "./billing";
import { getPrimaryDailyAction } from "./daily-rental-policy";
import {
  createBooking, createBackfillBooking, confirmBooking, checkIn, checkOut, completeCleaning, extendStay, cancelBooking,
  recordSupplementaryPayment, applyDiscount, deletePayment, setFixedCheckout,
} from "./actions";
import { ConfirmDialog } from "@/features/mobile/confirm-dialog";

interface BookingPanelProps {
  booking: DailyBookingRow | null; unitId: string | null; defaultDate?: string;
  units: UnitRow[]; customers: CustomerSummary[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean; completed_at?: string | null }[];
  payments: { id: string; source_id: string; amount: number; payment_date: string }[];
  locale: Locale; onClose: () => void; onChanged: () => void;
  onBookingCreated?: (booking: DailyBookingRow) => void;
  backfillMode?: boolean;
}

export function BookingPanel({ booking, unitId, defaultDate, units, customers, cleaningTasks, payments, locale, onClose, onChanged, onBookingCreated, backfillMode }: BookingPanelProps) {
  const t = dictionaries[locale].dailyRentals;
  const router = useRouter();
  const isNew = !booking && !backfillMode;
  const isBackfill = !!backfillMode;

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
  const [fixedCheckOutDate, setFixedCheckOutDate] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; amount: number } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showAdvancedActions, setShowAdvancedActions] = useState(false);

  // ── Backfill form state ──
  const [bfUnitId, setBfUnitId] = useState("");
  const [bfCustomerId, setBfCustomerId] = useState("");
  const [bfCheckIn, setBfCheckIn] = useState("");
  const [bfCheckOut, setBfCheckOut] = useState("");
  const [bfNightlyPrice, setBfNightlyPrice] = useState("40000");
  const [bfPaidAmount, setBfPaidAmount] = useState("0");
  const [bfReason, setBfReason] = useState("");
  const [bfNotes, setBfNotes] = useState("");
  const [bfError, setBfError] = useState("");

  useEffect(() => {
    if (defaultDate) { setNewCheckIn(defaultDate); const nextDay = new Date(defaultDate); nextDay.setDate(nextDay.getDate() + 1); setNewCheckOut(nextDay.toISOString().slice(0, 10)); }
  }, [defaultDate]);

  useEffect(() => {
    if (booking) { setFinalAmount(String(booking.final_amount_xof ?? booking.total_amount_xof)); }
  }, [booking]);

  useEffect(() => {
    setShowAdvancedActions(false);
    setActionError("");
  }, [booking?.id]);

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
  // Unit-level cleaning: a cleaning task on the same unit from a different booking
  // (e.g. previous guest checked out → cleaning pending → this confirmed booking can't check in yet)
  const unitCleaningTask = booking
    ? cleaningTasks.find((t) => t.unit_id === booking.unit_id && !t.is_completed && t.daily_booking_id !== booking.id) ?? null
    : null;
  const effectiveCleaningTask = relatedCleaningTask && !relatedCleaningTask.is_completed
    ? relatedCleaningTask
    : unitCleaningTask;
  const billing = booking ? calculateBilling(booking) : null;
  const primaryAction = booking
    ? getPrimaryDailyAction({
        bookingStatus: booking.status as "pending_review" | "confirmed" | "checked_in" | "checked_out" | "cancelled",
        hasOpenCleaningTask: Boolean(effectiveCleaningTask),
      })
    : null;

  const toN = (s: string) => parseInt(s, 10) || 0;

  const inputClass = "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground transition-all duration-fast hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/30";
  const labelClass = "block text-xs font-black uppercase tracking-[0.14em] text-muted-foreground/70 mb-1";
  const formatError = (message?: string | null) => formatDailyRentalError(message, locale);

  const handleCreate = async () => {
    if (!newCustomerId) { setError(t.booking.noCustomer); return; }
    if (newCheckoutMode === "fixed" && newNights <= 0) { setError(formatError("invalidDateRange")); return; }
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
    else setError(formatError(result.error));
  };

  const handleCheckIn = async () => {
    const prepay = toN(prepaidAmount);
    if (booking?.checkout_mode !== "open" && prepay <= 0) { setActionError(t.booking.prepaidWarning); return; }
    setSaving(true); const result = await checkIn(booking!.id, prepay);
    setSaving(false); if (!result.success) setActionError(formatError(result.error)); else { refresh(); onClose(); }
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
    setSaving(false); if (!result.success) setActionError(formatError(result.error)); else { refresh(); onClose(); }
  };

  const handleSuppPayment = async () => {
    const amt = toN(suppAmount);
    if (amt <= 0) return;
    setSaving(true); const result = await recordSupplementaryPayment({ bookingId: booking!.id, amount: amt });
    setSaving(false); if (result.success) { refresh(); setSuppAmount(""); } else setActionError(formatError(result.error));
  };

  const handleDiscount = async () => {
    const amt = toN(discountAmount);
    if (amt <= 0) return;
    setSaving(true); const result = await applyDiscount({ bookingId: booking!.id, amount: amt, reason: discountReason || "手动优惠" });
    setSaving(false); if (result.success) { refresh(); setDiscountAmount(""); setDiscountReason(""); } else setActionError(formatError(result.error));
  };

  const handleExtend = async () => {
    const days = toN(extendDays) || 1;
    const extraAmount = Math.round(Number(booking!.nightly_price_xof) * days);
    const nextCheckOut = booking!.check_out ? addDays(booking!.check_out, days) : "";
    setSaving(true);
    const result = await extendStay(booking!.id, nextCheckOut, days, extraAmount);
    setSaving(false); if (!result.success) setActionError(formatError(result.error)); else { refresh(); onClose(); }
  };

  const fixedCheckOutNights = useMemo(() => {
    if (!booking || !fixedCheckOutDate) return 0;
    return Math.max(0, Math.ceil((new Date(fixedCheckOutDate).getTime() - new Date(booking.check_in).getTime()) / (1000 * 60 * 60 * 24)));
  }, [booking, fixedCheckOutDate]);

  const handleSetFixedCheckout = async () => {
    if (!fixedCheckOutDate) { setActionError(formatError("checkOutRequired")); return; }
    setSaving(true);
    const result = await setFixedCheckout(booking!.id, fixedCheckOutDate);
    setSaving(false); if (!result.success) setActionError(formatError(result.error)); else { refresh(); onClose(); }
  };

  // ── Backfill handler ──
  const bfNights = useMemo(() => {
    if (!bfCheckIn || !bfCheckOut) return 0;
    return Math.max(1, Math.ceil((new Date(bfCheckOut).getTime() - new Date(bfCheckIn).getTime()) / (1000 * 60 * 60 * 24)));
  }, [bfCheckIn, bfCheckOut]);
  const bfTotal = bfNights * (parseInt(bfNightlyPrice, 10) || 0);

  const handleBackfillCreate = async () => {
    if (!bfUnitId) { setBfError(locale === "zh" ? "请选择房间。" : "Veuillez choisir une chambre."); return; }
    if (!bfCustomerId) { setBfError(t.booking.noCustomer); return; }
    if (!bfCheckIn || !bfCheckOut) { setBfError(formatError("invalidDateRange")); return; }
    if (!bfReason) { setBfError(locale === "zh" ? "请填写补录原因。" : "Veuillez indiquer la raison du backfill."); return; }
    setSaving(true); setBfError("");
    const result = await createBackfillBooking({
      unitId: bfUnitId, customerId: bfCustomerId,
      checkIn: bfCheckIn, checkOut: bfCheckOut,
      nightlyPriceXof: parseInt(bfNightlyPrice, 10) || 40000,
      prepaidAmountXof: parseInt(bfPaidAmount, 10) || 0,
      reason: bfReason,
      notes: bfNotes || undefined,
    });
    setSaving(false);
    if (result.success) {
      if (result.data) onBookingCreated?.(result.data);
      refresh(); onClose();
    }
    else setBfError(formatError(result.error));
  };

  return (
    <>
      <div className="fixed inset-0 z-overlay bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-panel w-full max-w-full overflow-auto border-l bg-card shadow-lg lg:max-w-md" role="dialog" aria-label={isNew ? t.booking.newBooking : t.booking.title}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-5 py-4 backdrop-blur">
          <div>
            <h3 className="text-sm font-bold">{isBackfill ? (locale === "zh" ? "历史补录" : "Backfill") : isNew ? t.booking.newBooking : t.booking.title}</h3>
            {selectedUnit && <p className="text-sm text-muted-foreground">{selectedUnit.unit_no} ({selectedUnit.floor_label})</p>}
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label={locale === "zh" ? "关闭" : "Fermer"}>
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
                <button onClick={() => setNewCheckoutMode("fixed")} className={cn("flex-1 rounded-md border px-3 py-2.5 text-xs font-semibold transition-all", newCheckoutMode === "fixed" ? "border-primary/30 bg-accent text-accent-foreground" : "border bg-card text-muted-foreground hover:bg-accent")}>{t.fixedCheckout}</button>
                <button onClick={() => setNewCheckoutMode("open")} className={cn("flex-1 rounded-md border px-3 py-2.5 text-xs font-semibold transition-all", newCheckoutMode === "open" ? "border-primary/30 bg-accent text-accent-foreground" : "border bg-card text-muted-foreground hover:bg-accent")}>{t.openCheckout}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>{t.booking.checkInDate}</label><DateInput value={newCheckIn} onChangeValue={setNewCheckIn} className={inputClass} min={new Date().toISOString().slice(0, 10)} /></div>
              {newCheckoutMode === "fixed" && <div><label className={labelClass}>{t.booking.checkOutDate}</label><DateInput value={newCheckOut} onChangeValue={setNewCheckOut} className={inputClass} /></div>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>{t.booking.nightlyPrice}</label><input type="number" value={newNightlyPrice} onChange={e => setNewNightlyPrice(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>{t.booking.totalAmount}</label><p className="mt-2 text-base font-black text-foreground">{newCheckoutMode === "fixed" ? `${newNights} ${t.booking.nights} = ${formatXof(newTotal)}` : `${t.booking.nights}×${newNightlyPrice.toLocaleString()} ${locale === "zh" ? "起" : "min"}`}</p></div>
            </div>
            <div><label className={labelClass}>{t.booking.notes}</label><textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2} className={inputClass} /></div>
            {error && <p className="text-sm text-accentRed-600" role="alert">{error}</p>}
            <Button onClick={handleCreate} disabled={saving} className="w-full" variant="default">
              {saving ? "..." : t.booking.newBooking}
            </Button>
          </>)}

          {/* ── Backfill Form (admin only) ── */}
          {isBackfill && (
            <div className="space-y-3">
              <div className="rounded-lg border border-accentAmber-200 bg-accentAmber-50 p-3 text-xs text-accentAmber-700">
                {locale === "zh"
                  ? "历史补录：录入过去已完成的入住记录，不会改变当前房间状态，不会创建保洁任务。"
                  : "Backfill : enregistrer un sejour passe deja termine. Ne modifie pas l'etat actuel de la chambre."}
              </div>

              <div>
                <label className={labelClass}>{locale === "zh" ? "房间" : "Chambre"}</label>
                <select value={bfUnitId} onChange={e => setBfUnitId(e.target.value)} className={inputClass}>
                  <option value="">{locale === "zh" ? "选择房间" : "Choisir"}</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.unit_no} ({u.floor_label})</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>{t.booking.customer}</label>
                <select value={bfCustomerId} onChange={e => setBfCustomerId(e.target.value)} className={inputClass}>
                  <option value="">{t.booking.noCustomer}</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass}>{t.booking.checkInDate}</label><DateInput value={bfCheckIn} onChangeValue={setBfCheckIn} className={inputClass} /></div>
                <div><label className={labelClass}>{t.booking.checkOutDate}</label><DateInput value={bfCheckOut} onChangeValue={setBfCheckOut} className={inputClass} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelClass}>{t.booking.nightlyPrice}</label><input type="number" value={bfNightlyPrice} onChange={e => setBfNightlyPrice(e.target.value)} className={inputClass} /></div>
                <div><label className={labelClass}>{locale === "zh" ? "已收金额" : "Montant percu"}</label><input type="number" value={bfPaidAmount} onChange={e => setBfPaidAmount(e.target.value)} className={inputClass} /></div>
              </div>
              {bfCheckIn && bfCheckOut && (
                <p className="text-xs text-muted-foreground">
                  {bfNights} {locale === "zh" ? "晚 ×" : "nuits ×"} {parseInt(bfNightlyPrice, 10).toLocaleString()} = {formatXof(bfTotal)}{" "}
                  {parseInt(bfPaidAmount, 10) > 0 && <span className="text-accentGreen-600">({locale === "zh" ? "已收" : "percu"} {formatXof(parseInt(bfPaidAmount, 10))})</span>}
                </p>
              )}
              <div>
                <label className={labelClass}>{locale === "zh" ? "补录原因 *" : "Raison *"}</label>
                <input type="text" value={bfReason} onChange={e => setBfReason(e.target.value)} className={inputClass} placeholder={locale === "zh" ? "如：补录2024年历史入住" : "ex: backfill sejour 2024"} />
              </div>
              <div>
                <label className={labelClass}>{t.booking.notes}</label>
                <textarea value={bfNotes} onChange={e => setBfNotes(e.target.value)} rows={2} className={inputClass} />
              </div>
              {bfError && <p className="text-sm text-accentRed-600" role="alert">{bfError}</p>}
              <Button onClick={handleBackfillCreate} disabled={saving} className="w-full" variant="default">
                {saving ? "..." : (locale === "zh" ? "确认补录" : "Confirmer le backfill")}
              </Button>
            </div>
          )}

          {/* Booking Detail */}
          {booking && !isBackfill && (<>
            <div className="flex items-start justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 bg-accentAmber-50 text-accentAmber-700 ring-amber-200">{t.bookingStatus[booking.status as keyof typeof t.bookingStatus] ?? booking.status}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", booking.checkout_mode === "open" ? "bg-accentAmber-50 text-accentAmber-700" : "bg-muted text-foreground/70")}>{booking.checkout_mode === "open" ? t.openEndedBadge : t.fixedBadge}</span>
              </div>
              <Button size="icon" variant="ghost" onClick={() => printDailyReceipt({ booking, unit: selectedUnit ?? null, customer: null }, locale)} aria-label={dictionaries[locale].settings.print.print}>
                <Printer className="h-4 w-4" />
              </Button>
            </div>

            <div className="text-right text-sm"><p className="font-semibold text-foreground">{bookingCustomer?.name ?? booking.customer_id.slice(0, 8)}</p>{bookingCustomer?.phone && <p className="text-xs text-muted-foreground/70">{bookingCustomer.phone}</p>}</div>

            <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted p-3 text-sm">
              <div><p className="text-xs text-muted-foreground/70">{t.booking.checkInDate}</p><p className="font-semibold text-foreground">{booking.check_in}</p></div>
              <div><p className="text-xs text-muted-foreground/70">{booking.checkout_mode === "open" ? t.actualCheckOutDate : t.booking.checkOutDate}</p><p className="font-semibold text-foreground">{booking.checkout_mode === "open" ? (booking.actual_check_out ?? "—") : booking.check_out}</p></div>
            </div>

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-foreground/70">{t.booking.nightlyPrice}</span><span>{formatXof(Number(booking.nightly_price_xof))}</span></div>
              {billing && (
                <>
                  <div className="flex justify-between"><span className="text-foreground/70">{t.booking.nights}</span><span>{billing.nights}{locale === "zh" ? "晚" : " nuits"}</span></div>
                  <div className="flex justify-between"><span className="text-foreground/70">{t.billing.grossAmount}</span><span>{formatXof(billing.grossAmount)}</span></div>
                  {billing.discount > 0 && <div className="flex justify-between text-accentGreen-600"><span>{t.billing.discount}</span><span>-{formatXof(billing.discount)}</span></div>}
                  <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>{t.billing.finalAmount}</span><span>{formatXof(billing.finalAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-foreground/70">{t.billing.paid}</span><span>{formatXof(totalPaid)}</span></div>
                  {billing.outstanding > 0 && <div className="flex justify-between text-accentRed-600 font-semibold"><span>{t.billing.outstanding}</span><span>{formatXof(billing.outstanding)}</span></div>}
                </>
              )}
            </div>

            {billing?.eligibleForMonthlyDiscount && billing.outstanding > 0 && (
              <div className="rounded-lg border border-amber-200 bg-accentAmber-50 p-3 text-xs text-accentAmber-700">
                <Percent className="inline h-3.5 w-3.5 mr-1" />
                {t.monthlyDiscountHint.replace("{nights}", String(billing.nights)).replace("{gross}", formatXof(billing.grossAmount))}
              </div>
            )}

            {booking.notes && <p className="text-xs text-muted-foreground">{locale === "zh" ? "备注" : "Note"}: {booking.notes}</p>}

            {/* Cleaning task summary. Open cleaning actions are rendered by the primary action block below. */}
            {effectiveCleaningTask && (effectiveCleaningTask.is_completed || primaryAction?.action !== "complete_cleaning") && (
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-cyan-700">{t.cleaning.title}: {effectiveCleaningTask.is_completed ? t.cleaning.completed : t.cleaning.pending}</span>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════
                 Actions driven by getPrimaryDailyAction.
                 Each status block: primary button first, then secondary / folds.
                 ════════════════════════════════════════════════════════════ */}
            <div className="space-y-2">

              {/* ── pending_review → primary = confirm ── */}
              {primaryAction?.action === "confirm" && (
                <div className="space-y-2">
                  <Button variant="default" onClick={() => { setSaving(true); confirmBooking(booking.id).then(r => { setSaving(false); if (r.success) { refresh(); onClose(); } else setActionError(formatError(r.error)); }); }} disabled={saving} className="w-full">{t.booking.confirmBooking}</Button>
                  <Button variant="outline" size="sm" onClick={() => { setSaving(true); cancelBooking(booking.id).then(r => { setSaving(false); if (r.success) { refresh(); onClose(); } else setActionError(formatError(r.error)); }); }} disabled={saving} className="w-full justify-center text-accentRed-600 hover:bg-accentRed-50 hover:text-accentRed-700"><UserX className="h-3.5 w-3.5 mr-1" />{t.booking.cancelBooking}</Button>
                </div>
              )}

              {/* ── confirmed + cleaning blocked → primary = complete_cleaning ── */}
              {primaryAction?.action === "complete_cleaning" && booking.status === "confirmed" && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
                    <p className="text-xs font-semibold text-amber-700">
                      {locale === "zh" ? "此预订已确认，需先完成保洁后才能办理入住。" : "Reservation confirmee. Le menage doit etre termine avant l'arrivee."}
                    </p>
                  </div>
                  {effectiveCleaningTask && (
                    <Button variant="default" size="sm" onClick={() => { setSaving(true); completeCleaning(effectiveCleaningTask.id).then(() => { setSaving(false); refresh(); onClose(); }); }} disabled={saving} className="w-full">
                      <Check className="h-3.5 w-3.5 mr-1" />{t.cleaning.markComplete}
                    </Button>
                  )}
                </div>
              )}

              {/* ── confirmed (no cleaning block) → primary = check_in ── */}
              {primaryAction?.action === "check_in" && (
                <div className="space-y-2">
                  <div><label className={labelClass}>{t.booking.prepaidAmount}{booking.checkout_mode !== "open" ? " *" : ""}</label><input type="number" value={prepaidAmount} onChange={e => setPrepaidAmount(e.target.value)} className={inputClass} /><p className="mt-0.5 text-xs text-muted-foreground/70">{t.booking.prepaidWarning}</p></div>
                  <Button variant="default" onClick={handleCheckIn} disabled={saving} className="w-full">{t.booking.checkIn}</Button>
                  <Button variant="outline" size="sm" onClick={() => { setSaving(true); cancelBooking(booking.id).then(r => { setSaving(false); if (r.success) { refresh(); onClose(); } else setActionError(formatError(r.error)); }); }} disabled={saving} className="w-full justify-center text-accentRed-600 hover:bg-accentRed-50 hover:text-accentRed-700"><UserX className="h-3.5 w-3.5 mr-1" />{t.booking.cancelBooking}</Button>
                </div>
              )}

              {/* ── checked_in → primary = check_out ── */}
              {primaryAction?.action === "check_out" && (
                <div className="space-y-3">
                  {/* ── Checkout total + date ── */}
                  <div className="rounded-lg border border-border bg-card p-3">
                    {booking.checkout_mode === "open" && (
                      <div className="mb-2">
                        <label className={labelClass}>{t.actualCheckOutDate}</label>
                        <DateInput value={actualCheckOut} onChangeValue={setActualCheckOut} className={inputClass} />
                      </div>
                    )}
                    <label className={labelClass}>{t.booking.calculatedTotal}</label>
                    <input type="number" value={finalAmount} onChange={e => setFinalAmount(e.target.value)} className={inputClass} />
                  </div>

                  <Button variant="default" onClick={handleCheckOut} disabled={saving} className="w-full"><Check className="h-4 w-4 mr-1" />{t.booking.confirmCheckOut} — {formatXof(parseInt(finalAmount,10)||0)}</Button>

                  {/* ── More actions: supplementary payment + discount + extend + fixed checkout ── */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAdvancedActions((value) => !value)}
                    className="w-full justify-center"
                  >
                    <MoreHorizontal className="h-4 w-4 mr-1" />
                    {showAdvancedActions
                      ? (locale === "zh" ? "收起辅助操作" : "Masquer")
                      : (locale === "zh" ? "辅助操作" : "Plus d'actions")}
                  </Button>

                  {showAdvancedActions && (
                    <div className="space-y-3 rounded-lg border border-dashed border-muted-foreground/20 p-3">

                      {/* Supplementary payment */}
                      <div>
                        <label className={labelClass}>{t.supplementaryPayment}</label>
                        <div className="flex items-center gap-2">
                          <input type="number" value={suppAmount} onChange={e => setSuppAmount(e.target.value)} className={inputClass} placeholder={t.booking.totalAmount} />
                          <Button variant="secondary" size="sm" onClick={handleSuppPayment} disabled={saving || (parseInt(suppAmount,10)||0) <= 0} className="shrink-0"><DollarSign className="h-3 w-3" />{locale === "zh" ? "收" : "+"}</Button>
                        </div>
                        {bookingPayments.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5 text-xs text-foreground/70">
                            {bookingPayments.map(p => (
                              <li key={p.id} className="flex items-center justify-between group">
                                <span>{p.payment_date} <span className="font-semibold">{formatXof(Number(p.amount))}</span></span>
                                <button
                                  type="button"
                                  className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-muted-foreground/70 hover:text-accentRed-600 hover:bg-accentRed-50"
                                  onClick={() => setDeleteTarget({ id: p.id, amount: Number(p.amount) })}
                                  title={locale === "zh" ? "删除此收款" : "Supprimer ce paiement"}
                                ><Trash2 className="h-3 w-3" /></button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Discount */}
                      <div>
                        <label className={labelClass}>{t.discount}</label>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} className={inputClass} placeholder={t.discountAmount} />
                          <input type="text" value={discountReason} onChange={e => setDiscountReason(e.target.value)} className={inputClass} placeholder={t.discountReason} />
                        </div>
                        <Button variant="secondary" size="sm" onClick={handleDiscount} disabled={saving || (parseInt(discountAmount,10)||0) <= 0} className="mt-2 w-full"><Percent className="h-3 w-3 mr-1" />{t.applyDiscount}</Button>
                      </div>

                      {/* Extend stay (fixed mode only) */}
                      {booking.checkout_mode === "fixed" && (
                        <div>
                          <label className={labelClass}>{t.booking.extendStay}</label>
                          <div className="flex items-center gap-2">
                            <input type="number" min={1} value={extendDays} onChange={e => setExtendDays(e.target.value)} className="w-16 rounded-lg border border-border px-2 py-2 text-sm transition-all duration-fast hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/30" />
                            <span className="text-xs text-foreground/70">+{formatXof(Number(booking.nightly_price_xof) * (parseInt(extendDays,10)||1))}</span>
                            <Button variant="secondary" size="sm" onClick={handleExtend} disabled={saving}>{t.booking.extendStay}</Button>
                          </div>
                        </div>
                      )}

                      {/* Set fixed checkout (open mode only) */}
                      {booking.checkout_mode === "open" && (
                        <div>
                          <p className="text-xs font-semibold text-accentBlue-700 mb-1">{t.setFixedCheckout}</p>
                          <p className="text-xs text-muted-foreground mb-2">{t.setFixedCheckoutDesc}</p>
                          <div className="flex items-center gap-2">
                            <DateInput value={fixedCheckOutDate} onChangeValue={setFixedCheckOutDate} className={inputClass} min={booking.check_in} />
                            <Button variant="secondary" size="sm" onClick={handleSetFixedCheckout} disabled={saving || !fixedCheckOutDate} className="shrink-0">{t.setFixedCheckoutButton}</Button>
                          </div>
                          {fixedCheckOutDate && fixedCheckOutNights > 0 && (
                            <p className="mt-1 text-xs text-foreground/70">{t.setFixedCheckoutNights.replace("{nights}", String(fixedCheckOutNights)).replace("{amount}", formatXof(fixedCheckOutNights * Number(booking.nightly_price_xof)))}</p>
                          )}
                        </div>
                      )}

                    </div>
                  )}
                </div>
              )}

              {/* ── checked_out + cleaning pending → primary = complete_cleaning ── */}
              {primaryAction?.action === "complete_cleaning" && booking.status === "checked_out" && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-center">
                    <p className="text-xs font-semibold text-cyan-700 mb-2">{t.cleaning.pending}</p>
                    {effectiveCleaningTask && (
                      <Button variant="default" size="sm" onClick={() => { setSaving(true); completeCleaning(effectiveCleaningTask.id).then(() => { setSaving(false); refresh(); onClose(); }); }} disabled={saving}>
                        <Check className="h-3.5 w-3.5 mr-1" />{t.cleaning.markComplete}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* ── checked_out without cleaning → view_settlement (read-only) ── */}
              {primaryAction?.action === "view_settlement" && (
                <div className="rounded-lg bg-muted/50 p-3 text-center text-sm text-foreground/70">{t.bookingStatus.checked_out}</div>
              )}

              {/* ── readonly (cancelled / blocked units / past dates) ── */}
              {primaryAction?.action === "readonly" && (
                <div className="rounded-lg bg-muted/50 p-3 text-center text-sm text-muted-foreground">
                  {primaryAction.reason === "booking_cancelled"
                    ? t.bookingStatus.cancelled
                    : primaryAction.reason
                      ? formatError(primaryAction.reason)
                      : (locale === "zh" ? "此房间当前不可操作" : "Aucune action disponible")}
                </div>
              )}
            </div>
            {actionError && <p className="text-sm text-accentRed-600" role="alert">{actionError}</p>}
          </>)}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          setDeleteLoading(true);
          deletePayment(deleteTarget.id).then(() => {
            setDeleteLoading(false);
            setDeleteTarget(null);
            refresh();
          });
        }}
        title={locale === "zh" ? "删除收款记录" : "Supprimer le paiement"}
        description={deleteTarget
          ? (locale === "zh" ? `确认删除这笔 ${formatXof(deleteTarget.amount)} 的收款？此操作不可撤销。` : `Confirmer la suppression de ce paiement de ${formatXof(deleteTarget.amount)} ? Cette action est irreversible.`)
          : ""}
        confirmLabel={locale === "zh" ? "确认删除" : "Supprimer"}
        locale={locale}
        loading={deleteLoading}
      />
    </>
  );
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDailyRentalError(message: string | null | undefined, locale: Locale): string {
  const fallback = locale === "zh" ? "操作失败，请稍后重试。" : "Operation impossible. Veuillez reessayer.";
  if (!message) return fallback;

  if (message.startsWith("doubleBooked:")) {
    const detail = message.replace("doubleBooked:", "").trim();
    return locale === "zh"
      ? `该房间所选日期已被占用：${detail}`
      : `Cette chambre est deja occupee sur cette periode : ${detail}`;
  }

  const errors: Record<string, Record<Locale, string>> = {
    checkInRequired: {
      zh: "请选择入住日期。",
      fr: "Veuillez choisir une date d'arrivee.",
    },
    checkOutRequired: {
      zh: "请选择离店日期。",
      fr: "Veuillez choisir une date de depart.",
    },
    invalidDateRange: {
      zh: "离店日期必须晚于入住日期。",
      fr: "La date de depart doit etre apres la date d'arrivee.",
    },
    pastDateNotAllowed: {
      zh: "不能创建过去日期的普通预订。如需补录历史订单，请使用历史补录流程。",
      fr: "Impossible de creer une reservation normale dans le passe. Utilisez le mode de rattrapage historique.",
    },
    cleaningPending: {
      zh: "该房间仍待保洁，完成保洁后才能安排入住。",
      fr: "Cette chambre est encore en menage. Terminez le menage avant une nouvelle arrivee.",
    },
    unitMaintenance: {
      zh: "该房间处于维修状态，暂不能预订。",
      fr: "Cette chambre est en maintenance et ne peut pas etre reservee.",
    },
    unitLocked: {
      zh: "该房间已锁定，暂不能预订。",
      fr: "Cette chambre est verrouillee et ne peut pas etre reservee.",
    },
    longLeaseConflict: {
      zh: "该房间已有生效长租合同，不能创建日租预订。",
      fr: "Cette chambre a deja un bail long actif.",
    },
    saleConflict: {
      zh: "该房间已有生效出售合同，不能创建日租预订。",
      fr: "Cette chambre a deja un contrat de vente actif.",
    },
    prepaymentRequired: {
      zh: "固定离店订单办理入住前必须至少收取一笔预付款。",
      fr: "Une avance est requise avant l'arrivee pour un depart fixe.",
    },
    bookingNotPendingReview: {
      zh: "只有待确认预订可以执行确认操作。",
      fr: "Seules les reservations a valider peuvent etre confirmees.",
    },
    bookingNotConfirmed: {
      zh: "只有已确认预订可以办理入住。",
      fr: "Seules les reservations confirmees peuvent etre enregistrees en arrivee.",
    },
    bookingNotCheckedIn: {
      zh: "只有入住中的订单可以办理退房。",
      fr: "Seuls les sejours en cours peuvent etre clotures.",
    },
    bookingCannotBeCancelled: {
      zh: "该订单当前状态不能取消。",
      fr: "Cette reservation ne peut pas etre annulee dans son etat actuel.",
    },
    cleaningTaskNotFound: {
      zh: "未找到待保洁任务。",
      fr: "Tache de menage introuvable.",
    },
    cleaningTaskAlreadyCompleted: {
      zh: "该保洁任务已完成。",
      fr: "Cette tache de menage est deja terminee.",
    },
    actualCheckOutBeforeCheckIn: {
      zh: "实际退房日期不能早于入住日期。",
      fr: "La date de depart reelle ne peut pas etre avant l'arrivee.",
    },
    backfillMustBePastDate: {
      zh: "历史补录只能录入过去日期。",
      fr: "Le backfill est reserve aux dates passees.",
    },
    backfillMustBeCompleted: {
      zh: "历史补录只能录入已经结束的住宿记录。",
      fr: "Le backfill est reserve aux sejours deja termines.",
    },
    invalidPrice: {
      zh: "每晚价格必须大于 0。",
      fr: "Le prix par nuit doit etre superieur a 0.",
    },
    invalidPrepaid: {
      zh: "已收金额不能为负数。",
      fr: "Le montant percu ne peut pas etre negatif.",
    },
  };

  return errors[message]?.[locale] ?? message;
}
