"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RightDrawer } from "@/components/ui/operational";
import type { Locale } from "@/lib/i18n";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import { addDays, formatDailyRentalError } from "./booking-presentation";
import {
  decodeCalendarWindow,
  parseCalendarWindow,
  type CalendarWindowData,
} from "./calendar-window-model";
import { DAILY_DATA_CHANGED, notifyDailyDataChanged } from "./daily-read-invalidation";
import { allowCreateBooking } from "./daily-rental-policy";

// Keep the existing, audited operation forms out of the initial workbench bundle.
const BookingPanel = dynamic(() => import("./booking-panel").then((module) => module.BookingPanel));

export interface DailyWorkbenchActionsProps {
  unit: UnitRow | null;
  booking: DailyBookingRow | null;
  date: string;
  checkOut?: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  locale: Locale;
  userRole?: string;
  buildingId: string;
}

/** Opening a different target never reuses a previous room's verified operation context. */
export function DailyWorkbenchActions(props: DailyWorkbenchActionsProps) {
  if (!props.open) return null;
  return (
    <OpenDailyWorkbenchActions
      key={`${props.buildingId}:${props.unit?.id ?? ""}:${props.booking?.id ?? ""}:${props.date}:${props.checkOut ?? ""}:${props.userRole ?? ""}`}
      {...props}
    />
  );
}

