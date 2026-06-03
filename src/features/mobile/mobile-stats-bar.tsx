"use client";

import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { RoomDisplayStatus } from "./room-state";
import { BedDouble, CheckCircle2, DoorOpen, Sparkles } from "lucide-react";

interface MobileStatsBarProps {
  occupiedCount: number;
  checkingOutCount: number;
  cleaningCount: number;
  availableCount: number;
  activeTab: RoomDisplayStatus;
  onTabChange: (tab: RoomDisplayStatus) => void;
  locale: Locale;
}

export function MobileStatsBar({
  occupiedCount,
  checkingOutCount,
  cleaningCount,
  availableCount,
  activeTab,
  onTabChange,
  locale,
}: MobileStatsBarProps) {
  const tabs = dictionaries[locale].mobile.tabs;

  const items = [
    { key: "checking_out_today" as const, count: checkingOutCount, label: tabs.checkingOut, icon: DoorOpen, tone: "amber" },
    { key: "cleaning" as const, count: cleaningCount, label: tabs.cleaning, icon: Sparkles, tone: "teal" },
    { key: "occupied" as const, count: occupiedCount, label: tabs.occupied, icon: BedDouble, tone: "blue" },
    { key: "available" as const, count: availableCount, label: tabs.all, icon: CheckCircle2, tone: "green" },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((item) => {
        const isActive = activeTab === item.key;
        const Icon = item.icon;
        const tone = {
          amber: "text-accentAmber-700 bg-accentAmber-50 border-accentAmber-200",
          teal: "text-emerald-700 bg-emerald-50 border-emerald-200",
          blue: "text-accentBlue-700 bg-accentBlue-50 border-accentBlue-200",
          green: "text-accentGreen-700 bg-accentGreen-50 border-accentGreen-200",
        }[item.tone];
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onTabChange(item.key)}
            className={cn(
              "flex min-h-[68px] flex-col items-start justify-between rounded-xl border px-2.5 py-2 text-left select-none",
              "transition active:scale-[0.98]",
              "active:scale-95",
              isActive
                ? cn("shadow-sm", tone)
                : "border-border/70 bg-white text-muted-foreground active:bg-muted"
            )}
          >
            <div className="flex w-full items-center justify-between gap-1">
              <Icon className={cn("h-4 w-4", isActive ? "text-current" : "text-muted-foreground")} />
              <span className={cn("text-lg font-black leading-none tabular-nums", isActive ? "text-current" : "text-foreground")}>{item.count}</span>
            </div>
            <span className={cn("text-[11px] font-bold leading-tight", isActive ? "text-current" : "text-muted-foreground")}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
