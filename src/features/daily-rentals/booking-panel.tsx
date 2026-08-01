"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Check, UserX, Printer, DollarSign, Percent, Trash2, MoreHorizontal, WalletCards, CalendarClock } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { RightDrawer, controlClass } from "@/components/ui/operational";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import type { CustomerSummary } from "./calendar";
import { printDailyReceipt } from "@/features/print";
import { calculateBilling } from "./billing";
import { getDailyLodgingBusinessType, getPrimaryDailyAction, type DailyLodgingBusinessType } from "./daily-rental-policy";
import {
  createBooking, createBackfillBooking, checkIn, checkOut, completeCleaning, extendStay, cancelBooking,
  recordSupplementaryPayment, applyDiscount, reversePayment, setFixedCheckout,
} from "./actions";
import type { DailyOperationSnapshot } from "./actions";
import { ConfirmDialog } from "@/features/mobile/confirm-dialog";

interface BookingPanelProps {
  booking: DailyBookingRow | null; unitId: string | null; defaultDate?: string;
  units: UnitRow[]; customers: CustomerSummary[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean; completed_at?: string | null }[];
  payments: {
    id: string;
    source_id: string;
    amount: number;
    payment_date: string;
    reversal_of_payment_id?: string | null;
  }[];
  locale: Locale; onClose: () => void; onChanged: () => void;
  onBookingCreated?: (booking: DailyBookingRow) => void;
  onCleaningTaskCompleted?: (taskId: string, unitId: string, status: UnitStatus) => void;
  onOperationSnapshot?: (snapshot: DailyOperationSnapshot) => void;
  backfillMode?: boolean;
  readOnly?: boolean;
}

type AdvancedTask = "payment" | "discount" | "extend" | "fixedCheckout" | null;

