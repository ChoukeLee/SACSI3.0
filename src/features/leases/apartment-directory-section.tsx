"use client";

import { useRouter } from "next/navigation";
import { routeFor, type Locale } from "@/lib/i18n";
import { buildWorkbenchRecordHref } from "@/lib/workbench-links";
import { LeaseRoomOverview, type LeaseRoomFilter } from "./lease-room-overview";
import type { LeaseRoomOverviewRow } from "./lease-room-overview-model";

export function ApartmentDirectorySection({
  rows,
  search,
  filter,
  locale,
  unavailable = false,
  returnTo = routeFor(locale, "/leases"),
}: {
  rows: LeaseRoomOverviewRow[];
  search: string;
  filter: LeaseRoomFilter;
  locale: Locale;
  unavailable?: boolean;
  returnTo?: string;
}) {
  const router = useRouter();

  return (
    <LeaseRoomOverview
      rows={rows}
      records={[]}
      locale={locale}
      loading={false}
      error={unavailable}
      embedded={{ search, filter }}
      onSelectUnit={(row) => {
        const href = row.contract
          ? buildWorkbenchRecordHref({
              workspace: "leases",
              id: row.contract.id,
              project: row.building?.project_id,
              building: row.unit.building_id,
              locale,
              returnTo,
            })
          : buildWorkbenchRecordHref({ workspace: "units", id: row.unit.id, locale, returnTo });
        if (href) router.push(href);
      }}
      onSelectRecord={() => undefined}
      onRetry={() => router.refresh()}
    />
  );
}
