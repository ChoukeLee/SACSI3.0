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
  const t = dictionaries[locale].mobile.stats;
  const tabs = dictionaries[locale].mobile.tabs;

  const items: { key: RoomDisplayStatus; count: number; label: string; colorClass: string }[] = [
    {
      key: "occupied",
      count: occupiedCount,
      label: tabs.occupied,
      colorClass: "text-brand-orange",
    },
    {
      key: "checking_out_today",
      count: checkingOutCount,
      label: tabs.checkingOut,
      colorClass: "text-brand-amber-600",
    },
    {
      key: "cleaning",
      count: cleaningCount,
      label: tabs.cleaning,
      colorClass: "text-brand-sky-600",
    },
    {
      key: "available",
      count: availableCount,
      label: tabs.all,
      colorClass: "text-brand-green-600",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((item) => {
        const isActive = activeTab === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onTabChange(item.key)}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl px-2 py-2.5 text-center transition-colors duration-fast",
              isActive
                ? "bg-white border border-brand-warm-400 shadow-card"
                : "bg-transparent border border-transparent active:bg-brand-warm-100",
            )}
          >
            <span
              className={cn(
                "text-lg font-bold leading-none",
                isActive ? item.colorClass : "text-brand-ink-500",
              )}
            >
              {item.count}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium mt-0.5",
                isActive ? "text-brand-ink-600" : "text-brand-ink-400",
              )}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
