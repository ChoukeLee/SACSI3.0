"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Printer } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import { cn } from "@/lib/utils";
import { getDailyRoomStateForDate } from "./room-status";

interface Props {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  cleaningTasks: { id: string; unit_id: string; daily_booking_id: string | null; is_completed: boolean }[];
  locale: Locale;
}

const tones = {
  dark: "border-[#D7D8D4] bg-[#F5F5F3]",
  orange: "border-[#FFD18B] bg-[#FFF4DF]",
  teal: "border-[#8BE1D8] bg-[#E4F9F5]",
  green: "border-[#A7E6C9] bg-[#EAF9F1]",
};

export function DailyOccupancyOverview({
  dailyUnits,
  bookings,
  cleaningTasks,
  locale,
}: Props) {
  const [copied, setCopied] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => {
    const states = dailyUnits.map((unit) => ({
      unit,
      state: getDailyRoomStateForDate({ unit, dateStr: today, bookings, cleaningTasks }),
    }));
    const build = (
      key: string,
      label: string,
      tone: keyof typeof tones,
      predicate: (status: (typeof states)[number]) => boolean,
    ) => {
      const matches = states.filter(predicate);
      return {
        key,
        label,
        tone,
        count: matches.length,
        units: matches.map(({ unit }) => unit.unit_no),
      };
    };

    return [
      build("occupied", locale === "zh" ? "占用" : "Occupé", "dark", ({ state }) =>
        state.status === "occupied" || state.status === "checking_out_today" || state.status === "reserved"),
      build("checkout", locale === "zh" ? "今日离店" : "Départ aujourd'hui", "orange", ({ state }) => state.isCheckoutDay),
      build("cleaning", locale === "zh" ? "待保洁" : "Ménage", "teal", ({ state }) => state.status === "cleaning"),
      build("available", locale === "zh" ? "可安排入住" : "Disponible", "green", ({ state }) => state.status === "available"),
    ];
  }, [bookings, cleaningTasks, dailyUnits, locale, today]);

  const copyOverview = async () => {
    const lines = [`11# ${locale === "zh" ? "日租房态" : "Occupation journalière"}`, ""];
    for (const row of rows) {
      lines.push(`${row.label}: ${row.count}`, row.units.join(", "), "");
    }
    const text = lines.join("\n").trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="space-y-5 print:space-y-3">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">11#</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {locale === "zh" ? "日租占用总览" : "Vue d'occupation journalière"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(`${today}T00:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link
            href={locale === "fr" ? "/fr/daily-rentals" : "/daily-rentals"}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold shadow-xs hover:bg-muted"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {locale === "zh" ? "返回日租" : "Retour"}
          </Link>
          <button
            type="button"
            onClick={() => void copyOverview()}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold shadow-xs hover:bg-muted",
              copied && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? (locale === "zh" ? "已复制" : "Copié") : (locale === "zh" ? "复制群消息" : "Copier")}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold shadow-xs hover:bg-muted"
          >
            <Printer className="h-3.5 w-3.5" />
            {locale === "zh" ? "打印" : "Imprimer"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <section key={row.key} className={cn("min-h-36 rounded-xl border p-4", tones[row.tone])}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold">{row.label}</h2>
              <span className="text-2xl font-semibold tabular-nums">{row.count}</span>
            </div>
            <p className="mt-3 text-xs leading-5 text-foreground/65">
              {row.units.length > 0 ? row.units.join(", ") : "—"}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
