"use client";

import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { RoomDisplayStatus } from "./room-state";

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

  const items: { key: RoomDisplayStatus; count: number; label: string; accentClass: string }[] = [
    { key: "occupied", count: occupiedCount, label: tabs.occupied, accentClass: "text-accentBlue-600" },
    { key: "checking_out_today", count: checkingOutCount, label: tabs.checkingOut, accentClass: "text-accentAmber-600" },
    { key: "cleaning", count: cleaningCount, label: tabs.cleaning, accentClass: "text-cyan-600" },
    { key: "available", count: availableCount, label: tabs.all, accentClass: "text-accentGreen-600" },
  ];

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {items.map((item) => {
        const isActive = activeTab === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onTabChange(item.key)}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl px-1.5 py-2.5 text-center select-none",
              "transition-colors duration-[100ms]",
              "active:scale-95",
              isActive
                ? "bg-white border border-border shadow-sm"
                : "border border-transparent active:bg-muted"
            )}
          >
            <span className={cn(
              "text-lg font-black leading-none tabular-nums",
              isActive ? item.accentClass : "text-foreground/70"
            )}>
              {item.count}
            </span>
            <span className={cn(
              "text-xs font-semibold mt-0.5 leading-tight",
              isActive ? "text-foreground/70" : "text-muted-foreground"
            )}>
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
