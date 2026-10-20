"use client";

import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { qualifiedUnitNo } from "@/lib/unit-building-label";
import { addDays } from "./booking-presentation";
import type { CalendarWindowData } from "./calendar-window-model";
import { dailyDateLabel, dailyBookingIdentityLabel } from "./daily-workbench-labels";
import { dailyBookingOccupiesDate } from "./daily-workbench-model";
import styles from "./daily-workbench.module.css";

export interface DailyWorkbenchTimelineProps {
  data: CalendarWindowData;
  from: string;
  dayCount: number;
  today: string;
  buildingLabel: string;
  locale: Locale;
  selectedBookingId?: string;
  inspectorId?: string;
  onChoose: (unitId: string, bookingId: string | null) => void;
  onRangeChange: (from: string) => void;
}

/** A planning view, never a substitute for the interval search or server write policy. */
export function DailyWorkbenchTimeline({
  data,
  from,
  dayCount,
  today,
  buildingLabel,
  locale,
  selectedBookingId,
  inspectorId,
  onChoose,
  onRangeChange,
}: DailyWorkbenchTimelineProps) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const dates = Array.from({ length: dayCount }, (_, index) => addDays(from, index));
  const weekday = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
    weekday: "short",
    timeZone: "Africa/Abidjan",
  });
  const todayIndex = dates.indexOf(today);
  const units = data.dailyUnits.filter((unit) => unit.building_id === data.buildingId);

  return (
    <section
      className={styles.timeline}
      style={{ "--day-count": dayCount } as CSSProperties}
      aria-label={text("排房时间轴", "Planning des chambres")}
    >
      <div className={styles.timelineTools}>
        <div>
          <h2>
            {buildingLabel} · {text("排房", "Planning")}
          </h2>
          <p className={styles.kicker}>
            {dailyDateLabel(from, locale)} — {dailyDateLabel(addDays(from, dayCount - 1), locale)}
          </p>
        </div>
        <div className={styles.periodNav}>
          <button
            className={styles.button}
            type="button"
            aria-label={text("前一段日期", "Période précédente")}
            onClick={() => onRangeChange(addDays(from, -dayCount))}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <button className={styles.button} type="button" onClick={() => onRangeChange(today)}>
            {text("今天", "Aujourd'hui")}
          </button>
          <button
            className={styles.button}
            type="button"
            aria-label={text("后一段日期", "Période suivante")}
            onClick={() => onRangeChange(addDays(from, dayCount))}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.timeHead}>
        <span className={styles.timeCell}>{text("房间", "Chambre")}</span>
        {dates.map((day) => (
          <span className={cn(styles.timeCell, day === today && styles.todayCell)} key={day}>
            {weekday.format(new Date(day + "T00:00:00Z"))}
            <strong>{Number(day.slice(8))}</strong>
          </span>
        ))}
      </div>
      {units.map((unit) => (
        <div className={styles.timeRow} key={unit.id}>
          <div className={styles.timeRoom}>
            {unit.unit_no}
            <small>{unit.layout ?? ""}</small>
          </div>
          <div className={styles.timeTrack}>
            {data.bookings
              .filter((booking) => booking.unit_id === unit.id && booking.status !== "cancelled")
              .map((booking) => {
                // One shared half-open occupancy rule: future checkout is not a
                // lodging night. Actual checkout alone bounds completed history.
                const occupiedDays = dates.map((day) =>
                  dailyBookingOccupiesDate(booking, day, today),
                );
                const first = occupiedDays.indexOf(true);
                const last = occupiedDays.lastIndexOf(true);
                if (first < 0) return null;
                const end =
                  booking.status === "checked_out"
                    ? booking.actual_check_out
                    : (booking.actual_check_out ?? booking.check_out);
                const departureUnverified =
                  booking.status === "checked_in" &&
                  booking.checkout_mode === "fixed" &&
                  !!booking.check_out &&
                  booking.check_out <= today &&
                  !booking.actual_check_out;
                return (
                  <button
                    type="button"
                    className={cn(
                      styles.bookingBand,
                      booking.status === "checked_in" && styles.inhouseBand,
                      (booking.checkout_mode === "open" ||
                        booking.status === "checked_out" ||
                        departureUnverified) &&
                        styles.conditionalBand,
                    )}
                    key={booking.id}
                    style={{ gridColumn: `${first + 1} / ${last + 2}` }}
                    onClick={() => onChoose(unit.id, booking.id)}
                    aria-pressed={selectedBookingId === booking.id}
                    aria-controls={inspectorId}
                    aria-label={`${qualifiedUnitNo(unit)} ${dailyBookingIdentityLabel(booking, data, locale)} ${dailyDateLabel(booking.check_in, locale)} — ${dailyDateLabel(end, locale)}`}
                  >
                    <span>
                      {dailyBookingIdentityLabel(booking, data, locale)}
                      {booking.checkout_mode === "open" && !booking.actual_check_out
                        ? ` · ${text("离店未定", "Départ ouvert")}`
                        : departureUnverified
                          ? ` · ${text("退房待核实", "Départ à vérifier")}`
                          : ""}
                    </span>
                  </button>
                );
              })}
            {data.bookings
              .filter(
                (booking) =>
                  booking.unit_id === unit.id &&
                  booking.status === "checked_in" &&
                  booking.checkout_mode === "fixed" &&
                  !booking.actual_check_out &&
                  !!booking.check_out &&
                  booking.check_out > today &&
                  dates.includes(booking.check_out),
              )
              .map((booking) => {
                const index = dates.indexOf(booking.check_out!);
                return (
                  <button
                    type="button"
                    key={`handover:${booking.id}`}
                    className={cn(styles.bookingBand, styles.conditionalBand)}
                    style={{ gridColumn: `${index + 1} / ${index + 2}` }}
                    onClick={() => onChoose(unit.id, booking.id)}
                    aria-label={`${qualifiedUnitNo(unit)} ${dailyDateLabel(booking.check_out, locale)} ${text("预计交接，须实际退房并核验保洁", "Remise prévue, départ réel et ménage à vérifier")}`}
                  >
                    <span>{text("预计交接", "Remise prévue")}</span>
                  </button>
                );
              })}
            {(unit.operational_condition === "maintenance" ||
              unit.operational_condition === "locked" ||
              unit.status === "maintenance" ||
              unit.status === "locked") && (
              <button
                type="button"
                className={cn(styles.bookingBand, styles.conditionalBand)}
                style={{ gridColumn: `1 / ${dayCount + 1}` }}
                onClick={() => onChoose(unit.id, null)}
              >
                {text("维修 / 锁房", "Maintenance / blocage")}
              </button>
            )}
            {todayIndex >= 0 &&
              data.cleaningTasks.some((task) => task.unit_id === unit.id && !task.is_completed) && (
                <button
                  type="button"
                  className={cn(styles.bookingBand, styles.conditionalBand)}
                  style={{ gridColumn: `${todayIndex + 1} / ${todayIndex + 2}` }}
                  onClick={() => onChoose(unit.id, null)}
                >
                  {text("待保洁", "Ménage")}
                </button>
              )}
          </div>
        </div>
      ))}
      {!units.length && (
        <p className={styles.empty}>
          {text("当前楼栋没有日租房源。", "Aucune chambre en location courte.")}
        </p>
      )}
      <div className={styles.timelineFoot}>
        <span className={styles.legend}>
          <i className={styles.dot} />
          {text("预订", "Réservé")}
        </span>
        <span className={styles.legend}>
          <i className={cn(styles.dot, styles.greenDot)} />
          {text("在住", "En séjour")}
        </span>
        <span className={styles.legend}>
          <i className={cn(styles.dot, styles.amberDot)} />
          {text("历史 / 交接 / 受限", "Historique / remise / restriction")}
        </span>
      </div>
      <p className={styles.inlineInfo}>
        <Info size={14} aria-hidden="true" />
        {text(
          "离店日不计住宿夜；预计交接不代表已就绪。未实际退房、离店未定与保洁状态须另行核实。",
          "Le départ n'est pas une nuitée ; une remise prévue ne garantit pas la disponibilité. Vérifier départ réel, séjour ouvert et ménage.",
        )}
      </p>
    </section>
  );
}
