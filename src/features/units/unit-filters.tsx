"use client";

import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import type { UnitStatus, UnitKind, BusinessType } from "@/types/domain";

interface UnitFiltersProps {
  locale: Locale;
  selectedFloor: string;
  selectedStatus: string;
  selectedKind: string;
  selectedBusiness: string;
  floors: string[];
  onFloorChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onKindChange: (v: string) => void;
  onBusinessChange: (v: string) => void;
}

const statusOptions: (UnitStatus | "all")[] = [
  "all", "available", "reserved", "daily_occupied", "cleaning_pending",
  "leased", "sold", "maintenance", "locked",
];

const kindOptions: (UnitKind | "all")[] = ["all", "apartment", "parking", "storefront", "office"];
const businessOptions: (BusinessType | "all")[] = ["all", "daily_rental", "long_lease", "sale"];

const selectClass =
  "h-9 rounded-md border bg-card px-3 text-xs font-medium shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";

export function UnitFilters({
  locale, selectedFloor, selectedStatus, selectedKind, selectedBusiness,
  floors, onFloorChange, onStatusChange, onKindChange, onBusinessChange,
}: UnitFiltersProps) {
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs font-semibold text-muted-foreground">
        {t.filters.floor}
      </label>
      <select className={selectClass} value={selectedFloor} onChange={(e) => onFloorChange(e.target.value)}>
        <option value="all">{t.filters.all}</option>
        {floors.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>

      <label className="text-xs font-semibold text-muted-foreground">
        {t.filters.status}
      </label>
      <select className={selectClass} value={selectedStatus} onChange={(e) => onStatusChange(e.target.value)}>
        <option value="all">{t.filters.all}</option>
        {statusOptions.filter((s) => s !== "all").map((s) => (
          <option key={s} value={s}>{statusLabels[s]}</option>
        ))}
      </select>

      <label className="text-xs font-semibold text-muted-foreground">
        {t.filters.kind}
      </label>
      <select className={selectClass} value={selectedKind} onChange={(e) => onKindChange(e.target.value)}>
        <option value="all">{t.filters.all}</option>
        {kindOptions.filter((k) => k !== "all").map((k) => (
          <option key={k} value={k}>{t.kinds[k]}</option>
        ))}
      </select>

      <label className="text-xs font-semibold text-muted-foreground">
        {t.filters.business}
      </label>
      <select className={selectClass} value={selectedBusiness} onChange={(e) => onBusinessChange(e.target.value)}>
        <option value="all">{t.filters.all}</option>
        {businessOptions.filter((b) => b !== "all").map((b) => (
          <option key={b} value={b}>{t.businessTypes[b]}</option>
        ))}
      </select>
    </div>
  );
}
