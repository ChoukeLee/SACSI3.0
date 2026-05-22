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
      <div className="mb-4 flex gap-1 rounded-xl border border-brand-warm-200 bg-brand-warm-100 p-1 w-fit">
        <TabBtn active={tab === "ledger"} onClick={() => setTab("ledger")} label={t.ledger} />
        <TabBtn active={tab === "receivables"} onClick={() => setTab("receivables")} label={t.receivables} />
      </div>
      {tab === "ledger" ? (
        <div key="finance-ledger-panel">{ledger}</div>
      ) : (
        <div key="finance-receivables-panel">{receivables}</div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-all duration-fast ${
        active
          ? "bg-white text-brand-ink-900 shadow-sm"
          : "text-brand-ink-500 hover:text-brand-ink-800"
      }`}
    >
      {label}
    </button>
  );
}
