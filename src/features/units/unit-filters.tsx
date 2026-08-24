"use client";

import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { FilterGroup, SegmentedControl } from "@/components/ui/operational";
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

const kindOptions: (UnitKind | "all")[] = ["all", "apartment", "parking", "storefront", "office", "warehouse"];
const businessOptions: (BusinessType | "all")[] = ["all", "daily_rental", "long_lease", "sale"];

export function UnitFilters({
  locale, selectedFloor, selectedStatus, selectedKind, selectedBusiness,
  floors, onFloorChange, onStatusChange, onKindChange, onBusinessChange,
}: UnitFiltersProps) {
  const t = dictionaries[locale].units;
  const statusLabels = dictionaries[locale].statuses;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <FilterGroup label={t.filters.floor}>
        <SegmentedControl
          value={selectedFloor}
          onChange={onFloorChange}
          ariaLabel={t.filters.floor}
          items={[
            { value: "all", label: t.filters.all },
            ...floors.map((floor) => ({ value: floor, label: floor })),
          ]}
        />
      </FilterGroup>

      <FilterGroup label={t.filters.status}>
        <SegmentedControl
          value={selectedStatus}
          onChange={onStatusChange}
          ariaLabel={t.filters.status}
          items={statusOptions.map((status) => ({
            value: status,
            label: status === "all" ? t.filters.all : statusLabels[status],
          }))}
        />
      </FilterGroup>

      <FilterGroup label={t.filters.kind}>
        <SegmentedControl
          value={selectedKind}
          onChange={onKindChange}
          ariaLabel={t.filters.kind}
          items={kindOptions.map((kind) => ({
            value: kind,
            label: kind === "all" ? t.filters.all : t.kinds[kind],
          }))}
        />
      </FilterGroup>

      <FilterGroup label={t.filters.business}>
        <SegmentedControl
          value={selectedBusiness}
          onChange={onBusinessChange}
          ariaLabel={t.filters.business}
          items={businessOptions.map((business) => ({
            value: business,
            label: business === "all" ? t.filters.all : t.businessTypes[business],
          }))}
        />
      </FilterGroup>
    </div>
  );
}
