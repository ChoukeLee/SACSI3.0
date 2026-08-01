"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChangeValue: (value: string) => void;
};

const WEEKDAYS = {
  zh: ["一", "二", "三", "四", "五", "六", "日"],
  fr: ["L", "M", "M", "J", "V", "S", "D"],
};

export function DateInput({ value, onChangeValue, className, onBlur, min, max, disabled, ...props }: DateInputProps) {
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState(() => getMonthStart(value || todayIso()));
  const [locale, setLocale] = React.useState<"zh" | "fr">("zh");
  const [panelPosition, setPanelPosition] = React.useState({ left: 0, top: 0 });

  React.useEffect(() => {
    if (isIsoDate(value)) setViewMonth(getMonthStart(value));
  }, [value]);

  React.useEffect(() => {
    setLocale(window.location.pathname.startsWith("/fr") ? "fr" : "zh");
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 32);
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
      const top = Math.min(rect.bottom + 6, window.innerHeight - 360);
      setPanelPosition({ left, top: Math.max(16, top) });
    };
    updatePosition();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const handleViewportChange = () => updatePosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open]);

  const minDate = typeof min === "string" && isIsoDate(min) ? min : null;
  const maxDate = typeof max === "string" && isIsoDate(max) ? max : null;
  const days = React.useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);
  const displayValue = isIsoDate(value) ? value.replaceAll("-", "/") : "";
  const monthLabel = locale === "zh"
    ? `${viewMonth.getUTCFullYear()}年 ${viewMonth.getUTCMonth() + 1}月`
    : `${String(viewMonth.getUTCMonth() + 1).padStart(2, "0")}/${viewMonth.getUTCFullYear()}`;

  const selectDate = (nextValue: string) => {
    onChangeValue(nextValue);
    setViewMonth(getMonthStart(nextValue));
    setOpen(false);
  };

  return (
    <span ref={wrapperRef} className="relative block w-full">
      <input
        {...props}
        type="text"
        readOnly
        disabled={disabled}
        value={displayValue}
        placeholder="YYYY/MM/DD"
        className={cn(
          "flex h-9 w-full cursor-pointer rounded-lg border border-border bg-card py-1.5 pl-3 pr-9 text-[13px] font-medium tabular-nums text-foreground shadow-xs outline-offset-2 transition-colors duration-fast placeholder:text-muted-foreground/60 hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60 disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!disabled) setOpen((current) => !current);
          }
          props.onKeyDown?.(event);
        }}
      />
      <CalendarDays
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.8}
      />
      {open && !disabled && (
        <div
          ref={panelRef}
          className="fixed z-dropdown w-[min(280px,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-dropdown"
          style={{ left: panelPosition.left, top: panelPosition.top }}
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth(addMonths(viewMonth, -1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold tabular-nums">{monthLabel}</span>
            <button
              type="button"
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS[locale].map((weekday, index) => (
              <span key={`${weekday}-${index}`} className="py-1 text-[11px] font-semibold text-muted-foreground">
                {weekday}
              </span>
            ))}
            {days.map((day) => {
              const blocked = isBlocked(day.value, minDate, maxDate);
              const selected = day.value === value;
              const today = day.value === todayIso();
              return (
                <button
                  key={day.value}
                  type="button"
                  disabled={blocked}
                  onClick={() => selectDate(day.value)}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-md text-xs font-semibold tabular-nums transition-colors",
                    day.inMonth ? "text-foreground" : "text-muted-foreground/40",
                    today && !selected && "bg-muted text-foreground",
                    selected && "bg-primary text-primary-foreground shadow-sm",
                    !selected && !blocked && "hover:bg-muted hover:text-foreground",
                    blocked && "cursor-not-allowed text-muted-foreground/25",
                  )}
                >
                  {day.day}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => selectDate(todayIso())}
              disabled={isBlocked(todayIso(), minDate, maxDate)}
              className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {locale === "zh" ? "今天" : "Aujourd'hui"}
            </button>
            <button
              type="button"
              onClick={() => {
                onChangeValue("");
                setOpen(false);
              }}
              className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {locale === "zh" ? "清空" : "Effacer"}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function getMonthStart(value: string) {
  const source = isIsoDate(value) ? value : todayIso();
  const [year, month] = source.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function toIsoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function buildCalendarDays(monthStart: Date) {
  const firstDay = monthStart.getUTCDay() || 7;
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(monthStart.getUTCDate() - firstDay + 1);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return {
      value: toIsoDate(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthStart.getUTCMonth(),
    };
  });
}

function isBlocked(value: string, minDate: string | null, maxDate: string | null) {
  return Boolean((minDate && value < minDate) || (maxDate && value > maxDate));
}