export function BookingPanel({
  booking,
  unitId,
  defaultDate,
  units,
  customers,
  cleaningTasks,
  payments,
  locale,
  onClose,
  onChanged,
  onBookingCreated,
  onCleaningTaskCompleted,
  onOperationSnapshot,
  backfillMode,
  readOnly = false,
}: BookingPanelProps) {
  const t = dictionaries[locale].dailyRentals;
  const router = useRouter();
  const isNew = !booking && !backfillMode;
  const isBackfill = !!backfillMode;

  const refresh = () => {
    router.refresh();
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
  const createRequestIdRef = useRef<string | null>(null);

  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [suppAmount, setSuppAmount] = useState("");
  const [suppPaymentDate, setSuppPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [suppReceiptNo, setSuppReceiptNo] = useState("");
  const [actualCheckOut, setActualCheckOut] = useState(new Date().toISOString().slice(0, 10));
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [extendDays, setExtendDays] = useState("1");
  const [fixedCheckOutDate, setFixedCheckOutDate] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; amount: number } | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [showAdvancedActions, setShowAdvancedActions] = useState(false);
  const [activeAdvancedTask, setActiveAdvancedTask] = useState<AdvancedTask>(null);

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
    setShowAdvancedActions(false);
    setActiveAdvancedTask(null);
    setActionError("");
  }, [booking?.id]);

  const selectedUnit = unitId ? units.find((u) => u.id === unitId) : null;
  const dailySelectableCustomers = useMemo(
    () => customers.filter((customer) =>
      !customer.has_active_lease_contract &&
      !customer.has_active_sale_contract
    ),
    [customers],
  );
  const bookingPayments = useMemo(() => payments.filter(p => p.source_id === booking?.id), [payments, booking]);
  const totalPaid = bookingPayments.reduce((s, p) => s + Number(p.amount), 0);
  const reversedPaymentIds = useMemo(
    () => new Set(bookingPayments.map((payment) => payment.reversal_of_payment_id).filter(Boolean)),
    [bookingPayments],
  );

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
  const finalDue = billing?.finalAmount ?? 0;
  const rawOutstanding = finalDue - totalPaid;
  const outstanding = rawOutstanding <= 1 ? 0 : Math.max(0, rawOutstanding);
  const hasOutstandingBalance = outstanding > 0;
  const lodgingBusinessType = booking && billing
    ? getDailyLodgingBusinessType({
        status: booking.status as "pending_review" | "confirmed" | "checked_in" | "checked_out" | "cancelled",
        checkoutMode: booking.checkout_mode,
        paidAmount: totalPaid,
        finalAmount: billing.finalAmount,
      })
    : null;
  const lodgingBusinessLabel = lodgingBusinessType ? getLodgingBusinessTypeLabel(lodgingBusinessType, locale) : null;
  const lodgingBusinessToneClass = lodgingBusinessType ? getLodgingBusinessTypeClass(lodgingBusinessType) : "";
  const primaryAction = booking
    ? getPrimaryDailyAction({
        bookingStatus: booking.status as "pending_review" | "confirmed" | "checked_in" | "checked_out" | "cancelled",
        hasOpenCleaningTask: Boolean(effectiveCleaningTask),
        hasOutstandingBalance,
      })
    : null;

  useEffect(() => {
    if (booking?.status === "checked_out" && hasOutstandingBalance) {
      setSuppAmount(String(outstanding));
      setSuppPaymentDate(new Date().toISOString().slice(0, 10));
      setSuppReceiptNo("");
    }
  }, [booking?.id, booking?.status, hasOutstandingBalance, outstanding]);

  const toN = (s: string) => parseInt(s, 10) || 0;

  const inputClass = cn("w-full bg-card", controlClass);
  const labelClass = "mb-1 block text-xs font-semibold text-muted-foreground";
  const formatError = (message?: string | null) => formatDailyRentalError(message, locale);
  const runPanelAction = async (
    action: () => Promise<{ success: boolean; error?: string; data?: DailyOperationSnapshot } | void>,
    options: {
      closeOnSuccess?: boolean;
      clearAdvancedTask?: boolean;
    } = {},
  ) => {
    setSaving(true);
    setActionError("");
    setError("");
    if (options.clearAdvancedTask) setActiveAdvancedTask(null);
    try {
      const result = await action();
      if (result && result.success === false) {
        setActionError(formatError(result.error ?? "unknownError"));
        return;
      }
      if (result?.data) onOperationSnapshot?.(result.data);
      else refresh();
      if (options.closeOnSuccess) onClose();
    } catch (operationError) {
      setActionError(formatError(operationError instanceof Error ? operationError.message : "unknownError"));
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!newCustomerId) { setError(t.booking.noCustomer); return; }
    if (newCheckoutMode === "fixed" && newNights <= 0) { setError(formatError("invalidDateRange")); return; }
    setError("");
    const nightlyPrice = toN(newNightlyPrice) || 40000;
    const requestId = createRequestIdRef.current ?? crypto.randomUUID();
    createRequestIdRef.current = requestId;
    await runPanelAction(
      async () => createBooking({
        unitId: unitId!, customerId: newCustomerId, checkIn: newCheckIn,
        checkOut: newCheckoutMode === "fixed" ? newCheckOut : undefined,
        checkoutMode: newCheckoutMode, nightlyPriceXof: nightlyPrice,
        notes: newNotes || undefined,
        requestId,
      }),
      { closeOnSuccess: true },
    );
  };

  const handleCheckIn = async () => {
    const prepay = toN(prepaidAmount);
    const requestId = prepay > 0 ? crypto.randomUUID() : undefined;
    await runPanelAction(
      () => checkIn(booking!.id, prepay, requestId),
      { closeOnSuccess: true },
    );
  };

  const handleCheckOut = async () => {
    const disc = toN(discountAmount);
    await runPanelAction(
      () => checkOut(booking!.id, {
        actualCheckOut: booking?.checkout_mode === "open" ? actualCheckOut : undefined,
        discountAmount: disc || undefined,
        discountReason: discountReason || undefined,
      }),
      { closeOnSuccess: true },
    );
  };

  const handleSuppPayment = async () => {
    const amt = toN(suppAmount);
    if (amt <= 0) return;
    await runPanelAction(
      () => recordSupplementaryPayment({
        bookingId: booking!.id,
        amount: amt,
        paymentDate: suppPaymentDate || undefined,
        receiptNo: suppReceiptNo || undefined,
        requestId: crypto.randomUUID(),
      }),
      { closeOnSuccess: true, clearAdvancedTask: true },
    );
    setSuppAmount("");
  };

  const handleDiscount = async () => {
    const amt = toN(discountAmount);
    if (amt <= 0) return;
    await runPanelAction(
      () => applyDiscount({ bookingId: booking!.id, amount: amt, reason: discountReason || "手动优惠" }),
      { closeOnSuccess: true, clearAdvancedTask: true },
    );
    setDiscountAmount("");
    setDiscountReason("");
  };

  const handleExtend = async () => {
    const days = toN(extendDays) || 1;
    const extraAmount = Math.round(Number(booking!.nightly_price_xof) * days);
    const nextCheckOut = booking!.check_out ? addDays(booking!.check_out, days) : "";
    await runPanelAction(
      () => extendStay(booking!.id, nextCheckOut, days, extraAmount, crypto.randomUUID()),
      { closeOnSuccess: true },
    );
  };

  const fixedCheckOutNights = useMemo(() => {
    if (!booking || !fixedCheckOutDate) return 0;
    return Math.max(0, Math.ceil((new Date(fixedCheckOutDate).getTime() - new Date(booking.check_in).getTime()) / (1000 * 60 * 60 * 24)));
  }, [booking, fixedCheckOutDate]);

  const handleSetFixedCheckout = async () => {
    if (!fixedCheckOutDate) { setActionError(formatError("checkOutRequired")); return; }
    await runPanelAction(
      () => setFixedCheckout(booking!.id, fixedCheckOutDate),
      { closeOnSuccess: true },
    );
  };

  // ── Backfill handler ──
  const handleCancelBooking = async () => {
    await runPanelAction(
      () => cancelBooking(booking!.id),
      { closeOnSuccess: true },
    );
  };

  const handleCompleteCleaning = async () => {
    if (!effectiveCleaningTask) return;
    await runPanelAction(
      async () => {
        const result = await completeCleaning(effectiveCleaningTask.id);
        if (result.success && result.taskId && result.unitId && result.unitStatus) {
          onCleaningTaskCompleted?.(result.taskId, result.unitId, result.unitStatus);
        }
        return result;
      },
      { closeOnSuccess: true },
    );
  };

  const handleReversePayment = async () => {
    if (!deleteTarget || !reversalReason.trim()) return;
    setSaving(true);
    setActionError("");
    try {
      const result = await reversePayment({
        paymentId: deleteTarget.id,
        reason: reversalReason.trim(),
        requestId: crypto.randomUUID(),
      });
      if (!result.success) {
        setActionError(formatError(result.error ?? "unknownError"));
        return;
      }
      if (result.data) onOperationSnapshot?.(result.data);
      else refresh();
      setDeleteTarget(null);
      setReversalReason("");
    } catch (operationError) {
      setActionError(formatError(operationError instanceof Error ? operationError.message : "unknownError"));
    } finally {
      setSaving(false);
    }
  };

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
    setBfError("");
    await runPanelAction(
      async () => {
        const result = await createBackfillBooking({
          unitId: bfUnitId, customerId: bfCustomerId,
          checkIn: bfCheckIn, checkOut: bfCheckOut,
          nightlyPriceXof: parseInt(bfNightlyPrice, 10) || 40000,
          prepaidAmountXof: parseInt(bfPaidAmount, 10) || 0,
          reason: bfReason,
          notes: bfNotes || undefined,
        });
        if (result.success && result.data?.booking) onBookingCreated?.(result.data.booking);
        if (!result.success) setBfError(formatError(result.error));
        return result;
      },
      { closeOnSuccess: true },
    );
  };

  return (
    <>
      <RightDrawer
        open
        title={isBackfill ? (locale === "zh" ? "历史补录" : "Backfill") : isNew ? t.booking.newBooking : t.booking.title}
        subtitle={selectedUnit ? `11# · ${selectedUnit.unit_no} · ${selectedUnit.floor_label}` : undefined}
        onClose={() => { if (!saving) onClose(); }}
      >
        <div className="space-y-4">
          {/* New Booking */}
          {isNew && (<>
            <div>
              <label className={labelClass}>{t.booking.customer}</label>
              <select value={newCustomerId} onChange={e => setNewCustomerId(e.target.value)} className={inputClass}>
                <option value="">{t.booking.noCustomer}</option>
                {dailySelectableCustomers.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t.checkoutModeLabel}</label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.checkoutModeLabel}>
                {([
                  { value: "fixed" as const, label: t.fixedCheckout },
                  { value: "open" as const, label: t.openCheckout },
                ]).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setNewCheckoutMode(item.value)}
                    className={cn(
                      "h-9 rounded-lg border px-3 text-sm font-medium shadow-xs transition-colors",
                      newCheckoutMode === item.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-white hover:text-foreground",
                    )}
                    role="radio"
                    aria-checked={newCheckoutMode === item.value}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.checkoutModeHint}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>{t.booking.checkInDate}</label><DateInput value={newCheckIn} onChangeValue={setNewCheckIn} className={inputClass} min={new Date().toISOString().slice(0, 10)} /></div>
              {newCheckoutMode === "fixed" && <div><label className={labelClass}>{t.booking.checkOutDate}</label><DateInput value={newCheckOut} onChangeValue={setNewCheckOut} className={inputClass} /></div>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>{t.booking.nightlyPrice}</label><input type="number" value={newNightlyPrice} onChange={e => setNewNightlyPrice(e.target.value)} className={inputClass} /></div>
              <div><label className={labelClass}>{t.booking.totalAmount}</label><p className="mt-2 text-sm font-semibold text-foreground">{newCheckoutMode === "fixed" ? `${newNights} ${t.booking.nights} = ${formatXof(newTotal)}` : `${t.booking.nights}×${newNightlyPrice.toLocaleString()} ${locale === "zh" ? "起" : "min"}`}</p></div>
            </div>
            <div><label className={labelClass}>{t.booking.notes}</label><textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2} className={cn(inputClass, "resize-none overflow-hidden")} /></div>
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
                  {dailySelectableCustomers.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
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
                <textarea value={bfNotes} onChange={e => setBfNotes(e.target.value)} rows={2} className={cn(inputClass, "resize-none overflow-hidden")} />
              </div>
              {bfError && <p className="text-sm text-accentRed-600" role="alert">{bfError}</p>}
              <Button onClick={handleBackfillCreate} disabled={saving} className="w-full" variant="default">
                {saving ? "..." : (locale === "zh" ? "确认补录" : "Confirmer le backfill")}
              </Button>
            </div>
          )}

          {/* Booking Detail */}
          {booking && !isBackfill && (<>
            <section className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{selectedUnit?.unit_no ?? booking.unit_id.slice(0, 8)}</p>
                  <p className="mt-1 truncate text-base font-semibold text-foreground">{bookingCustomer?.name ?? booking.customer_id.slice(0, 8)}</p>
                  {bookingCustomer?.phone && <p className="mt-0.5 text-xs text-muted-foreground">{bookingCustomer.phone}</p>}
                </div>
                <Button size="icon" variant="ghost" onClick={() => printDailyReceipt({ booking, unit: selectedUnit ?? null, customer: null }, locale)} aria-label={dictionaries[locale].settings.print.print} className="h-8 w-8 shrink-0">
                  <Printer className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {lodgingBusinessLabel && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold", lodgingBusinessToneClass)}>
                    <CalendarClock className="h-3.5 w-3.5" />
                    {lodgingBusinessLabel}
                  </span>
                )}
                <span className="inline-flex rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/75">
                  {t.bookingStatus[booking.status as keyof typeof t.bookingStatus] ?? booking.status}
                </span>
                <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", booking.checkout_mode === "open" ? "border-accentAmber-200 bg-accentAmber-50 text-accentAmber-700" : "border-border bg-muted text-foreground/70")}>
                  {booking.checkout_mode === "open" ? t.openEndedBadge : t.fixedBadge}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-muted px-3 py-2">
                  <p className="text-xs text-muted-foreground">{t.booking.checkInDate}</p>
                  <p className="mt-0.5 font-semibold text-foreground">{booking.check_in}</p>
                </div>
                <div className="rounded-lg bg-muted px-3 py-2">
                  <p className="text-xs text-muted-foreground">{booking.checkout_mode === "open" ? t.actualCheckOutDate : t.booking.checkOutDate}</p>
                  <p className="mt-0.5 font-semibold text-foreground">{booking.checkout_mode === "open" ? (booking.actual_check_out ?? "—") : booking.check_out}</p>
                </div>
              </div>

              <div className={cn("mt-3 flex items-center justify-between rounded-lg border px-3 py-2 text-sm", hasOutstandingBalance ? "border-accentRed-200 bg-accentRed-50 text-accentRed-700" : "border-accentGreen-200 bg-accentGreen-50 text-accentGreen-700")}>
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <WalletCards className="h-4 w-4" />
                  {hasOutstandingBalance ? t.billing.outstanding : t.billing.paid}
                </span>
                <span className="tabular-nums font-semibold">{hasOutstandingBalance ? formatXof(outstanding) : formatXof(totalPaid)}</span>
              </div>
            </section>

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-foreground/70">{t.booking.nightlyPrice}</span><span>{formatXof(Number(booking.nightly_price_xof))}</span></div>
              {billing && (
                <>
                  <div className="flex justify-between"><span className="text-foreground/70">{t.booking.nights}</span><span>{billing.nights}{locale === "zh" ? "晚" : " nuits"}</span></div>
                  <div className="flex justify-between"><span className="text-foreground/70">{t.billing.grossAmount}</span><span>{formatXof(billing.grossAmount)}</span></div>
                  {billing.discount > 0 && <div className="flex justify-between text-accentGreen-600"><span>{t.billing.discount}</span><span>-{formatXof(billing.discount)}</span></div>}
                  <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>{t.billing.finalAmount}</span><span>{formatXof(billing.finalAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-foreground/70">{t.billing.paid}</span><span>{formatXof(totalPaid)}</span></div>
                  {hasOutstandingBalance && <div className="flex justify-between text-accentRed-600 font-semibold"><span>{t.billing.outstanding}</span><span>{formatXof(outstanding)}</span></div>}
                </>
              )}
            </div>

            {billing?.eligibleForMonthlyDiscount && hasOutstandingBalance && (
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

            {!readOnly && <section className="space-y-3 rounded-xl border border-border bg-muted/35 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{locale === "zh" ? "当前操作" : "Action actuelle"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{locale === "zh" ? "系统按住宿类型和订单状态给出下一步" : "Action proposee selon le sejour et le statut"}</p>
                </div>
                {primaryAction && (
                  <span className="shrink-0 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
                    {getPrimaryActionLabel(primaryAction.action, locale)}
                  </span>
                )}
              </div>
              <div className="space-y-2">

              {/* ── confirmed + cleaning blocked → primary = complete_cleaning ── */}
              {primaryAction?.action === "complete_cleaning" && booking.status === "confirmed" && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
                    <p className="text-xs font-semibold text-amber-700">
                      {locale === "zh" ? "此预订已确认，需先完成保洁后才能办理入住。" : "Reservation confirmee. Le menage doit etre termine avant l'arrivee."}
                    </p>
                  </div>
                  {effectiveCleaningTask && (
                    <Button variant="default" size="sm" onClick={handleCompleteCleaning} disabled={saving} className="w-full">
                      <Check className="h-3.5 w-3.5 mr-1" />{t.cleaning.markComplete}
                    </Button>
                  )}
                </div>
              )}

              {/* ── confirmed (no cleaning block) → primary = check_in ── */}
              {primaryAction?.action === "check_in" && (
                <div className="space-y-2">
                  <div><label className={labelClass}>{t.booking.prepaidAmount}</label><input type="number" value={prepaidAmount} onChange={e => setPrepaidAmount(e.target.value)} className={inputClass} /><p className="mt-0.5 text-xs text-muted-foreground/70">{t.booking.prepaidWarning}</p></div>
                  <Button variant="default" onClick={handleCheckIn} disabled={saving} className="w-full">{t.booking.checkIn}</Button>
                  <Button variant="outline" size="sm" onClick={handleCancelBooking} disabled={saving} className="w-full justify-center text-accentRed-600 hover:bg-accentRed-50 hover:text-accentRed-700"><UserX className="h-3.5 w-3.5 mr-1" />{t.booking.cancelBooking}</Button>
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
                    <div className="mt-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm font-semibold tabular-nums text-foreground">
                      {formatXof(finalDue)}
                    </div>
                  </div>

                  <Button variant="default" onClick={handleCheckOut} disabled={saving} className="w-full"><Check className="h-4 w-4 mr-1" />{t.booking.confirmCheckOut} — {formatXof(finalDue)}</Button>

                  {/* More actions: choose one task, then show one focused form */}
                  <div className="rounded-lg border border-border bg-card">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdvancedActions((value) => !value);
                        setActiveAdvancedTask(null);
                      }}
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      {showAdvancedActions
                        ? (locale === "zh" ? "收起更多业务" : "Masquer")
                        : (locale === "zh" ? "更多业务操作" : "Plus d'actions")}
                    </button>

                    {showAdvancedActions && (
                      <div className="border-t border-border p-3">
                        {activeAdvancedTask === null ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => setActiveAdvancedTask("payment")}
                              className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/70"
                            >
                              <DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span>
                                <span className="block text-sm font-semibold">{locale === "zh" ? "补缴收款" : "Paiement"}</span>
                                <span className="block text-xs text-muted-foreground">{locale === "zh" ? "登记追加收款与收据" : "Ajouter un paiement"}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveAdvancedTask("discount")}
                              className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/70"
                            >
                              <Percent className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span>
                                <span className="block text-sm font-semibold">{locale === "zh" ? "优惠调整" : "Remise"}</span>
                                <span className="block text-xs text-muted-foreground">{locale === "zh" ? "记录手动优惠原因" : "Ajuster le montant"}</span>
                              </span>
                            </button>
                            {booking.checkout_mode === "fixed" && (
                              <button
                                type="button"
                                onClick={() => setActiveAdvancedTask("extend")}
                                className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/70"
                              >
                                <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span>
                                  <span className="block text-sm font-semibold">{t.booking.extendStay}</span>
                                  <span className="block text-xs text-muted-foreground">{locale === "zh" ? "延长固定离店日期" : "Prolonger le sejour"}</span>
                                </span>
                              </button>
                            )}
                            {booking.checkout_mode === "open" && (
                              <button
                                type="button"
                                onClick={() => setActiveAdvancedTask("fixedCheckout")}
                                className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/70"
                              >
                                <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span>
                                  <span className="block text-sm font-semibold">{t.setFixedCheckout}</span>
                                  <span className="block text-xs text-muted-foreground">{locale === "zh" ? "把不固定离店改为固定日期" : "Fixer une date de depart"}</span>
                                </span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {activeAdvancedTask === "payment" && (locale === "zh" ? "补缴收款" : "Paiement")}
                                  {activeAdvancedTask === "discount" && (locale === "zh" ? "优惠调整" : "Remise")}
                                  {activeAdvancedTask === "extend" && t.booking.extendStay}
                                  {activeAdvancedTask === "fixedCheckout" && t.setFixedCheckout}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {locale === "zh" ? "只处理当前选中的业务动作" : "Action ciblee uniquement"}
                                </p>
                              </div>
                              <Button type="button" variant="ghost" size="sm" onClick={() => setActiveAdvancedTask(null)}>
                                {locale === "zh" ? "返回" : "Retour"}
                              </Button>
                            </div>

                            {activeAdvancedTask === "payment" && (
                              <div className="space-y-2">
                                <div className="grid grid-cols-[1fr_auto] gap-2">
                                  <input type="number" value={suppAmount} onChange={e => setSuppAmount(e.target.value)} className={inputClass} placeholder={t.booking.totalAmount} />
                                  <Button variant="secondary" size="sm" onClick={handleSuppPayment} disabled={saving || (parseInt(suppAmount,10)||0) <= 0} className="shrink-0"><DollarSign className="h-3 w-3" />{locale === "zh" ? "收" : "+"}</Button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <DateInput value={suppPaymentDate} onChangeValue={setSuppPaymentDate} className={inputClass} />
                                  <input type="text" value={suppReceiptNo} onChange={e => setSuppReceiptNo(e.target.value)} className={inputClass} placeholder={locale === "zh" ? "收据号/备注" : "Recu / note"} />
                                </div>
                                {bookingPayments.length > 0 && (
                                  <ul className="mt-2 space-y-1 text-xs text-foreground/70">
                                    {bookingPayments.filter((payment) => Number(payment.amount) > 0).map(p => (
                                      <li key={p.id} className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1 group">
                                        <span>{p.payment_date} <span className="font-semibold">{formatXof(Number(p.amount))}</span></span>
                                        {reversedPaymentIds.has(p.id) ? (
                                          <span className="text-[11px] text-muted-foreground">{locale === "zh" ? "已冲销" : "Annule"}</span>
                                        ) : (
                                          <button
                                            type="button"
                                            className="rounded p-0.5 text-muted-foreground/70 opacity-60 transition hover:bg-accentRed-50 hover:text-accentRed-600 group-hover:opacity-100"
                                            onClick={() => {
                                              setDeleteTarget({ id: p.id, amount: Number(p.amount) });
                                              setReversalReason("");
                                            }}
                                            title={locale === "zh" ? "冲销此收款" : "Annuler ce paiement"}
                                          ><Trash2 className="h-3 w-3" /></button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}

                            {activeAdvancedTask === "discount" && (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <input type="number" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} className={inputClass} placeholder={t.discountAmount} />
                                  <input type="text" value={discountReason} onChange={e => setDiscountReason(e.target.value)} className={inputClass} placeholder={t.discountReason} />
                                </div>
                                <Button variant="secondary" size="sm" onClick={handleDiscount} disabled={saving || (parseInt(discountAmount,10)||0) <= 0} className="w-full"><Percent className="h-3 w-3 mr-1" />{t.applyDiscount}</Button>
                              </div>
                            )}

                            {activeAdvancedTask === "extend" && booking.checkout_mode === "fixed" && (
                              <div className="flex items-center gap-2">
                                <input type="number" min={1} value={extendDays} onChange={e => setExtendDays(e.target.value)} className="h-9 w-16 rounded-lg border border-border px-2 text-sm shadow-sm transition-colors duration-fast hover:border-ring/30 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20" />
                                <span className="flex-1 text-xs text-foreground/70">+{formatXof(Number(booking.nightly_price_xof) * (parseInt(extendDays,10)||1))}</span>
                                <Button variant="secondary" size="sm" onClick={handleExtend} disabled={saving}>{t.booking.extendStay}</Button>
                              </div>
                            )}

                            {activeAdvancedTask === "fixedCheckout" && booking.checkout_mode === "open" && (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">{t.setFixedCheckoutDesc}</p>
                                <div className="flex items-center gap-2">
                                  <DateInput value={fixedCheckOutDate} onChangeValue={setFixedCheckOutDate} className={inputClass} min={booking.check_in} />
                                  <Button variant="secondary" size="sm" onClick={handleSetFixedCheckout} disabled={saving || !fixedCheckOutDate} className="shrink-0">{t.setFixedCheckoutButton}</Button>
                                </div>
                                {fixedCheckOutDate && fixedCheckOutNights > 0 && (
                                  <p className="text-xs text-foreground/70">{t.setFixedCheckoutNights.replace("{nights}", String(fixedCheckOutNights)).replace("{amount}", formatXof(fixedCheckOutNights * Number(booking.nightly_price_xof)))}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── checked_out + unpaid → primary = collect_balance ── */}
              {primaryAction?.action === "collect_balance" && (
                <div className="space-y-3 rounded-lg border border-accentRed-200 bg-accentRed-50 p-3">
                  <div>
                    <p className="text-sm font-semibold text-accentRed-700">{locale === "zh" ? "补录离店未付款" : "Encaisser le solde"}</p>
                    <p className="mt-0.5 text-xs text-accentRed-700/80">
                      {locale === "zh"
                        ? `当前仍欠 ${formatXof(outstanding)}，补录后会同步财务、流水和审计日志。`
                        : `Solde restant ${formatXof(outstanding)}. Le paiement mettra a jour finance, ledger et audit.`}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>{t.supplementaryPayment}</label>
                      <input type="number" value={suppAmount} onChange={e => setSuppAmount(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>{locale === "zh" ? "收款日期" : "Date paiement"}</label>
                      <DateInput value={suppPaymentDate} onChangeValue={setSuppPaymentDate} className={inputClass} />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>{locale === "zh" ? "收据号/备注" : "Recu / note"}</label>
                    <input type="text" value={suppReceiptNo} onChange={e => setSuppReceiptNo(e.target.value)} className={inputClass} placeholder={locale === "zh" ? "可选" : "Optionnel"} />
                  </div>
                  <Button variant="default" onClick={handleSuppPayment} disabled={saving || (parseInt(suppAmount, 10) || 0) <= 0} className="w-full">
                    <DollarSign className="h-4 w-4" />
                    {locale === "zh" ? "确认补录收款" : "Confirmer le paiement"}
                  </Button>
                </div>
              )}

              {/* ── checked_out + cleaning pending → primary = complete_cleaning ── */}
              {primaryAction?.action === "complete_cleaning" && booking.status === "checked_out" && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-center">
                    <p className="text-xs font-semibold text-cyan-700 mb-2">{t.cleaning.pending}</p>
                    {effectiveCleaningTask && (
                      <Button variant="default" size="sm" onClick={handleCompleteCleaning} disabled={saving}>
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
            </section>}
            {actionError && <p className="text-sm text-accentRed-600" role="alert">{actionError}</p>}
          </>)}
        </div>
      </RightDrawer>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (saving) return;
          setDeleteTarget(null);
          setReversalReason("");
        }}
        onConfirm={() => void handleReversePayment()}
        title={locale === "zh" ? "冲销收款记录" : "Annuler le paiement"}
        description={deleteTarget
          ? (locale === "zh"
              ? `原收款 ${formatXof(deleteTarget.amount)} 将被保留，并新增等额冲销流水。`
              : `Le paiement original de ${formatXof(deleteTarget.amount)} sera conserve avec une ecriture d'annulation.`)
          : ""}
        confirmLabel={locale === "zh" ? "确认冲销" : "Confirmer"}
        locale={locale}
        loading={saving}
        confirmDisabled={!reversalReason.trim()}
      >
        <div className="mb-4">
          <label className={labelClass}>{locale === "zh" ? "冲销原因（必填）" : "Motif obligatoire"}</label>
          <textarea
            value={reversalReason}
            onChange={(event) => setReversalReason(event.target.value)}
            className={cn(inputClass, "min-h-20 resize-y py-2")}
            placeholder={locale === "zh" ? "例如：重复收款、金额录入错误" : "Ex. doublon ou montant incorrect"}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getLodgingBusinessTypeLabel(type: DailyLodgingBusinessType, locale: Locale): string {
  const labels: Record<DailyLodgingBusinessType, Record<Locale, string>> = {
    upcoming_unpaid: { zh: "预订未入住未付款", fr: "Reservation non payee" },
    upcoming_paid: { zh: "预订未入住已付款", fr: "Reservation payee" },
    fixed_checkout_unpaid: { zh: "固定离店未付款", fr: "Depart fixe non paye" },
    fixed_checkout_paid: { zh: "固定离店已付款", fr: "Depart fixe paye" },
    open_checkout_unpaid: { zh: "未固定离店未付款", fr: "Depart ouvert non paye" },
    open_checkout_paid: { zh: "未固定离店已付款", fr: "Depart ouvert paye" },
    checked_out_unpaid: { zh: "已离店未付款", fr: "Depart effectue non paye" },
    checked_out_paid: { zh: "已离店已付款", fr: "Depart effectue paye" },
    cancelled: { zh: "已取消", fr: "Annule" },
  };

  return labels[type][locale];
}

function getLodgingBusinessTypeClass(type: DailyLodgingBusinessType): string {
  if (type === "upcoming_paid" || type === "fixed_checkout_paid" || type === "open_checkout_paid" || type === "checked_out_paid") {
    return "border-accentGreen-200 bg-accentGreen-50 text-accentGreen-700";
  }
  if (type === "checked_out_unpaid") {
    return "border-accentRed-200 bg-accentRed-50 text-accentRed-700";
  }
  if (type === "cancelled") {
    return "border-border bg-muted text-muted-foreground";
  }
  return "border-accentAmber-200 bg-accentAmber-50 text-accentAmber-700";
}

function getPrimaryActionLabel(action: ReturnType<typeof getPrimaryDailyAction>["action"], locale: Locale): string {
  const labels: Record<ReturnType<typeof getPrimaryDailyAction>["action"], Record<Locale, string>> = {
    create_booking: { zh: "创建订单", fr: "Creer" },
    confirm: { zh: "确认预订", fr: "Confirmer" },
    check_in: { zh: "办理入住", fr: "Arrivee" },
    check_out: { zh: "办理退房", fr: "Depart" },
    collect_balance: { zh: "补录收款", fr: "Encaisser" },
    complete_cleaning: { zh: "完成保洁", fr: "Menage" },
    view_settlement: { zh: "查看结算", fr: "Solde" },
    readonly: { zh: "只读", fr: "Lecture seule" },
  };

  return labels[action][locale];
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
    customerBlacklisted: {
      zh: "该客户已列入黑名单，不能创建预订。",
      fr: "Ce client est sur liste noire et ne peut pas reserver.",
    },
    customerNotFound: {
      zh: "未找到该客户，请刷新后重新选择。",
      fr: "Client introuvable. Actualisez puis choisissez-le de nouveau.",
    },
    unitNotFound: {
      zh: "未找到该房间，请刷新日历后重试。",
      fr: "Chambre introuvable. Actualisez le calendrier puis reessayez.",
    },
    dailyRentalOnlyAllowedInSacsi11: {
      zh: "日租订单只能创建在11#公寓。",
      fr: "Les reservations journalieres sont limitees au bâtiment 11.",
    },
    requestIdRequired: {
      zh: "订单请求无效，请关闭侧栏后重新创建。",
      fr: "La demande est invalide. Fermez le panneau puis recommencez.",
    },
    prepaymentRequired: {
      zh: "当前订单暂不能办理入住，请检查房态、保洁和订单状态。",
      fr: "Cette reservation ne peut pas encore etre enregistree ; verifiez l'etat de la chambre et du dossier.",
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
