"use client";

import { useId, useMemo, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { qualifiedUnitNo } from "@/lib/unit-building-label";
import { addDays } from "./booking-presentation";
import type { CalendarWindowData } from "./calendar-window-model";
import { dailyDateLabel, dailyBookingIdentityLabel } from "./daily-workbench-labels";
import {
  dailyCalendarEventLanes,
  dailyCalendarFloorLabel,
  dailyCalendarFloors,
  dailyCalendarStayLanes,
  dailyCalendarUnits,
} from "./daily-room-calendar-model";
import styles from "./daily-room-calendar.module.css";

export interface DailyWorkbenchTimelineProps {
  data: CalendarWindowData;
  from: string;
  dayCount: number;
  today: string;
  buildingLabel: string;
  locale: Locale;
  selectedBookingId?: string;
  selectedUnitId?: string;
  selectedDate?: string;
  highlightedUnitIds?: readonly string[];
  inspectorId?: string;
  onChoose: (unitId: string, bookingId: string | null, date?: string) => void;
  onRangeChange: (from: string) => void;
  onScopeChange?: () => void;
}

type RoomEvent = {
  key: string;
  first: number;
  last: number;
  label: string;
  description: string;
  bookingId: string | null;
};

function roomEvents(
  unit: UnitRow,
  bookings: readonly DailyBookingRow[],
  cleaning: boolean,
  dates: readonly string[],
  today: string,
  locale: Locale,
): RoomEvent[] {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const events: RoomEvent[] = [];
  for (const booking of bookings) {
    if (
      booking.status === "checked_in" &&
      booking.checkout_mode === "fixed" &&
      !booking.actual_check_out &&
      booking.check_out &&
      booking.check_out > today &&
      dates.includes(booking.check_out)
    ) {
      const index = dates.indexOf(booking.check_out);
      events.push({
        key: `handover:${booking.id}`,
        first: index,
        last: index,
        label: text("预计交接", "Remise prévue"),
        description: text(
          "预计交接，须实际退房并核验保洁",
          "Remise prévue, départ réel et ménage à vérifier",
        ),
        bookingId: booking.id,
      });
    }
  }
  if (
    unit.operational_condition === "maintenance" ||
    unit.operational_condition === "locked" ||
    unit.status === "maintenance" ||
    unit.status === "locked"
  ) {
    const locked = unit.operational_condition === "locked" || unit.status === "locked";
    events.push({
      key: "condition",
      first: 0,
      last: dates.length - 1,
      label: locked ? text("锁房", "Blocage") : text("维修", "Maintenance"),
      description: text(
        "维修 / 锁房：当前限制状态，历史范围未核实",
        "Maintenance / blocage : restriction actuelle, historique non vérifié",
      ),
      bookingId: null,
    });
  }
  const todayIndex = dates.indexOf(today);
  if (cleaning && todayIndex >= 0) {
    events.push({
      key: "cleaning",
      first: todayIndex,
      last: todayIndex,
      label: text("待保洁", "Ménage"),
      description: text(
        "当前保洁未完成，须核验交付",
        "Ménage actuel à terminer, remise à vérifier",
      ),
      bookingId: null,
    });
  }
  return events;
}

/** The whole-room planning surface only selects records; existing forms own every write. */
export function DailyWorkbenchTimeline({
  data,
  from,
  dayCount,
  today,
  buildingLabel,
  locale,
  selectedBookingId,
  selectedUnitId,
  selectedDate,
  highlightedUnitIds,
  inspectorId,
  onChoose,
  onRangeChange,
  onScopeChange,
}: DailyWorkbenchTimelineProps) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const floorSelectId = useId();
  const [floorSelection, setFloorSelection] = useState({
    buildingId: data.buildingId,
    value: "all",
  });
  const dates = useMemo(
    () => Array.from({ length: dayCount }, (_, index) => addDays(from, index)),
    [dayCount, from],
  );
  const units = useMemo(
    () => dailyCalendarUnits(data.dailyUnits, data.buildingId),
    [data.dailyUnits, data.buildingId],
  );
  const floors = useMemo(() => dailyCalendarFloors(units), [units]);
  const floor =
    floorSelection.buildingId === data.buildingId &&
    (floorSelection.value === "all" || floors.includes(floorSelection.value))
      ? floorSelection.value
      : "all";
  const bookingsByUnit = useMemo(() => {
    const index = new Map<string, DailyBookingRow[]>();
    for (const booking of data.bookings) {
      const entries = index.get(booking.unit_id);
      if (entries) entries.push(booking);
      else index.set(booking.unit_id, [booking]);
    }
    return index;
  }, [data.bookings]);
  const cleaningUnitIds = useMemo(
    () =>
      new Set(data.cleaningTasks.filter((task) => !task.is_completed).map((task) => task.unit_id)),
    [data.cleaningTasks],
  );
  const highlighted = useMemo(() => new Set(highlightedUnitIds), [highlightedUnitIds]);
  const weekday = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
    weekday: "short",
    timeZone: "Africa/Abidjan",
  });
  const visibleFloors = floor === "all" ? floors : [floor];

  return (
    <section
      className={styles.calendar}
      style={{ "--day-count": dayCount } as CSSProperties}
      aria-label={text("排房时间轴", "Planning des chambres")}
    >
      <div className={styles.toolbar}>
        <div className={styles.location}>
          <h2>
            {buildingLabel} · {text("房态日历", "Calendrier des chambres")}
          </h2>
          <label className={styles.srOnly} htmlFor={floorSelectId}>
            {text("选择楼层", "Choisir un étage")}
          </label>
          <select
            id={floorSelectId}
            value={floor}
            onChange={(event) => {
              setFloorSelection({ buildingId: data.buildingId, value: event.target.value });
              onScopeChange?.();
            }}
            className={styles.select}
          >
            <option value="all">{text("全部楼层", "Tous les étages")}</option>
            {floors.map((value) => (
              <option value={value} key={value}>
                {value || text("楼层未登记", "Étage non renseigné")}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.periodNav}>
          <button
            className={styles.iconButton}
            type="button"
            aria-label={text("前一段日期", "Période précédente")}
            onClick={() => onRangeChange(addDays(from, -dayCount))}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <p className={styles.dateRange}>
            {dailyDateLabel(from, locale)} — {dailyDateLabel(addDays(from, dayCount - 1), locale)}
          </p>
          <button
            className={styles.iconButton}
            type="button"
            aria-label={text("后一段日期", "Période suivante")}
            onClick={() => onRangeChange(addDays(from, dayCount))}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          <button className={styles.todayButton} type="button" onClick={() => onRangeChange(today)}>
            {text("今天", "Aujourd'hui")}
          </button>
        </div>
      </div>
      <div
        className={styles.scrollRegion}
        role="region"
        aria-label={text(
          "房态日历，可滚动查看全部房间与日期",
          "Calendrier défilant des chambres et des dates",
        )}
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption className={styles.srOnly}>
            {text(
              "点住宿条查看订单，点空日期格核对预订；入住日计住宿夜，离店日不计。",
              "Choisissez un séjour ou une date libre pour vérifier une réservation ; la date de départ n'est pas une nuitée.",
            )}
          </caption>
          <colgroup>
            <col className={styles.roomColumn} />
            {dates.map((day) => (
              <col key={day} />
            ))}
          </colgroup>
          <thead>
            <tr className={styles.timeHead}>
              <th className={styles.roomHeading} scope="col">
                {text("房间", "Chambre")}
              </th>
              {dates.map((day) => (
                <th
                  className={cn(styles.dayHeading, day === today && styles.todayCell)}
                  scope="col"
                  key={day}
                  aria-current={day === today ? "date" : undefined}
                >
                  <span>{weekday.format(new Date(`${day}T00:00:00Z`))}</span>
                  <strong>{Number(day.slice(8))}</strong>
                </th>
              ))}
            </tr>
          </thead>
          {visibleFloors.map((floorLabel) => (
            <tbody key={floorLabel}>
              <tr className={styles.floorRow}>
                <th scope="rowgroup" colSpan={dayCount + 1}>
                  <span>{floorLabel || text("楼层未登记", "Étage non renseigné")}</span>
                  <small>
                    {units.filter((unit) => dailyCalendarFloorLabel(unit) === floorLabel).length}{" "}
                    {text("间", "chambres")}
                  </small>
                </th>
              </tr>
              {units
                .filter((unit) => dailyCalendarFloorLabel(unit) === floorLabel)
                .map((unit) => {
                  const roomBookings = bookingsByUnit.get(unit.id) ?? [];
                  const { stays, laneCount } = dailyCalendarStayLanes(roomBookings, dates, today);
                  const events = roomEvents(
                    unit,
                    roomBookings,
                    cleaningUnitIds.has(unit.id),
                    dates,
                    today,
                    locale,
                  );
                  const { placedEvents, extraLaneCount } = dailyCalendarEventLanes(
                    stays,
                    laneCount,
                    events,
                  );
                  const rowStyle = {
                    gridTemplateRows: `repeat(${laneCount}, var(--room-row-height))${extraLaneCount ? ` repeat(${extraLaneCount}, var(--event-row-height))` : ""}`,
                  } as CSSProperties;
                  return (
                    <tr
                      key={unit.id}
                      className={cn(
                        styles.roomRow,
                        selectedUnitId === unit.id && styles.selectedRoom,
                        highlighted.has(unit.id) && styles.highlightedRoom,
                      )}
                      data-unit-id={unit.id}
                    >
                      <th scope="row" className={styles.roomCell}>
                        <button
                          type="button"
                          className={styles.roomButton}
                          onClick={() => onChoose(unit.id, null)}
                          aria-controls={inspectorId}
                          aria-label={`${qualifiedUnitNo(unit)} ${text("查看房间详情", "Voir la chambre")}`}
                        >
                          <strong>{unit.unit_no}</strong>
                          {unit.layout ? <span title={unit.layout}>{unit.layout}</span> : null}
                        </button>
                      </th>
                      <td colSpan={dayCount} className={styles.trackCell}>
                        <div className={styles.track} style={rowStyle}>
                          {dates.map((day, index) => {
                            const occupied = stays.some(
                              (stay) => stay.first <= index && stay.last >= index,
                            );
                            return occupied ? (
                              <span
                                key={day}
                                aria-hidden="true"
                                className={cn(styles.dateCell, day === today && styles.todayCell)}
                                style={{ gridColumn: `${index + 1}`, gridRow: "1 / -1" }}
                              />
                            ) : (
                              <button
                                type="button"
                                key={day}
                                className={cn(
                                  styles.dateCell,
                                  styles.emptyDate,
                                  day === today && styles.todayCell,
                                )}
                                style={{ gridColumn: `${index + 1}`, gridRow: "1 / -1" }}
                                onClick={() => onChoose(unit.id, null, day)}
                                aria-label={`${qualifiedUnitNo(unit)} ${day} ${text("查看日期与预订", "Vérifier la date et la réservation")}`}
                                aria-controls={inspectorId}
                                aria-pressed={
                                  selectedUnitId === unit.id &&
                                  !selectedBookingId &&
                                  selectedDate === day
                                }
                              >
                                <span aria-hidden="true">+</span>
                              </button>
                            );
                          })}
                          {stays.map(({ booking, first, last, lane }) => {
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
                            const open =
                              booking.checkout_mode === "open" && !booking.actual_check_out;
                            const status =
                              booking.status === "checked_out"
                                ? text("已退房", "Terminé")
                                : booking.status === "checked_in"
                                  ? text("在住", "En séjour")
                                  : booking.status === "pending_review"
                                    ? text("待确认", "À confirmer")
                                    : text("预订", "Réservé");
                            const note = open
                              ? text("离店未定", "Départ ouvert")
                              : departureUnverified
                                ? text("退房待核实", "Départ à vérifier")
                                : "";
                            return (
                              <button
                                type="button"
                                className={cn(
                                  styles.bookingBand,
                                  booking.status === "checked_in" && styles.inhouseBand,
                                  booking.status === "checked_out" && styles.completedBand,
                                  booking.status !== "checked_in" &&
                                    booking.status !== "checked_out" &&
                                    styles.reservedBand,
                                  (open || departureUnverified) && styles.conditionalBand,
                                )}
                                key={booking.id}
                                style={{
                                  gridColumn: `${first + 1} / ${last + 2}`,
                                  gridRow: lane + 1,
                                }}
                                onClick={() => onChoose(unit.id, booking.id)}
                                aria-pressed={selectedBookingId === booking.id}
                                aria-controls={inspectorId}
                                aria-label={`${qualifiedUnitNo(unit)} ${dailyBookingIdentityLabel(booking, data, locale)} · ${status} · ${dailyDateLabel(booking.check_in, locale)} — ${dailyDateLabel(end, locale)}${note ? ` · ${note}` : ""}`}
                                title={`${dailyBookingIdentityLabel(booking, data, locale)} · ${status}${note ? ` · ${note}` : ""}`}
                              >
                                <strong>{status}</strong>
                                <span>
                                  {dailyBookingIdentityLabel(booking, data, locale)}
                                  {note ? ` · ${note}` : ""}
                                </span>
                              </button>
                            );
                          })}
                          {placedEvents.map((event) => (
                            <button
                              key={event.key}
                              type="button"
                              className={cn(styles.eventBand, styles.conditionalBand)}
                              style={{
                                gridColumn: `${event.first + 1} / ${event.last + 2}`,
                                gridRow: event.lane + 1,
                              }}
                              onClick={() => onChoose(unit.id, event.bookingId)}
                              aria-label={`${qualifiedUnitNo(unit)} ${dailyDateLabel(dates[event.first], locale)} ${event.description}`}
                              title={event.description}
                              aria-controls={inspectorId}
                            >
                              {event.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          ))}
        </table>
        {!units.length ? (
          <p className={styles.empty}>
            {text("当前楼栋没有日租房源。", "Aucune chambre en location courte.")}
          </p>
        ) : null}
      </div>
      <div className={styles.footer}>
        <div className={styles.legend}>
          <span>
            <i className={styles.greenSwatch} />
            {text("在住", "En séjour")}
          </span>
          <span>
            <i className={styles.blueSwatch} />
            {text("预订 / 待确认", "Réservé / à confirmer")}
          </span>
          <span>
            <i className={styles.graySwatch} />
            {text("已退房", "Terminé")}
          </span>
          <span>
            <i className={styles.amberSwatch} />
            {text("交接 / 保洁 / 受限", "Remise / ménage / restriction")}
          </span>
        </div>
        <span>
          {floor === "all"
            ? units.length
            : units.filter((unit) => dailyCalendarFloorLabel(unit) === floor).length}{" "}
          {text("间房", "chambres")}
        </span>
      </div>
      <p className={styles.notice}>
        {text(
          "离店日不计住宿夜；预计交接不代表已就绪。未实际退房、离店未定与保洁状态须另行核实。",
          "Le départ n'est pas une nuitée ; une remise prévue ne garantit pas la disponibilité. Vérifier départ réel, séjour ouvert et ménage.",
        )}
      </p>
    </section>
  );
}
