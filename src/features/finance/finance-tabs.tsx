"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  ledger: React.ReactNode;
  receivables: React.ReactNode;
  locale: Locale;
}

export function FinanceTabs({ ledger, receivables, locale }: Props) {
  const t = dictionaries[locale].receivables.tabs;
  const [tab, setTab] = useState<"ledger" | "receivables">("ledger");

  const tabs = [
    { key: "ledger" as const, label: t.ledger },
    { key: "receivables" as const, label: t.receivables },
  ];

  return (
    <div className="space-y-5">
      <nav className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5 shadow-sm w-fit" aria-label="Finance tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              "shrink-0 rounded-md px-4 py-2 text-sm font-semibold transition",
              tab === item.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {tab === "ledger" ? ledger : receivables}
    </div>
  );
}
