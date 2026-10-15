"use client";

import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { FilterGroup, controlClass } from "@/components/ui/operational";
import type { UnitStatus, UnitKind, BusinessType } from "@/types/domain";

interface UnitFiltersProps {
  locale: Locale;
  selectedFloor: string;
  selectedStatus: string;
  selectedKind: string;
  selectedBusiness: string;
  floors: string[];
  onFloorChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onKindChange: (value: string) => void;
  onBusinessChange: (value: string) => void;
}

const statuses: (UnitStatus | "all")[] = [
  "all",
  "available",
  "reserved",
  "daily_occupied",
  "cleaning_pending",
  "leased",
  "sold",
  "maintenance",
  "locked",
];
const kinds: (UnitKind | "all")[] = [
  "all",
  "apartment",
  "parking",
  "storefront",
  "office",
  "warehouse",
];
const businesses: (BusinessType | "all")[] = ["all", "daily_rental", "long_lease", "sale"];

export function UnitFilters({
  locale,
  selectedFloor,
  selectedStatus,
  selectedKind,
  selectedBusiness,
  floors,
  onFloorChange,
  onStatusChange,
  onKindChange,
  onBusinessChange,
}: UnitFiltersProps) {
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;
  const zh = locale === "zh";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <FilterGroup label={t.filters.floor}>
        <select
          className={controlClass}
          value={selectedFloor}
          onChange={(event) => onFloorChange(event.target.value)}
          aria-label={t.filters.floor}
        >
          <option value="all">{t.filters.all}</option>
          {floors.map((floor) => (
            <option key={floor} value={floor}>
              {floor}
            </option>
          ))}
        </select>
      </FilterGroup>
      <FilterGroup label={zh ? "状态维度" : "État"}>
        <select
          className={controlClass}
          value={selectedStatus}
          onChange={(event) => onStatusChange(event.target.value)}
          aria-label={zh ? "状态维度" : "Dimension d’état"}
        >
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status === "all"
                ? t.filters.all
                : status === "available"
                  ? zh
                    ? "无当前占用"
                    : "Sans occupation"
                  : status === "daily_occupied"
                    ? zh
                      ? "日租实际入住"
                      : "Séjour effectif"
                    : statusLabels[status]}
            </option>
          ))}
        </select>
      </FilterGroup>
      <FilterGroup label={t.filters.kind}>
        <select
          className={controlClass}
          value={selectedKind}
          onChange={(event) => onKindChange(event.target.value)}
          aria-label={t.filters.kind}
        >
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind === "all" ? t.filters.all : t.kinds[kind]}
            </option>
          ))}
        </select>
      </FilterGroup>
      <FilterGroup label={t.filters.business}>
        <select
          className={controlClass}
          value={selectedBusiness}
          onChange={(event) => onBusinessChange(event.target.value)}
          aria-label={t.filters.business}
        >
          {businesses.map((business) => (
            <option key={business} value={business}>
              {business === "all" ? t.filters.all : t.businessTypes[business]}
            </option>
          ))}
        </select>
      </FilterGroup>
    </div>
  );
}
