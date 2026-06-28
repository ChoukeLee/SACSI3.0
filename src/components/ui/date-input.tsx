"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChangeValue: (value: string) => void;
};

export function DateInput({ value, onChangeValue, className, onBlur, ...props }: DateInputProps) {
  const [displayValue, setDisplayValue] = React.useState(formatIsoDate(value));

  React.useEffect(() => {
    setDisplayValue(formatIsoDate(value));
  }, [value]);

  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={displayValue}
      placeholder="YYYY/MM/DD"
      className={cn(
        "flex h-9 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] shadow-xs outline-offset-2 transition-colors duration-fast placeholder:text-muted-foreground/60 hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60",
        className,
      )}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDisplayValue(nextValue);
        const parsed = parseDateInput(nextValue);
        if (parsed !== null) onChangeValue(parsed);
      }}
      onBlur={(event) => {
        const parsed = parseDateInput(displayValue);
        if (parsed) {
          onChangeValue(parsed);
          setDisplayValue(formatIsoDate(parsed));
        } else if (displayValue.trim() === "") {
          onChangeValue("");
        }
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        props.onKeyDown?.(event);
      }}
    />
  );
}

function formatIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[1]}/${match[2]}/${match[3]}`;
}

function parseDateInput(value: string) {
  const compact = value.trim();
  if (!compact) return "";

  const normalized = compact.replace(/[.\-\s]/g, "/");
  const slashMatch = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  const plainMatch = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  const match = slashMatch ?? plainMatch;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