function OpenDailyWorkbenchActions({
  unit,
  booking,
  date,
  checkOut,
  onClose,
  onChanged,
  locale,
  userRole,
  buildingId,
}: DailyWorkbenchActionsProps) {
  const router = useRouter();
  const [context, setContext] = useState<CalendarWindowData>();
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [operationError, setOperationError] = useState("");
  const isBackfill = !unit && !booking;
  const canCreate = userRole === "admin" || userRole === "rental_sales";
  const canOperate = canCreate || userRole === "front_desk";
  const canOpen = booking ? true : isBackfill ? userRole === "admin" : canOperate;
  const targetUnitId = booking?.unit_id ?? unit?.id;
  const invalidate = useCallback(() => {
    setContext(undefined);
    setPending(true);
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const changed = (event: Event) => {
      const changedBuilding = (event as CustomEvent<{ buildingId?: string }>).detail?.buildingId;
      if (!changedBuilding || changedBuilding === buildingId) invalidate();
    };
    window.addEventListener(DAILY_DATA_CHANGED, changed);
    return () => window.removeEventListener(DAILY_DATA_CHANGED, changed);
  }, [buildingId, invalidate]);

  useEffect(() => {
    if (!canOpen) {
      setPending(false);
      setFailed(true);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setContext(undefined);
    setPending(true);
    setFailed(false);
    // One date inside the selected stay also finds historical checked-out orders.
    // There is no all-history/customer-directory download when the workbench loads.
    let query;
    try {
      const from = booking?.check_in ?? date;
      query = parseCalendarWindow({ buildingId, from, to: addDays(from, 1) });
      if (
        (unit && unit.building_id !== buildingId) ||
        (booking && unit && booking.unit_id !== unit.id)
      )
        throw new Error("dailyOperationTargetMismatch");
    } catch {
      setPending(false);
      setFailed(true);
      return;
    }
    fetch(`/api/daily-rentals/calendar?${new URLSearchParams({ ...query })}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("dailyOperationContextUnavailable");
        const result = decodeCalendarWindow(await response.json(), query);
        if (
          !Array.isArray(result.customers) ||
          (targetUnitId && !result.unitLookupUnits.some((item) => item.id === targetUnitId)) ||
          (booking &&
            !result.bookings.some(
              (item) => item.id === booking.id && item.unit_id === targetUnitId,
            ))
        )
          throw new Error("dailyOperationContextUnavailable");
        return result;
      })
      .then((result) => {
        if (!active) return;
        setContext(result);
        setPending(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setPending(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [buildingId, booking, canOpen, date, revision, targetUnitId, unit]);

  const changed = () => {
    notifyDailyDataChanged(buildingId);
    onChanged();
  };
  const operationUnits = useMemo(() => {
    const dailyById = new Map(context?.dailyUnits.map((item) => [item.id, item]));
    return context?.unitLookupUnits.map((item) => dailyById.get(item.id) ?? item) ?? [];
  }, [context]);
  const currentBooking = context?.bookings.find((item) => item.id === booking?.id) ?? null;
  const currentUnit = operationUnits.find((item) => item.id === targetUnitId);
  const cleaningTask = context?.cleaningTasks.find(
    (item) => item.unit_id === targetUnitId && !item.is_completed,
  );
  const finishCleaning = async () => {
    if (!cleaningTask || !canOperate || pending || failed || saving) return;
    setSaving(true);
    setOperationError("");
    try {
      const { completeCleaning } = await import("./actions");
      const result = await completeCleaning(cleaningTask.id);
      if (!result.success) {
        setOperationError(formatDailyRentalError(result.error, locale));
        return;
      }
      changed();
      router.refresh();
      onClose();
    } catch {
      // The server may have committed before a connection failure. Re-read before retrying.
      notifyDailyDataChanged(buildingId);
      setOperationError(formatDailyRentalError(null, locale));
    } finally {
      setSaving(false);
    }
  };

  if (pending || failed || !context) {
    return (
      <RightDrawer
        open
        title={locale === "zh" ? "日租办理" : "Operations journalieres"}
        onClose={onClose}
      >
        {pending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {locale === "zh"
              ? "正在核对最新订单、收款和保洁记录…"
              : "Verification du dossier en cours…"}
          </p>
        ) : (
          <div className="space-y-4">
            <p role="alert" className="text-sm leading-6 text-muted-foreground">
              {locale === "zh"
                ? "无法核验当前房间或订单，暂不开放办理。请检查权限，或刷新后重新选择。"
                : "Le dossier ne peut pas etre verifie. Verifiez vos droits puis actualisez."}
            </p>
            <Button variant="outline" onClick={invalidate} disabled={!canOpen}>
              {locale === "zh" ? "重新核对" : "Reessayer"}
            </Button>
          </div>
        )}
      </RightDrawer>
    );
  }

  if (!booking && !isBackfill && cleaningTask) {
    return (
      <RightDrawer
        open
        title={locale === "zh" ? "确认完成保洁" : "Terminer le menage"}
        subtitle={currentUnit?.unit_no}
        onClose={() => {
          if (!saving) onClose();
        }}
        footer={
          <Button onClick={finishCleaning} disabled={!canOperate || saving} className="w-full">
            {saving ? "…" : locale === "zh" ? "保洁已完成" : "Menage termine"}
          </Button>
        }
      >
        <p className="text-sm leading-6 text-muted-foreground">
          {locale === "zh"
            ? "请确认房间已经实际完成保洁。空房不等于可入住；此操作沿用现有保洁流程并记录当前操作账号。"
            : "Confirmez que le menage est reellement termine. L'operation conserve la trace du compte connecte."}
        </p>
        {operationError && (
          <p role="alert" className="mt-4 text-sm text-accentRed-600">
            {operationError}
          </p>
        )}
      </RightDrawer>
    );
  }

  const creationPolicy = currentUnit
    ? allowCreateBooking({
        checkIn: date,
        checkOut: checkOut ?? addDays(date, 1),
        todayStr: context.today,
        unitStatus: currentUnit.status,
        operationalCondition: currentUnit.operational_condition,
        dailyRentalEnabled: currentUnit.daily_rental_enabled,
      })
    : null;
  if (
    !booking &&
    !isBackfill &&
    (!canCreate || currentUnit?.daily_rental_enabled !== true || !creationPolicy?.allowed)
  ) {
    return (
      <RightDrawer
        open
        title={locale === "zh" ? "暂不可创建预订" : "Reservation indisponible"}
        onClose={onClose}
      >
        <p role="alert" className="text-sm leading-6 text-muted-foreground">
          {currentUnit?.daily_rental_enabled !== true
            ? formatDailyRentalError("dailyRentalNotEnabledForUnit", locale)
            : creationPolicy && !creationPolicy.allowed
              ? formatDailyRentalError(creationPolicy.reason, locale)
              : locale === "zh"
                ? "当前账号无创建预订权限。"
                : "Votre compte ne peut pas creer de reservation."}
        </p>
      </RightDrawer>
    );
  }

  return (
    <BookingPanel
      booking={currentBooking}
      unitId={targetUnitId ?? null}
      defaultDate={date}
      defaultCheckOut={checkOut}
      units={isBackfill ? context.dailyUnits : operationUnits}
      customers={context.customers ?? []}
      cleaningTasks={context.cleaningTasks}
      payments={context.payments}
      locale={locale}
      readOnly={!canOperate}
      canCorrectCheckin={userRole === "admin"}
      backfillMode={isBackfill}
      onClose={onClose}
      onChanged={changed}
    />
  );
}
