"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { SegmentedControl } from "@/components/ui/operational";

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
      <SegmentedControl value={tab} items={tabs.map((item) => ({ value: item.key, label: item.label }))} onChange={setTab} ariaLabel="Finance tabs" />
      {tab === "ledger" ? ledger : receivables}
    </div>
  );
}
