"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  X, Phone, Copy, Check, ChevronRight, CreditCard,
  Wrench, Lock, Unlock, CalendarPlus, DoorOpen,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./confirm-dialog";
import type { RoomState } from "./room-state";
import type { UnitStatus } from "@/types/domain";
import { checkOut, recordSupplementaryPayment, completeCleaning, extendStay } from "@/features/daily-rentals/actions";
import { updateUnitStatus } from "@/features/units/actions";

function displayStatusToUnitStatus(s: RoomState["displayStatus"]): UnitStatus {
  switch (s) {
    case "occupied":
    case "checking_out_today":
      return "daily_occupied";
    case "reserved":
      return "reserved";
    case "cleaning":
      return "cleaning_pending";
    case "available":
      return "available";
    default:
      return "available";
  }
}

interface MobileRoomDrawerProps {
  room: RoomState | null;
  open: boolean;
  onClose: () => void;
  locale: Locale;
}

type DrawerAction =
  | { type: "checkout" }
  | { type: "payment" }
  | { type: "cleaning" }
  | { type: "maintenance" }
  | { type: "lock" }
  | { type: "markAvailable" }
  | { type: "extendStay" }
  | null;

export function MobileRoomDrawer({ room, open, onClose, locale }: MobileRoomDrawerProps) {
  const t = dictionaries[locale].mobile;
  const router = useRouter();
  const [action, setAction] = useState<DrawerAction>(null);
  const [loading, setLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [extendDate, setExtendDate] = useState("");
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const resetState = useCallback(() => {
    setAction(null);
    setLoading(false);
    setPaymentAmount("");
    setExtendDate("");
    setShowMore(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  if (!open || !room) return null;

  const unitStatus = displayStatusToUnitStatus(room.displayStatus);
  const isOccupied = room.displayStatus === "occupied" || room.displayStatus === "checking_out_today";
  const isCleaning = room.displayStatus === "cleaning";
  const isAvailable = room.displayStatus === "available";

  const handleCopyPhone = async () => {
    if (room.customer?.phone) {
      try {
        await navigator.clipboard.writeText(room.customer.phone);
        setPhoneCopied(true);
        setTimeout(() => setPhoneCopied(false), 2000);
      } catch {
        // Fallback for non-HTTPS
        const input = document.createElement("input");
        input.value = room.customer.phone;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        setPhoneCopied(true);
        setTimeout(() => setPhoneCopied(false), 2000);
      }
    }
  };

  const executeAction = async () => {
    if (!action || !room) return;
    setLoading(true);
    try {
      if (action.type === "checkout" && room.booking) {
        await checkOut(room.booking.id, {});
      } else if (action.type === "payment" && room.booking && paymentAmount) {
        const amt = Math.round(Number(paymentAmount));
        if (amt <= 0) return;
        await recordSupplementaryPayment({ bookingId: room.booking.id, amount: amt });
      } else if (action.type === "cleaning" && room.cleaningTask) {
        await completeCleaning(room.cleaningTask.id);
      } else if (action.type === "maintenance") {
        await updateUnitStatus(room.unit.id, "maintenance");
      } else if (action.type === "lock") {
        await updateUnitStatus(room.unit.id, "locked");
      } else if (action.type === "markAvailable") {
        await updateUnitStatus(room.unit.id, "available");
      } else if (action.type === "extendStay" && room.booking && extendDate) {
        const currentCheckOut = room.booking.check_out ?? new Date().toISOString().slice(0, 10);
        const newDate = new Date(extendDate);
        const oldDate = new Date(currentCheckOut);
        const extraNights = Math.max(1, Math.ceil((newDate.getTime() - oldDate.getTime()) / (1000 * 60 * 60 * 24)));
        const extraAmount = Math.round(extraNights * Number(room.booking.nightly_price_xof));
        await extendStay(room.booking.id, extendDate, extraNights, extraAmount);
      }
      resetState();
      router.refresh();
      onClose();
    } catch (e) {
      console.error("Action failed:", e);
    } finally {
      setLoading(false);
    }
  };

  const actionLabels = t.actions;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-overlay" onClick={handleClose}>
        <div className="absolute inset-0 bg-brand-ink-900/30" />
        {/* Bottom sheet */}
        <div
          className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white shadow-panel animate-in slide-in-from-bottom-4 duration-normal"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1 w-10 rounded-full bg-brand-warm-400" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-2">
            <div className="flex items-baseline gap-2.5">
              <span className="font-mono text-2xl font-bold text-brand-ink-900">
                {room.unit.unit_no}
              </span>
              <StatusBadge status={unitStatus} locale={locale} />
            </div>
            <button
              onClick={handleClose}
              className="rounded-full p-1.5 text-brand-ink-300 hover:bg-brand-warm-100"
              aria-label={actionLabels.cancel}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-4">
            {/* Guest info */}
            {room.customer && (
              <div className="rounded-xl border border-brand-warm-400 bg-brand-warm-50 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-ink-300">
                    {t.drawer.guest}
                  </p>
                </div>
                <p className="text-sm font-semibold text-brand-ink-900">{room.customer.name}</p>
                {room.customer.phone && (
                  <button
                    onClick={handleCopyPhone}
                    className="flex items-center gap-2 text-sm text-brand-orange active:opacity-70 min-h-[36px]"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {room.customer.phone}
                    {phoneCopied ? (
                      <Check className="h-3.5 w-3.5 text-brand-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Stay info */}
            {room.booking && (
              <div className="rounded-xl border border-brand-warm-400 bg-white p-3.5">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-brand-ink-300">{t.drawer.checkIn}</p>
                    <p className="font-semibold text-brand-ink-700">{room.booking.check_in}</p>
                  </div>
                  <div>
                    <p className="text-brand-ink-300">{t.drawer.checkOut}</p>
                    <p className="font-semibold text-brand-ink-700">
                      {room.booking.checkout_mode === "open"
                        ? t.drawer.openEnded
                        : room.booking.check_out ?? t.drawer.openEnded}
                    </p>
                  </div>
                </div>
                {room.billing && (
                  <div className="mt-3 pt-3 border-t border-brand-warm-200">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-brand-ink-300">{t.drawer.nights}</span>
                      <span className="font-semibold text-brand-ink-700">{room.billing.nights}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-brand-ink-300">{t.drawer.paid}</span>
                      <span className="font-semibold text-brand-green-600">{formatXof(room.totalPaid)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-brand-ink-300">{t.drawer.total}</span>
                      <span className="font-semibold text-brand-ink-700">
                        {formatXof(room.billing.finalAmount)}
                      </span>
                    </div>
                    {room.billing.outstanding > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-brand-ink-300">{t.drawer.outstanding}</span>
                        <span className="font-bold text-brand-red-600">
                          {formatXof(room.billing.outstanding)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            <div className="rounded-xl border border-brand-warm-400 bg-white p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-ink-300 mb-1">
                {t.drawer.notes}
              </p>
              <p className="text-xs text-brand-ink-600">
                {room.unit.notes || room.booking?.notes || t.drawer.noNotes}
              </p>
            </div>

            {/* Payment input (when payment action active) */}
            {action?.type === "payment" && (
              <div className="rounded-xl border border-brand-orange-200 bg-brand-orange-50 p-3.5">
                <p className="text-xs font-semibold text-brand-ink-700 mb-2">
                  {actionLabels.recordPaymentTitle}
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder={actionLabels.recordPaymentPlaceholder}
                    className="flex-1 rounded-lg border border-brand-warm-400 px-3 py-2 text-sm bg-white text-brand-ink-900 placeholder:text-brand-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
                    autoFocus
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={executeAction}
                    disabled={loading || !paymentAmount || Number(paymentAmount) <= 0}
                  >
                    {actionLabels.save}
                  </Button>
                </div>
              </div>
            )}

            {/* Extend stay input (when extend action active) */}
            {action?.type === "extendStay" && room.booking && (
              <div className="rounded-xl border border-brand-sky-200 bg-brand-sky-50 p-3.5">
                <p className="text-xs font-semibold text-brand-ink-700 mb-2">
                  {actionLabels.extendStayDesc}
                </p>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-[10px] text-brand-ink-400 block mb-1">
                      {locale === "zh" ? "新离店日期" : "Nouvelle date départ"}
                    </label>
                    <input
                      type="date"
                      value={extendDate}
                      onChange={(e) => setExtendDate(e.target.value)}
                      min={room.booking.check_out ?? new Date().toISOString().slice(0, 10)}
                      className="w-full rounded-lg border border-brand-warm-400 px-3 py-2 text-sm bg-white text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
                      autoFocus
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={executeAction}
                    disabled={loading || !extendDate}
                  >
                    {actionLabels.save}
                  </Button>
                </div>
              </div>
            )}

            {/* Primary actions */}
            <div className="space-y-2">
              {isOccupied && (
                <>
                  <button
                    onClick={() => setAction({ type: "checkout" })}
                    className="flex w-full items-center justify-between rounded-xl border border-brand-warm-400 bg-white px-4 py-3 text-sm font-semibold text-brand-ink-900 active:bg-brand-warm-50 min-h-[44px]"
                  >
                    <span className="flex items-center gap-2">
                      <DoorOpen className="h-4 w-4 text-brand-orange" />
                      {actionLabels.checkOut}
                    </span>
                    <ChevronRight className="h-4 w-4 text-brand-ink-300" />
                  </button>
                  <button
                    onClick={() => setAction({ type: "payment" })}
                    className="flex w-full items-center justify-between rounded-xl border border-brand-warm-400 bg-white px-4 py-3 text-sm font-semibold text-brand-ink-900 active:bg-brand-warm-50 min-h-[44px]"
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-brand-green-600" />
                      {actionLabels.recordPayment}
                    </span>
                    <ChevronRight className="h-4 w-4 text-brand-ink-300" />
                  </button>
                </>
              )}

              {isCleaning && room.cleaningTask && (
                <button
                  onClick={() => setAction({ type: "cleaning" })}
                  className="flex w-full items-center justify-between rounded-xl border border-brand-warm-400 bg-white px-4 py-3 text-sm font-semibold text-brand-ink-900 active:bg-brand-warm-50 min-h-[44px]"
                >
                  <span className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-brand-green-600" />
                    {actionLabels.completeCleaning}
                  </span>
                  <ChevronRight className="h-4 w-4 text-brand-ink-300" />
                </button>
              )}

              {/* More actions toggle */}
              {!showMore ? (
                <button
                  onClick={() => setShowMore(true)}
                  className="flex w-full items-center justify-center gap-1 rounded-xl px-4 py-2.5 text-xs font-medium text-brand-ink-400 active:bg-brand-warm-50 min-h-[44px]"
                >
                  {t.roomCard.more}
                </button>
              ) : (
                <div className="space-y-2 pt-1">
                  {isOccupied && (
                    <button
                      onClick={() => setAction({ type: "extendStay" })}
                      className="flex w-full items-center justify-between rounded-xl border border-brand-warm-400 bg-white px-4 py-3 text-sm font-semibold text-brand-ink-900 active:bg-brand-warm-50 min-h-[44px]"
                    >
                      <span className="flex items-center gap-2">
                        <CalendarPlus className="h-4 w-4 text-brand-sky-600" />
                        {actionLabels.extendStay}
                      </span>
                      <ChevronRight className="h-4 w-4 text-brand-ink-300" />
                    </button>
                  )}
                  {(isOccupied || isAvailable) && (
                    <button
                      onClick={() => setAction({ type: "maintenance" })}
                      className="flex w-full items-center justify-between rounded-xl border border-brand-warm-400 bg-white px-4 py-3 text-sm font-semibold text-brand-ink-900 active:bg-brand-warm-50 min-h-[44px]"
                    >
                      <span className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-brand-red-600" />
                        {actionLabels.maintenance}
                      </span>
                      <ChevronRight className="h-4 w-4 text-brand-ink-300" />
                    </button>
                  )}
                  {(isOccupied || isAvailable) && (
                    <button
                      onClick={() => setAction({ type: "lock" })}
                      className="flex w-full items-center justify-between rounded-xl border border-brand-warm-400 bg-white px-4 py-3 text-sm font-semibold text-brand-ink-900 active:bg-brand-warm-50 min-h-[44px]"
                    >
                      <span className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-brand-ink-500" />
                        {actionLabels.lock}
                      </span>
                      <ChevronRight className="h-4 w-4 text-brand-ink-300" />
                    </button>
                  )}
                  {room.unit.status === "maintenance" || room.unit.status === "locked" ? (
                    <button
                      onClick={() => setAction({ type: "markAvailable" })}
                      className="flex w-full items-center justify-between rounded-xl border border-brand-warm-400 bg-white px-4 py-3 text-sm font-semibold text-brand-green-700 active:bg-brand-warm-50 min-h-[44px]"
                    >
                      <span className="flex items-center gap-2">
                        <Unlock className="h-4 w-4 text-brand-green-600" />
                        {actionLabels.markAvailable}
                      </span>
                      <ChevronRight className="h-4 w-4 text-brand-ink-300" />
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation dialogs */}
      <ConfirmDialog
        open={action?.type === "checkout"}
        onClose={() => setAction(null)}
        onConfirm={executeAction}
        title={actionLabels.checkOutConfirm}
        description={actionLabels.checkOutDesc}
        locale={locale}
        loading={loading}
      />
      <ConfirmDialog
        open={action?.type === "maintenance"}
        onClose={() => setAction(null)}
        onConfirm={executeAction}
        title={actionLabels.maintenanceConfirm}
        description={actionLabels.maintenanceDesc}
        locale={locale}
        loading={loading}
      />
      <ConfirmDialog
        open={action?.type === "lock"}
        onClose={() => setAction(null)}
        onConfirm={executeAction}
        title={actionLabels.lockConfirm}
        description={actionLabels.lockDesc}
        locale={locale}
        loading={loading}
      />
      <ConfirmDialog
        open={action?.type === "markAvailable"}
        onClose={() => setAction(null)}
        onConfirm={executeAction}
        title={actionLabels.markAvailableConfirm}
        description={actionLabels.markAvailableDesc}
        locale={locale}
        loading={loading}
      />
      <ConfirmDialog
        open={action?.type === "cleaning"}
        onClose={() => setAction(null)}
        onConfirm={executeAction}
        title={actionLabels.completeCleaning}
        locale={locale}
        loading={loading}
      />
    </>
  );
}
