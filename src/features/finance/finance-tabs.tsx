"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";

interface Props {
  ledger: React.ReactNode;
  receivables: React.ReactNode;
  locale: Locale;
}

export function FinanceTabs({ ledger, receivables, locale }: Props) {
  const t = dictionaries[locale].receivables.tabs;
  const [tab, setTab] = useState<"ledger" | "receivables">("ledger");

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg border border-brand-warm-400 bg-brand-warm-50 p-1 w-fit">
        <TabBtn active={tab === "ledger"} onClick={() => setTab("ledger")} label={t.ledger} />
        <TabBtn active={tab === "receivables"} onClick={() => setTab("receivables")} label={t.receivables} />
      </div>
      {tab === "ledger" ? ledger : receivables}
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-all duration-fast ${
        active
          ? "bg-white text-brand-ink-900 shadow-sm"
          : "text-brand-ink-400 hover:text-brand-ink-600"
      }`}
    >
      {label}
    </button>
  );
}
