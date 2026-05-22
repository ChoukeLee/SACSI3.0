"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Lock, Phone, Printer, Unlock, Wrench } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CustomerRow, DailyBookingRow, PaymentRow, UnitRow } from "@/types/database";
import type { UnitStatus } from "@/types/domain";
import { ConfirmDialog } from "@/features/mobile/confirm-dialog";
import { updateUnitStatus } from "@/features/units/actions";
import { calculateBilling } from "./billing";
import type { DailyRoomDisplayStatus } from "./room-status";
import { buildDailyRoomStateMap } from "./room-status";

interface OverviewViewProps {
  dailyUnits: UnitRow[];
  bookings: DailyBookingRow[];
  customers: CustomerRow[];
  payments: PaymentRow[];
  cleaningTasks: { id: string; unit_id: string; is_completed: boolean }[];
  locale: Locale;
}

type RoomRow = {
  unit: UnitRow;
  booking: DailyBookingRow | null;
  customer: CustomerRow | null;
  billing: ReturnType<typeof calculateBilling> | null;
  totalPaid: number;
  status: DailyRoomDisplayStatus;
  isCheckoutDay: boolean;
};

export function OverviewView({ dailyUnits, bookings, customers, payments, cleaningTasks, locale }: OverviewViewProps) {
  const t = dictionaries[locale].dailyOccupancy;
  const selectedDate = new Date().toISOString().slice(0, 10);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: RoomRow } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string; description: string; status: UnitStatus; unitId: string;
  } | null>(null);

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", close, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", close, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [contextMenu]);

  const handleStatusChange = async (unitId: string, status: UnitStatus) => {
    await updateUnitStatus(unitId, status);
    router.refresh();
    setConfirmAction(null);
    setContextMenu(null);
  };

  const stateMap = useMemo(
    () => buildDailyRoomStateMap({ dailyUnits, dateStr: selectedDate, bookings, cleaningTasks }),
    [dailyUnits, selectedDate, bookings, cleaningTasks],
  );

  const roomRows = useMemo<RoomRow[]>(() => {
    return dailyUnits.map((unit) => {
      const state = stateMap.get(unit.id)!;
      const booking = state.booking;
      const customer = booking ? (customers.find((c) => c.id === booking.customer_id) ?? null) : null;
      const billing = booking ? calculateBilling(booking, selectedDate) : null;
      const unitPayments = booking ? payments.filter((p) => p.source_id === booking.id) : [];
      const totalPaid = unitPayments.reduce((sum, p) => sum + Number(p.amount), 0);

      return {
        unit,
        booking,
        customer,
        billing,
        totalPaid,
        status: state.status,
        isCheckoutDay: state.isCheckoutDay,
      };
    });
  }, [dailyUnits, stateMap, customers, payments, selectedDate]);

  const summary = useMemo(() => {
    const occupied = roomRows.filter((r) => r.status === "occupied" || r.status === "checking_out_today").length;
    const checkoutsToday = roomRows.filter((r) => r.isCheckoutDay).length;
    const cleaning = roomRows.filter((r) => r.status === "cleaning").length;
    const available = roomRows.filter((r) => r.status === "available").length;
    const openEnded = roomRows.filter((r) => r.booking?.checkout_mode === "open").length;
    const maintenance = roomRows.filter((r) => r.status === "maintenance" || r.status === "locked").length;
    return { total: dailyUnits.length, occupied, checkoutsToday, cleaning, available, openEnded, maintenance };
  }, [roomRows, dailyUnits.length]);

  const floorGroups = useMemo(() => {
    const groups = new Map<string, RoomRow[]>();
    for (const row of roomRows) {
      const floor = row.unit.floor_label || `${Math.floor(Number(row.unit.unit_no) / 100)}`;
      if (!groups.has(floor)) groups.set(floor, []);
      groups.get(floor)!.push(row);
    }
    return [...groups.entries()].sort(([a], [b]) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  }, [roomRows]);

  const shareRows = useMemo(() => {
    const occupied = roomRows.filter((r) => r.status === "occupied" || r.status === "checking_out_today" || r.status === "reserved");
    const checkingOut = roomRows.filter((r) => r.isCheckoutDay);
    const cleaning = roomRows.filter((r) => r.status === "cleaning");
    const available = roomRows.filter((r) => r.status === "available");

    return [
      { key: "occupied", label: locale === "zh" ? "占用" : "Occupe", count: occupied.length, units: occupied.map((r) => r.unit.unit_no), tone: "dark" },
      { key: "checkout", label: locale === "zh" ? "今日离店" : "Depart", count: checkingOut.length, units: checkingOut.map((r) => r.unit.unit_no), tone: "orange" },
      { key: "cleaning", label: locale === "zh" ? "待保洁" : "Menage", count: cleaning.length, units: cleaning.map((r) => r.unit.unit_no), tone: "teal" },
      { key: "available", label: locale === "zh" ? "可安排入住" : "Disponible", count: available.length, units: available.map((r) => r.unit.unit_no), tone: "green" },
    ].filter((row) => row.count > 0);
  }, [roomRows, locale]);

  const buildShareText = useCallback(() => {
    let text = `11# ${locale === "zh" ? "日租房态" : "Occupation journaliere"}\n`;
    for (const row of shareRows) {
      text += `\n${row.label}: ${row.count}\n`;
      text += `${row.units.join(", ")}\n`;
    }
    return text;
  }, [shareRows, locale]);

  const handleCopy = async () => {
    const text = buildShareText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-natural">
        <div className="flex flex-col gap-4 border-b border-neutral-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-base font-black leading-5 text-brand-neutral-950">{locale === "zh" ? "今日可发群内容" : t.shareTitle}</h3>
            <p className="mt-1 text-sm font-semibold text-brand-neutral-700">
              {locale === "zh" ? "房态摘要已按群发格式整理，可直接复制。" : "Message du jour pret a copier."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-2xl border border-neutral-200 bg-brand-neutral-50 px-4 py-2 text-sm font-black text-brand-neutral-950">
              {new Date(selectedDate).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN")}
              <span className="ml-3 text-brand-neutral-500">
                {new Date(selectedDate).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN", { weekday: "long" })}
              </span>
            </div>
            <Button variant="primary" size="sm" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? (locale === "zh" ? "已复制" : "Copie") : t.copy}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()} className="no-print">
              <Printer className="h-3.5 w-3.5" />
              {locale === "zh" ? "打印" : "Imprimer"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 bg-brand-neutral-50/70 px-5 py-4 md:grid-cols-2 xl:grid-cols-4">
          {shareRows.map((row) => (
            <ShareCard key={row.key} label={row.label} value={row.count} units={row.units} tone={row.tone as ShareTone} />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label={locale === "zh" ? "总房源" : "Total"} value={summary.total} tone="light" />
        <SummaryCard label={locale === "zh" ? "占用" : "Occupe"} value={summary.occupied} tone="dark" />
        <SummaryCard label={locale === "zh" ? "未定离店" : "Ouvert"} value={summary.openEnded} tone="orange" />
        <SummaryCard label={locale === "zh" ? "今日离店" : "Depart"} value={summary.checkoutsToday} tone="orangeSoft" />
        <SummaryCard label={locale === "zh" ? "待保洁" : "Menage"} value={summary.cleaning} tone="teal" />
        <SummaryCard label={locale === "zh" ? "空闲" : "Libre"} value={summary.available} tone="green" />
      </div>

      <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-natural">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-4">
          <div>
            <h3 className="text-base font-black text-brand-neutral-950">{locale === "zh" ? "今日房态矩阵" : "Matrice du jour"}</h3>
            <p className="mt-1 text-xs font-semibold text-brand-neutral-500">{selectedDate}</p>
          </div>
          <Legend locale={locale} />
        </div>

        <div className="grid gap-4 bg-brand-neutral-50/50 p-4 xl:grid-cols-2 2xl:grid-cols-3">
          {floorGroups.map(([floor, rows]) => (
            <div key={floor} className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-black text-brand-neutral-800">{floor}</p>
                <span className="rounded-full bg-brand-neutral-50 px-2.5 py-1 text-[11px] font-black text-brand-neutral-600">{rows.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {rows.map((row) => (
                  <DailyRoomCard key={row.unit.id} row={row} locale={locale} onContextMenu={(e, r) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, row: r }); }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {contextMenu && (
        <RoomContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          row={contextMenu.row}
          locale={locale}
          onAction={(action) => {
            const row = contextMenu.row;
            switch (action) {
              case "viewProfile":
                router.push(routeFor(locale, `/units/${row.unit.id}`));
                setContextMenu(null);
                break;
              case "copyRoomNo":
                navigator.clipboard.writeText(row.unit.unit_no);
                setContextMenu(null);
                break;
              case "copyPhone":
                if (row.customer?.phone) navigator.clipboard.writeText(row.customer.phone);
                setContextMenu(null);
                break;
              case "maintenance":
                setConfirmAction({
                  title: locale === "zh" ? "标记维修" : "En maintenance",
                  description: locale === "zh" ? "维修期间房间不可出租" : "La chambre ne sera pas disponible à la location",
                  status: "maintenance",
                  unitId: row.unit.id,
                });
                break;
              case "lock":
                setConfirmAction({
                  title: locale === "zh" ? "锁定房间" : "Bloquer",
                  description: locale === "zh" ? "锁定后房间不可出租" : "Chambre bloquée, non disponible à la location",
                  status: "locked",
                  unitId: row.unit.id,
                });
                break;
              case "markAvailable":
                setConfirmAction({
                  title: locale === "zh" ? "恢复可用" : "Disponible",
                  description: locale === "zh" ? "房间将重新开放出租" : "La chambre sera de nouveau disponible",
                  status: "available",
                  unitId: row.unit.id,
                });
                break;
            }
          }}
        />
      )}

      {confirmAction && (
        <ConfirmDialog
          open
          locale={locale}
          title={confirmAction.title}
          description={confirmAction.description}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => handleStatusChange(confirmAction.unitId, confirmAction.status)}
        />
      )}
    </div>
  );
}

type ShareTone = "dark" | "orange" | "teal" | "green";

function ShareCard({ label, value, units, tone }: { label: string; value: number; units: string[]; tone: ShareTone }) {
  const styles = {
    dark: "border-brand-orange-200 bg-brand-orange-50 text-brand-orange-900",
    orange: "border-brand-amber-200 bg-brand-amber-50 text-brand-amber-900",
    teal: "border-brand-blue-200 bg-brand-blue-50 text-brand-blue-900",
    green: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
  }[tone];

  return (
    <div className={cn("rounded-2xl border px-4 py-3 shadow-sm", styles)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-black opacity-85">{label}</p>
        <p className="text-2xl font-black tabular-nums leading-none">{value}</p>
      </div>
      <p className="mt-3 min-h-6 text-sm font-black leading-6">{units.join(", ")}</p>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "light" | "dark" | "orange" | "orangeSoft" | "teal" | "green" }) {
  const styles = {
    light: "border-neutral-200 bg-white text-brand-neutral-950",
    dark: "border-brand-orange-200 bg-brand-orange-50 text-brand-orange-900",
    orange: "border-brand-orange-200 bg-brand-orange-50 text-brand-orange-900",
    orangeSoft: "border-brand-orange-300 bg-brand-orange-100 text-brand-orange-900",
    teal: "border-brand-blue-200 bg-brand-blue-50 text-brand-blue-900",
    green: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
  }[tone];

  return (
    <div className={cn("rounded-2xl border px-4 py-3 shadow-sm", styles)}>
      <p className="text-[11px] font-black opacity-80">{label}</p>
      <p className="mt-2 text-3xl font-black leading-none tabular-nums">{value}</p>
    </div>
  );
}

function DailyRoomCard({ row, locale, onContextMenu }: { row: RoomRow; locale: Locale; onContextMenu: (e: React.MouseEvent, row: RoomRow) => void }) {
  const labelMap: Record<DailyRoomDisplayStatus, string> = locale === "zh"
    ? {
        available: "空闲",
        occupied: "占用",
        checking_out_today: "今日离店",
        reserved: "预订",
        cleaning: "待保洁",
        maintenance: "维修",
        locked: "锁定",
      }
    : {
        available: "Libre",
        occupied: "Occupe",
        checking_out_today: "Depart",
        reserved: "Reserve",
        cleaning: "Menage",
        maintenance: "Maintenance",
        locked: "Bloque",
      };

  const tone: Record<DailyRoomDisplayStatus, string> = {
    available: "border-brand-green-500 bg-brand-green-50 text-brand-green-950",
    occupied: "border-brand-orange-500 bg-brand-orange-100 text-brand-orange-950",
    checking_out_today: "border-brand-orange-300 bg-brand-orange-50 text-brand-orange-900",
    reserved: "border-brand-orange-300 bg-brand-orange-50 text-brand-orange-900",
    cleaning: "border-brand-blue-200 bg-brand-blue-50 text-brand-blue-900",
    maintenance: "border-brand-red-200 bg-brand-red-50 text-brand-red-900",
    locked: "border-brand-warm-300 bg-brand-warm-100 text-brand-ink-900",
  };

  const hasBooking = Boolean(row.booking);
  const checkoutText = row.booking?.checkout_mode === "open"
    ? (locale === "zh" ? "未定离店" : "Ouvert")
    : row.booking?.check_out;
  const outstanding = row.billing?.outstanding ?? 0;
  const guestText = row.customer?.name ?? (hasBooking ? "-" : (locale === "zh" ? "可安排入住" : "Disponible"));
  const dateText = hasBooking
    ? `${row.booking?.check_in ?? "-"} → ${checkoutText ?? "-"}`
    : (row.unit.layout ?? row.unit.floor_label);

  return (
    <Link
      href={routeFor(locale, `/units/${row.unit.id}`)}
      onContextMenu={(e) => onContextMenu(e, row)}
      className={cn(
        "group relative flex min-h-[118px] cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        tone[row.status],
      )}
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(135deg,rgba(255,255,255,0.35),transparent_58%)]" />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span className="rounded-full bg-white/90 px-2.5 py-0.5 font-mono text-sm font-black leading-6 text-brand-neutral-950 shadow-sm">
          {row.unit.unit_no}
        </span>
        <span className="rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-black leading-4 text-brand-neutral-950 shadow-sm">
          {labelMap[row.status]}
        </span>
      </div>

      <div className="relative z-10 min-w-0">
        <p className="truncate text-sm font-black">{guestText}</p>
        <p className="mt-1 truncate text-[11px] font-bold opacity-75">{dateText}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          {outstanding > 0 ? (
            <span className={cn("truncate text-[11px] font-black", row.status === "checking_out_today" || row.status === "maintenance" || row.status === "locked" ? "text-white" : "text-brand-red-700")}>
              {locale === "zh" ? "待收 " : "Reste "}{formatXof(outstanding)}
            </span>
          ) : (
            <span className="truncate text-[11px] font-bold opacity-65">{locale === "zh" ? "房间档案" : "Dossier"}</span>
          )}
          <span className="flex shrink-0 items-center gap-1">
            <span className="h-5 w-5 rounded-full bg-white/85 shadow-sm" />
            <span className="h-5 w-5 rounded-full bg-white/65 shadow-sm" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function RoomContextMenu({ x, y, row, locale, onAction }: {
  x: number; y: number;
  row: RoomRow;
  locale: Locale;
  onAction: (action: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      setPos({
        x: Math.min(x, window.innerWidth - rect.width - 8),
        y: Math.min(y, window.innerHeight - rect.height - 8),
      });
    }
    setReady(true);
  }, [x, y]);

  const items = useMemo(() => {
    const list: { key: string; icon: React.ComponentType<{ className?: string }> | null; label: string; danger?: boolean }[] = [
      { key: "viewProfile", icon: ExternalLink, label: locale === "zh" ? "查看房间档案" : "Voir le dossier" },
      { key: "copyRoomNo", icon: Copy, label: locale === "zh" ? "复制房间号" : "Copier N°" },
    ];
    if (row.customer?.phone) {
      list.push({ key: "copyPhone", icon: Phone, label: locale === "zh" ? "复制住客电话" : "Copier tél" });
    }
    list.push({ key: "separator", icon: null, label: "" });
    if (row.status !== "maintenance") {
      list.push({ key: "maintenance", icon: Wrench, label: locale === "zh" ? "标记维修" : "En maintenance" });
    }
    if (row.status !== "locked") {
      list.push({ key: "lock", icon: Lock, label: locale === "zh" ? "锁定房间" : "Bloquer" });
    }
    if (row.status === "maintenance" || row.status === "locked") {
      list.push({ key: "markAvailable", icon: Unlock, label: locale === "zh" ? "恢复可用" : "Disponible" });
    }
    return list;
  }, [row, locale]);

  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[9999] min-w-[180px] rounded-xl border border-neutral-200 bg-white p-1.5 shadow-panel",
        !ready && "invisible",
      )}
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item) =>
        item.key === "separator" ? (
          <div key="sep" className="my-1 border-t border-neutral-100" />
        ) : (
          <button
            key={item.key}
            onClick={() => onAction(item.key)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-100"
          >
            {item.icon && <item.icon className="h-4 w-4 shrink-0 text-neutral-400" />}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

function Legend({ locale }: { locale: Locale }) {
  const items = locale === "zh"
    ? [
        ["占用", "bg-brand-orange-500"],
        ["预订", "bg-brand-orange-100 ring-1 ring-brand-orange-300"],
        ["待保洁", "bg-brand-blue-500"],
        ["空闲", "bg-brand-green-500"],
        ["维修/锁定", "bg-brand-red-500"],
      ]
    : [
        ["Occupe", "bg-brand-orange-500"],
        ["Reserve", "bg-brand-orange-100 ring-1 ring-brand-orange-300"],
        ["Menage", "bg-brand-blue-500"],
        ["Libre", "bg-brand-green-500"],
        ["Maint", "bg-brand-red-500"],
      ];

  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] font-black text-brand-neutral-600">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
          {label}
        </span>
      ))}
    </div>
  );
}
