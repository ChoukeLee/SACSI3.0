import "server-only";

import { cache } from "react";
import { fetchAssetOperations } from "@/features/asset-operations/asset-operations-server";
import { buildOperatingAssetDirectory } from "@/features/asset-operations/operating-asset-directory-model";
import { parseWorkspaceQuery, WorkspaceReadError } from "@/features/contracts/workspace-model";
import { readWorkspace } from "@/features/contracts/workspace-service";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { LeaseContractRow } from "@/types/database";
import {
  buildLeaseRecordOverview,
  buildLeaseRoomOverview,
  type LeaseRecordOverviewRow,
  type LeaseRoomOverviewRow,
} from "./lease-room-overview-model";
import {
  buildApartmentCollectionRows,
  buildOperatingCollectionRows,
  type CollectionCategory,
} from "./unified-lease-collections-model";
import { UnifiedLeaseCollections } from "./unified-lease-collections";

interface ApartmentLeaseOverview {
  projectId: string | null;
  today: string;
  rows: LeaseRoomOverviewRow[];
  records: LeaseRecordOverviewRow[];
  unavailable: boolean;
}

function matchesSacsiProject(project: string | undefined, projectId: string) {
  return (
    !project ||
    project.toLowerCase() === projectId.toLowerCase() ||
    project.toUpperCase() === "SACSI"
  );
}

const readApartmentLeaseOverview = cache(
  async (
    locale: Locale,
    project: string | undefined,
    viewerId: string | undefined,
  ): Promise<ApartmentLeaseOverview> => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const user = await getCurrentUser();
      if (!user || !hasPermission(user, "leases:read") || (viewerId && viewerId !== user.id))
        throw new WorkspaceReadError(403);
      const client = await createClient();
      const { data, error } = await client
        .from("projects")
        .select("id")
        .eq("code", "SACSI")
        .eq("is_active", true)
        .single();
      const projectId: unknown = data?.id;
      if (error || typeof projectId !== "string" || !matchesSacsiProject(project, projectId))
        throw new WorkspaceReadError(403);

      const query = parseWorkspaceQuery({ projectId, locale, status: "all" });
      const workspace = await readWorkspace(
        client,
        "lease",
        query,
        "context",
        undefined,
        "sacsi",
        true,
      );
      if (!workspace.roomReceivables) throw new WorkspaceReadError();
      const input = {
        units: workspace.units,
        contracts: workspace.contracts as LeaseContractRow[],
        customers: workspace.customers,
        buildings: workspace.buildings,
        today: workspace.today,
        summaries: workspace.summaries,
        attentionDue: workspace.attentionDue,
        receivables: workspace.roomReceivables,
      };
      return {
        projectId,
        today: workspace.today,
        rows: buildLeaseRoomOverview(input),
        records: buildLeaseRecordOverview(input),
        unavailable: false,
      };
    } catch {
      return { projectId: null, today, rows: [], records: [], unavailable: true };
    }
  },
);

/** Resolve the full authorized SACSI context without applying a remembered building or list page. */
export function loadApartmentLeaseOverview({
  locale,
  project,
  viewerId,
}: {
  locale: Locale;
  project?: string;
  viewerId?: string;
}) {
  return readApartmentLeaseOverview(locale, project, viewerId);
}

export async function UnifiedLeaseCollectionsPage({
  locale,
  project,
  viewerId,
  initialCategory = "all",
}: {
  locale: Locale;
  project?: string;
  viewerId?: string;
  initialCategory?: CollectionCategory;
}) {
  const [apartments, operating] = await Promise.allSettled([
    loadApartmentLeaseOverview({ locale, project, viewerId }),
    fetchAssetOperations({ includeLeaseEvidence: true }),
  ]);
  const apartment = apartments.status === "fulfilled" ? apartments.value : null;
  const source = operating.status === "fulfilled" ? operating.value : null;
  const today = apartment?.today ?? new Date().toISOString().slice(0, 10);
  const validSource =
    source &&
    matchesSacsiProject(project, source.projectId) &&
    (!apartment?.projectId || apartment.projectId === source.projectId);
  const operatingRows = validSource
    ? buildOperatingCollectionRows(
        buildOperatingAssetDirectory(source, {
          sacsiProjectId: source.projectId,
          applyExcelConfirmation: true,
          today,
          leaseEvidence: source.leaseEvidence,
        }),
        today,
        locale,
      )
    : [];
  return (
    <UnifiedLeaseCollections
      key={initialCategory}
      rows={[...buildApartmentCollectionRows(apartment?.records ?? [], locale), ...operatingRows]}
      locale={locale}
      initialCategory={initialCategory}
      unavailable={{ apartments: apartment?.unavailable !== false, operatingAssets: !validSource }}
    />
  );
}
