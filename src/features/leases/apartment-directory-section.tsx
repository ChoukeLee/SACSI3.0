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
}: {
  rows: LeaseRoomOverviewRow[];
  search: string;
  filter: LeaseRoomFilter;
  locale: Locale;
  unavailable?: boolean;
}) {
  const router = useRouter();
  const returnTo = routeFor(locale, "/leases?assetCategory=all");

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
